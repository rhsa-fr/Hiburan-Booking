import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import type { CatalogService } from '@tarlink/modules/catalog';
import { MEDIA_NOT_APPROVED_CODE } from './media.contracts';
import { MediaRepository } from './media.repository';
import type { MediaService } from './media.service';
import { VendorPortalController } from './vendor-portal.controller';
import { VendorPortalRepository, type VendorPortalVendorRow } from './vendor-portal.repository';
import { VendorPortalService } from './vendor-portal.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const BOOKING_ID = '33333333-3333-4333-8333-333333333333';
const MEDIA_ID = '44444444-4444-4444-8444-444444444444';

const MOCK_VENDOR: VendorPortalVendorRow = {
  id: VENDOR_ID,
  display_name: 'Tarling Dangdut Pantura',
  slug: 'tarling-dangdut-pantura',
  region_code: '32.09',
  verification_status: 'approved',
  suspension_reason: null,
  suspended_at: null,
  is_active: true,
  calendar_updated_at: new Date('2026-05-01T00:00:00Z'),
  legal_name: null,
  description: null,
  base_address: null,
  service_radius_km: null,
  free_radius_km: 0,
  transport_fee_per_km_idr: '0',
  min_dp_bp: 3000,
  avatar_url: null,
  banner_url: null,
  photo_urls: [],
  video_url: null,
  whatsapp: null
};

const MOCK_SUSPENDED_VENDOR: VendorPortalVendorRow = {
  ...MOCK_VENDOR,
  verification_status: 'suspended',
  suspension_reason: 'Melanggar ketentuan katalog vendor',
  suspended_at: new Date('2026-05-10T10:00:00Z')
};

function createService(
  repoOverrides: Partial<VendorPortalRepository> = {},
  mediaRepoOverrides: Partial<MediaRepository> = {}
) {
  const repo = new VendorPortalRepository();
  Object.assign(repo, repoOverrides);
  const mediaRepo = new MediaRepository();
  Object.assign(mediaRepo, {
    findApprovedUrls: vi.fn().mockResolvedValue(new Set()),
    insertSubmission: vi.fn().mockResolvedValue({ id: MEDIA_ID, status: 'pending' }),
    findById: vi.fn().mockResolvedValue(null),
    deleteById: vi.fn().mockResolvedValue(undefined),
    ...mediaRepoOverrides
  });
  const catalog = {
    listPackages: vi.fn(),
    createPackage: vi.fn(),
    updatePackage: vi.fn(),
    deletePackage: vi.fn(),
    writeCalendar: vi.fn()
  };
  return {
    service: new VendorPortalService(
      repo,
      catalog as unknown as CatalogService,
      mediaRepo as unknown as MediaRepository
    ),
    repo,
    catalog,
    mediaRepo
  };
}

function createController(
  repoOverrides: Partial<VendorPortalRepository> = {},
  mediaRepoOverrides: Partial<MediaRepository> = {},
  mediaServiceOverrides: Partial<MediaService> = {}
) {
  const { service, repo, catalog, mediaRepo } = createService(repoOverrides, mediaRepoOverrides);
  const mediaService = {
    save: vi.fn().mockResolvedValue({
      url: 'http://localhost:3001/v1/media/test-file.jpg',
      filename: 'test-file.jpg'
    }),
    ...mediaServiceOverrides
  };
  const controller = new VendorPortalController(
    service,
    mediaService as unknown as MediaService,
    mediaRepo
  );
  return { controller, service, repo, catalog, mediaRepo, mediaService };
}

describe('VendorPortalService', () => {
  describe('requireVendor', () => {
    it('throws NOT_FOUND when vendor does not exist for the user', async () => {
      const { service } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(null)
      });

      await expect(service.getMe(USER_ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Vendor tidak ditemukan untuk akun ini.'
      });
    });

    it('returns vendor when found', async () => {
      const { service } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR)
      });

      const result = await service.getMe(USER_ID);
      expect(result).toEqual(MOCK_VENDOR);
    });
  });

  describe('getDashboard', () => {
    it('returns vendor and summary data', async () => {
      const summary = {
        total_bookings: 15,
        pending_count: 3,
        this_month_count: 5,
        this_month_idr: '25000000'
      };

      const { service } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR),
        getSummary: vi.fn().mockResolvedValue(summary)
      });

      const result = await service.getDashboard(USER_ID);
      expect(result).toEqual({
        vendor: MOCK_VENDOR,
        summary
      });
    });
  });

  describe('listBookings', () => {
    it('calculates pagination, strips total_count, and returns page object', async () => {
      const mockRows = [
        {
          id: BOOKING_ID,
          code: 'TRL-BK-001',
          lifecycle_status: 'requested',
          payment_status: 'unpaid',
          settlement_status: 'not_eligible',
          total_customer_idr: '5000000',
          dp_amount_idr: '1500000',
          vendor_entitlement_idr: '4500000',
          respond_deadline: new Date('2026-06-01T12:00:00Z'),
          created_at: new Date('2026-05-30T12:00:00Z'),
          event_title: 'Pernikahan A & B',
          event_start_date: '2026-07-01',
          event_region_code: '32.09',
          customer_phone: '081234567890',
          customer_name: 'Budi Santoso',
          total_count: 1
        }
      ];

      const listBookingsSpy = vi.fn().mockResolvedValue(mockRows);
      const { service } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR),
        listBookings: listBookingsSpy
      });

      const result = await service.listBookings(USER_ID, 2, 10, 'requested');

      expect(listBookingsSpy).toHaveBeenCalledWith(VENDOR_ID, 'requested', 10, 10);
      expect(result.page).toBe(2);
      expect(result.page_size).toBe(10);
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect('total_count' in result.items[0]!).toBe(false);
      expect(result.items[0]!.id).toBe(BOOKING_ID);
    });

    it('handles empty results properly', async () => {
      const { service } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR),
        listBookings: vi.fn().mockResolvedValue([])
      });

      const result = await service.listBookings(USER_ID, 1, 20);
      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        page_size: 20
      });
    });
  });

  describe('getBookingDetail', () => {
    it('throws NOT_FOUND when booking does not exist or does not belong to vendor', async () => {
      const { service } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR),
        findBookingForVendor: vi.fn().mockResolvedValue(null)
      });

      await expect(service.getBookingDetail(USER_ID, BOOKING_ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Booking tidak ditemukan'
      });
    });

    it('returns booking detail when found', async () => {
      const mockDetail = {
        id: BOOKING_ID,
        code: 'TRL-BK-001',
        customer_id: '44444444-4444-4444-8444-444444444444',
        vendor_id: VENDOR_ID,
        event_id: '55555555-5555-4555-8555-555555555555',
        package_id: '66666666-6666-4666-8666-666666666666',
        lifecycle_status: 'confirmed',
        payment_status: 'dp_paid',
        settlement_status: 'held',
        currency: 'IDR',
        price_package_idr: '5000000',
        price_addons_idr: '0',
        price_transport_idr: '0',
        service_fee_idr: '25000',
        discount_idr: '0',
        total_customer_idr: '5025000',
        dp_amount_idr: '1500000',
        vendor_entitlement_idr: '4500000',
        commission_idr: '500000',
        pricing_snapshot: {},
        respond_deadline: new Date(),
        counter_deadline: null,
        payment_deadline: null,
        scheduled_start_at: null,
        scheduled_end_at: null,
        checkin_at: null,
        confirmed_at: new Date(),
        started_at: null,
        completed_at: null,
        cancelled_at: null,
        cancel_reason: null,
        released_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        event_title: 'Pernikahan',
        event_type: 'wedding',
        event_region_code: '32.09',
        event_venue_name: 'Gedung Serbaguna',
        event_venue_address: 'Jl. Raya No. 1',
        event_start_date: '2026-07-01',
        event_end_date: '2026-07-01',
        event_notes: null,
        event_guest_estimate: 500,
        customer_name: 'Budi Santoso',
        customer_phone: '081234567890',
        customer_email: 'budi@example.com',
        package_name: 'Paket Komplit',
        package_duration_minutes: 360,
        package_description: 'Full sound system & kendang'
      };

      const { service } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR),
        findBookingForVendor: vi.fn().mockResolvedValue(mockDetail)
      });

      const result = await service.getBookingDetail(USER_ID, BOOKING_ID);
      expect(result).toEqual(mockDetail);
    });
  });

  describe('getEarnings', () => {
    it('returns held_idr and settled list', async () => {
      const settledRows = [
        {
          id: BOOKING_ID,
          code: 'TRL-BK-001',
          vendor_entitlement_idr: '4500000',
          released_at: new Date('2026-06-05T00:00:00Z'),
          settlement_status: 'settled',
          event_title: 'Pernikahan',
          event_start_date: '2026-06-01',
          total_count: 1
        }
      ];

      const { service } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR),
        getHeldBalance: vi.fn().mockResolvedValue('9000000'),
        listSettledBookings: vi.fn().mockResolvedValue(settledRows),
        getPayoutSummary: vi.fn().mockResolvedValue({
          available_idr: '4500000',
          pending_payout_idr: '0',
          bank_code: 'bca',
          bank_name: 'BCA',
          account_number_masked: '****7890',
          account_holder_name: 'Tarling Dangdut Pantura',
          bank_status: 'verified'
        })
      });

      const result = await service.getEarnings(USER_ID, 1, 20);

      expect(result.held_idr).toBe('9000000');
      expect(result.held_balance_idr).toBe('9000000');
      expect(result.available_idr).toBe('4500000');
      expect(result.bank_account).toMatchObject({
        bank_code: 'bca',
        account_number_masked: '****7890'
      });
      expect(result.settled.total).toBe(1);
      expect(result.settled.page).toBe(1);
      expect(result.settled.page_size).toBe(20);
      expect(result.settled.items).toHaveLength(1);
      expect('total_count' in result.settled.items[0]!).toBe(false);
      expect(result.settled.items[0]!.id).toBe(BOOKING_ID);
    });
  });

  describe('write access', () => {
    it('updates only the owner vendor profile and converts the transport fee to BIGINT', async () => {
      const update = vi.fn().mockResolvedValue({ ...MOCK_VENDOR, display_name: 'Baru' });
      const { service } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR),
        updateOwnProfile: update
      });

      await service.updateMe(USER_ID, {
        display_name: 'Baru',
        transport_fee_per_km_idr: 15000
      });

      expect(update).toHaveBeenCalledWith(
        VENDOR_ID,
        expect.objectContaining({
          display_name: 'Baru',
          transport_fee_per_km_idr: '15000'
        })
      );
    });

    it('lists and creates packages for the owner vendor only', async () => {
      const list = vi.fn().mockResolvedValue({ items: [] });
      const create = vi.fn().mockResolvedValue({ id: 'pkg' });
      const { service, catalog } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR)
      });
      catalog.listPackages.mockImplementation(list);
      catalog.createPackage.mockImplementation(create);

      await service.listPackages(USER_ID);
      await service.createPackage(USER_ID, {
        name: 'Paket 6 jam',
        duration_minutes: 360,
        base_price_idr: 5000000
      });

      expect(list).toHaveBeenCalledWith(VENDOR_ID);
      expect(create).toHaveBeenCalledWith(
        VENDOR_ID,
        expect.objectContaining({ name: 'Paket 6 jam', base_price_idr: 5000000 })
      );
    });

    it('rejects a package that does not belong to the owner vendor', async () => {
      const { service, catalog } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR)
      });
      catalog.updatePackage.mockRejectedValue(new AppError('NOT_FOUND', 'Paket tidak ditemukan'));

      await expect(
        service.updatePackage(USER_ID, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
          base_price_idr: 7000000
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(catalog.updatePackage).toHaveBeenCalledWith(
        VENDOR_ID,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expect.objectContaining({ base_price_idr: 7000000 })
      );
    });

    it('writes the calendar with source=vendor', async () => {
      const write = vi.fn().mockResolvedValue({ updated: 4 });
      const { service, catalog } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR)
      });
      catalog.writeCalendar.mockImplementation(write);

      await service.writeCalendar(USER_ID, {
        from: '2026-11-01',
        to: '2026-11-02',
        status: 'available',
        sessions: ['day', 'night']
      });

      expect(write).toHaveBeenCalledWith(
        VENDOR_ID,
        expect.objectContaining({ status: 'available' }),
        USER_ID,
        'vendor'
      );
    });

    it('rejects profile update with unapproved media URL with VALIDATION_ERROR and MEDIA_NOT_APPROVED code', async () => {
      const { service, mediaRepo } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR)
      });
      // Mock findApprovedUrls returning empty set (URL not approved)
      (mediaRepo.findApprovedUrls as any).mockResolvedValue(new Set());

      await expect(
        service.updateMe(USER_ID, {
          avatar_url: 'https://example.com/unapproved-avatar.jpg'
        })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { reason: MEDIA_NOT_APPROVED_CODE }
      });
    });

    it('allows profile update when media URLs are approved', async () => {
      const approvedUrl = 'https://example.com/approved-avatar.jpg';
      const update = vi.fn().mockResolvedValue({ ...MOCK_VENDOR, avatar_url: approvedUrl });
      const { service, mediaRepo } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR),
        updateOwnProfile: update
      });
      (mediaRepo.findApprovedUrls as any).mockResolvedValue(new Set([approvedUrl]));

      const res = await service.updateMe(USER_ID, { avatar_url: approvedUrl });
      expect(res.avatar_url).toBe(approvedUrl);
      expect(update).toHaveBeenCalled();
    });

    it('allows clearing media fields with null or empty without checking approved URLs', async () => {
      const update = vi.fn().mockResolvedValue({ ...MOCK_VENDOR, avatar_url: null, photo_urls: [] });
      const { service, mediaRepo } = createService({
        findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR),
        updateOwnProfile: update
      });

      await service.updateMe(USER_ID, { avatar_url: null, photo_urls: [] });
      expect(mediaRepo.findApprovedUrls).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalled();
    });
  });

  describe('FR-132: Vendor suspension', () => {
    const mockUser = { id: USER_ID, roles: ['vendor_owner'] as any };
    const mockReq = { protocol: 'http', get: () => 'localhost' } as any;
    const mockFile = {
      fieldname: 'file',
      originalname: 'photo.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      buffer: Buffer.from('test-image'),
      size: 100
    } as any;
    const mockUploadBody = {
      kind: 'gallery',
      license_statement: 'Saya pemilik hak cipta foto ini'
    };
    const mockLinkBody = {
      kind: 'video',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      license_statement: 'Saya pemilik hak cipta video ini'
    };

    describe('blocked writes for suspended vendor', () => {
      it('blocks createPackage with CONFLICT error', async () => {
        const { service, catalog } = createService({
          findVendorByOwner: vi.fn().mockResolvedValue(MOCK_SUSPENDED_VENDOR)
        });

        await expect(
          service.createPackage(USER_ID, {
            name: 'Paket Dangdut',
            duration_minutes: 180,
            base_price_idr: 4000000
          })
        ).rejects.toMatchObject({
          code: 'CONFLICT',
          message: 'Vendor sedang ditangguhkan; perubahan katalog dibekukan.'
        });
        expect(catalog.createPackage).not.toHaveBeenCalled();
      });

      it('blocks updatePackage with CONFLICT error', async () => {
        const { service, catalog } = createService({
          findVendorByOwner: vi.fn().mockResolvedValue(MOCK_SUSPENDED_VENDOR)
        });

        await expect(
          service.updatePackage(USER_ID, 'pkg-uuid-1', {
            name: 'Paket Dangdut Baru'
          })
        ).rejects.toMatchObject({
          code: 'CONFLICT',
          message: 'Vendor sedang ditangguhkan; perubahan katalog dibekukan.'
        });
        expect(catalog.updatePackage).not.toHaveBeenCalled();
      });

      it('blocks deletePackage with CONFLICT error', async () => {
        const { service, catalog } = createService({
          findVendorByOwner: vi.fn().mockResolvedValue(MOCK_SUSPENDED_VENDOR)
        });

        await expect(
          service.deletePackage(USER_ID, 'pkg-uuid-1')
        ).rejects.toMatchObject({
          code: 'CONFLICT',
          message: 'Vendor sedang ditangguhkan; perubahan katalog dibekukan.'
        });
        expect(catalog.deletePackage).not.toHaveBeenCalled();
      });

      it('blocks media upload (POST /vendor/media) with CONFLICT error', async () => {
        const { controller, mediaService, mediaRepo } = createController({
          findVendorByOwner: vi.fn().mockResolvedValue(MOCK_SUSPENDED_VENDOR)
        });

        await expect(
          controller.upload(mockFile, mockUploadBody, mockReq, mockUser)
        ).rejects.toMatchObject({
          code: 'CONFLICT',
          message: 'Vendor sedang ditangguhkan; perubahan katalog dibekukan.'
        });
        expect(mediaService.save).not.toHaveBeenCalled();
        expect(mediaRepo.insertSubmission).not.toHaveBeenCalled();
      });

      it('blocks media link (POST /vendor/media/link) with CONFLICT error', async () => {
        const { controller, mediaRepo } = createController({
          findVendorByOwner: vi.fn().mockResolvedValue(MOCK_SUSPENDED_VENDOR)
        });

        await expect(
          controller.createMediaLink(mockLinkBody, mockUser)
        ).rejects.toMatchObject({
          code: 'CONFLICT',
          message: 'Vendor sedang ditangguhkan; perubahan katalog dibekukan.'
        });
        expect(mediaRepo.insertSubmission).not.toHaveBeenCalled();
      });
    });

    describe('allowed portal access for suspended vendor', () => {
      it('succeeds on getMe and returns suspension_reason and suspended_at', async () => {
        const { service } = createService({
          findVendorByOwner: vi.fn().mockResolvedValue(MOCK_SUSPENDED_VENDOR)
        });

        const me = await service.getMe(USER_ID);
        expect(me.verification_status).toBe('suspended');
        expect(me.suspension_reason).toBe('Melanggar ketentuan katalog vendor');
        expect(me.suspended_at).toEqual(MOCK_SUSPENDED_VENDOR.suspended_at);
      });

      it('succeeds on listPackages', async () => {
        const mockPackages = { items: [{ id: 'pkg-1', name: 'Paket Lama' }] };
        const { service, catalog } = createService({
          findVendorByOwner: vi.fn().mockResolvedValue(MOCK_SUSPENDED_VENDOR)
        });
        catalog.listPackages.mockResolvedValue(mockPackages as any);

        const res = await service.listPackages(USER_ID);
        expect(res).toEqual(mockPackages);
        expect(catalog.listPackages).toHaveBeenCalledWith(VENDOR_ID);
      });

      it('succeeds on listBookings so in-flight bookings can finish', async () => {
        const { service, repo } = createService({
          findVendorByOwner: vi.fn().mockResolvedValue(MOCK_SUSPENDED_VENDOR),
          listBookings: vi.fn().mockResolvedValue([])
        });

        const res = await service.listBookings(USER_ID, 1, 20);
        expect(res.items).toEqual([]);
        expect(repo.listBookings).toHaveBeenCalledWith(VENDOR_ID, null, 20, 0);
      });

      it('succeeds on updateCalendar (writeCalendar)', async () => {
        const { service, catalog } = createService({
          findVendorByOwner: vi.fn().mockResolvedValue(MOCK_SUSPENDED_VENDOR)
        });
        catalog.writeCalendar.mockResolvedValue({ updated: 2 } as any);

        const res = await service.writeCalendar(USER_ID, {
          from: '2026-11-01',
          to: '2026-11-02',
          status: 'available',
          sessions: ['day', 'night']
        });
        expect(res).toEqual({ updated: 2 });
        expect(catalog.writeCalendar).toHaveBeenCalledWith(
          VENDOR_ID,
          expect.objectContaining({ status: 'available' }),
          USER_ID,
          'vendor'
        );
      });

      it('succeeds on deleteMedia so vendor can remove problematic media', async () => {
        const { controller, mediaRepo } = createController(
          {
            findVendorByOwner: vi.fn().mockResolvedValue(MOCK_SUSPENDED_VENDOR)
          },
          {
            findById: vi.fn().mockResolvedValue({
              id: MEDIA_ID,
              vendor_id: VENDOR_ID,
              status: 'pending'
            }),
            deleteById: vi.fn().mockResolvedValue(undefined)
          }
        );

        await expect(controller.deleteMedia(MEDIA_ID, mockUser)).resolves.toBeUndefined();
        expect(mediaRepo.deleteById).toHaveBeenCalledWith(MEDIA_ID);
      });
    });

    describe('non-suspended vendor unaffected', () => {
      it('allows createPackage, updatePackage, and deletePackage', async () => {
        const { service, catalog } = createService({
          findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR)
        });
        catalog.createPackage.mockResolvedValue({ id: 'pkg-1' } as any);
        catalog.updatePackage.mockResolvedValue({ id: 'pkg-1' } as any);
        catalog.deletePackage.mockResolvedValue(undefined);

        await expect(
          service.createPackage(USER_ID, {
            name: 'Paket Asli',
            duration_minutes: 120,
            base_price_idr: 3000000
          })
        ).resolves.toEqual({ id: 'pkg-1' });

        await expect(
          service.updatePackage(USER_ID, 'pkg-1', {
            name: 'Paket Asli Revisi'
          })
        ).resolves.toEqual({ id: 'pkg-1' });

        await expect(
          service.deletePackage(USER_ID, 'pkg-1')
        ).resolves.toBeUndefined();
      });

      it('allows upload and createMediaLink', async () => {
        const mockSubmission = { id: MEDIA_ID, status: 'pending' };
        const { controller, mediaService, mediaRepo } = createController(
          {
            findVendorByOwner: vi.fn().mockResolvedValue(MOCK_VENDOR)
          },
          {
            insertSubmission: vi.fn().mockResolvedValue(mockSubmission as any)
          }
        );

        const uploadRes = await controller.upload(mockFile, mockUploadBody, mockReq, mockUser);
        expect(uploadRes).toEqual({ data: { media: mockSubmission } });
        expect(mediaService.save).toHaveBeenCalled();

        const linkRes = await controller.createMediaLink(mockLinkBody, mockUser);
        expect(linkRes).toEqual({ data: { media: mockSubmission } });
        expect(mediaRepo.insertSubmission).toHaveBeenCalled();
      });
    });
  });
});
