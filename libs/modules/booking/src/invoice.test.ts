import { describe, expect, it } from 'vitest';
import { AppError } from '../../../../apps/api/src/core/errors';
import type { AuthUser } from './current-user.decorator';
import { InvoiceController } from './invoice.controller';
import { InvoiceService, type InvoiceView } from './invoice.service';

const BOOKING_ID = '33333333-3333-4333-8333-333333333333';
const VENDOR_ID = '44444444-4444-4444-8444-444444444444';
const CUSTOMER_A = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_B = '22222222-2222-4222-8222-222222222222';
const VENDOR_USER_ID = '77777777-7777-4777-8777-777777777777';

const mockBookingDbRow = {
  booking_id: BOOKING_ID,
  booking_code: 'BK-261104-ABCD',
  customer_id: CUSTOMER_A,
  vendor_id: VENDOR_ID,
  lifecycle_status: 'confirmed',
  payment_status: 'dp_paid',
  booking_created_at: new Date('2026-11-04T10:00:00.000Z'),
  booking_completed_at: null,
  price_package_idr: '5000000',
  price_addons_idr: '500000',
  price_transport_idr: '100000',
  service_fee_idr: '50000',
  discount_idr: '0',
  total_customer_idr: '5650000',
  customer_name: 'Budi Santoso',
  customer_phone: '081234567890',
  customer_email: 'budi@example.com',
  vendor_name: 'Seni Tarling Cirebon',
  vendor_phone: '081987654321',
  vendor_category: 'Tarling & Dangdut',
  event_title: 'Hajatan Sunatan',
  event_type: 'Khitanan',
  event_start_date: '2026-12-10',
  event_venue_name: 'Gedung Serbaguna',
  event_venue_address: 'Jl. Merdeka No. 10, Cirebon'
};

const mockAddonDbRows = [
  {
    name: 'Sound System Tambahan',
    unit_price_idr: '500000',
    quantity: 1
  }
];

const mockPaymentDbRows = [
  {
    id: '88888888-8888-4888-8888-888888888888',
    kind: 'dp',
    method: 'qris',
    amount_idr: '1500000',
    status: 'paid',
    paid_at: new Date('2026-11-04T10:15:00.000Z'),
    external_id: 'TRX-12345'
  }
];

function createMockDb(options: {
  bookingExists?: boolean;
  isVendorMember?: boolean;
} = {}) {
  const { bookingExists = true, isVendorMember = false } = options;

  return async function mockQuery<T>(text: string): Promise<T[]> {
    if (text.includes('FROM bookings b')) {
      if (!bookingExists) return [];
      return [mockBookingDbRow as unknown as T];
    }
    if (text.includes('vendor_members')) {
      return [{ allowed: isVendorMember } as unknown as T];
    }
    if (text.includes('FROM booking_addons')) {
      return mockAddonDbRows as unknown as T[];
    }
    if (text.includes('FROM payments')) {
      return mockPaymentDbRows as unknown as T[];
    }
    return [];
  };
}

describe('InvoiceService', () => {
  describe('renderHtml', () => {
    const sampleInvoice: InvoiceView = {
      booking: {
        id: BOOKING_ID,
        code: 'BK-261104-ABCD',
        lifecycle_status: 'confirmed',
        payment_status: 'dp_paid',
        created_at: '2026-11-04T10:00:00.000Z',
        completed_at: null
      },
      customer: {
        name: 'Budi Santoso',
        phone: '081234567890',
        email: 'budi@example.com'
      },
      vendor: {
        name: 'Seni Tarling Cirebon',
        category: 'Tarling & Dangdut',
        phone: '081987654321'
      },
      event: {
        name: 'Hajatan Sunatan',
        event_type: 'Khitanan',
        start_date: '2026-12-10',
        venue_name: 'Gedung Serbaguna',
        venue_address: 'Jl. Merdeka No. 10, Cirebon'
      },
      pricing: {
        price_package_idr: 5000000,
        price_addons_idr: 500000,
        price_transport_idr: 100000,
        service_fee_idr: 50000,
        discount_idr: 0,
        total_customer_idr: 5650000
      },
      addons: [
        {
          name: 'Sound System Tambahan',
          unit_price_idr: 500000,
          quantity: 1,
          subtotal_idr: 500000
        }
      ],
      payments: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          kind: 'dp',
          method: 'qris',
          amount_idr: 1500000,
          status: 'paid',
          paid_at: '2026-11-04T10:15:00.000Z',
          external_id: 'TRX-12345'
        }
      ]
    };

    it('returns valid HTML containing booking code, vendor name, customer name, and total amount', () => {
      const service = new InvoiceService();
      const html = service.renderHtml(sampleInvoice);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('BK-261104-ABCD');
      expect(html).toContain('Seni Tarling Cirebon');
      expect(html).toContain('Budi Santoso');
      expect(html).toContain('Rp5.650.000');
      expect(html).toContain('@media print');
      expect(html).toContain(
        'Dokumen ini diterbitkan secara otomatis oleh sistem Tarlink sebagai bukti transaksi yang sah.'
      );
    });

    it('escapes user strings to prevent XSS injection', () => {
      const service = new InvoiceService();
      const dangerousInvoice: InvoiceView = {
        ...sampleInvoice,
        customer: {
          name: '<script>alert("xss")</script>',
          phone: '081234567890',
          email: null
        },
        vendor: {
          name: 'Vendor & Co "Safe"',
          category: null,
          phone: null
        }
      };

      const html = service.renderHtml(dangerousInvoice);
      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(html).toContain('Vendor &amp; Co &quot;Safe&quot;');
    });
  });

  describe('getInvoiceData', () => {
    it('throws NOT_FOUND when unauthorized user tries to access', async () => {
      const mockDb = createMockDb({ bookingExists: true, isVendorMember: false });
      const service = new InvoiceService(mockDb);

      const unauthorizedUser: AuthUser = {
        id: CUSTOMER_B,
        roles: ['customer']
      };

      await expect(service.getInvoiceData(BOOKING_ID, unauthorizedUser)).rejects.toThrow(
        new AppError('NOT_FOUND', `Booking ${BOOKING_ID} tidak ditemukan`)
      );
    });

    it('returns complete invoice structure for authorized customer', async () => {
      const mockDb = createMockDb({ bookingExists: true });
      const service = new InvoiceService(mockDb);

      const authorizedCustomer: AuthUser = {
        id: CUSTOMER_A,
        roles: ['customer']
      };

      const result = await service.getInvoiceData(BOOKING_ID, authorizedCustomer);

      expect(result.booking.id).toBe(BOOKING_ID);
      expect(result.booking.code).toBe('BK-261104-ABCD');
      expect(result.booking.lifecycle_status).toBe('confirmed');
      expect(result.booking.payment_status).toBe('dp_paid');
      expect(result.booking.created_at).toBe('2026-11-04T10:00:00.000Z');
      expect(result.booking.completed_at).toBeNull();

      expect(result.customer.name).toBe('Budi Santoso');
      expect(result.customer.phone).toBe('081234567890');
      expect(result.customer.email).toBe('budi@example.com');

      expect(result.vendor.name).toBe('Seni Tarling Cirebon');
      expect(result.vendor.category).toBe('Tarling & Dangdut');
      expect(result.vendor.phone).toBe('081987654321');

      expect(result.event.name).toBe('Hajatan Sunatan');
      expect(result.event.event_type).toBe('Khitanan');
      expect(result.event.start_date).toBe('2026-12-10');
      expect(result.event.venue_name).toBe('Gedung Serbaguna');
      expect(result.event.venue_address).toBe('Jl. Merdeka No. 10, Cirebon');

      expect(result.pricing.price_package_idr).toBe(5000000);
      expect(result.pricing.price_addons_idr).toBe(500000);
      expect(result.pricing.price_transport_idr).toBe(100000);
      expect(result.pricing.service_fee_idr).toBe(50000);
      expect(result.pricing.discount_idr).toBe(0);
      expect(result.pricing.total_customer_idr).toBe(5650000);

      expect(result.addons).toHaveLength(1);
      expect(result.addons[0]).toEqual({
        name: 'Sound System Tambahan',
        unit_price_idr: 500000,
        quantity: 1,
        subtotal_idr: 500000
      });

      expect(result.payments).toHaveLength(1);
      expect(result.payments[0]).toEqual({
        id: '88888888-8888-4888-8888-888888888888',
        kind: 'dp',
        method: 'qris',
        amount_idr: 1500000,
        status: 'paid',
        paid_at: '2026-11-04T10:15:00.000Z',
        external_id: 'TRX-12345'
      });
    });

    it('returns complete invoice structure for authorized admin', async () => {
      const mockDb = createMockDb({ bookingExists: true });
      const service = new InvoiceService(mockDb);

      const adminUser: AuthUser = {
        id: '99999999-9999-4999-8999-999999999999',
        roles: ['admin_finance']
      };

      const result = await service.getInvoiceData(BOOKING_ID, adminUser);
      expect(result.booking.code).toBe('BK-261104-ABCD');
      expect(result.pricing.total_customer_idr).toBe(5650000);
    });

    it('returns complete invoice structure for authorized vendor member', async () => {
      const mockDb = createMockDb({ bookingExists: true, isVendorMember: true });
      const service = new InvoiceService(mockDb);

      const vendorUser: AuthUser = {
        id: VENDOR_USER_ID,
        roles: ['vendor_owner']
      };

      const result = await service.getInvoiceData(BOOKING_ID, vendorUser);
      expect(result.booking.code).toBe('BK-261104-ABCD');
    });

    it('throws NOT_FOUND when booking does not exist', async () => {
      const mockDb = createMockDb({ bookingExists: false });
      const service = new InvoiceService(mockDb);

      const customer: AuthUser = {
        id: CUSTOMER_A,
        roles: ['customer']
      };

      await expect(service.getInvoiceData(BOOKING_ID, customer)).rejects.toThrow(
        new AppError('NOT_FOUND', `Booking ${BOOKING_ID} tidak ditemukan`)
      );
    });
  });

  describe('InvoiceController', () => {
    it('returns JSON format when format=json query parameter is given', async () => {
      const mockDb = createMockDb({ bookingExists: true });
      const service = new InvoiceService(mockDb);
      const controller = new InvoiceController(service);

      const user: AuthUser = { id: CUSTOMER_A, roles: ['customer'] };
      let jsonPayload: unknown = null;
      const res = {
        json: (data: unknown) => {
          jsonPayload = data;
          return res;
        },
        setHeader: () => res,
        send: () => res
      } as unknown as import('express').Response;

      await controller.getInvoice(BOOKING_ID, 'json', user, res);

      expect(jsonPayload).toBeDefined();
      expect((jsonPayload as { data: InvoiceView }).data.booking.code).toBe('BK-261104-ABCD');
    });

    it('returns HTML and sets Content-Type header by default', async () => {
      const mockDb = createMockDb({ bookingExists: true });
      const service = new InvoiceService(mockDb);
      const controller = new InvoiceController(service);

      const user: AuthUser = { id: CUSTOMER_A, roles: ['customer'] };
      const headers: Record<string, string> = {};
      let sentBody = '';
      const res = {
        setHeader: (name: string, value: string) => {
          headers[name] = value;
          return res;
        },
        send: (body: string) => {
          sentBody = body;
          return res;
        },
        json: () => res
      } as unknown as import('express').Response;

      await controller.getInvoice(BOOKING_ID, undefined, user, res);

      expect(headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(sentBody).toContain('<!DOCTYPE html>');
      expect(sentBody).toContain('BK-261104-ABCD');
    });
  });
});
