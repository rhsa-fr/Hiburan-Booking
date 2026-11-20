import { describe, expect, it } from 'vitest';
import type { VendorEarningsExportRow } from './vendor-portal.repository';
import {
  EARNINGS_EXPORT_MAX_DAYS,
  buildEarningsExport,
  renderEarningsCsv,
  resolveEarningsPeriod,
  sumEarnings,
  wibDateString
} from './earnings-export';

const BOOKING_ID = '33333333-3333-4333-8333-333333333333';

function row(overrides: Partial<VendorEarningsExportRow> = {}): VendorEarningsExportRow {
  return {
    booking_id: BOOKING_ID,
    code: 'TL-2611-001',
    event_title: 'Resepsi Pernikahan',
    event_start_date: '2026-11-14',
    released_at: new Date('2026-11-15T03:00:00Z'),
    gmv_idr: '10000000',
    commission_idr: '500000',
    service_fee_idr: '200000',
    vendor_entitlement_idr: '9300000',
    clawback_idr: '0',
    payout_amount_idr: '9300000',
    payout_status: 'paid',
    payout_paid_at: new Date('2026-11-16T03:00:00Z'),
    ...overrides
  };
}

describe('resolveEarningsPeriod', () => {
  it('defaults to the current WIB month when no dates are given', () => {
    // 18:00 UTC is already the next day in WIB.
    const period = resolveEarningsPeriod({}, new Date('2026-11-16T18:00:00Z'));
    expect(period).toEqual({ from: '2026-11-01', to: '2026-11-17' });
  });

  it('accepts explicit ISO dates', () => {
    expect(resolveEarningsPeriod({ from: '2026-01-01', to: '2026-01-31' })).toEqual({
      from: '2026-01-01',
      to: '2026-01-31'
    });
  });

  it('rejects a reversed range', () => {
    expect(() => resolveEarningsPeriod({ from: '2026-02-01', to: '2026-01-01' })).toThrowError(
      /Tanggal awal tidak boleh setelah tanggal akhir/
    );
  });

  it('rejects an impossible calendar date', () => {
    expect(() => resolveEarningsPeriod({ from: '2026-02-30', to: '2026-03-01' })).toThrowError(
      /bukan tanggal yang valid/
    );
  });

  it('rejects a range longer than the yearly cap', () => {
    expect(() => resolveEarningsPeriod({ from: '2024-01-01', to: '2026-01-01' })).toThrowError(
      new RegExp(`maksimal ${EARNINGS_EXPORT_MAX_DAYS} hari`)
    );
  });
});

describe('wibDateString', () => {
  it('moves an instant just before midnight UTC into the next WIB day', () => {
    expect(wibDateString(new Date('2026-11-14T18:00:00Z'))).toBe('2026-11-15');
  });
});

describe('sumEarnings', () => {
  it('adds the ledger cells and subtracts clawbacks from the net', () => {
    const totals = sumEarnings([
      row(),
      row({
        code: 'TL-2611-002',
        gmv_idr: '5000000',
        commission_idr: '250000',
        service_fee_idr: '100000',
        vendor_entitlement_idr: '4650000',
        clawback_idr: '1000000',
        payout_amount_idr: null,
        payout_status: null,
        payout_paid_at: null
      })
    ]);

    expect(totals.gmv_idr).toBe(15_000_000n);
    expect(totals.commission_idr).toBe(750_000n);
    expect(totals.service_fee_idr).toBe(300_000n);
    expect(totals.vendor_entitlement_idr).toBe(13_950_000n);
    expect(totals.clawback_idr).toBe(1_000_000n);
    expect(totals.net_vendor_idr).toBe(12_950_000n);
    expect(totals.payout_idr).toBe(9_300_000n);
  });
});

describe('renderEarningsCsv', () => {
  it('writes a BOM, the header, escaped cells, and a TOTAL row', () => {
    const rows = [
      row({ event_title: 'Akad, "Resepsi"' }),
      row({
        code: 'TL-2611-002',
        event_title: 'Sunatan',
        gmv_idr: '5000000',
        commission_idr: '250000',
        service_fee_idr: '100000',
        vendor_entitlement_idr: '4650000',
        clawback_idr: '500000',
        payout_amount_idr: null,
        payout_status: null,
        payout_paid_at: null
      })
    ];
    const totals = sumEarnings(rows);
    const csv = renderEarningsCsv(rows, totals);

    expect(csv.startsWith('\uFEFFtanggal_lepas,kode_booking,judul_acara')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('"Akad, ""Resepsi"""');
    expect(csv).toContain('2026-11-15,TL-2611-001');
    expect(csv).toContain('9300000,paid,2026-11-16');

    const lines = csv.replace('\uFEFF', '').trimEnd().split('\r\n');
    expect(lines).toHaveLength(4); // header + 2 rows + TOTAL
    expect(lines[3]).toBe(
      'TOTAL,,,,' +
        '15000000,750000,300000,13950000,500000,13450000,9300000,,'
    );
  });

  it('still writes a zero TOTAL for an empty range', () => {
    const csv = renderEarningsCsv([], sumEarnings([]));
    const lines = csv.replace('\uFEFF', '').trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('TOTAL,,,,0,0,0,0,0,0,0,,');
  });

  it('neutralizes spreadsheet formulas in user-supplied titles', () => {
    const rows = [row({ event_title: '=HYPERLINK("http://evil")' })];
    const csv = renderEarningsCsv(rows, sumEarnings(rows));
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe('buildEarningsExport', () => {
  it('returns the filename, safe JSON totals, and the CSV in one payload', () => {
    const period = { from: '2026-11-01', to: '2026-11-30' };
    const result = buildEarningsExport(period, [row()]);

    expect(result.filename).toBe('pendapatan-vendor-2026-11-01_2026-11-30.csv');
    expect(result.source).toBe('release_journal');
    expect(result.row_count).toBe(1);
    expect(result.period).toEqual(period);
    expect(result.totals).toEqual({
      gmv_idr: 10_000_000,
      commission_idr: 500_000,
      service_fee_idr: 200_000,
      vendor_entitlement_idr: 9_300_000,
      clawback_idr: 0,
      net_vendor_idr: 9_300_000,
      payout_idr: 9_300_000
    });
    expect(result.csv).toContain('TOTAL,,,');
  });
});
