import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import {
  CALENDAR_WRITE_STATUSES,
  MAX_CALENDAR_RANGE_DAYS,
  enumerateDates,
  isIsoDate
} from '@tarlink/modules/catalog';

const MAX_IDR = Number.MAX_SAFE_INTEGER;

/** Empty strings from mobile forms mean "clear this column". */
function nullableText(max: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable().optional()
  );
}

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine(
    (value) => /^https?:\/\//i.test(value),
    'URL harus memakai http atau https'
  );

const nullableUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  httpUrl.nullable().optional()
);

const photoUrls = z.array(httpUrl).max(8).optional();
const inclusions = z.array(z.string().trim().min(1).max(120)).max(30).optional();

/**
 * Self-service profile patch. `.strict()` is deliberate: verification status,
 * region, active flag and slug are admin-only and must be rejected, not ignored.
 */
export const VENDOR_SELF_UPDATE_BODY = z
  .object({
    display_name: z.string().trim().min(1).max(150).optional(),
    legal_name: nullableText(150),
    description: nullableText(4000),
    base_address: nullableText(2000),
    service_radius_km: z.number().int().min(0).max(500).nullable().optional(),
    free_radius_km: z.number().int().min(0).max(500).optional(),
    transport_fee_per_km_idr: z.number().int().min(0).max(MAX_IDR).optional(),
    min_dp_bp: z.number().int().min(0).max(10000).optional(),
    avatar_url: nullableUrl,
    banner_url: nullableUrl,
    photo_urls: photoUrls,
    video_url: nullableUrl
  })
  .strict();

export const CREATE_PACKAGE_BODY = z
  .object({
    name: z.string().trim().min(1).max(150),
    duration_minutes: z.number().int().min(30).max(1440),
    personnel_count: z.number().int().min(0).max(200).nullable().optional(),
    base_price_idr: z.number().int().positive().max(MAX_IDR),
    description: nullableText(4000),
    inclusions,
    photo_url: nullableUrl,
    is_active: z.boolean().optional()
  })
  .strict();

export const UPDATE_PACKAGE_BODY = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    duration_minutes: z.number().int().min(30).max(1440).optional(),
    personnel_count: z.number().int().min(0).max(200).nullable().optional(),
    base_price_idr: z.number().int().positive().max(MAX_IDR).optional(),
    description: nullableText(4000),
    inclusions,
    photo_url: nullableUrl,
    is_active: z.boolean().optional()
  })
  .strict();

const isoDate = z
  .string()
  .trim()
  .refine((value) => isIsoDate(value), 'Tanggal harus berformat YYYY-MM-DD');

function checkRange(from: string, to: string, ctx: z.RefinementCtx): void {
  try {
    const days = enumerateDates(from, to).length;
    if (days > MAX_CALENDAR_RANGE_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Rentang maksimum ${MAX_CALENDAR_RANGE_DAYS} hari`
      });
    }
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: err instanceof Error ? err.message : 'Rentang tanggal tidak valid'
    });
  }
}

export const WRITE_CALENDAR_BODY = z
  .object({
    from: isoDate,
    to: isoDate,
    status: z.enum(CALENDAR_WRITE_STATUSES),
    sessions: z.array(z.enum(['day', 'night', 'full'])).min(1).max(3)
  })
  .strict()
  .superRefine((value, ctx) => checkRange(value.from, value.to, ctx));

export type VendorSelfUpdateInput = z.infer<typeof VENDOR_SELF_UPDATE_BODY>;
export type CreatePackageBody = z.infer<typeof CREATE_PACKAGE_BODY>;
export type UpdatePackageBody = z.infer<typeof UPDATE_PACKAGE_BODY>;
export type WriteCalendarBody = z.infer<typeof WRITE_CALENDAR_BODY>;

export function parseBody<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  body: unknown,
  message: string
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', message, parsed.error.issues);
  }
  return parsed.data;
}
