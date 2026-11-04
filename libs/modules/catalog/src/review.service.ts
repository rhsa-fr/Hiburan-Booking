import { Injectable } from '@nestjs/common';
import { query } from '@tarlink/core/db';
import { AppError } from '@tarlink/core/errors';
import type { ReviewListResult, ReviewResult } from './contracts';
import { toIsoRequired } from './mappers';
import { asPgError } from './pg-errors';

interface BookingCheckRow {
  id: string;
  customer_id: string;
  vendor_id: string;
  lifecycle_status: string;
}

interface ReviewDbRow {
  id: string;
  booking_id: string;
  vendor_id: string;
  customer_id: string;
  rating: number;
  comment: string | null;
  created_at: Date | string;
}

interface ReviewListDbRow {
  id: string;
  rating: number;
  comment: string | null;
  customer_name: string;
  created_at: Date | string;
}

@Injectable()
export class ReviewService {
  async submitReview(
    customerId: string,
    bookingId: string,
    rating: number,
    comment?: string | null
  ): Promise<ReviewResult> {
    const bookingRows = await query<BookingCheckRow>(
      `SELECT id, customer_id, vendor_id, lifecycle_status::text AS lifecycle_status
         FROM bookings
        WHERE id = $1::uuid`,
      [bookingId]
    );

    const booking = bookingRows[0];
    if (!booking) {
      throw new AppError('NOT_FOUND', 'Booking tidak ditemukan');
    }

    if (booking.customer_id !== customerId) {
      throw new AppError('FORBIDDEN', 'Booking ini bukan milik Anda');
    }

    if (booking.lifecycle_status !== 'completed') {
      throw new AppError('CONFLICT', 'Hanya booking yang telah selesai yang dapat diulas');
    }

    const existingRows = await query<{ id: string }>(
      `SELECT id FROM reviews WHERE booking_id = $1::uuid LIMIT 1`,
      [bookingId]
    );

    if (existingRows.length > 0) {
      throw new AppError('CONFLICT', 'Booking ini sudah pernah diulas');
    }

    try {
      const insertedRows = await query<ReviewDbRow>(
        `INSERT INTO reviews (booking_id, vendor_id, customer_id, rating, comment)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
         RETURNING id, booking_id, vendor_id, customer_id, rating, comment, created_at`,
        [booking.id, booking.vendor_id, customerId, rating, comment ?? null]
      );

      const created = insertedRows[0];
      if (!created) {
        throw new AppError('INTERNAL_ERROR', 'Gagal menyimpan ulasan');
      }

      return {
        id: created.id,
        booking_id: created.booking_id,
        vendor_id: created.vendor_id,
        customer_id: created.customer_id,
        rating: Number(created.rating),
        comment: created.comment,
        created_at: toIsoRequired(created.created_at)
      };
    } catch (err) {
      const pg = asPgError(err);
      if (pg?.code === '23505') {
        throw new AppError('CONFLICT', 'Booking ini sudah pernah diulas');
      }
      if (pg?.code === '23503') {
        throw new AppError('NOT_FOUND', 'Booking atau vendor tidak ditemukan');
      }
      throw err;
    }
  }

  async listVendorReviews(
    vendorId: string,
    page = 1,
    pageSize = 20
  ): Promise<ReviewListResult> {
    const safePage = Math.max(1, Math.floor(page || 1));
    const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize || 20)));
    const offset = (safePage - 1) * safePageSize;

    const rows = await query<ReviewListDbRow>(
      `SELECT r.id,
              r.rating,
              r.comment,
              COALESCE(u.name, 'Pelanggan') AS customer_name,
              r.created_at
         FROM reviews r
         JOIN users u ON u.id = r.customer_id
        WHERE r.vendor_id = $1::uuid
        ORDER BY r.created_at DESC, r.id ASC
        LIMIT $2 OFFSET $3`,
      [vendorId, safePageSize, offset]
    );

    const countRows = await query<{ total: number | string }>(
      `SELECT COUNT(*)::int AS total
         FROM reviews
        WHERE vendor_id = $1::uuid`,
      [vendorId]
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        rating: Number(r.rating),
        comment: r.comment,
        customer_name: r.customer_name,
        created_at: toIsoRequired(r.created_at)
      })),
      total: Number(countRows[0]?.total ?? 0),
      page: safePage,
      page_size: safePageSize
    };
  }
}
