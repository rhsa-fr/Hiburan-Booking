import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import type { CatalogService } from '@tarlink/modules/catalog';
import { VendorPortalRepository } from './vendor-portal.repository';
import { VendorPortalService } from './vendor-portal.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const BOOKING_ID = '33333333-3333-4333-8333-333333333333';

const MOCK_VENDOR = {
  id: VENDOR_ID,
  display_name: 'Tarling Dangdut Pantura',
  slug: 'tarling-dangdut-pantura',
  region_code: '32.09',
  verification_status: 'approved',
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

function createService(repoOverrides: Partial<VendorPortalRepository> = {}) {
  const repo = new VendorPortalRepository();
  Object.assign(repo, repoOverrides);
  const catalog = {
    listPackages: vi.fn(),
    createPackage: vi.fn(),
    updatePackage: vi.fn(),
    deletePackage: vi.fn(),
    writeCalendar: vi.fn()
  };
  return {
    service: new VendorPortalService(repo, catalog as unknown as CatalogService),
    repo,
    catalog
  };
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
        listSettledBookings: vi.fn().mockResolvedValue(settledRows)
      });

      const result = await service.getEarnings(USER_ID, 1, 20);

      expect(result.held_idr).toBe('9000000');
      expect(result.held_balance_idr).toBe('9000000');
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
  });
});
