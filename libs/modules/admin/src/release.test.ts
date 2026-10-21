import { describe, expect, it } from 'vitest';
import { ACCOUNT, sumCredits, sumDebits } from '@tarlink/modules/ledger';
import { buildReleaseJournalPlan, type ReleaseBookingMoney } from './eligibility';

const OCCURRED_AT = new Date('2026-10-21T02:00:00.000Z');

function booking(overrides: Partial<ReleaseBookingMoney> = {}): ReleaseBookingMoney {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'BK-261021-AB12',
    vendor_id: '3f7c1d20-5b8e-4a91-9c2d-1e4b7a6f0c11',
    // total = package 5.000.000 + service fee 50.000
    price_package_idr: '5000000',
    service_fee_idr: '50000',
    total_customer_idr: '5050000',
    commission_bp: 1000,
    commission_threshold_idr: '10000000',
    commission_bp_tier2: 500,
    commission_min_idr: '25000',
    commission_cap_idr: '7500000',
    ...overrides
  };
}

function lineFor(
  plan: ReturnType<typeof buildReleaseJournalPlan>,
  accountCode: string,
  side: 'debit' | 'credit'
): number | undefined {
  return plan.journal.lines.find(
    (line) => line.account_code === accountCode && line.side === side
  )?.amount_idr;
}

describe('buildReleaseJournalPlan', () => {
  it('produces the §6.4 scenario-3 split and balances to the rupiah', () => {
    const plan = buildReleaseJournalPlan(booking(), OCCURRED_AT);

    expect(lineFor(plan, ACCOUNT.escrow_liability_vendor.code, 'debit')).toBe(5_050_000);
    expect(lineFor(plan, ACCOUNT.platform_revenue_commission.code, 'credit')).toBe(500_000);
    expect(lineFor(plan, ACCOUNT.platform_revenue_service_fee.code, 'credit')).toBe(50_000);
    expect(lineFor(plan, ACCOUNT.vendor_payable.code, 'credit')).toBe(4_500_000);

    expect(plan.journal.debit_total_idr).toBe(5_050_000);
    expect(plan.journal.credit_total_idr).toBe(5_050_000);
    expect(sumDebits(plan.draft.lines)).toBe(sumCredits(plan.draft.lines));
    expect(plan.vendorPayableIdr).toBe(4_500_000n);
  });

  it('uses the commission snapshot stored on the booking, not today’s settings', () => {
    const plan = buildReleaseJournalPlan(
      booking({ commission_bp: 1200, commission_bp_tier2: 700 }),
      OCCURRED_AT
    );
    expect(lineFor(plan, ACCOUNT.platform_revenue_commission.code, 'credit')).toBe(600_000);
    expect(plan.vendorPayableIdr).toBe(4_400_000n);
  });

  it('applies the D-17 floor and the tier-2 band', () => {
    const floor = buildReleaseJournalPlan(
      booking({
        price_package_idr: '100000',
        service_fee_idr: '1000',
        total_customer_idr: '101000'
      }),
      OCCURRED_AT
    );
    expect(lineFor(floor, ACCOUNT.platform_revenue_commission.code, 'credit')).toBe(25_000);
    expect(floor.vendorPayableIdr).toBe(75_000n);

    const tier2 = buildReleaseJournalPlan(
      booking({
        price_package_idr: '20000000',
        service_fee_idr: '200000',
        total_customer_idr: '20200000'
      }),
      OCCURRED_AT
    );
    // 10.000.000 * 10% + 10.000.000 * 5% = 1.500.000
    expect(lineFor(tier2, ACCOUNT.platform_revenue_commission.code, 'credit')).toBe(1_500_000);
    expect(tier2.vendorPayableIdr).toBe(18_500_000n);
  });

  it('keeps the escrow debit equal to the customer total (add-ons included)', () => {
    const plan = buildReleaseJournalPlan(
      booking({
        price_package_idr: '5000000',
        service_fee_idr: '50000',
        total_customer_idr: '5300000'
      }),
      OCCURRED_AT
    );
    expect(lineFor(plan, ACCOUNT.escrow_liability_vendor.code, 'debit')).toBe(5_300_000);
    expect(lineFor(plan, ACCOUNT.vendor_payable.code, 'credit')).toBe(4_750_000);
    expect(plan.journal.debit_total_idr).toBe(plan.journal.credit_total_idr);
  });

  it('keys the entry so a retry can never post the booking twice', () => {
    const plan = buildReleaseJournalPlan(booking(), OCCURRED_AT);
    expect(plan.draft.sourceEventKey).toBe(`booking:${booking().id}:released`);
    expect(plan.draft.eventType).toBe('release');
    expect(plan.draft.referenceType).toBe('booking');
  });

  it('omits a zero service-fee credit line instead of emitting an empty line', () => {
    const plan = buildReleaseJournalPlan(
      booking({ service_fee_idr: '0', total_customer_idr: '5000000' }),
      OCCURRED_AT
    );
    expect(lineFor(plan, ACCOUNT.platform_revenue_service_fee.code, 'credit')).toBeUndefined();
    expect(plan.vendorPayableIdr).toBe(4_500_000n);
  });

  it('refuses a split larger than escrow', () => {
    expect(() =>
      buildReleaseJournalPlan(
        booking({
          price_package_idr: '5000000',
          service_fee_idr: '50000',
          // total below commission + service fee: impossible state, must fail loudly
          total_customer_idr: '500000'
        }),
        OCCURRED_AT
      )
    ).toThrow(/splits exceed the escrow balance/);
  });
});
