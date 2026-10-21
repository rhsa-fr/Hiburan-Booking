import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The role grant lives in SQL, so this test pins the contract between service
 * and repository: the grant must be issued for the freshly inserted vendor id,
 * inside the same transaction callback, and a failure must not be swallowed.
 *
 * `withTransaction` is replaced by a pass-through that hands the callback a
 * sentinel "client"; the repository methods are spied, so no database is hit.
 */
vi.mock('@tarlink/core/db', () => ({
  query: vi.fn(),
  withTransaction: async <T>(fn: (client: unknown) => Promise<T>): Promise<T> => fn({})
}));

import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';
import type { VendorRow } from './rows';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';

const VENDOR_ROW: VendorRow = {
  id: VENDOR_ID,
  slug: 'tarling-dian',
  display_name: 'Tarling Dian',
  legal_name: null,
  description: null,
  base_address: null,
  region_code: '32',
  verification_status: 'pending',
  verification_note: null,
  service_radius_km: null,
  free_radius_km: 0,
  transport_fee_per_km_idr: '0',
  min_dp_bp: 3000,
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  verified_at: null,
  verified_by: null
};

function arrange(): {
  service: CatalogService;
  insertVendor: ReturnType<typeof vi.spyOn>;
  grantVendorOwner: ReturnType<typeof vi.spyOn>;
} {
  const repository = new CatalogRepository();
  vi.spyOn(repository, 'regionExists').mockResolvedValue(true);
  vi.spyOn(repository, 'findActiveUserByPhone').mockResolvedValue(OWNER_ID);
  vi.spyOn(repository, 'vendorIdForOwner').mockResolvedValue(null);
  vi.spyOn(repository, 'takenSlugs').mockResolvedValue([]);
  const insertVendor = vi.spyOn(repository, 'insertVendor').mockResolvedValue(VENDOR_ROW);
  const grantVendorOwner = vi
    .spyOn(repository, 'grantVendorOwner')
    .mockResolvedValue(undefined);

  return { service: new CatalogService(repository), insertVendor, grantVendorOwner };
}

const CREATE_INPUT = {
  owner_phone: '0899000012341',
  region_code: '32',
  display_name: 'Tarling Dian'
};

describe('CatalogService.createVendor — vendor_owner grant', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('grants vendor_owner scoped to the new vendor id', async () => {
    const { service, grantVendorOwner } = arrange();

    const created = await service.createVendor(CREATE_INPUT);

    expect(created.id).toBe(VENDOR_ID);
    expect(grantVendorOwner).toHaveBeenCalledTimes(1);

    const call = grantVendorOwner.mock.calls[0];
    expect(call?.[1]).toBe(OWNER_ID);
    expect(call?.[2]).toBe(VENDOR_ID);
  });

  it('grants after the vendor row exists', async () => {
    const { service, insertVendor, grantVendorOwner } = arrange();

    await service.createVendor(CREATE_INPUT);

    const insertOrder = insertVendor.mock.invocationCallOrder[0];
    const grantOrder = grantVendorOwner.mock.invocationCallOrder[0];
    expect(insertOrder).toBeDefined();
    expect(grantOrder).toBeDefined();
    expect(grantOrder ?? 0).toBeGreaterThan(insertOrder ?? 0);
  });

  it('fails the whole create when the grant fails (no swallow)', async () => {
    const { service, grantVendorOwner } = arrange();
    grantVendorOwner.mockRejectedValue(new Error('user_roles check violated'));

    await expect(service.createVendor(CREATE_INPUT)).rejects.toThrow('user_roles check violated');
  });
});
