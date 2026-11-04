import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, Roles, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import type { ReviewListResult, ReviewResult } from './contracts';
import { ReviewService } from './review.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOKING_ID_PARAM = z.string().trim().regex(UUID_REGEX, 'ID booking harus UUID');
const VENDOR_ID_PARAM = z.string().trim().regex(UUID_REGEX, 'ID vendor harus UUID');

const optionalComment = z
  .string()
  .trim()
  .max(500, 'Komentar maksimal 500 karakter')
  .nullish()
  .transform((val) => (!val ? null : val));

const SUBMIT_REVIEW_BODY = z
  .object({
    rating: z
      .number({ required_error: 'Rating wajib diisi' })
      .int('Rating harus berupa bilangan bulat')
      .min(1, 'Rating minimal 1')
      .max(5, 'Rating maksimal 5'),
    comment: optionalComment
  })
  .strict();

const pageNumber = (fallback: number, max?: number): z.ZodType<number> => {
  const base = z.coerce.number().int().min(1);
  const bounded = max === undefined ? base : base.max(max);
  return z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : value),
    bounded.default(fallback)
  ) as z.ZodType<number>;
};

const LIST_REVIEWS_QUERY = z.object({
  page: pageNumber(1),
  page_size: pageNumber(20, 100)
});

function parse<T>(schema: z.ZodType<T>, raw: unknown, message: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', message, parsed.error.issues);
  }
  return parsed.data;
}

function requireUserId(request: AuthenticatedRequest): string {
  const userId = request.user?.id;
  if (!userId) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  }
  return userId;
}

@Controller()
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post('bookings/:bookingId/review')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('customer')
  @HttpCode(HttpStatus.CREATED)
  async submitReview(
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: { review: ReviewResult } }> {
    const validBookingId = parse(BOOKING_ID_PARAM, bookingId, 'ID booking tidak valid');
    const input = parse(SUBMIT_REVIEW_BODY, body, 'Data ulasan tidak valid');
    const customerId = requireUserId(req);

    const review = await this.reviewService.submitReview(
      customerId,
      validBookingId,
      input.rating,
      input.comment
    );

    return { data: { review } };
  }

  @Get('vendors/:vendorId/reviews')
  async listVendorReviews(
    @Param('vendorId') vendorId: string,
    @Query() query: unknown
  ): Promise<ReviewListResult> {
    const validVendorId = parse(VENDOR_ID_PARAM, vendorId, 'ID vendor tidak valid');
    const pagination = parse(LIST_REVIEWS_QUERY, query, 'Parameter halaman tidak valid');

    return this.reviewService.listVendorReviews(
      validVendorId,
      pagination.page,
      pagination.page_size
    );
  }
}
