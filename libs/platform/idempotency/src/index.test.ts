import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import { FixedClock } from '@tarlink/platform/clock';
import {
  IdempotencyService,
  type ClaimRequest,
  type IdempotencyRecord,
  type IdempotencyStore
} from './index';

const KEY = '2f8e6a4c-0b1d-4c9e-9c1a-1a2b3c4d5e6f';
const SCOPE = 'POST /bookings';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** In-memory stand-in for the unique index on (actor_id, scope, key). */
class MemoryStore implements IdempotencyStore {
  readonly rows = new Map<string, IdempotencyRecord>();

  private id(scope: string, key: string, actorId: string | null): string {
    return `${actorId ?? '∅'}|${scope}|${key}`;
  }

  async tryClaim(request: ClaimRequest): Promise<boolean> {
    const id = this.id(request.scope, request.key, request.actorId);
    // The unit double keeps rows for the whole test; TTL reclaim belongs to
    // the Postgres store and is not exercised here, so wall-clock time must
    // not decide whether a FixedClock fixture is still alive.
    if (this.rows.has(id)) return false;

    this.rows.set(id, {
      requestHash: request.requestHash,
      status: 'in_progress',
      responseStatus: null,
      responseBody: null,
      lockedUntil: request.lockedUntil,
      expiresAt: request.expiresAt
    });
    return true;
  }

  async read(
    scope: string,
    key: string,
    actorId: string | null
  ): Promise<IdempotencyRecord | null> {
    return this.rows.get(this.id(scope, key, actorId)) ?? null;
  }

  async complete(
    scope: string,
    key: string,
    actorId: string | null,
    responseStatus: number,
    responseBody: unknown
  ): Promise<void> {
    const row = this.rows.get(this.id(scope, key, actorId));
    if (!row) throw new Error('missing key');
    row.status = 'completed';
    row.responseStatus = responseStatus;
    row.responseBody = responseBody;
    row.lockedUntil = null;
  }

  async fail(
    scope: string,
    key: string,
    actorId: string | null,
    responseStatus: number
  ): Promise<void> {
    const row = this.rows.get(this.id(scope, key, actorId));
    if (!row) throw new Error('missing key');
    row.status = 'failed';
    row.responseStatus = responseStatus;
    row.lockedUntil = null;
  }

  async takeOver(
    scope: string,
    key: string,
    actorId: string | null,
    lockedUntil: Date
  ): Promise<void> {
    const row = this.rows.get(this.id(scope, key, actorId));
    if (!row) throw new Error('missing key');
    row.lockedUntil = lockedUntil;
  }
}

function newService(store: IdempotencyStore, clock?: FixedClock): IdempotencyService {
  return new IdempotencyService(store, {
    actorId: 'user-1',
    clock: clock ?? new FixedClock('2026-10-21T00:00:00.000Z')
  });
}

describe('IdempotencyService', () => {
  it('executes once and stores the response', async () => {
    const store = new MemoryStore();
    const service = newService(store);
    const fn = vi.fn(async () => ({ bookingId: 'b-1' }));

    await expect(service.run(KEY, SCOPE, sha256('create'), fn)).resolves.toEqual({
      bookingId: 'b-1'
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('replays the stored response for the same key and hash', async () => {
    const store = new MemoryStore();
    const service = newService(store);
    const fn = vi.fn(async () => ({ bookingId: 'b-1' }));

    await service.run(KEY, SCOPE, sha256('create'), fn);
    const replayed = await service.run(KEY, SCOPE, sha256('create'), fn);

    expect(replayed).toEqual({ bookingId: 'b-1' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects the same key with a different payload', async () => {
    const store = new MemoryStore();
    const service = newService(store);
    const fn = vi.fn(async () => 'ok');

    await service.run(KEY, SCOPE, sha256('create'), fn);

    await expect(service.run(KEY, SCOPE, sha256('different'), fn)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH'
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('scopes keys per endpoint', async () => {
    const store = new MemoryStore();
    const service = newService(store);
    const fn = vi.fn(async () => 'ok');

    await service.run(KEY, SCOPE, sha256('create'), fn);
    await service.run(KEY, 'POST /payments', sha256('create'), fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('refuses a second runner while the first holds the lease', async () => {
    const store = new MemoryStore();
    const service = newService(store);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = vi.fn();

    const first = service.run(KEY, SCOPE, sha256('create'), async () => {
      entered();
      await gate;
      return 'first';
    });

    while (entered.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    await expect(
      service.run(KEY, SCOPE, sha256('create'), async () => 'second')
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    release();
    await expect(first).resolves.toBe('first');
  });

  it('takes over an expired lease left by a crashed runner', async () => {
    const clock = new FixedClock('2026-10-21T00:00:00.000Z');
    const store = new MemoryStore();
    const service = newService(store, clock);

    await store.tryClaim({
      scope: SCOPE,
      key: KEY,
      actorId: 'user-1',
      requestHash: sha256('create'),
      lockedUntil: new Date('2026-10-21T00:00:05.000Z'),
      expiresAt: new Date('2026-10-22T00:00:00.000Z')
    });

    clock.advance(60_000);
    const result = await service.run(KEY, SCOPE, sha256('create'), async () => 'recovered');

    expect(result).toBe('recovered');
    expect(store.rows.get(`user-1|${SCOPE}|${KEY}`)?.status).toBe('completed');
  });

  it('allows a retry after a failed attempt', async () => {
    const store = new MemoryStore();
    const service = newService(store);

    await expect(
      service.run(KEY, SCOPE, sha256('create'), async () => {
        throw new AppError('CONFLICT', 'domain failure');
      })
    ).rejects.toThrow('domain failure');

    expect(store.rows.get(`user-1|${SCOPE}|${KEY}`)?.status).toBe('failed');

    await expect(
      service.run(KEY, SCOPE, sha256('create'), async () => 'retried')
    ).resolves.toBe('retried');
  });

  it('fails loudly when the winning row is not yet visible', async () => {
    const store = new MemoryStore();
    const service = newService(store);
    store.tryClaim = async () => false;

    await expect(service.run(KEY, SCOPE, sha256('create'), async () => 'x')).rejects.toMatchObject(
      { code: 'CONFLICT' }
    );
  });

  it('validates key and hash shape before touching the store', async () => {
    const store = new MemoryStore();
    const service = newService(store);

    await expect(service.run('short', SCOPE, sha256('x'), async () => 'x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    await expect(service.run(KEY, SCOPE, 'not-a-hash', async () => 'x')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(store.rows.size).toBe(0);
  });
});
