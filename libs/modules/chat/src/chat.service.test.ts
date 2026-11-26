import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { ChatParticipantRow, ChatMessageRow, ChatThreadRow } from './chat.repository';
import {
  ChatRepository,
  READ_NOTIFY_BATCH_SIZE,
  buildChatReadNotification,
  toChatMessageView
} from './chat.repository';
import {
  ChatService,
  decodeChatCursor,
  encodeChatCursor,
  normalizeChatBody
} from './chat.service';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const VENDOR_OWNER_ID = '33333333-3333-4333-8333-333333333333';
const OUTSIDER_ID = '44444444-4444-4444-8444-444444444444';

function participant(overrides: Partial<ChatParticipantRow> = {}): ChatParticipantRow {
  return {
    customer_id: CUSTOMER_ID,
    vendor_id: '55555555-5555-4555-8555-555555555555',
    is_customer: false,
    is_vendor_owner: false,
    is_vendor_member: false,
    ...overrides
  };
}

function row(id: string, createdAt: string, body = 'halo'): ChatMessageRow {
  return {
    id,
    booking_id: BOOKING_ID,
    sender_id: CUSTOMER_ID,
    sender_role: 'customer',
    body,
    created_at: new Date(createdAt),
    read_at: null
  };
}

function threadRow(overrides: Partial<ChatThreadRow> = {}): ChatThreadRow {
  return {
    booking_id: BOOKING_ID,
    booking_code: 'TRL-2611-0001',
    vendor_id: '55555555-5555-4555-8555-555555555555',
    vendor_name: 'Organ Tarling DWS',
    customer_name: 'Rina Puspita',
    last_message: 'Halo, masih tersedia?',
    last_at: new Date('2026-11-26T08:00:00.000Z'),
    unread_count: 2,
    is_customer: true,
    ...overrides
  };
}

function fakeRepository(overrides: Partial<ChatRepository> = {}): ChatRepository {
  return {
    findParticipants: vi.fn(),
    listMessages: vi.fn(),
    listThreads: vi.fn(),
    insertMessage: vi.fn(),
    markRead: vi.fn(),
    ...overrides
  } as unknown as ChatRepository;
}

interface RecordedQuery {
  text: string;
  params?: unknown[];
}

/**
 * Minimal `pg` stand-in: `markRead` only needs `connect`, a client `query` and
 * `release`. Rows returned for the UPDATE are the ids that *would* be flipped.
 */
function fakePool(updatedIds: string[]): {
  pool: Pool;
  queries: RecordedQuery[];
  release: ReturnType<typeof vi.fn>;
} {
  const queries: RecordedQuery[] = [];
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    queries.push({ text, params });
    if (/^\s*UPDATE/i.test(text)) return { rows: updatedIds.map((id) => ({ id })) };
    return { rows: [] };
  });
  const release = vi.fn();
  const pool = {
    connect: vi.fn(async () => ({ query, release }))
  } as unknown as Pool;
  return { pool, queries, release };
}

describe('normalizeChatBody', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeChatBody('  halo vendor  ')).toBe('halo vendor');
  });

  it('rejects empty and whitespace-only bodies', () => {
    expect(() => normalizeChatBody('   ')).toThrow('Pesan tidak boleh kosong');
    expect(() => normalizeChatBody(undefined)).toThrow('Pesan wajib berupa teks');
  });

  it('rejects bodies above 2000 characters', () => {
    expect(() => normalizeChatBody('a'.repeat(2001))).toThrow('maksimal 2000');
  });
});

describe('chat cursor', () => {
  it('round-trips the timestamp and id', () => {
    const original = row(
      '66666666-6666-4666-8666-666666666666',
      '2026-11-05T10:00:00.000Z'
    );
    const decoded = decodeChatCursor(encodeChatCursor(original));
    expect(decoded.id).toBe(original.id);
    expect(decoded.createdAt.toISOString()).toBe('2026-11-05T10:00:00.000Z');
  });

  it('rejects a malformed cursor', () => {
    expect(() => decodeChatCursor('not-a-cursor')).toThrow('tidak valid');
  });
});

describe('ChatService.resolveRole', () => {
  it('maps the booking customer to customer', async () => {
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant({ is_customer: true }))
    });
    const service = new ChatService(repository);
    await expect(
      service.resolveRole(BOOKING_ID, { id: CUSTOMER_ID, roles: ['customer'] })
    ).resolves.toBe('customer');
  });

  it('maps the vendor owner and active member to vendor', async () => {
    const ownerRepository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant({ is_vendor_owner: true }))
    });
    await expect(
      new ChatService(ownerRepository).resolveRole(BOOKING_ID, {
        id: VENDOR_OWNER_ID,
        roles: ['vendor_owner']
      })
    ).resolves.toBe('vendor');

    const memberRepository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant({ is_vendor_member: true }))
    });
    await expect(
      new ChatService(memberRepository).resolveRole(BOOKING_ID, {
        id: VENDOR_OWNER_ID,
        roles: ['vendor_member']
      })
    ).resolves.toBe('vendor');
  });

  it('gives admins read/write access for dispute handling', async () => {
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant())
    });
    await expect(
      new ChatService(repository).resolveRole(BOOKING_ID, {
        id: OUTSIDER_ID,
        roles: ['admin_support']
      })
    ).resolves.toBe('admin');
  });

  it('rejects an unrelated account', async () => {
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant())
    });
    await expect(
      new ChatService(repository).resolveRole(BOOKING_ID, {
        id: OUTSIDER_ID,
        roles: ['customer']
      })
    ).rejects.toThrow('tidak terlibat');
  });

  it('returns NOT_FOUND for an unknown booking and rejects a bad id', async () => {
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(null)
    });
    const service = new ChatService(repository);
    await expect(
      service.resolveRole(BOOKING_ID, { id: CUSTOMER_ID, roles: ['customer'] })
    ).rejects.toThrow('Booking tidak ditemukan');
    await expect(
      service.resolveRole('not-a-uuid', { id: CUSTOMER_ID, roles: ['customer'] })
    ).rejects.toThrow('invalid booking id');
  });
});

describe('ChatService.list', () => {
  it('returns the page ascending and points to the next older cursor', async () => {
    const newest = row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-11-05T10:02:00.000Z');
    const middle = row('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-11-05T10:01:00.000Z');
    const oldest = row('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2026-11-05T10:00:00.000Z');
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant({ is_customer: true })),
      listMessages: vi.fn().mockResolvedValue([newest, middle, oldest])
    });

    const page = await new ChatService(repository).list(
      BOOKING_ID,
      { id: CUSTOMER_ID, roles: ['customer'] },
      { limit: 2 }
    );

    expect(page.items.map((item) => item.id)).toEqual([middle.id, newest.id]);
    expect(page.next_before).toBe(encodeChatCursor(middle));
    expect(repository.listMessages).toHaveBeenCalledWith(BOOKING_ID, CUSTOMER_ID, {
      beforeCreatedAt: null,
      beforeId: null,
      limit: 3
    });
  });

  it('passes the decoded cursor to the repository', async () => {
    const cursorRow = row('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '2026-11-05T09:00:00.000Z');
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant({ is_customer: true })),
      listMessages: vi.fn().mockResolvedValue([])
    });

    const page = await new ChatService(repository).list(
      BOOKING_ID,
      { id: CUSTOMER_ID, roles: ['customer'] },
      { limit: 50, before: encodeChatCursor(cursorRow) }
    );

    expect(repository.listMessages).toHaveBeenCalledWith(BOOKING_ID, CUSTOMER_ID, {
      beforeCreatedAt: cursorRow.created_at,
      beforeId: cursorRow.id,
      limit: 51
    });
    expect(page).toEqual({ items: [], next_before: null });
  });
});

describe('ChatService.send', () => {
  it('stores the sender role derived from the booking, not the token', async () => {
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant({ is_customer: true })),
      insertMessage: vi.fn().mockResolvedValue(
        row('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '2026-11-05T11:00:00.000Z', 'halo')
      )
    });

    const message = await new ChatService(repository).send(
      BOOKING_ID,
      { id: CUSTOMER_ID, roles: ['admin_finance'] },
      '  halo  '
    );

    expect(repository.insertMessage).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      senderId: CUSTOMER_ID,
      senderRole: 'customer',
      body: 'halo'
    });
    expect(message.body).toBe('halo');
  });
});

describe('toChatMessageView', () => {
  it('keeps an unread message null and serializes a read timestamp', () => {
    const unread = toChatMessageView(
      row('77777777-7777-4777-8777-777777777777', '2026-11-22T08:00:00.000Z')
    );
    expect(unread.read_at).toBeNull();

    const read = toChatMessageView({
      ...row('88888888-8888-4888-8888-888888888888', '2026-11-22T08:00:00.000Z'),
      read_at: new Date('2026-11-22T09:00:00.000Z')
    });
    expect(read.read_at).toBe('2026-11-22T09:00:00.000Z');
  });
});

describe('ChatRepository.markRead', () => {
  const READ_AT = new Date('2026-11-22T09:00:00.000Z');

  it('flips only unread messages the reader did not send', async () => {
    const { pool, queries, release } = fakePool([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    ]);

    const result = await new ChatRepository(pool).markRead(BOOKING_ID, CUSTOMER_ID, READ_AT);

    expect(result).toEqual({
      read_ids: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      ],
      read_at: READ_AT
    });
    const update = queries.find((entry) => /^\s*UPDATE/i.test(entry.text));
    expect(update?.text).toContain('SET read_at = $3::timestamptz');
    expect(update?.text).toContain('sender_id <> $2::uuid');
    expect(update?.text).toContain('read_at IS NULL');
    // The caller's clock, not SQL now(): the returned value is what was written.
    expect(update?.params).toEqual([BOOKING_ID, CUSTOMER_ID, READ_AT]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: nothing unread returns empty ids and emits no notification', async () => {
    const { pool, queries } = fakePool([]);

    const result = await new ChatRepository(pool).markRead(BOOKING_ID, CUSTOMER_ID, READ_AT);

    expect(result).toEqual({ read_ids: [], read_at: READ_AT });
    expect(queries.some((entry) => /pg_notify/i.test(entry.text))).toBe(false);
  });

  it('notifies once inside the same transaction, after the update', async () => {
    const messageIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];
    const { pool, queries } = fakePool(messageIds);

    await new ChatRepository(pool).markRead(BOOKING_ID, CUSTOMER_ID, READ_AT);

    const steps = queries.map(
      (entry) =>
        /BEGIN/i.test(entry.text)
          ? 'BEGIN'
          : /^\s*UPDATE/i.test(entry.text)
            ? 'UPDATE'
            : /pg_notify/i.test(entry.text)
              ? 'NOTIFY'
              : /COMMIT/i.test(entry.text)
                ? 'COMMIT'
                : 'OTHER'
    );
    expect(steps).toEqual(['BEGIN', 'UPDATE', 'NOTIFY', 'COMMIT']);

    const notify = queries.find((entry) => /pg_notify/i.test(entry.text));
    expect(notify?.params?.[0]).toBe('tarlink_chat');
    expect(notify?.params?.[1]).toBe(
      `{"type":"read","booking_id":"${BOOKING_ID}","reader_id":"${CUSTOMER_ID}",` +
        `"message_ids":["${messageIds[0]}"],"read_at":"2026-11-22T09:00:00.000Z"}`
    );
  });

  it('chunks large reads into one notification per 100 ids', async () => {
    const ids = Array.from(
      { length: 250 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    );
    const { pool, queries } = fakePool(ids);

    const result = await new ChatRepository(pool).markRead(BOOKING_ID, CUSTOMER_ID, READ_AT);

    expect(result.read_ids).toEqual(ids);
    const notifies = queries.filter((entry) => /pg_notify/i.test(entry.text));
    expect(READ_NOTIFY_BATCH_SIZE).toBe(100);
    expect(notifies).toHaveLength(3);

    const batches = notifies.map(
      (entry) =>
        (JSON.parse(String(entry.params?.[1])) as { message_ids: string[] }).message_ids
    );
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(ids);
    // The payload is far below the 8000-byte pg_notify limit in every batch.
    for (const entry of notifies) {
      expect(Buffer.byteLength(String(entry.params?.[1]), 'utf8')).toBeLessThan(8000);
    }
  });

  it('rolls back and rethrows when the notify fails', async () => {
    const queries: string[] = [];
    const query = vi.fn(async (text: string) => {
      queries.push(text);
      if (/pg_notify/i.test(text)) throw new Error('notify failed');
      if (/^\s*UPDATE/i.test(text)) {
        return { rows: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({ query, release }))
    } as unknown as Pool;

    await expect(
      new ChatRepository(pool).markRead(BOOKING_ID, CUSTOMER_ID, READ_AT)
    ).rejects.toThrow('notify failed');

    expect(queries.some((text) => /^ROLLBACK/i.test(text))).toBe(true);
    expect(queries.some((text) => /^COMMIT/i.test(text))).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('buildChatReadNotification', () => {
  it('emits the frozen read payload shape', () => {
    const payload = buildChatReadNotification(
      BOOKING_ID,
      CUSTOMER_ID,
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
      new Date('2026-11-22T09:00:00.000Z')
    );

    expect(payload).toBe(
      `{"type":"read","booking_id":"${BOOKING_ID}","reader_id":"${CUSTOMER_ID}",` +
        '"message_ids":["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",' +
        '"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],"read_at":"2026-11-22T09:00:00.000Z"}'
    );
  });
});

describe('ChatService.markRead', () => {
  const READ_AT = new Date('2026-11-22T09:00:00.000Z');

  it('reuses the listing authorization and returns ISO timestamps', async () => {
    const markRead = vi.fn().mockResolvedValue({
      read_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      read_at: READ_AT
    });
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant({ is_customer: true })),
      markRead
    });

    const receipt = await new ChatService(repository).markRead(
      BOOKING_ID,
      { id: CUSTOMER_ID, roles: ['customer'] },
      READ_AT
    );

    expect(receipt).toEqual({
      read_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      read_at: '2026-11-22T09:00:00.000Z'
    });
    expect(repository.findParticipants).toHaveBeenCalledWith(BOOKING_ID, CUSTOMER_ID);
    expect(markRead).toHaveBeenCalledWith(BOOKING_ID, CUSTOMER_ID, READ_AT);
  });

  it('returns an empty receipt when there was nothing to mark', async () => {
    const markRead = vi.fn().mockResolvedValue({ read_ids: [], read_at: READ_AT });
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant({ is_vendor_owner: true })),
      markRead
    });

    const receipt = await new ChatService(repository).markRead(
      BOOKING_ID,
      { id: VENDOR_OWNER_ID, roles: ['vendor_owner'] },
      READ_AT
    );

    expect(receipt).toEqual({ read_ids: [], read_at: '2026-11-22T09:00:00.000Z' });
    // The vendor side still reaches the writer, unlike the admin branch.
    expect(markRead).toHaveBeenCalledWith(BOOKING_ID, VENDOR_OWNER_ID, READ_AT);
  });

  it('never writes read ticks for an admin, only echoes the clock', async () => {
    const markRead = vi.fn();
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant()),
      markRead
    });

    const receipt = await new ChatService(repository).markRead(
      BOOKING_ID,
      { id: OUTSIDER_ID, roles: ['admin_super'] },
      READ_AT
    );

    expect(receipt).toEqual({ read_ids: [], read_at: '2026-11-22T09:00:00.000Z' });
    expect(markRead).not.toHaveBeenCalled();
  });

  it('defaults the admin read_at to the process clock', async () => {
    const markRead = vi.fn();
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant()),
      markRead
    });

    const before = Date.now();
    const receipt = await new ChatService(repository).markRead(BOOKING_ID, {
      id: OUTSIDER_ID,
      roles: ['admin_finance']
    });

    expect(receipt.read_ids).toEqual([]);
    expect(new Date(receipt.read_at).getTime()).toBeGreaterThanOrEqual(before);
    expect(markRead).not.toHaveBeenCalled();
  });

  it('rejects an unrelated account before touching messages', async () => {
    const markRead = vi.fn();
    const repository = fakeRepository({
      findParticipants: vi.fn().mockResolvedValue(participant()),
      markRead
    });

    await expect(
      new ChatService(repository).markRead(
        BOOKING_ID,
        { id: OUTSIDER_ID, roles: ['customer'] },
        READ_AT
      )
    ).rejects.toThrow('tidak terlibat');
    expect(markRead).not.toHaveBeenCalled();
  });
});
describe('ChatService.threads', () => {
  it('uses the vendor name for a customer and the customer name for a vendor', async () => {
    const listThreads = vi.fn().mockResolvedValue([
      threadRow(),
      threadRow({ is_customer: false, booking_id: '66666666-6666-4666-8666-666666666666' })
    ]);
    const service = new ChatService(fakeRepository({ listThreads }));

    const rows = await service.threads({ id: CUSTOMER_ID, roles: ['customer'] });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      counterpart_name: 'Organ Tarling DWS',
      counterpart_role: 'vendor',
      unread_count: 2
    });
    expect(rows[1]).toMatchObject({
      counterpart_name: 'Rina Puspita',
      counterpart_role: 'customer'
    });
  });
});
