import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '@tarlink/platform/auth';
import { AdminController } from './admin.controller';
import type { AdminService } from './admin.service';
import type { AdminRegion } from './contracts';
import { mapRegion } from './mappers';

const REGION: AdminRegion = {
  code: '3212',
  name: 'Indramayu',
  level: 'regency',
  parent_code: '32',
  is_active: true,
  vendor_count: 3
};

function request(userId = 'admin-1'): AuthenticatedRequest {
  return {
    headers: {},
    user: { id: userId, roles: ['admin_super'] }
  };
}

describe('mapRegion', () => {
  it('keeps the wire shape and the active-vendor count', () => {
    expect(
      mapRegion({
        code: '3212',
        name: 'Indramayu',
        level: 'regency',
        parent_code: '32',
        is_active: false,
        vendor_count: 0
      })
    ).toEqual({
      code: '3212',
      name: 'Indramayu',
      level: 'regency',
      parent_code: '32',
      is_active: false,
      vendor_count: 0
    });
  });
});

describe('AdminController regions', () => {
  it('lists regions through the service', async () => {
    const regions = vi.fn().mockResolvedValue([REGION]);
    const controller = new AdminController({ regions } as unknown as AdminService);

    await expect(controller.regions()).resolves.toEqual([REGION]);
    expect(regions).toHaveBeenCalledOnce();
  });

  it('rejects a body without is_active before touching the service', async () => {
    const setRegionActive = vi.fn();
    const controller = new AdminController({ setRegionActive } as unknown as AdminService);

    await expect(
      controller.setRegionActive('3212', {}, undefined, request())
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(setRegionActive).not.toHaveBeenCalled();
  });

  it('passes the actor and request id, and returns the updated region', async () => {
    const updated = { ...REGION, is_active: false, vendor_count: 0 };
    const setRegionActive = vi.fn().mockResolvedValue(updated);
    const controller = new AdminController({ setRegionActive } as unknown as AdminService);

    const result = await controller.setRegionActive(
      '3212',
      { is_active: false },
      'req-9',
      request('admin-super-1')
    );

    expect(result).toEqual(updated);
    expect(setRegionActive).toHaveBeenCalledWith('3212', false, {
      actorId: 'admin-super-1',
      requestId: 'req-9'
    });
  });

  it('requires an authenticated actor', async () => {
    const controller = new AdminController({ setRegionActive: vi.fn() } as unknown as AdminService);

    await expect(
      controller.setRegionActive('3212', { is_active: false }, undefined, { headers: {} })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
