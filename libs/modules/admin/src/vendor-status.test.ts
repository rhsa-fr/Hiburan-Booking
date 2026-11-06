import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
vi.mock('@tarlink/core/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: async <T>(fn: (client: unknown) => Promise<T>): Promise<T> => fn({})
}));

import { AdminRepository } from './admin.repository';
import { mapVendor, mapVerificationStatus } from './mappers';
import type { VendorRow } from './rows';

const baseVendorRow: VendorRow = {
  id: 'v-1',
  name: 'Test Vendor',
  slug: 'test-vendor',
  legal_name: null,
  description: null,
  base_address: null,
  service_radius_km: 10,
  free_radius_km: 5,
  transport_fee_per_km_idr: '10000',
  min_dp_bp: 3000,
  verification_note: null,
  verified_by: null,
  city: 'Indramayu',
  owner_name: 'Owner',
  phone: '08123456789',
  verification_status: 'approved',
  verified_at: new Date('2026-11-01T00:00:00.000Z'),
  calendar_updated_at: new Date('2026-11-01T00:00:00.000Z'),
  created_at: new Date('2026-11-01T00:00:00.000Z'),
  response_rate_bp: 10000,
  rating_x10: 50,
  completed_bookings: 10,
  is_active: true,
  bank_id: null,
  bank_name: null,
  bank_masked: null,
  bank_holder: null,
  bank_status: null,
  bank_cooling_until: null,
  bank_verified_at: null,
  bank_rejection_reason: null
};

describe('vendor verification mapper', () => {
  it('maps suspended to suspended without collapsing into rejected', () => {
    expect(mapVerificationStatus('suspended')).toBe('suspended');
    expect(mapVerificationStatus('rejected')).toBe('rejected');
    expect(mapVerificationStatus('approved')).toBe('verified');
    expect(mapVerificationStatus('pending')).toBe('pending');
  });

  it('throws INTERNAL_ERROR for unknown status', () => {
    expect(() => mapVerificationStatus('bogus')).toThrowError(/unknown vendor verification status/);
  });

  it('maps suspension fields on vendor detail/list item when suspended', () => {
    const row = {
      ...baseVendorRow,
      verification_status: 'suspended',
      suspended_at: new Date('2026-11-06T07:00:00.000Z'),
      suspended_by: 'admin-uuid-1',
      suspension_reason: 'Pelanggaran ketentuan operasional'
    };

    const vendor = mapVendor(row);
    expect(vendor.verification_status).toBe('suspended');
    expect(vendor.suspended_at).toBe('2026-11-06T07:00:00.000Z');
    expect(vendor.suspended_by).toBe('admin-uuid-1');
    expect(vendor.suspension_reason).toBe('Pelanggaran ketentuan operasional');
  });

  it('maps suspension fields as null when vendor is not suspended', () => {
    const vendor = mapVendor(baseVendorRow);
    expect(vendor.verification_status).toBe('verified');
    expect(vendor.suspended_at).toBeNull();
    expect(vendor.suspended_by).toBeNull();
    expect(vendor.suspension_reason).toBeNull();
  });
});

describe('AdminRepository vendor list filter & region queries', () => {
  let repo: AdminRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([]);
    repo = new AdminRepository();
  });

  it('builds SQL for verification=verified', async () => {
    await repo.listVendors({ q: '', city: '', verification: 'verified' });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("v.verification_status = 'approved'");
  });

  it('builds SQL for verification=pending', async () => {
    await repo.listVendors({ q: '', city: '', verification: 'pending' });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("v.verification_status = 'pending'");
  });

  it('builds SQL for verification=rejected without including suspended', async () => {
    await repo.listVendors({ q: '', city: '', verification: 'rejected' });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("v.verification_status = 'rejected'");
    expect(sql).not.toContain("('rejected', 'suspended')");
  });

  it('builds SQL for verification=suspended', async () => {
    await repo.listVendors({ q: '', city: '', verification: 'suspended' });
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("v.verification_status = 'suspended'");
  });

  it('rejects unknown verification filter with VALIDATION_ERROR', async () => {
    await expect(
      repo.listVendors({ q: '', city: '', verification: 'invalid' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('excludes suspended vendors in listRegions vendor_count subquery', async () => {
    await repo.listRegions();
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("v.verification_status <> 'suspended'");
  });

  it('excludes suspended vendors in findRegion vendor_count subquery', async () => {
    await repo.findRegion('3212');
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("v.verification_status <> 'suspended'");
  });
});
