import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@tarlink/core/db', () => ({
  query: queryMock,
  withTransaction: vi.fn()
}));

import type { AuthenticatedRequest } from '@tarlink/platform/auth';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const VENDOR_ID = '33333333-3333-4333-8333-333333333333';
const BOOKING_ID = '44444444-4444-4444-8444-444444444444';
const REVIEW_ID = '55555555-5555-4555-8555-555555555555';
const INVALID_UUID = 'not-a-uuid';

describe('ReviewService', () => {
  let service: ReviewService;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryMock.mockReset();
    service = new ReviewService();
  });

  describe('submitReview', () => {
    const validBooking = {
      id: BOOKING_ID,
      customer_id: CUSTOMER_ID,
      vendor_id: VENDOR_ID,
      lifecycle_status: 'completed'
    };

    const insertedReviewRow = {
      id: REVIEW_ID,
      booking_id: BOOKING_ID,
      vendor_id: VENDOR_ID,
      customer_id: CUSTOMER_ID,
      rating: 5,
      comment: 'Pelayanan sangat memuaskan!',
      created_at: new Date('2026-10-25T10:00:00.000Z')
    };

    it('submits a review successfully and returns mapped review result', async () => {
      queryMock
        .mockResolvedValueOnce([validBooking]) // 1. booking check
        .mockResolvedValueOnce([]) // 2. review duplicate check
        .mockResolvedValueOnce([insertedReviewRow]); // 3. insert review

      const result = await service.submitReview(
        CUSTOMER_ID,
        BOOKING_ID,
        5,
        'Pelayanan sangat memuaskan!'
      );

      expect(queryMock).toHaveBeenCalledTimes(3);

      // Verify booking check query
      const [bookingSql, bookingParams] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(bookingSql).toContain('FROM bookings');
      expect(bookingParams).toEqual([BOOKING_ID]);

      // Verify review check query
      const [checkSql, checkParams] = queryMock.mock.calls[1] as [string, unknown[]];
      expect(checkSql).toContain('FROM reviews WHERE booking_id = $1::uuid');
      expect(checkParams).toEqual([BOOKING_ID]);

      // Verify insert query
      const [insertSql, insertParams] = queryMock.mock.calls[2] as [string, unknown[]];
      expect(insertSql).toContain('INSERT INTO reviews');
      expect(insertParams).toEqual([
        BOOKING_ID,
        VENDOR_ID,
        CUSTOMER_ID,
        5,
        'Pelayanan sangat memuaskan!'
      ]);

      expect(result).toEqual({
        id: REVIEW_ID,
        booking_id: BOOKING_ID,
        vendor_id: VENDOR_ID,
        customer_id: CUSTOMER_ID,
        rating: 5,
        comment: 'Pelayanan sangat memuaskan!',
        created_at: '2026-10-25T10:00:00.000Z'
      });
    });

    it('submits a review without comment and stores null', async () => {
      queryMock
        .mockResolvedValueOnce([validBooking])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...insertedReviewRow, rating: 4, comment: null }]);

      const result = await service.submitReview(CUSTOMER_ID, BOOKING_ID, 4);

      expect(queryMock).toHaveBeenCalledTimes(3);
      const [, , [insertSql, insertParams]] = queryMock.mock.calls as [unknown, unknown, [string, unknown[]]];
      expect(insertParams).toEqual([BOOKING_ID, VENDOR_ID, CUSTOMER_ID, 4, null]);
      expect(result.comment).toBeNull();
      expect(result.rating).toBe(4);
    });

    it('throws NOT_FOUND when booking does not exist', async () => {
      queryMock.mockResolvedValueOnce([]);

      await expect(
        service.submitReview(CUSTOMER_ID, BOOKING_ID, 5, 'Bagus')
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Booking tidak ditemukan'
      });

      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('throws FORBIDDEN when booking belongs to another customer', async () => {
      queryMock.mockResolvedValueOnce([
        { ...validBooking, customer_id: OTHER_USER_ID }
      ]);

      await expect(
        service.submitReview(CUSTOMER_ID, BOOKING_ID, 5, 'Bagus')
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Booking ini bukan milik Anda'
      });

      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('throws CONFLICT when booking lifecycle_status is not completed', async () => {
      queryMock.mockResolvedValueOnce([
        { ...validBooking, lifecycle_status: 'confirmed' }
      ]);

      await expect(
        service.submitReview(CUSTOMER_ID, BOOKING_ID, 5, 'Bagus')
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Hanya booking yang telah selesai yang dapat diulas'
      });

      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('throws CONFLICT when booking has already been reviewed (pre-check query)', async () => {
      queryMock
        .mockResolvedValueOnce([validBooking])
        .mockResolvedValueOnce([{ id: REVIEW_ID }]);

      await expect(
        service.submitReview(CUSTOMER_ID, BOOKING_ID, 5, 'Bagus')
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Booking ini sudah pernah diulas'
      });

      expect(queryMock).toHaveBeenCalledTimes(2);
    });

    it('translates pg unique constraint violation (23505) to CONFLICT', async () => {
      queryMock
        .mockResolvedValueOnce([validBooking])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce({
          code: '23505',
          message: 'duplicate key value violates unique constraint "reviews_booking_unique"'
        });

      await expect(
        service.submitReview(CUSTOMER_ID, BOOKING_ID, 5, 'Bagus')
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Booking ini sudah pernah diulas'
      });
    });

    it('translates pg foreign key violation (23503) to NOT_FOUND', async () => {
      queryMock
        .mockResolvedValueOnce([validBooking])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce({
          code: '23503',
          message: 'foreign key violation'
        });

      await expect(
        service.submitReview(CUSTOMER_ID, BOOKING_ID, 5, 'Bagus')
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Booking atau vendor tidak ditemukan'
      });
    });

    it('re-throws unexpected database errors', async () => {
      queryMock
        .mockResolvedValueOnce([validBooking])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('Connection lost'));

      await expect(
        service.submitReview(CUSTOMER_ID, BOOKING_ID, 5, 'Bagus')
      ).rejects.toThrow('Connection lost');
    });
  });

  describe('listVendorReviews', () => {
    const sampleReviewRow = {
      id: REVIEW_ID,
      rating: 5,
      comment: 'Sangat recommended!',
      customer_name: 'Budi Santoso',
      created_at: new Date('2026-10-26T12:00:00.000Z')
    };

    it('queries reviews joined with users and returns mapped items with pagination', async () => {
      queryMock
        .mockResolvedValueOnce([sampleReviewRow])
        .mockResolvedValueOnce([{ total: 1 }]);

      const result = await service.listVendorReviews(VENDOR_ID, 1, 20);

      expect(queryMock).toHaveBeenCalledTimes(2);

      const [listSql, listParams] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(listSql).toContain('FROM reviews r');
      expect(listSql).toContain('JOIN users u ON u.id = r.customer_id');
      expect(listSql).toContain('WHERE r.vendor_id = $1::uuid');
      expect(listSql).toContain('ORDER BY r.created_at DESC, r.id ASC');
      expect(listParams).toEqual([VENDOR_ID, 20, 0]);

      const [countSql, countParams] = queryMock.mock.calls[1] as [string, unknown[]];
      expect(countSql).toContain('SELECT COUNT(*)::int AS total');
      expect(countParams).toEqual([VENDOR_ID]);

      expect(result).toEqual({
        items: [
          {
            id: REVIEW_ID,
            rating: 5,
            comment: 'Sangat recommended!',
            customer_name: 'Budi Santoso',
            created_at: '2026-10-26T12:00:00.000Z'
          }
        ],
        total: 1,
        page: 1,
        page_size: 20
      });
    });

    it('returns empty items and 0 total when vendor has no reviews', async () => {
      queryMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      const result = await service.listVendorReviews(VENDOR_ID, 2, 10);

      expect(result.page).toBe(2);
      expect(result.page_size).toBe(10);
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);

      const [, listParams] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(listParams).toEqual([VENDOR_ID, 10, 10]);
    });
  });
});

describe('ReviewController', () => {
  let controller: ReviewController;
  let service: ReviewService;

  const mockReq: AuthenticatedRequest = {
    headers: {},
    user: { id: CUSTOMER_ID, roles: ['customer'] }
  };

  beforeEach(() => {
    service = new ReviewService();
    controller = new ReviewController(service);
  });

  describe('POST /bookings/:bookingId/review', () => {
    it('delegates to service.submitReview and wraps response in { data: { review } }', async () => {
      const mockReview = {
        id: REVIEW_ID,
        booking_id: BOOKING_ID,
        vendor_id: VENDOR_ID,
        customer_id: CUSTOMER_ID,
        rating: 5,
        comment: 'Mantap!',
        created_at: '2026-10-25T10:00:00.000Z'
      };

      const spy = vi.spyOn(service, 'submitReview').mockResolvedValueOnce(mockReview);

      const res = await controller.submitReview(
        BOOKING_ID,
        { rating: 5, comment: 'Mantap!' },
        mockReq
      );

      expect(spy).toHaveBeenCalledWith(CUSTOMER_ID, BOOKING_ID, 5, 'Mantap!');
      expect(res).toEqual({ data: { review: mockReview } });
    });

    it('rejects invalid bookingId with VALIDATION_ERROR', async () => {
      await expect(
        controller.submitReview(INVALID_UUID, { rating: 5 }, mockReq)
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'ID booking tidak valid'
      });
    });

    it('rejects rating below 1 or above 5 with VALIDATION_ERROR', async () => {
      await expect(
        controller.submitReview(BOOKING_ID, { rating: 0 }, mockReq)
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });

      await expect(
        controller.submitReview(BOOKING_ID, { rating: 6 }, mockReq)
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });
    });

    it('rejects non-integer rating with VALIDATION_ERROR', async () => {
      await expect(
        controller.submitReview(BOOKING_ID, { rating: 4.5 }, mockReq)
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });
    });

    it('rejects comment exceeding 500 characters with VALIDATION_ERROR', async () => {
      await expect(
        controller.submitReview(
          BOOKING_ID,
          { rating: 5, comment: 'a'.repeat(501) },
          mockReq
        )
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });
    });

    it('rejects unauthenticated requests with UNAUTHENTICATED', async () => {
      const unauthReq: AuthenticatedRequest = { headers: {} };
      await expect(
        controller.submitReview(BOOKING_ID, { rating: 5 }, unauthReq)
      ).rejects.toMatchObject({
        code: 'UNAUTHENTICATED'
      });
    });
  });

  describe('GET /vendors/:vendorId/reviews', () => {
    it('delegates to service.listVendorReviews and returns unnested paginated object', async () => {
      const expected = { items: [], total: 0, page: 1, page_size: 20 };
      const spy = vi.spyOn(service, 'listVendorReviews').mockResolvedValueOnce(expected);

      const res = await controller.listVendorReviews(VENDOR_ID, {});

      expect(spy).toHaveBeenCalledWith(VENDOR_ID, 1, 20);
      expect(res).toEqual(expected);
    });

    it('parses page and page_size query parameters', async () => {
      const expected = { items: [], total: 0, page: 3, page_size: 50 };
      const spy = vi.spyOn(service, 'listVendorReviews').mockResolvedValueOnce(expected);

      const res = await controller.listVendorReviews(VENDOR_ID, {
        page: '3',
        page_size: '50'
      });

      expect(spy).toHaveBeenCalledWith(VENDOR_ID, 3, 50);
      expect(res).toEqual(expected);
    });

    it('rejects invalid vendorId with VALIDATION_ERROR', async () => {
      await expect(
        controller.listVendorReviews(INVALID_UUID, {})
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'ID vendor tidak valid'
      });
    });
  });
});
