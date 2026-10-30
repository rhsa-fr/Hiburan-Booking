/**
 * HTTP surface for vendor lifecycle, packages and the vendor calendar.
 *
 * Mounted under the global `v1` prefix by `app.module.ts`: `/v1/admin/vendors*`.
 * Paths and response shapes are frozen — the admin panel is coded against them.
 *
 * Guards: `AuthGuard` (signed bearer token) then `RolesGuard` (`@Roles`).
 * Reads: admin_support|admin_finance|admin_super.
 * Writes: admin_finance|admin_super. Verification: admin_super only.
 * Identity comes only from `request.user`; no header is trusted for it.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, Roles, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import {
  CALENDAR_WRITE_STATUSES,
  MAX_CALENDAR_RANGE_DAYS,
  enumerateDates,
  isIsoDate
} from './calendar-plan';
import type {
  CalendarDays,
  CalendarWriteResult,
  PackageList,
  PackageRow,
  VendorCategoryList,
  VendorDetail,
  VendorSummary,
  VerifyVendorResult
} from './contracts';
import { CatalogService } from './catalog.service';

const READ_ROLES = ['admin_support', 'admin_finance', 'admin_super'] as const;
const WRITE_ROLES = ['admin_finance', 'admin_super'] as const;

const MAX_IDR = Number.MAX_SAFE_INTEGER;

/** Empty strings from HTML forms mean "not provided" on create. */
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional()
  );

/** On PATCH an empty string clears the column (`null`). */
const nullableText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable().optional()
  );

const optionalEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().email().max(150).optional()
);

const optionalPhone = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(4).max(20).optional()
);

const moneyAmount = z.number().int().positive().max(MAX_IDR);

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine(
    (value) => /^https?:\/\//i.test(value),
    'URL harus memakai http atau https'
  );

/** `null` clears a media URL; empty string from an HTML form also clears it. */
const nullableUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  httpUrl.nullable().optional()
);

const photoUrls = z.array(httpUrl).max(8).optional();

const inclusions = z.array(z.string().trim().min(1).max(120)).max(30).optional();

const isoDate = z
  .string()
  .trim()
  .refine((value) => isIsoDate(value), 'Tanggal harus berformat YYYY-MM-DD');

const CREATE_VENDOR_BODY = z
  .object({
    owner_email: optionalEmail,
    owner_phone: optionalPhone,
    region_code: z.string().trim().min(1).max(10),
    display_name: z.string().trim().min(1).max(150),
    legal_name: optionalText(150),
    description: optionalText(4000),
    base_address: optionalText(2000)
  })
  .passthrough();

const UPDATE_VENDOR_BODY = z
  .object({
    display_name: z.string().trim().min(1).max(150).optional(),
    legal_name: nullableText(150),
    description: nullableText(4000),
    base_address: nullableText(2000),
    service_radius_km: z.number().int().min(0).max(500).nullable().optional(),
    free_radius_km: z.number().int().min(0).max(2_000_000_000).optional(),
    transport_fee_per_km_idr: z.number().int().min(0).max(MAX_IDR).optional(),
    min_dp_bp: z.number().int().min(0).max(10000).optional(),
    is_active: z.boolean().optional(),
    avatar_url: nullableUrl,
    banner_url: nullableUrl,
    photo_urls: photoUrls,
    video_url: nullableUrl
  })
  .passthrough();

const VERIFY_BODY = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note: optionalText(2000)
  })
  .passthrough();

const WRITE_CATEGORIES_BODY = z
  .object({
    categories: z
      .array(
        z.object({
          slug: z
            .string()
            .trim()
            .regex(/^[a-z0-9-]{1,50}$/, 'Slug kategori tidak valid'),
          is_primary: z.boolean().optional()
        })
      )
      .max(10)
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const category of value.categories) {
      if (seen.has(category.slug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Kategori ganda: ${category.slug}`
        });
      }
      seen.add(category.slug);
    }
    if (value.categories.filter((category) => category.is_primary === true).length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Hanya satu kategori yang boleh menjadi primer'
      });
    }
  });

const CREATE_PACKAGE_BODY = z
  .object({
    name: z.string().trim().min(1).max(150),
    duration_minutes: z.number().int().min(30).max(1440),
    personnel_count: z.number().int().min(0).max(200).nullable().optional(),
    base_price_idr: moneyAmount,
    description: nullableText(4000),
    inclusions,
    photo_url: nullableUrl,
    is_active: z.boolean().optional()
  })
  .passthrough();

const UPDATE_PACKAGE_BODY = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    duration_minutes: z.number().int().min(30).max(1440).optional(),
    personnel_count: z.number().int().min(0).max(200).nullable().optional(),
    base_price_idr: moneyAmount.optional(),
    description: nullableText(4000),
    inclusions,
    photo_url: nullableUrl,
    is_active: z.boolean().optional()
  })
  .passthrough();

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

const CALENDAR_QUERY = z
  .object({ from: isoDate, to: isoDate })
  .passthrough()
  .superRefine((value, ctx) => checkRange(value.from, value.to, ctx));

const WRITE_CALENDAR_BODY = z
  .object({
    from: isoDate,
    to: isoDate,
    status: z.enum(CALENDAR_WRITE_STATUSES),
    sessions: z.array(z.enum(['day', 'night', 'full'])).min(1).max(3)
  })
  .passthrough()
  .superRefine((value, ctx) => checkRange(value.from, value.to, ctx));

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown, message: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', message, parsed.error.issues);
  }
  return parsed.data;
}

function requireActor(request: AuthenticatedRequest): string {
  const actorId = request.user?.id;
  if (!actorId) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  }
  return actorId;
}

/** `audit_logs.actor_role` for this route: verification is admin_super only. */
function requireActorRole(request: AuthenticatedRequest): string {
  if (!request.user?.roles.includes('admin_super')) {
    throw new AppError('FORBIDDEN', 'Verifikasi vendor memerlukan admin_super');
  }
  return 'admin_super';
}

@Controller('admin/vendors')
@UseGuards(AuthGuard, RolesGuard)
@Roles(...READ_ROLES)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  async createVendor(@Body() body: unknown): Promise<VendorSummary> {
    return this.catalog.createVendor(parse(CREATE_VENDOR_BODY, body, 'Data vendor tidak valid'));
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  async updateVendor(
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<VendorDetail> {
    return this.catalog.updateVendor(
      id,
      parse(UPDATE_VENDOR_BODY, body, 'Perubahan vendor tidak valid')
    );
  }

  @Get(':id/categories')
  async vendorCategories(@Param('id') id: string): Promise<VendorCategoryList> {
    return this.catalog.listVendorCategories(id);
  }

  @Put(':id/categories')
  @Roles(...WRITE_ROLES)
  async setVendorCategories(
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<VendorCategoryList> {
    return this.catalog.setVendorCategories(
      id,
      parse(WRITE_CATEGORIES_BODY, body, 'Kategori vendor tidak valid')
    );
  }

  @Post(':id/verify')
  @HttpCode(200)
  @Roles('admin_super')
  async verifyVendor(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-request-id') requestId: string | undefined,
    @Req() request: AuthenticatedRequest
  ): Promise<VerifyVendorResult> {
    return this.catalog.verifyVendor(
      id,
      parse(VERIFY_BODY, body, 'Keputusan verifikasi tidak valid'),
      {
        actorId: requireActor(request),
        actorRole: requireActorRole(request),
        requestId: requestId ?? null
      }
    );
  }

  @Get(':id/packages')
  async packages(@Param('id') id: string): Promise<PackageList> {
    return this.catalog.listPackages(id);
  }

  @Post(':id/packages')
  @Roles(...WRITE_ROLES)
  async createPackage(
    @Param('id') id: string,
    @Body() body: unknown
  ): Promise<PackageRow> {
    return this.catalog.createPackage(
      id,
      parse(CREATE_PACKAGE_BODY, body, 'Data paket tidak valid')
    );
  }

  @Patch(':id/packages/:packageId')
  @Roles(...WRITE_ROLES)
  async updatePackage(
    @Param('id') id: string,
    @Param('packageId') packageId: string,
    @Body() body: unknown
  ): Promise<PackageRow> {
    return this.catalog.updatePackage(
      id,
      packageId,
      parse(UPDATE_PACKAGE_BODY, body, 'Perubahan paket tidak valid')
    );
  }

  @Delete(':id/packages/:packageId')
  @HttpCode(204)
  @Roles(...WRITE_ROLES)
  async deletePackage(
    @Param('id') id: string,
    @Param('packageId') packageId: string
  ): Promise<void> {
    await this.catalog.deletePackage(id, packageId);
  }

  @Get(':id/calendar')
  async calendar(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>
  ): Promise<CalendarDays> {
    const parsed = parse(CALENDAR_QUERY, query, 'Rentang kalender tidak valid');
    return this.catalog.listCalendar(id, parsed.from, parsed.to);
  }

  @Put(':id/calendar')
  @Roles(...WRITE_ROLES)
  async writeCalendar(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<CalendarWriteResult> {
    return this.catalog.writeCalendar(
      id,
      parse(WRITE_CALENDAR_BODY, body, 'Perubahan kalender tidak valid'),
      requireActor(request)
    );
  }
}
