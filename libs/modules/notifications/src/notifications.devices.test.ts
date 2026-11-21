/**
 * Device-token ownership at the HTTP/service boundary.
 *
 * The point of these tests is that the account id always comes from the access
 * token: the body has no `user_id`, and a delete is scoped by `user_id` so a
 * known token cannot be removed from someone else's account.
 */
import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { AppError } from '@tarlink/core/errors';
import type { AuthenticatedRequest, Role } from '@tarlink/platform/auth';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

const CALLER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'fcm-token:APA91b-example-token-value-0001';

interface DeviceRow {
  userId: string;
  platform: string;
}

/**
 * In-memory device table. The upsert deliberately mirrors the SQL constraint
 * (`UNIQUE(token)` -> the row moves to the last caller), so a service that
 * took the owner from the body would be caught here.
 */
class FakeDeviceStore {
  readonly rows = new Map<string, DeviceRow>();

  upsertCalls: { userId: string; token: string; platform: string }[] = [];
  removeCalls: string[] = [];

  async upsertDeviceToken(userId: string, token: string, platform: string): Promise<void> {
    this.upsertCalls.push({ userId, token, platform });
    this.rows.set(token, { userId, platform });
  }

  async removeDeviceToken(userId: string, token: string): Promise<number> {
    this.removeCalls.push(userId);
    const row = this.rows.get(token);
    if (!row || row.userId !== userId) return 0;
    this.rows.delete(token);
    return 1;
  }
}

function request(userId = CALLER): AuthenticatedRequest {
  return {
    headers: {},
    user: { id: userId, roles: ['customer' as Role] }
  };
}

function controller(store: FakeDeviceStore): NotificationsController {
  const service = new NotificationsService(store as unknown as NotificationsRepository);
  return new NotificationsController(service);
}

function errorCode(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'NO_ERROR',
    (err: unknown) => (err instanceof AppError ? err.code : 'NOT_APP_ERROR')
  );
}

describe('NotificationsController device registration', () => {
  it('registers the token for the caller from the access token', async () => {
    const store = new FakeDeviceStore();

    const response = await controller(store).registerDevice(
      { token: TOKEN, platform: 'android' },
      request()
    );

    expect(response).toEqual({ data: { registered: true } });
    expect(store.upsertCalls).toEqual([{ userId: CALLER, token: TOKEN, platform: 'android' }]);
  });

  it('re-owns a token registered earlier by another account', async () => {
    const store = new FakeDeviceStore();

    await controller(store).registerDevice({ token: TOKEN, platform: 'android' }, request(OTHER_USER));
    await controller(store).registerDevice({ token: TOKEN, platform: 'ios' }, request(CALLER));

    expect(store.rows.get(TOKEN)).toEqual({ userId: CALLER, platform: 'ios' });
  });

  it('rejects an out-of-range token or an unknown platform', async () => {
    const store = new FakeDeviceStore();
    const devices = controller(store);

    await expect(errorCode(devices.registerDevice({ token: 'short', platform: 'android' }, request()))).resolves.toBe(
      'VALIDATION_ERROR'
    );
    await expect(
      errorCode(devices.registerDevice({ token: TOKEN, platform: 'symbian' }, request()))
    ).resolves.toBe('VALIDATION_ERROR');
    expect(store.upsertCalls).toHaveLength(0);
  });

  it('removes the caller own token', async () => {
    const store = new FakeDeviceStore();
    const devices = controller(store);
    await devices.registerDevice({ token: TOKEN, platform: 'android' }, request());

    const response = await devices.removeDevice(TOKEN, request());

    expect(response).toEqual({ data: { removed: true } });
    expect(store.rows.has(TOKEN)).toBe(false);
  });

  it('removes nothing when the token belongs to another user', async () => {
    const store = new FakeDeviceStore();
    const devices = controller(store);
    await devices.registerDevice({ token: TOKEN, platform: 'android' }, request(OTHER_USER));

    const response = await devices.removeDevice(TOKEN, request(CALLER));

    expect(response).toEqual({ data: { removed: false } });
    // The other account still owns its device.
    expect(store.rows.get(TOKEN)).toEqual({ userId: OTHER_USER, platform: 'android' });
    expect(store.removeCalls).toEqual([CALLER]);
  });

  it('accepts a URL-decoded token exactly as Nest hands it over', async () => {
    const store = new FakeDeviceStore();
    const devices = controller(store);
    const decoded = 'fcm:APA91b/with+encoded=chars-0123456789';

    await devices.registerDevice({ token: decoded, platform: 'web' }, request());

    expect(store.upsertCalls[0]?.token).toBe(decoded);
  });

  it('rejects a path token that is too short', async () => {
    const store = new FakeDeviceStore();

    await expect(errorCode(controller(store).removeDevice('short', request()))).resolves.toBe(
      'VALIDATION_ERROR'
    );
    expect(store.removeCalls).toHaveLength(0);
  });
});

describe('NotificationsRepository device SQL', () => {
  function repositoryWith(rowCount: number): {
    repository: NotificationsRepository;
    calls: { text: string; params: readonly unknown[] }[];
  } {
    const calls: { text: string; params: readonly unknown[] }[] = [];
    const pool = {
      async query(text: string, params: readonly unknown[]) {
        calls.push({ text, params });
        return { rows: [], rowCount };
      }
    };
    return {
      repository: new NotificationsRepository(pool as unknown as Pool),
      calls
    };
  }

  it('re-owns the token row on conflict instead of inserting a duplicate', async () => {
    const { repository, calls } = repositoryWith(1);

    await repository.upsertDeviceToken(CALLER, TOKEN, 'android');

    const sql = calls[0]?.text ?? '';
    expect(sql).toContain('INSERT INTO device_tokens (user_id, token, platform)');
    expect(sql).toContain('ON CONFLICT (token) DO UPDATE');
    expect(sql).toContain('user_id = EXCLUDED.user_id');
    expect(sql).toContain('updated_at = now()');
    expect(calls[0]?.params).toEqual([CALLER, TOKEN, 'android']);
  });

  it('scopes the delete by user_id and reports the row count', async () => {
    const { repository, calls } = repositoryWith(0);

    const removed = await repository.removeDeviceToken(CALLER, TOKEN);

    const sql = calls[0]?.text ?? '';
    expect(sql).toContain('DELETE FROM device_tokens');
    expect(sql).toMatch(/WHERE user_id = \$1::uuid\s+AND token = \$2/);
    expect(calls[0]?.params).toEqual([CALLER, TOKEN]);
    // 0 rows = token missing or owned by someone else; the API answers
    // `removed: false` either way.
    expect(removed).toBe(0);
  });
});
