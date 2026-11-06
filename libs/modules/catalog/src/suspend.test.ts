import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tarlink/core/db', () => ({
  query: vi.fn(),
  withTransaction: async <T>(fn: (client: unknown) => Promise<T>): Promise<T> => fn({})
}));

import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';
import type { VendorRow } from './rows';
import type { AuthenticatedRequest } from '@tarlink/platform/auth';

const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = 'req-trace-9999';
const NOW = new Date('2026-11-06T10:00:00.000Z');

const APPROVED_ROW: VendorRow = {
  id: VENDOR_ID,
  slug: 'tarling-dian',
  display_name: 'Tarling Dian',
  legal_name: null,
  description: null,
  base_address: null,
  region_code: '32',
  verification_status: 'approved',
  verification_note: null,
  service_radius_km: null,
  free_radius_km: 0,
  transport_fee_per_km_idr: '0',
  min_dp_bp: 3000,
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  verified_at: new Date('2026-01-02T00:00:00.000Z'),
  verified_by: ACTOR_ID,
  suspended_at: null,
  suspended_by: null,
  suspension_reason: null,
  suspension_previous_status: null
};

const SUSPENDED_ROW: VendorRow = {
  ...APPROVED_ROW,
  verification_status: 'suspended',
  suspended_at: NOW,
  suspended_by: ACTOR_ID,
  suspension_reason: 'Pelanggaran ketentuan layanan penonton',
  suspension_previous_status: 'approved'
};

function arrange() {
  const repository = new CatalogRepository();
  const lockVendor = vi.spyOn(repository, 'lockVendor');
  const setApproved = vi.spyOn(repository, 'setApproved');
  const setRejected = vi.spyOn(repository, 'setRejected');
  const setSuspended = vi.spyOn(repository, 'setSuspended');
  const setUnsuspended = vi.spyOn(repository, 'setUnsuspended');
  const insertAudit = vi.spyOn(repository, 'insertAudit').mockResolvedValue(undefined);
  const service = new CatalogService(repository);

  return {
    repository,
    service,
    lockVendor,
    setApproved,
    setRejected,
    setSuspended,
    setUnsuspended,
    insertAudit
  };
}

describe('Vendor suspension — service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('suspends an approved vendor and returns suspension payload', async () => {
    const { service, lockVendor, setSuspended, insertAudit } = arrange();
    lockVendor.mockResolvedValue(APPROVED_ROW);
    setSuspended.mockResolvedValue(SUSPENDED_ROW);

    const result = await service.suspendVendor(
      VENDOR_ID,
      { reason: '  Pelanggaran ketentuan layanan penonton  ' },
      { actorId: ACTOR_ID, actorRole: 'admin_super', requestId: REQUEST_ID }
    );

    expect(setSuspended).toHaveBeenCalledWith(
      expect.anything(),
      VENDOR_ID,
      {
        actorId: ACTOR_ID,
        reason: 'Pelanggaran ketentuan layanan penonton',
        previousStatus: 'approved'
      }
    );

    expect(insertAudit).toHaveBeenCalledWith(
      expect.anything(),
      {
        actorId: ACTOR_ID,
        actorRole: 'admin_super',
        action: 'vendor.suspend',
        entityType: 'vendor',
        entityId: VENDOR_ID,
        beforeState: {
          verification_status: 'approved',
          suspended_at: null,
          suspended_by: null,
          suspension_reason: null,
          suspension_previous_status: null
        },
        afterState: {
          verification_status: 'suspended',
          suspended_at: NOW.toISOString(),
          suspended_by: ACTOR_ID,
          suspension_reason: 'Pelanggaran ketentuan layanan penonton',
          suspension_previous_status: 'approved'
        },
        requestId: REQUEST_ID
      }
    );

    expect(result).toEqual({
      id: VENDOR_ID,
      verification_status: 'suspended',
      suspended_at: NOW.toISOString(),
      suspension_reason: 'Pelanggaran ketentuan layanan penonton',
      suspended_by: ACTOR_ID
    });
  });

  it('rejects suspension of non-approved vendor', async () => {
    const { service, lockVendor } = arrange();
    lockVendor.mockResolvedValue({ ...APPROVED_ROW, verification_status: 'pending' });

    await expect(
      service.suspendVendor(
        VENDOR_ID,
        { reason: 'Pelanggaran berat ketentuan layanan' },
        { actorId: ACTOR_ID, actorRole: 'admin_super', requestId: REQUEST_ID }
      )
    ).rejects.toMatchObject({
      code: 'CONFLICT'
    });
  });

  it('rejects double suspend with specific Indonesian message', async () => {
    const { service, lockVendor } = arrange();
    lockVendor.mockResolvedValue(SUSPENDED_ROW);

    await expect(
      service.suspendVendor(
        VENDOR_ID,
        { reason: 'Pelanggaran berat ketentuan layanan' },
        { actorId: ACTOR_ID, actorRole: 'admin_super', requestId: REQUEST_ID }
      )
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Vendor sudah dalam status ditangguhkan'
    });
  });

  it('rejects suspend when vendor is not found', async () => {
    const { service, lockVendor } = arrange();
    lockVendor.mockResolvedValue(null);

    await expect(
      service.suspendVendor(
        VENDOR_ID,
        { reason: 'Pelanggaran berat ketentuan layanan' },
        { actorId: ACTOR_ID, actorRole: 'admin_super', requestId: REQUEST_ID }
      )
    ).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });

  it('validates reason length and whitespace at service boundary', async () => {
    const { service } = arrange();

    // Less than 10 characters
    await expect(
      service.suspendVendor(
        VENDOR_ID,
        { reason: 'Terlalu' },
        { actorId: ACTOR_ID, actorRole: 'admin_super', requestId: REQUEST_ID }
      )
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });

    // Whitespace only
    await expect(
      service.suspendVendor(
        VENDOR_ID,
        { reason: '                  ' },
        { actorId: ACTOR_ID, actorRole: 'admin_super', requestId: REQUEST_ID }
      )
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });

    // More than 500 characters
    await expect(
      service.suspendVendor(
        VENDOR_ID,
        { reason: 'a'.repeat(501) },
        { actorId: ACTOR_ID, actorRole: 'admin_super', requestId: REQUEST_ID }
      )
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('unsuspends a suspended vendor and restores approved status', async () => {
    const { service, lockVendor, setUnsuspended, insertAudit } = arrange();
    lockVendor.mockResolvedValue(SUSPENDED_ROW);
    setUnsuspended.mockResolvedValue({
      ...APPROVED_ROW,
      suspended_at: null,
      suspended_by: null,
      suspension_reason: null,
      suspension_previous_status: null
    });

    const result = await service.unsuspendVendor(VENDOR_ID, {
      actorId: ACTOR_ID,
      actorRole: 'admin_super',
      requestId: REQUEST_ID
    });

    expect(setUnsuspended).toHaveBeenCalledWith(expect.anything(), VENDOR_ID, {
      restoreStatus: 'approved'
    });

    expect(insertAudit).toHaveBeenCalledWith(
      expect.anything(),
      {
        actorId: ACTOR_ID,
        actorRole: 'admin_super',
        action: 'vendor.unsuspend',
        entityType: 'vendor',
        entityId: VENDOR_ID,
        beforeState: {
          verification_status: 'suspended',
          suspended_at: NOW.toISOString(),
          suspended_by: ACTOR_ID,
          suspension_reason: 'Pelanggaran ketentuan layanan penonton',
          suspension_previous_status: 'approved'
        },
        afterState: {
          verification_status: 'approved',
          suspended_at: null,
          suspended_by: null,
          suspension_reason: null,
          suspension_previous_status: null
        },
        requestId: REQUEST_ID
      }
    );

    expect(result).toEqual({
      id: VENDOR_ID,
      verification_status: 'approved',
      suspended_at: null,
      suspension_reason: null,
      suspended_by: null
    });
  });

  it('rejects unsuspend of non-suspended vendor', async () => {
    const { service, lockVendor } = arrange();
    lockVendor.mockResolvedValue(APPROVED_ROW);

    await expect(
      service.unsuspendVendor(VENDOR_ID, {
        actorId: ACTOR_ID,
        actorRole: 'admin_super',
        requestId: REQUEST_ID
      })
    ).rejects.toMatchObject({
      code: 'CONFLICT'
    });
  });

  it('rejects unsuspend when vendor is not found', async () => {
    const { service, lockVendor } = arrange();
    lockVendor.mockResolvedValue(null);

    await expect(
      service.unsuspendVendor(VENDOR_ID, {
        actorId: ACTOR_ID,
        actorRole: 'admin_super',
        requestId: REQUEST_ID
      })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });

  it('rejects verifyVendor on a suspended vendor with CONFLICT without calling repository or audit', async () => {
    const { service, lockVendor, setApproved, setRejected, insertAudit } = arrange();
    lockVendor.mockResolvedValue(SUSPENDED_ROW);

    await expect(
      service.verifyVendor(
        VENDOR_ID,
        { decision: 'approve' },
        { actorId: ACTOR_ID, actorRole: 'admin_super', requestId: REQUEST_ID }
      )
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Vendor sedang ditangguhkan. Batalkan penangguhan terlebih dahulu sebelum memverifikasi.'
    });

    expect(setApproved).not.toHaveBeenCalled();
    expect(setRejected).not.toHaveBeenCalled();
    expect(insertAudit).not.toHaveBeenCalled();
  });

  it('allows verifyVendor on a pending vendor with decision approve', async () => {
    const { service, lockVendor, setApproved, setRejected, insertAudit } = arrange();
    lockVendor.mockResolvedValue({ ...APPROVED_ROW, verification_status: 'pending' });
    setApproved.mockResolvedValue({
      id: VENDOR_ID,
      verification_status: 'approved',
      verification_note: null,
      verified_at: NOW,
      verified_by: ACTOR_ID
    });

    const result = await service.verifyVendor(
      VENDOR_ID,
      { decision: 'approve' },
      { actorId: ACTOR_ID, actorRole: 'admin_super', requestId: REQUEST_ID }
    );

    expect(setApproved).toHaveBeenCalledWith(expect.anything(), VENDOR_ID, ACTOR_ID);
    expect(setRejected).not.toHaveBeenCalled();
    expect(insertAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'vendor.approve',
        entityId: VENDOR_ID,
        beforeState: { verification_status: 'pending' },
        afterState: {
          verification_status: 'approved',
          verification_note: null,
          verified_at: NOW.toISOString(),
          verified_by: ACTOR_ID
        }
      })
    );
    expect(result).toEqual({
      id: VENDOR_ID,
      verification_status: 'approved',
      verified_at: NOW.toISOString(),
      verified_by: ACTOR_ID
    });
  });
});

describe('Vendor suspension — controller', () => {
  function arrangeController() {
    const service = {
      suspendVendor: vi.fn(),
      unsuspendVendor: vi.fn()
    };
    const controller = new CatalogController(service as unknown as CatalogService);
    const mockRequest = {
      user: {
        id: ACTOR_ID,
        roles: ['admin_super']
      }
    } as unknown as AuthenticatedRequest;

    return { controller, service, mockRequest };
  }

  it('routes POST :id/suspend with trimmed reason and valid audit context', async () => {
    const { controller, service, mockRequest } = arrangeController();
    service.suspendVendor.mockResolvedValue({
      id: VENDOR_ID,
      verification_status: 'suspended',
      suspended_at: NOW.toISOString(),
      suspension_reason: 'Pelanggaran berat regulasi pertunjukan',
      suspended_by: ACTOR_ID
    });

    const result = await controller.suspendVendor(
      VENDOR_ID,
      {
        reason: '  Pelanggaran berat regulasi pertunjukan  ',
        note: 'Peringatan ketiga sudah diabaikan'
      },
      REQUEST_ID,
      mockRequest
    );

    expect(service.suspendVendor).toHaveBeenCalledWith(
      VENDOR_ID,
      {
        reason: 'Pelanggaran berat regulasi pertunjukan',
        note: 'Peringatan ketiga sudah diabaikan'
      },
      {
        actorId: ACTOR_ID,
        actorRole: 'admin_super',
        requestId: REQUEST_ID
      }
    );

    expect(result.verification_status).toBe('suspended');
  });

  it('rejects invalid reason length in controller', async () => {
    const { controller, mockRequest } = arrangeController();

    await expect(
      controller.suspendVendor(
        VENDOR_ID,
        { reason: 'pendek' },
        REQUEST_ID,
        mockRequest
      )
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });

    await expect(
      controller.suspendVendor(
        VENDOR_ID,
        { reason: '            ' },
        REQUEST_ID,
        mockRequest
      )
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('routes POST :id/unsuspend with valid audit context', async () => {
    const { controller, service, mockRequest } = arrangeController();
    service.unsuspendVendor.mockResolvedValue({
      id: VENDOR_ID,
      verification_status: 'approved',
      suspended_at: null,
      suspension_reason: null,
      suspended_by: null
    });

    const result = await controller.unsuspendVendor(
      VENDOR_ID,
      REQUEST_ID,
      mockRequest
    );

    expect(service.unsuspendVendor).toHaveBeenCalledWith(
      VENDOR_ID,
      {
        actorId: ACTOR_ID,
        actorRole: 'admin_super',
        requestId: REQUEST_ID
      }
    );

    expect(result.verification_status).toBe('approved');
  });
});
