import { describe, expect, it } from 'vitest';
import {
  assertReleaseOperators,
  evaluateReleaseEligibility,
  validateReleaseRequest,
  type ReleaseEligibilityBooking
} from './eligibility';
import type { Role } from '@tarlink/platform/auth';

const NOW = new Date('2026-10-21T09:00:00.000Z');

function booking(overrides: Partial<ReleaseEligibilityBooking> = {}): ReleaseEligibilityBooking {
  return {
    lifecycle_status: 'completed',
    payment_status: 'fully_paid',
    settlement_status: 'held',
    dispute_window_ends_at: new Date('2026-10-20T09:00:00.000Z'),
    ...overrides
  };
}

describe('evaluateReleaseEligibility', () => {
  it('accepts completed + held + paid + closed dispute window', () => {
    expect(evaluateReleaseEligibility(booking(), NOW)).toEqual({
      eligible: true,
      blocked_reason: null
    });
  });

  it('accepts dp_paid only as far as the ledger allows, and blocks the release itself', () => {
    // 001_core.sql's assert_booking_combination rejects settlement='released'
    // for dp_paid, so the queue must not promise a release that cannot commit.
    const result = evaluateReleaseEligibility(booking({ payment_status: 'dp_paid' }), NOW);
    expect(result.eligible).toBe(false);
    expect(result.blocked_reason).toContain('fully_paid');
  });

  it('blocks a booking that is not completed', () => {
    const result = evaluateReleaseEligibility(booking({ lifecycle_status: 'in_progress' }), NOW);
    expect(result.eligible).toBe(false);
    expect(result.blocked_reason).toContain('completed');
  });

  it('blocks escrow that is not held', () => {
    const result = evaluateReleaseEligibility(booking({ settlement_status: 'disputed' }), NOW);
    expect(result.eligible).toBe(false);
    expect(result.blocked_reason).toContain('held');
  });

  it('blocks unpaid and refunded bookings', () => {
    expect(evaluateReleaseEligibility(booking({ payment_status: 'unpaid' }), NOW).eligible).toBe(
      false
    );
    expect(
      evaluateReleaseEligibility(booking({ payment_status: 'refunded' }), NOW).eligible
    ).toBe(false);
  });

  it('blocks when the dispute window is missing or still open', () => {
    expect(
      evaluateReleaseEligibility(booking({ dispute_window_ends_at: null }), NOW).blocked_reason
    ).toContain('Jendela sengketa');

    const stillOpen = evaluateReleaseEligibility(
      booking({ dispute_window_ends_at: new Date('2026-10-21T09:00:01.000Z') }),
      NOW
    );
    expect(stillOpen.eligible).toBe(false);
    expect(stillOpen.blocked_reason).toContain('belum berakhir');
  });

  it('requires the window to be strictly in the past', () => {
    const exactlyNow = evaluateReleaseEligibility(
      booking({ dispute_window_ends_at: new Date(NOW.getTime()) }),
      NOW
    );
    expect(exactlyNow.eligible).toBe(false);

    const oneMsBefore = evaluateReleaseEligibility(
      booking({ dispute_window_ends_at: new Date(NOW.getTime() - 1) }),
      NOW
    );
    expect(oneMsBefore.eligible).toBe(true);
  });

  it('accepts ISO strings from the wire as well as Dates', () => {
    const result = evaluateReleaseEligibility(
      booking({ dispute_window_ends_at: '2026-10-20T09:00:00.000Z' }),
      NOW
    );
    expect(result.eligible).toBe(true);
  });
});

const BOOKING_A = '11111111-1111-4111-8111-111111111111';
const BOOKING_B = '22222222-2222-4222-8222-222222222222';

function identity(id: string, name: string, roles: string[]): {
  id: string;
  name: string;
  roles: string[];
} {
  return { id, name, roles };
}

describe('validateReleaseRequest', () => {
  it('normalises a valid request', () => {
    const result = validateReleaseRequest({
      booking_ids: [` ${BOOKING_A} `],
      reason: '  pencairan batch pagi  ',
      maker: ' Sari ',
      checker: 'Bagus'
    });
    expect(result).toEqual({
      bookingIds: [BOOKING_A],
      reason: 'pencairan batch pagi',
      maker: 'Sari',
      checker: 'Bagus'
    });
  });

  it('rejects an empty batch', () => {
    expect(() =>
      validateReleaseRequest({ booking_ids: [], reason: 'alasan cukup panjang', maker: 'A', checker: 'B' })
    ).toThrow(/minimal satu booking/);
  });

  it('rejects more than the max batch size', () => {
    const ids = Array.from(
      { length: 6 },
      (_, index) => `1111111${index}-1111-4111-8111-111111111111`
    );
    expect(() =>
      validateReleaseRequest({ booking_ids: ids, reason: 'alasan cukup panjang', maker: 'A', checker: 'B' })
    ).toThrow(/Maksimal 5 booking/);
  });

  it('rejects duplicates — a booking must not be released twice in one batch', () => {
    expect(() =>
      validateReleaseRequest({
        booking_ids: [BOOKING_A, BOOKING_A],
        reason: 'alasan cukup panjang',
        maker: 'A',
        checker: 'B'
      })
    ).toThrow(/duplikat/);
  });

  it('rejects a non-UUID id', () => {
    expect(() =>
      validateReleaseRequest({
        booking_ids: ['BK-261021-AB12'],
        reason: 'alasan cukup panjang',
        maker: 'A',
        checker: 'B'
      })
    ).toThrow(/UUID/);
  });

  it('requires at least 10 characters after trim', () => {
    expect(() =>
      validateReleaseRequest({
        booking_ids: [BOOKING_A],
        reason: '   pendek   ',
        maker: 'A',
        checker: 'B'
      })
    ).toThrow(/minimal 10 karakter/);

    expect(() =>
      validateReleaseRequest({
        booking_ids: [BOOKING_A],
        reason: '  1234567890  ',
        maker: 'A',
        checker: 'B'
      })
    ).not.toThrow();
  });

  it('rejects an empty maker or checker and identical pairs', () => {
    expect(() =>
      validateReleaseRequest({ booking_ids: [BOOKING_A], reason: 'alasan cukup panjang', maker: '', checker: 'B' })
    ).toThrow(/wajib dipilih/);

    expect(() =>
      validateReleaseRequest({
        booking_ids: [BOOKING_A],
        reason: 'alasan cukup panjang',
        maker: 'Sari',
        checker: '  sari '
      })
    ).toThrow(/berbeda dari maker/);
  });
});

describe('assertReleaseOperators', () => {
  const makr = identity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Sari', [
    'admin_finance'
  ] satisfies Role[]);
  const checker = identity('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bagus', [
    'admin_super'
  ] satisfies Role[]);

  it('accepts two different privileged operators and reports their roles', () => {
    expect(assertReleaseOperators(makr, checker)).toEqual({
      makerRole: 'admin_finance',
      checkerRole: 'admin_super'
    });
  });

  it('rejects missing users', () => {
    expect(() => assertReleaseOperators(null, checker)).toThrow(/Maker tidak ditemukan/);
    expect(() => assertReleaseOperators(makr, null)).toThrow(/Checker tidak ditemukan/);
  });

  it('rejects the same person acting as both parties', () => {
    const sameId = identity(makr.id, 'Sari', ['admin_finance', 'admin_super']);
    expect(() => assertReleaseOperators(makr, sameId)).toThrow(/berbeda dari maker/);
  });

  it('rejects a user without a finance role', () => {
    const support = identity('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Nia', ['admin_support']);
    expect(() => assertReleaseOperators(support, checker)).toThrow(/admin_finance atau admin_super/);
    expect(() => assertReleaseOperators(makr, support)).toThrow(/admin_finance atau admin_super/);
  });

  it('rejects a vendor or customer role', () => {
    const customer = identity('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Pelanggan', [
      'customer'
    ] satisfies Role[]);
    expect(() => assertReleaseOperators(customer, checker)).toThrow(/tidak memiliki peran/);
  });
});
