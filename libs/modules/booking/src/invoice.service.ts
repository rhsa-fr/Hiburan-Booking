import { Inject, Injectable, Optional } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { query } from '../../../../apps/api/src/core/db';
import { AppError } from '../../../../apps/api/src/core/errors';
import type { AuthUser } from './current-user.decorator';

export interface InvoiceBookingView {
  id: string;
  code: string;
  lifecycle_status: string;
  payment_status: string;
  created_at: string;
  completed_at: string | null;
}

export interface InvoiceCustomerView {
  name: string | null;
  phone: string;
  email: string | null;
}

export interface InvoiceVendorView {
  name: string;
  category: string | null;
  phone: string | null;
}

export interface InvoiceEventView {
  name: string;
  event_type: string | null;
  start_date: string;
  venue_name: string | null;
  venue_address: string;
}

export interface InvoicePricingView {
  price_package_idr: number;
  price_addons_idr: number;
  price_transport_idr: number;
  service_fee_idr: number;
  discount_idr: number;
  total_customer_idr: number;
}

export interface InvoiceAddonView {
  name: string;
  unit_price_idr: number;
  quantity: number;
  subtotal_idr: number;
}

export interface InvoicePaymentView {
  id: string;
  kind: string;
  method: string;
  amount_idr: number;
  status: string;
  paid_at: string | null;
  external_id: string | null;
}

export interface InvoiceView {
  booking: InvoiceBookingView;
  customer: InvoiceCustomerView;
  vendor: InvoiceVendorView;
  event: InvoiceEventView;
  pricing: InvoicePricingView;
  addons: InvoiceAddonView[];
  payments: InvoicePaymentView[];
}

interface BookingInvoiceDbRow {
  booking_id: string;
  booking_code: string;
  customer_id: string;
  vendor_id: string;
  lifecycle_status: string;
  payment_status: string;
  booking_created_at: Date | string;
  booking_completed_at: Date | string | null;
  price_package_idr: string;
  price_addons_idr: string;
  price_transport_idr: string;
  service_fee_idr: string;
  discount_idr: string;
  total_customer_idr: string;
  customer_name: string | null;
  customer_phone: string;
  customer_email: string | null;
  vendor_name: string;
  vendor_phone: string | null;
  vendor_category: string | null;
  event_title: string;
  event_type: string | null;
  event_start_date: string;
  event_venue_name: string | null;
  event_venue_address: string;
}

interface AddonDbRow {
  name: string;
  unit_price_idr: string;
  quantity: number;
}

interface PaymentDbRow {
  id: string;
  kind: string;
  method: string;
  amount_idr: string;
  status: string;
  paid_at: Date | string | null;
  external_id: string | null;
}

export type InvoiceQueryFn = <T extends QueryResultRow>(
  text: string,
  params?: readonly unknown[]
) => Promise<T[]>;

export const INVOICE_QUERY_FN = Symbol('INVOICE_QUERY_FN');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRupiah(amount: number): string {
  return `Rp${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function formatPaymentKind(kind: string): string {
  switch (kind) {
    case 'dp':
      return 'Uang Muka (DP)';
    case 'settlement':
      return 'Pelunasan';
    default:
      return kind.toUpperCase();
  }
}

function formatPaymentMethod(method: string): string {
  switch (method) {
    case 'qris':
      return 'QRIS';
    case 'va_bca':
      return 'BCA Virtual Account';
    case 'va_bni':
      return 'BNI Virtual Account';
    case 'va_bri':
      return 'BRI Virtual Account';
    case 'va_mandiri':
      return 'Mandiri Virtual Account';
    case 'transfer_manual':
      return 'Transfer Bank';
    case 'cash':
      return 'Tunai / Kas';
    case 'gopay':
      return 'GoPay';
    case 'ovo':
      return 'OVO';
    case 'dana':
      return 'DANA';
    case 'shopeepay':
      return 'ShopeePay';
    default:
      return method.toUpperCase();
  }
}

function formatPaymentStatus(status: string): string {
  switch (status) {
    case 'paid':
      return 'LUNAS';
    case 'pending':
      return 'MENUNGGU';
    case 'failed':
      return 'GAGAL';
    case 'expired':
      return 'KADALUWARSA';
    default:
      return status.toUpperCase();
  }
}

@Injectable()
export class InvoiceService {
  private readonly db: InvoiceQueryFn;

  constructor(
    @Optional()
    @Inject(INVOICE_QUERY_FN)
    injectedDbQuery?: InvoiceQueryFn
  ) {
    this.db = injectedDbQuery ?? query;
  }

  async getInvoiceData(bookingId: string, user: AuthUser): Promise<InvoiceView> {
    if (!UUID_REGEX.test(bookingId)) {
      throw new AppError('NOT_FOUND', `Booking ${bookingId} tidak ditemukan`);
    }

    const bookingRows = await this.db<BookingInvoiceDbRow>(
      `SELECT
         b.id AS booking_id,
         b.code AS booking_code,
         b.customer_id,
         b.vendor_id,
         b.lifecycle_status::text AS lifecycle_status,
         b.payment_status::text AS payment_status,
         b.created_at AS booking_created_at,
         b.completed_at AS booking_completed_at,
         b.price_package_idr::text AS price_package_idr,
         b.price_addons_idr::text AS price_addons_idr,
         b.price_transport_idr::text AS price_transport_idr,
         b.service_fee_idr::text AS service_fee_idr,
         b.discount_idr::text AS discount_idr,
         b.total_customer_idr::text AS total_customer_idr,
         u_cust.name AS customer_name,
         u_cust.phone AS customer_phone,
         u_cust.email AS customer_email,
         v.display_name AS vendor_name,
         u_vend.phone AS vendor_phone,
         cat.name AS vendor_category,
         e.title AS event_title,
         e.event_type AS event_type,
         e.start_date::text AS event_start_date,
         e.venue_name AS event_venue_name,
         e.venue_address AS event_venue_address
       FROM bookings b
       JOIN users u_cust ON u_cust.id = b.customer_id
       JOIN vendors v ON v.id = b.vendor_id
       LEFT JOIN users u_vend ON u_vend.id = v.owner_user_id
       LEFT JOIN LATERAL (
         SELECT c.name
           FROM vendor_categories vc
           JOIN categories c ON c.id = vc.category_id
          WHERE vc.vendor_id = v.id
          ORDER BY vc.is_primary DESC, vc.created_at ASC
          LIMIT 1
       ) cat ON true
       LEFT JOIN events e ON e.id = b.event_id
      WHERE b.id = $1::uuid`,
      [bookingId]
    );

    const row = bookingRows[0];
    if (!row) {
      throw new AppError('NOT_FOUND', `Booking ${bookingId} tidak ditemukan`);
    }

    // Authorization check
    const isAdmin = user.roles.some((role) =>
      role === 'admin_support' || role === 'admin_finance' || role === 'admin_super'
    );
    const isCustomerOwner = row.customer_id === user.id;

    let isVendorAuthorized = false;
    if (!isAdmin && !isCustomerOwner) {
      const memberRows = await this.db<{ allowed: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM vendors v
             LEFT JOIN vendor_members vm
               ON vm.vendor_id = v.id
              AND vm.user_id = $2
              AND vm.is_active = true
            WHERE v.id = $1
              AND (v.owner_user_id = $2 OR vm.id IS NOT NULL)
         ) AS allowed`,
        [row.vendor_id, user.id]
      );
      isVendorAuthorized = Boolean(memberRows[0]?.allowed);
    }

    if (!isAdmin && !isCustomerOwner && !isVendorAuthorized) {
      throw new AppError('NOT_FOUND', `Booking ${bookingId} tidak ditemukan`);
    }

    // Query addons
    const addonRows = await this.db<AddonDbRow>(
      `SELECT name, price_idr::text AS unit_price_idr, qty AS quantity
         FROM booking_addons
        WHERE booking_id = $1::uuid
        ORDER BY id ASC`,
      [bookingId]
    );

    const addons: InvoiceAddonView[] = addonRows.map((a) => {
      const unitPrice = BigInt(a.unit_price_idr);
      const qty = Number(a.quantity);
      return {
        name: a.name,
        unit_price_idr: Number(unitPrice),
        quantity: qty,
        subtotal_idr: Number(unitPrice * BigInt(qty))
      };
    });

    // Query payments
    const paymentRows = await this.db<PaymentDbRow>(
      `SELECT id,
              kind::text,
              method,
              amount_idr::text,
              status::text,
              paid_at,
              COALESCE(provider_ref, provider_txn_id) AS external_id
         FROM payments
        WHERE booking_id = $1::uuid
        ORDER BY created_at ASC, id ASC`,
      [bookingId]
    );

    const payments: InvoicePaymentView[] = paymentRows.map((p) => ({
      id: p.id,
      kind: p.kind,
      method: p.method,
      amount_idr: Number(BigInt(p.amount_idr)),
      status: p.status,
      paid_at: p.paid_at ? new Date(p.paid_at).toISOString() : null,
      external_id: p.external_id ?? null
    }));

    return {
      booking: {
        id: row.booking_id,
        code: row.booking_code,
        lifecycle_status: row.lifecycle_status,
        payment_status: row.payment_status,
        created_at: new Date(row.booking_created_at).toISOString(),
        completed_at: row.booking_completed_at ? new Date(row.booking_completed_at).toISOString() : null
      },
      customer: {
        name: row.customer_name ?? null,
        phone: row.customer_phone,
        email: row.customer_email ?? null
      },
      vendor: {
        name: row.vendor_name,
        category: row.vendor_category ?? null,
        phone: row.vendor_phone ?? null
      },
      event: {
        name: row.event_title ?? '',
        event_type: row.event_type ?? null,
        start_date: row.event_start_date ?? '',
        venue_name: row.event_venue_name ?? null,
        venue_address: row.event_venue_address ?? ''
      },
      pricing: {
        price_package_idr: Number(BigInt(row.price_package_idr)),
        price_addons_idr: Number(BigInt(row.price_addons_idr)),
        price_transport_idr: Number(BigInt(row.price_transport_idr)),
        service_fee_idr: Number(BigInt(row.service_fee_idr)),
        discount_idr: Number(BigInt(row.discount_idr)),
        total_customer_idr: Number(BigInt(row.total_customer_idr))
      },
      addons,
      payments
    };
  }

  renderHtml(invoice: InvoiceView): string {
    const addonsRowsHtml =
      invoice.addons.length > 0
        ? invoice.addons
            .map(
              (a) => `
          <tr>
            <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9;">+ ${escapeHtml(a.name)}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: center;">${a.quantity}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right;">${formatRupiah(a.unit_price_idr)}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right;">${formatRupiah(a.subtotal_idr)}</td>
          </tr>`
            )
            .join('')
        : '';

    const transportRowHtml =
      invoice.pricing.price_transport_idr > 0
        ? `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9;">Biaya Transportasi</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: center;">1</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right;">${formatRupiah(invoice.pricing.price_transport_idr)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right;">${formatRupiah(invoice.pricing.price_transport_idr)}</td>
        </tr>`
        : '';

    const discountRowHtml =
      invoice.pricing.discount_idr > 0
        ? `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #16a34a;">Diskon / Potongan</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: center;">-</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right;">-</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right; color: #16a34a;">-${formatRupiah(invoice.pricing.discount_idr)}</td>
        </tr>`
        : '';

    const paymentsRowsHtml =
      invoice.payments.length > 0
        ? invoice.payments
            .map((p) => {
              const statusLabel = formatPaymentStatus(p.status);
              const statusBg =
                p.status === 'paid' ? '#dcfce7' : p.status === 'pending' ? '#fef3c7' : '#fee2e2';
              const statusColor =
                p.status === 'paid' ? '#15803d' : p.status === 'pending' ? '#b45309' : '#b91c1c';
              return `
          <tr>
            <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9;">${formatPaymentKind(p.kind)}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9;">${formatPaymentMethod(p.method)}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: center;">
              <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; background: ${statusBg}; color: ${statusColor};">${statusLabel}</span>
            </td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9;">${p.paid_at ? p.paid_at.substring(0, 10) : '-'}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; font-family: monospace; font-size: 12px;">${escapeHtml(p.external_id ?? p.id.substring(0, 8))}</td>
            <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right; font-weight: 600;">${formatRupiah(p.amount_idr)}</td>
          </tr>`;
            })
            .join('')
        : `<tr><td colspan="6" style="padding: 14px 12px; text-align: center; color: #64748b;">Belum ada riwayat pembayaran tercatat.</td></tr>`;

    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice - ${escapeHtml(invoice.booking.code)}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a;
      background-color: #f8fafc;
      padding: 32px 16px;
      line-height: 1.5;
    }
    .invoice-card {
      max-width: 800px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 20px;
      margin-bottom: 28px;
    }
    .brand {
      font-size: 28px;
      font-weight: 900;
      letter-spacing: -0.5px;
      color: #0f172a;
    }
    .brand-sub {
      font-size: 13px;
      color: #64748b;
      margin-top: 2px;
    }
    .title-wrap {
      text-align: right;
    }
    .title {
      font-size: 16px;
      font-weight: 700;
      color: #334155;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge {
      display: inline-block;
      margin-top: 8px;
      padding: 4px 10px;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 13px;
      color: #0f172a;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-bottom: 24px;
    }
    .section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      margin-bottom: 8px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
    }
    .info-list {
      font-size: 14px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .info-label {
      color: #64748b;
    }
    .info-value {
      font-weight: 500;
      text-align: right;
    }
    .event-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 28px;
    }
    .event-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      font-size: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      margin-bottom: 28px;
    }
    th {
      background: #f8fafc;
      padding: 10px 12px;
      text-align: left;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #475569;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #cbd5e1;
    }
    .total-box {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 32px;
    }
    .total-card {
      width: 320px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 16px;
    }
    .total-line {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .grand-total {
      border-top: 2px solid #0f172a;
      padding-top: 8px;
      margin-top: 8px;
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
    }
    .footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 20px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
    }
    .action-bar {
      max-width: 800px;
      margin: 0 auto 16px auto;
      display: flex;
      justify-content: flex-end;
    }
    .btn-print {
      background: #0f172a;
      color: #ffffff;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-print:hover {
      background: #1e293b;
    }
    @media print {
      body {
        background: #ffffff;
        color: #000000;
        padding: 0;
      }
      .action-bar {
        display: none !important;
      }
      .invoice-card {
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
        max-width: 100% !important;
      }
      .header {
        border-bottom: 2px solid #000000;
      }
      th {
        background: #f1f5f9 !important;
        color: #000000 !important;
      }
      tr {
        page-break-inside: avoid;
      }
      .event-box, .total-card {
        background: #ffffff !important;
        border: 1px solid #cccccc !important;
      }
    }
    @page {
      margin: 15mm;
      size: auto;
    }
  </style>
</head>
<body>
  <div class="action-bar">
    <button class="btn-print" onclick="window.print()">Cetak / Simpan PDF</button>
  </div>

  <div class="invoice-card">
    <div class="header">
      <div>
        <div class="brand">TARLINK</div>
        <div class="brand-sub">Platform Pemesanan Seni Tarling & Hiburan</div>
      </div>
      <div class="title-wrap">
        <h1 class="title">NOTA PEMESANAN / BUKTI PEMBAYARAN</h1>
        <div class="badge">Kode: <strong>${escapeHtml(invoice.booking.code)}</strong></div>
      </div>
    </div>

    <div class="grid-2">
      <div>
        <div class="section-title">Informasi Pemesan</div>
        <div class="info-list">
          <div class="info-row">
            <span class="info-label">Nama:</span>
            <span class="info-value">${escapeHtml(invoice.customer.name ?? '-')}</span>
          </div>
          <div class="info-row">
            <span class="info-label">No. WhatsApp:</span>
            <span class="info-value">${escapeHtml(invoice.customer.phone)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Email:</span>
            <span class="info-value">${escapeHtml(invoice.customer.email ?? '-')}</span>
          </div>
        </div>
      </div>

      <div>
        <div class="section-title">Informasi Vendor</div>
        <div class="info-list">
          <div class="info-row">
            <span class="info-label">Vendor:</span>
            <span class="info-value">${escapeHtml(invoice.vendor.name)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Kategori:</span>
            <span class="info-value">${escapeHtml(invoice.vendor.category ?? 'Seni Pertunjukan')}</span>
          </div>
          <div class="info-row">
            <span class="info-label">No. Telepon:</span>
            <span class="info-value">${escapeHtml(invoice.vendor.phone ?? '-')}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="event-box">
      <div class="section-title" style="margin-bottom: 12px;">Detail Acara</div>
      <div class="event-grid">
        <div>
          <div class="info-row">
            <span class="info-label">Nama Acara:</span>
            <span class="info-value">${escapeHtml(invoice.event.name || '-')}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Jenis Acara:</span>
            <span class="info-value">${escapeHtml(invoice.event.event_type ?? '-')}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Tanggal Acara:</span>
            <span class="info-value">${escapeHtml(invoice.event.start_date)}</span>
          </div>
        </div>
        <div>
          <div class="info-row">
            <span class="info-label">Lokasi / Venue:</span>
            <span class="info-value">${escapeHtml(invoice.event.venue_name ? `${invoice.event.venue_name} - ${invoice.event.venue_address}` : invoice.event.venue_address)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Tanggal Pemesanan:</span>
            <span class="info-value">${invoice.booking.created_at.substring(0, 10)}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="section-title">Rincian Biaya</div>
    <table>
      <thead>
        <tr>
          <th>Layanan / Item</th>
          <th style="text-align: center; width: 60px;">Qty</th>
          <th style="text-align: right; width: 130px;">Harga Satuan</th>
          <th style="text-align: right; width: 130px;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9;">Paket Layanan</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: center;">1</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right;">${formatRupiah(invoice.pricing.price_package_idr)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right;">${formatRupiah(invoice.pricing.price_package_idr)}</td>
        </tr>
        ${addonsRowsHtml}
        ${transportRowHtml}
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9;">Biaya Layanan Platform (1%)</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: center;">1</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right;">${formatRupiah(invoice.pricing.service_fee_idr)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: right;">${formatRupiah(invoice.pricing.service_fee_idr)}</td>
        </tr>
        ${discountRowHtml}
      </tbody>
    </table>

    <div class="total-box">
      <div class="total-card">
        <div class="total-line">
          <span style="color: #64748b;">Total Layanan:</span>
          <span>${formatRupiah(invoice.pricing.price_package_idr + invoice.pricing.price_addons_idr)}</span>
        </div>
        ${
          invoice.pricing.price_transport_idr > 0
            ? `<div class="total-line"><span style="color: #64748b;">Transport:</span><span>${formatRupiah(invoice.pricing.price_transport_idr)}</span></div>`
            : ''
        }
        <div class="total-line">
          <span style="color: #64748b;">Biaya Platform:</span>
          <span>${formatRupiah(invoice.pricing.service_fee_idr)}</span>
        </div>
        ${
          invoice.pricing.discount_idr > 0
            ? `<div class="total-line" style="color: #16a34a;"><span>Diskon:</span><span>-${formatRupiah(invoice.pricing.discount_idr)}</span></div>`
            : ''
        }
        <div class="total-line grand-total">
          <span>Total Pembayaran:</span>
          <span>${formatRupiah(invoice.pricing.total_customer_idr)}</span>
        </div>
      </div>
    </div>

    <div class="section-title">Riwayat Pembayaran</div>
    <table>
      <thead>
        <tr>
          <th>Jenis</th>
          <th>Metode</th>
          <th style="text-align: center;">Status</th>
          <th>Tanggal Bayar</th>
          <th>Referensi</th>
          <th style="text-align: right;">Jumlah</th>
        </tr>
      </thead>
      <tbody>
        ${paymentsRowsHtml}
      </tbody>
    </table>

    <div class="footer">
      <p>Dokumen ini diterbitkan secara otomatis oleh sistem Tarlink sebagai bukti transaksi yang sah.</p>
    </div>
  </div>
</body>
</html>`;
  }
}
