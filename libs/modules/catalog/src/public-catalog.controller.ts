/**
 * PUBLIC customer-facing catalog: `GET /v1/vendors`, `GET /v1/vendors/:idOrSlug`,
 * `GET /v1/policies/:code`.
 *
 * Deliberately guard-free: these routes are the browse surface for the Flutter
 * customer app and must answer without a bearer token. Only approved+active
 * vendors, active packages and active addons ever leave this controller.
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import type {
  PolicyDocument,
  PublicVendorList,
  PublicVendorProfile,
  PublicVendorQuery
} from './contracts';
import { CatalogService } from './catalog.service';

/** An empty query string means "not provided". */
const optionalQueryText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional()
  );

/** Express hands query values over as strings; `.default` applies before coercion. */
const pageNumber = (fallback: number, max?: number) => {
  const base = z.coerce.number().int().min(1);
  const bounded = max === undefined ? base : base.max(max);
  return z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : value),
    bounded.default(fallback)
  );
};

const VENDOR_LIST_QUERY = z
  .object({
    q: optionalQueryText(80),
    region: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z
        .string()
        .trim()
        .regex(/^[0-9]{1,10}$/, 'region harus kode wilayah angka')
        .optional()
    ),
    page: pageNumber(1),
    page_size: pageNumber(20, 50)
  })
  .strict();

const POLICY_CODE = z.string().trim().min(1).max(40);

function parseListQuery(query: unknown): PublicVendorQuery {
  const parsed = VENDOR_LIST_QUERY.safeParse(query);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Parameter daftar vendor tidak valid',
      parsed.error.issues
    );
  }
  return {
    q: parsed.data.q === undefined ? null : parsed.data.q,
    region: parsed.data.region === undefined ? null : parsed.data.region,
    page: parsed.data.page,
    page_size: parsed.data.page_size
  };
}

@Controller()
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('vendors')
  async vendors(@Query() query: unknown): Promise<PublicVendorList> {
    return this.catalog.listPublicVendors(parseListQuery(query));
  }

  @Get('vendors/:idOrSlug')
  async vendor(@Param('idOrSlug') idOrSlug: string): Promise<PublicVendorProfile> {
    return this.catalog.getPublicVendor(idOrSlug);
  }

  @Get('policies/:code')
  async policy(@Param('code') code: string): Promise<PolicyDocument> {
    const parsed = POLICY_CODE.safeParse(code);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Kode kebijakan tidak valid', parsed.error.issues);
    }
    return this.catalog.getPolicy(parsed.data);
  }
}
