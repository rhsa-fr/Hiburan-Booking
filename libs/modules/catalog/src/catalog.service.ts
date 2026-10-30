/**
 * Catalog orchestration: vendor lifecycle, packages, calendar.
 *
 * Validation that needs the database (owner resolves to an active user, region
 * exists, no existing vendor, slug collision) lives here, inside the same
 * transaction as the write it guards. Shape validation happens in the
 * controller; money crosses `money.ts`.
 */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { withTransaction } from '@tarlink/core/db';
import { AppError } from '@tarlink/core/errors';
import {
  buildCalendarView,
  expandCalendarCells,
  planCalendarWrites,
  slotKey,
  type CalendarWriteStatus
} from './calendar-plan';
import type {
  CalendarDays,
  CalendarSession,
  CalendarSlotStatus,
  CalendarWriteResult,
  PackageList,
  PackageRow,
  PolicyDocument,
  PublicCategoryList,
  PublicVendorList,
  PublicVendorProfile,
  PublicVendorQuery,
  VendorCategoryList,
  VendorDetail,
  VendorDecision,
  VendorSummary,
  VerifyVendorResult
} from './contracts';
import {
  mapCalendarSlot,
  mapPackage,
  mapPolicy,
  mapPublicPackages,
  mapPublicVendorCard,
  mapPublicVendorProfile,
  mapVendorCategory,
  mapVendorDetail,
  mapVendorSummary,
  mapVerifyResult
} from './mappers';
import { idrToPgParam } from './money';
import { CatalogRepository } from './catalog.repository';
import { isDataViolation, isUniqueViolation } from './pg-errors';
import { slugify, uniqueSlug } from './slug';

const SLUG_ATTEMPTS = 5;

export interface CreateVendorInput {
  owner_email?: string;
  owner_phone?: string;
  region_code: string;
  display_name: string;
  legal_name?: string;
  description?: string;
  base_address?: string;
}

export interface UpdateVendorInput {
  display_name?: string;
  legal_name?: string | null;
  description?: string | null;
  base_address?: string | null;
  service_radius_km?: number | null;
  free_radius_km?: number;
  transport_fee_per_km_idr?: number;
  min_dp_bp?: number;
  is_active?: boolean;
}

export interface VerifyVendorInput {
  decision: VendorDecision;
  note?: string;
}

export interface SetVendorCategoriesInput {
  categories: ReadonlyArray<{ slug: string; is_primary?: boolean }>;
}

export interface VerifyContext {
  actorId: string;
  /** `audit_logs.actor_role`; `admin_super` for this route. */
  actorRole: string | null;
  requestId: string | null;
}

export interface CreatePackageInput {
  name: string;
  duration_minutes: number;
  base_price_idr: number;
  description?: string | null;
  is_active?: boolean;
  personnel_count?: number | null;
  inclusions?: string[];
  photo_url?: string | null;
}

export interface UpdatePackageInput {
  name?: string;
  duration_minutes?: number;
  base_price_idr?: number;
  description?: string | null;
  is_active?: boolean;
  personnel_count?: number | null;
  inclusions?: string[];
  photo_url?: string | null;
}

export interface WriteCalendarInput {
  from: string;
  to: string;
  status: CalendarWriteStatus;
  sessions: readonly CalendarSession[];
}

@Injectable()
export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  /* ---------------------------------------------------------------- vendors */

  async createVendor(input: CreateVendorInput): Promise<VendorSummary> {
    const base = slugify(input.display_name);

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      try {
        return await withTransaction(async (client) => {
          if (!(await this.repository.regionExists(client, input.region_code))) {
            throw new AppError(
              'VALIDATION_ERROR',
              `region_code tidak dikenal: ${input.region_code}`
            );
          }

          const ownerUserId = await this.resolveOwner(client, input);
          const existing = await this.repository.vendorIdForOwner(client, ownerUserId);
          if (existing !== null) {
            throw new AppError('CONFLICT', 'User ini sudah memiliki vendor');
          }

          const taken = new Set(await this.repository.takenSlugs(client, base));
          const row = await this.repository.insertVendor(client, {
            ownerUserId,
            regionCode: input.region_code,
            slug: uniqueSlug(base, taken),
            displayName: input.display_name,
            legalName: input.legal_name ?? null,
            description: input.description ?? null,
            baseAddress: input.base_address ?? null
          });

          // Same transaction as the vendor row: if the insert above rolls back,
          // the role grant does too. The owner needs this to act as a vendor.
          await this.repository.grantVendorOwner(client, ownerUserId, row.id);

          return mapVendorSummary(row);
        });
      } catch (err) {
        // The slug was claimed between the SELECT and the INSERT: recompute.
        if (isUniqueViolation(err, 'vendors_slug_key') && attempt < SLUG_ATTEMPTS - 1) continue;
        if (isUniqueViolation(err)) {
          throw new AppError('CONFLICT', 'Slug vendor sudah dipakai');
        }
        if (isDataViolation(err)) {
          throw new AppError('VALIDATION_ERROR', 'Data vendor tidak valid');
        }
        throw err;
      }
    }

    throw new AppError('CONFLICT', 'Slug vendor tidak dapat dibuat unik');
  }

  async updateVendor(id: string, input: UpdateVendorInput): Promise<VendorDetail> {
    return withTransaction(async (client) => {
      try {
        const row = await this.repository.updateVendor(client, id, {
          ...input,
          transport_fee_per_km_idr:
            input.transport_fee_per_km_idr === undefined
              ? undefined
              : idrToPgParam(input.transport_fee_per_km_idr, 'vendor.transport_fee_per_km_idr')
        });
        if (!row) throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
        return mapVendorDetail(row);
      } catch (err) {
        if (isDataViolation(err)) {
          throw new AppError('VALIDATION_ERROR', 'Perubahan vendor melanggar batas kolom');
        }
        throw err;
      }
    });
  }

  /* ------------------------------------------------------- vendor categories */

  async listVendorCategories(vendorId: string): Promise<VendorCategoryList> {
    if (!(await this.repository.vendorExists(vendorId))) {
      throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
    }
    const rows = await this.repository.listVendorCategories(vendorId);
    return { vendor_id: vendorId, items: rows.map(mapVendorCategory) };
  }

  /**
   * Replaces the vendor's category set. Input order is preserved for the
   * primary pick: the first `is_primary` entry wins, otherwise the first slug.
   * Writes are atomic with the vendor lock, so a concurrent assignment cannot
   * leave two primaries behind.
   */
  async setVendorCategories(
    vendorId: string,
    input: SetVendorCategoriesInput
  ): Promise<VendorCategoryList> {
    const slugs = [...new Set(input.categories.map((category) => category.slug))];
    const primarySlug =
      input.categories.find((category) => category.is_primary === true)?.slug ??
      slugs[0] ??
      null;

    return withTransaction(async (client) => {
      if (!(await this.repository.lockVendor(client, vendorId))) {
        throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
      }

      const found = await this.repository.categoriesBySlugs(client, slugs);
      const bySlug = new Map(found.map((row) => [row.slug, row] as const));

      const unknown = slugs.filter((slug) => !bySlug.has(slug));
      if (unknown.length > 0) {
        throw new AppError('VALIDATION_ERROR', `Kategori tidak dikenal: ${unknown.join(', ')}`);
      }
      const inactive = found
        .filter((row) => !row.is_active)
        .map((row) => row.slug);
      if (inactive.length > 0) {
        throw new AppError('VALIDATION_ERROR', `Kategori tidak aktif: ${inactive.join(', ')}`);
      }

      const categoryIds = slugs.map((slug) => bySlug.get(slug)!.id);
      const primaryId =
        primarySlug === null ? null : (bySlug.get(primarySlug)?.id ?? null);

      await this.repository.replaceVendorCategories(client, vendorId, categoryIds, primaryId);
      const rows = await this.repository.vendorCategoriesInTx(client, vendorId);
      return { vendor_id: vendorId, items: rows.map(mapVendorCategory) };
    });
  }

  async verifyVendor(
    id: string,
    input: VerifyVendorInput,
    context: VerifyContext
  ): Promise<VerifyVendorResult> {
    return withTransaction(async (client) => {
      const before = await this.repository.lockVendor(client, id);
      if (!before) throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');

      const after =
        input.decision === 'approve'
          ? await this.repository.setApproved(client, id, context.actorId)
          : await this.repository.setRejected(client, id, input.note ?? null);
      if (!after) throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');

      await this.repository.insertAudit(client, {
        actorId: context.actorId,
        actorRole: context.actorRole,
        action: input.decision === 'approve' ? 'vendor.approve' : 'vendor.reject',
        entityType: 'vendor',
        entityId: id,
        beforeState: { verification_status: before.verification_status },
        afterState: {
          verification_status: after.verification_status,
          verification_note: after.verification_note,
          verified_at: after.verified_at ? after.verified_at.toISOString() : null,
          verified_by: after.verified_by
        },
        requestId: context.requestId
      });

      return mapVerifyResult(after);
    });
  }

  private async resolveOwner(client: PoolClient, input: CreateVendorInput): Promise<string> {
    const byEmail = input.owner_email
      ? await this.repository.findActiveUserByEmail(client, input.owner_email)
      : null;
    const byPhone = input.owner_phone
      ? await this.repository.findActiveUserByPhone(client, input.owner_phone)
      : null;

    if (byEmail !== null && byPhone !== null && byEmail !== byPhone) {
      throw new AppError(
        'VALIDATION_ERROR',
        'owner_email dan owner_phone menunjuk user yang berbeda'
      );
    }

    const ownerUserId = byEmail ?? byPhone;
    if (ownerUserId === null) {
      throw new AppError(
        'VALIDATION_ERROR',
        'owner_email atau owner_phone harus cocok dengan user aktif'
      );
    }
    return ownerUserId;
  }

  /* --------------------------------------------------------------- packages */

  async listPackages(vendorId: string): Promise<PackageList> {
    if (!(await this.repository.vendorExists(vendorId))) {
      throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
    }
    const rows = await this.repository.listPackages(vendorId);
    return { items: rows.map(mapPackage) };
  }

  async createPackage(vendorId: string, input: CreatePackageInput): Promise<PackageRow> {
    return withTransaction(async (client) => {
      if (!(await this.repository.lockVendorRef(client, vendorId))) {
        throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
      }
      try {
        const row = await this.repository.insertPackage(client, vendorId, {
          name: input.name,
          duration_minutes: input.duration_minutes,
          base_price_idr: idrToPgParam(input.base_price_idr, 'package.base_price_idr'),
          description: input.description ?? null,
          is_active: input.is_active ?? true,
          personnel_count: input.personnel_count ?? null,
          inclusions: input.inclusions ?? [],
          photo_url: input.photo_url ?? null
        });
        return mapPackage(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError('CONFLICT', `Paket "${input.name}" sudah ada untuk vendor ini`);
        }
        if (isDataViolation(err)) {
          throw new AppError('VALIDATION_ERROR', 'Data paket tidak valid');
        }
        throw err;
      }
    });
  }

  async updatePackage(
    vendorId: string,
    packageId: string,
    input: UpdatePackageInput
  ): Promise<PackageRow> {
    return withTransaction(async (client) => {
      try {
        const row = await this.repository.updatePackage(client, vendorId, packageId, {
          ...input,
          base_price_idr:
            input.base_price_idr === undefined
              ? undefined
              : idrToPgParam(input.base_price_idr, 'package.base_price_idr')
        });
        if (!row) throw new AppError('NOT_FOUND', 'Paket tidak ditemukan');
        return mapPackage(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError('CONFLICT', 'Nama paket sudah dipakai vendor ini');
        }
        if (isDataViolation(err)) {
          throw new AppError('VALIDATION_ERROR', 'Perubahan paket melanggar batas kolom');
        }
        throw err;
      }
    });
  }

  async deletePackage(vendorId: string, packageId: string): Promise<void> {
    await withTransaction(async (client) => {
      if (!(await this.repository.lockVendorRef(client, vendorId))) {
        throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
      }
      const deactivated = await this.repository.deactivatePackage(client, vendorId, packageId);
      if (!deactivated) throw new AppError('NOT_FOUND', 'Paket tidak ditemukan');
    });
  }

  /* --------------------------------------------------------------- calendar */

  async listCalendar(vendorId: string, from: string, to: string): Promise<CalendarDays> {
    if (!(await this.repository.vendorExists(vendorId))) {
      throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
    }
    const rows = await this.repository.calendarSlots(vendorId, from, to);
    return { days: buildCalendarView(from, to, rows.map(mapCalendarSlot)) };
  }

  async writeCalendar(
    vendorId: string,
    input: WriteCalendarInput,
    actorId: string,
    source: 'admin' | 'vendor' = 'admin'
  ): Promise<CalendarWriteResult> {
    const cells = expandCalendarCells(input.from, input.to, input.sessions);

    return withTransaction(async (client) => {
      if (!(await this.repository.lockVendorRef(client, vendorId))) {
        throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
      }

      const existing: ReadonlyMap<string, CalendarSlotStatus> = new Map(
        (await this.repository.lockCalendarSlots(client, vendorId, input.from, input.to)).map(
          (row) => {
            const mapped = mapCalendarSlot(row);
            return [slotKey(mapped.date, mapped.session), mapped.status] as const;
          }
        )
      );

      const plan = planCalendarWrites(cells, existing, input.status);
      const updated = await this.repository.upsertCalendarCells(
        client,
        vendorId,
        plan.writes,
        input.status,
        actorId,
        source
      );
      await this.repository.touchCalendar(client, vendorId);
      return { updated };
    });
  }

  /* ---------------------------------------------------------- public catalog */

  async listPublicVendors(input: PublicVendorQuery): Promise<PublicVendorList> {
    const { rows, total } = await this.repository.publicVendorPage({
      q: input.q,
      region: input.region,
      category: input.category,
      date: input.date,
      session: input.session,
      sort: input.sort,
      limit: input.page_size,
      offset: (input.page - 1) * input.page_size
    });
    return {
      items: rows.map(mapPublicVendorCard),
      total,
      page: input.page,
      page_size: input.page_size
    };
  }

  async listPublicCategories(): Promise<PublicCategoryList> {
    const rows = await this.repository.publicCategories();
    return {
      items: rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        sort_order: row.sort_order
      }))
    };
  }

  async getPublicVendor(idOrSlug: string): Promise<PublicVendorProfile> {
    const vendor = await this.repository.publicVendorProfile(idOrSlug);
    if (!vendor) throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');

    const packages = await this.repository.publicPackages(vendor.id);
    const addons = await this.repository.publicAddons(packages.map((row) => row.id));
    return {
      vendor: mapPublicVendorProfile(vendor),
      packages: mapPublicPackages(packages, addons)
    };
  }

  async getPolicy(code: string): Promise<PolicyDocument> {
    const row = await this.repository.currentPolicy(code);
    if (!row) throw new AppError('NOT_FOUND', 'Kebijakan tidak ditemukan');
    return mapPolicy(row);
  }
}
