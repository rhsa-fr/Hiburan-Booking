import { describe, expect, it, vi } from 'vitest';
import type { ChatParticipantRow, ChatMessageRow } from './chat.repository';
import { ChatRepository } from './chat.repository';
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
    created_at: new Date(createdAt)
  };
}

function fakeRepository(overrides: Partial<ChatRepository> = {}): ChatRepository {
  return {
    findParticipants: vi.fn(),
    listMessages: vi.fn(),
    insertMessage: vi.fn(),
    ...overrides
  } as unknown as ChatRepository;
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
    expect(repository.listMessages).toHaveBeenCalledWith(BOOKING_ID, {
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

    expect(repository.listMessages).toHaveBeenCalledWith(BOOKING_ID, {
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
