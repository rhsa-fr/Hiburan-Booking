import type { PoolClient } from 'pg';
import { AppError } from '@tarlink/core/errors';
import { query, withTransaction } from '@tarlink/core/db';
import type {
  SubmitVendorApplicationInput,
  VendorAccountRecord,
  VendorApplicationRecord,
  VendorApplicationStatus,
  VendorApplicationView,
  VendorCategoryRecord,
  VendorPolicyRecord
} from './vendor-onboarding.contracts';

/** Plain column list; usable by `RETURNING` and by `FOR UPDATE` locks. */
const APPLICATION_COLUMNS = `
  id, user_id, status, display_name, legal_name, nik, nik_ciphertext, nik_key_id,
  region_code, base_address, ktp_object_key, review_note, reviewed_by, reviewed_at,
  vendor_id, created_at, form_version, category_id, years_active, description,
  personnel_count, equipment_summary, portfolio_url, agreement_policy_version_id
`;

/** Aliased columns for SELECTs: category and agreement version come from joins. */
const APPLICATION_SELECT = `
  a.id, a.user_id, a.status, a.display_name, a.legal_name, a.nik, a.nik_ciphertext,
  a.nik_key_id, a.region_code, a.base_address, a.ktp_object_key, a.review_note,
  a.reviewed_by, a.reviewed_at, a.vendor_id, a.created_at, a.form_version,
  a.category_id, a.years_active, a.description, a.personnel_count,
  a.equipment_summary, a.portfolio_url, a.agreement_policy_version_id,
  c.slug AS category_slug,
  c.name AS category_name,
  p.version AS agreement_version
`;

const APPLICATION_FROM = `
  FROM vendor_applications a
  LEFT JOIN categories c ON c.id = a.category_id
  LEFT JOIN policy_versions p ON p.id = a.agreement_policy_version_id
`;

interface ApplicationRow {
  id: string;
  user_id: string;
  status: VendorApplicationStatus;
  display_name: string;
  legal_name: string;
  nik: string | null;
  nik_ciphertext: Buffer | null;
  nik_key_id: string | null;
  region_code: string;
  base_address: string;
  ktp_object_key: string;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  vendor_id: string | null;
  created_at: Date;
  form_version: number | null;
  category_id: number | null;
  category_slug: string | null;
  category_name: string | null;
  years_active: number | null;
  description: string | null;
  personnel_count: number | null;
  equipment_summary: string | null;
  portfolio_url: string | null;
  agreement_policy_version_id: string | null;
  agreement_version: number | null;
}

interface AccountRow {
  name: string | null;
  phone: string | null;
  email: string | null;
  email_verified_at: Date | null;
  status: string;
}

interface CategoryRow {
  id: number;
  slug: string;
  name: string;
  is_active: boolean;
}

interface PolicyRow {
  id: string;
  code: string;
  version: number;
  body_hash: string;
  effective_from: Date;
  body: Record<string, unknown>;
}

interface PolicyVersionRow {
  id: string;
  code: string;
  version: number;
}

export interface ApplicationWindow {
  readonly count: number;
  readonly oldest: Date | null;
}

function mapApplication(row: ApplicationRow): VendorApplicationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    displayName: row.display_name,
    legalName: row.legal_name,
    nik: row.nik ?? '',
    nikCiphertext: row.nik_ciphertext ?? null,
    nikKeyId: row.nik_key_id ?? null,
    regionCode: row.region_code,
    baseAddress: row.base_address,
    ktpObjectKey: row.ktp_object_key,
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    vendorId: row.vendor_id,
    createdAt: row.created_at,
    formVersion: row.form_version ?? 1,
    categoryId: row.category_id ?? null,
    categorySlug: row.category_slug ?? null,
    categoryName: row.category_name ?? null,
    yearsActive: row.years_active ?? null,
    description: row.description ?? null,
    personnelCount: row.personnel_count ?? null,
    equipmentSummary: row.equipment_summary ?? null,
    portfolioUrl: row.portfolio_url ?? null,
    agreementPolicyVersionId: row.agreement_policy_version_id ?? null,
    agreementVersion: row.agreement_version ?? null
  };
}

/** Masks all but the last four digits; admins see the full value. */
export function maskNik(nik: string): string {
  if (nik.length <= 4) return nik;
  return `${'*'.repeat(nik.length - 4)}${nik.slice(-4)}`;
}

export function toApplicationView(
  record: VendorApplicationRecord,
  options: { revealNik: boolean }
): VendorApplicationView {
  return {
    id: record.id,
    status: record.status,
    display_name: record.displayName,
    legal_name: record.legalName,
    nik: options.revealNik ? record.nik : maskNik(record.nik),
    region_code: record.regionCode,
    base_address: record.baseAddress,
    review_note: record.reviewNote,
    vendor_id: record.vendorId,
    created_at: record.createdAt.toISOString(),
    reviewed_at: record.reviewedAt ? record.reviewedAt.toISOString() : null,
    form_version: record.formVersion,
    category_slug: record.categorySlug,
    category_name: record.categoryName,
    years_active: record.yearsActive,
    description: record.description,
    personnel_count: record.personnelCount,
    equipment_summary: record.equipmentSummary,
    portfolio_url: record.portfolioUrl,
    agreement_version_id: record.agreementPolicyVersionId,
    agreement_version: record.agreementVersion
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

/**
 * CHECK (23514) and foreign-key (23503) failures mean the payload disagrees
 * with the schema. They are client errors, not 500s; the Zod layer normally
 * catches them first, this is the last safety net before the DB driver surfaces.
 */
function isConstraintViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === '23514' || code === '23503';
}

export class VendorOnboardingRepository {
  async findLatestByUser(userId: string): Promise<VendorApplicationRecord | null> {
    const rows = await query<ApplicationRow>(
      `SELECT ${APPLICATION_SELECT}
       ${APPLICATION_FROM}
        WHERE a.user_id = $1
        ORDER BY a.created_at DESC
        LIMIT 1`,
      [userId]
    );
    return rows[0] ? mapApplication(rows[0]) : null;
  }

  async findAccount(userId: string): Promise<VendorAccountRecord | null> {
    const rows = await query<AccountRow>(
      `SELECT name, phone, email, email_verified_at, status
         FROM users
        WHERE id = $1`,
      [userId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      name: row.name,
      phone: row.phone,
      email: row.email,
      emailVerifiedAt: row.email_verified_at,
      status: row.status
    };
  }

  async hasVendorAccount(userId: string): Promise<boolean> {
    const rows = await query<{ exists: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM vendors WHERE owner_user_id = $1)
         OR EXISTS (
           SELECT 1 FROM vendor_applications
            WHERE user_id = $1 AND status = 'approved'
         )
       ) AS exists`,
      [userId]
    );
    return rows[0]?.exists ?? false;
  }

  async hasOpenApplication(userId: string): Promise<boolean> {
    const rows = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM vendor_applications
          WHERE user_id = $1 AND status IN ('draft','submitted')
       ) AS exists`,
      [userId]
    );
    return rows[0]?.exists ?? false;
  }

  /** Every KTP object key the database still references for this user. */
  async listKtpKeysForUser(userId: string): Promise<string[]> {
    const rows = await query<{ ktp_object_key: string }>(
      `SELECT ktp_object_key
         FROM vendor_applications
        WHERE user_id = $1 AND ktp_object_key <> ''
       UNION
       SELECT v.ktp_object_key
         FROM vendors v
        WHERE v.owner_user_id = $1 AND v.ktp_object_key IS NOT NULL`,
      [userId]
    );
    return rows.map((row) => row.ktp_object_key);
  }

  /** Number of applications created since `since`, plus the oldest one. */
  async countApplicationsSince(userId: string, since: Date): Promise<ApplicationWindow> {
    const rows = await query<{ count: number; oldest: Date | null }>(
      `SELECT COUNT(*)::int AS count, MIN(created_at) AS oldest
         FROM vendor_applications
        WHERE user_id = $1 AND created_at >= $2`,
      [userId, since]
    );
    const row = rows[0];
    return { count: row?.count ?? 0, oldest: row?.oldest ?? null };
  }

  async categoryBySlug(slug: string): Promise<VendorCategoryRecord | null> {
    const rows = await query<CategoryRow>(
      'SELECT id, slug, name, is_active FROM categories WHERE slug = $1',
      [slug]
    );
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, slug: row.slug, name: row.name, isActive: row.is_active };
  }

  async listActiveCategories(): Promise<Array<{ slug: string; name: string }>> {
    return query<{ slug: string; name: string }>(
      `SELECT slug, name
         FROM categories
        WHERE is_active
        ORDER BY sort_order, name`
    );
  }

  /** The exact document the client must accept; `null` blocks submission. */
  async currentVendorPolicy(): Promise<VendorPolicyRecord | null> {
    const rows = await query<PolicyRow>(
      `SELECT id, code, version, body_hash, effective_from, body
         FROM policy_versions
        WHERE code = 'vendor'
          AND is_active
          AND effective_from <= now()
          AND (effective_to IS NULL OR effective_to > now())
        ORDER BY effective_from DESC, version DESC
        LIMIT 1`
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      version: row.version,
      bodyHash: row.body_hash,
      effectiveFrom: row.effective_from,
      body: row.body
    };
  }

  async policyVersionById(policyVersionId: string): Promise<PolicyVersionRow | null> {
    const rows = await query<PolicyVersionRow>(
      'SELECT id, code, version FROM policy_versions WHERE id = $1',
      [policyVersionId]
    );
    return rows[0] ?? null;
  }

  /**
   * Re-reads the active vendor policy inside the submit transaction with a
   * shared row lock. Closes the check-then-write race where an admin ships a new
   * Ketentuan Mitra between the pre-check and the insert.
   */
  async lockVendorPolicy(
    client: PoolClient
  ): Promise<{ id: string; version: number } | null> {
    const result = await client.query<{ id: string; version: number }>(
      `SELECT id, version
         FROM policy_versions
        WHERE code = 'vendor'
          AND is_active
          AND effective_from <= now()
          AND (effective_to IS NULL OR effective_to > now())
        ORDER BY effective_from DESC, version DESC
        LIMIT 1
        FOR SHARE`
    );
    return result.rows[0] ?? null;
  }

  /** Regency/city list for the onboarding form (no auth, no PII). */
  async listRegions(): Promise<Array<{ code: string; name: string; level: string }>> {
    return query<{ code: string; name: string; level: string }>(
      `SELECT code, name, level
         FROM regions
        WHERE level IN ('regency','city')
          AND is_active
        ORDER BY sort_order, name`
    );
  }

  async regionExists(regionCode: string): Promise<boolean> {
    const rows = await query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM regions WHERE code = $1 AND is_active) AS exists',
      [regionCode]
    );
    return rows[0]?.exists ?? false;
  }

  /** Consent row for the accepted Ketentuan Mitra; same transaction as submit. */
  async insertConsent(
    client: PoolClient,
    input: {
      userId: string;
      policyCode: string;
      policyVersionId: string;
      acceptedAt: Date;
      ip: string | null;
      userAgent: string | null;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO user_consents
         (user_id, policy_code, policy_version_id, accepted_at, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, policy_version_id) DO NOTHING`,
      [
        input.userId,
        input.policyCode,
        input.policyVersionId,
        input.acceptedAt,
        input.ip,
        input.userAgent
      ]
    );
  }

  async insertApplication(
    client: PoolClient,
    userId: string,
    input: SubmitVendorApplicationInput,
    secret: { ciphertext: Buffer; keyId: string },
    resolved: { categoryId: number; agreementPolicyVersionId: string }
  ): Promise<VendorApplicationRecord> {
    let insertedId: string;
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO vendor_applications
           (user_id, display_name, legal_name, nik, nik_ciphertext, nik_key_id,
            region_code, base_address, ktp_object_key, form_version, category_id,
            years_active, description, personnel_count, equipment_summary,
            portfolio_url, agreement_policy_version_id)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, 2, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id`,
        [
          userId,
          input.display_name,
          input.legal_name,
          secret.ciphertext,
          secret.keyId,
          input.region_code,
          input.base_address,
          input.ktp_object_key,
          resolved.categoryId,
          input.years_active,
          input.description,
          input.personnel_count,
          input.equipment_summary,
          input.portfolio_url,
          resolved.agreementPolicyVersionId
        ]
      );
      const row = inserted.rows[0];
      if (!row) throw new AppError('INTERNAL_ERROR', 'vendor application insert returned no row');
      insertedId = row.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('CONFLICT', 'Pengajuan vendor untuk akun ini masih diproses.', {
          reason: 'APPLICATION_OPEN'
        });
      }
      if (isConstraintViolation(error)) {
        throw new AppError('VALIDATION_ERROR', 'Data pengajuan tidak valid', {
          reason: 'DB_CONSTRAINT'
        });
      }
      throw error;
    }

    // Re-read with joins so the response carries `category_name` and the
    // accepted policy version without the caller re-deriving them.
    const selected = await client.query<ApplicationRow>(
      `SELECT ${APPLICATION_SELECT} ${APPLICATION_FROM} WHERE a.id = $1`,
      [insertedId]
    );
    const row = selected.rows[0];
    if (!row) throw new AppError('INTERNAL_ERROR', 'vendor application select returned no row');
    return mapApplication(row);
  }

  /** Audit entry for a self-service submit: no NIK, no address. */
  async insertSubmitAudit(
    client: PoolClient,
    input: {
      applicationId: string;
      userId: string;
      policyVersion: number;
      categorySlug: string;
    }
  ): Promise<void> {
    await this.insertAudit(client, {
      actorId: input.userId,
      actorRole: 'customer',
      action: 'vendor.application.submit',
      entityType: 'vendor_application',
      entityId: input.applicationId,
      beforeState: null,
      afterState: {
        form_version: 2,
        policy_version: input.policyVersion,
        category_slug: input.categorySlug
      },
      requestId: null
    });
  }

  /** Lazy backfill for a row that still holds a plaintext NIK (pre-019). */
  async setNikCiphertext(
    applicationId: string,
    ciphertext: Buffer,
    keyId: string
  ): Promise<void> {
    await query(
      `UPDATE vendor_applications
          SET nik = NULL, nik_ciphertext = $2, nik_key_id = $3
        WHERE id = $1`,
      [applicationId, ciphertext, keyId]
    );
  }

  async listForAdmin(input: {
    status?: VendorApplicationStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: VendorApplicationRecord[]; total: number }> {
    const where = input.status ? 'WHERE a.status = $1' : '';
    const params: Array<string | number> = input.status ? [input.status] : [];
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;

    const rows = await query<ApplicationRow>(
      `SELECT ${APPLICATION_SELECT}
       ${APPLICATION_FROM}
       ${where}
        ORDER BY a.created_at DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      [...params, input.pageSize, (input.page - 1) * input.pageSize]
    );

    const counts = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM vendor_applications a ${where}`,
      params
    );

    return { items: rows.map(mapApplication), total: counts[0]?.total ?? 0 };
  }

  async findById(applicationId: string): Promise<VendorApplicationRecord | null> {
    const rows = await query<ApplicationRow>(
      `SELECT ${APPLICATION_SELECT} ${APPLICATION_FROM} WHERE a.id = $1`,
      [applicationId]
    );
    return rows[0] ? mapApplication(rows[0]) : null;
  }

  /**
   * Approves one application: creates the vendor, grants `vendor_owner`, and
   * closes the application, all in the caller's transaction.
   */
  async approve(
    client: PoolClient,
    input: {
      application: VendorApplicationRecord;
      actorId: string;
      actorRole: string;
      slug: string;
      now: Date;
    }
  ): Promise<VendorApplicationRecord> {
    const locked = await client.query<ApplicationRow>(
      `SELECT ${APPLICATION_COLUMNS}
         FROM vendor_applications
        WHERE id = $1
        FOR UPDATE`,
      [input.application.id]
    );
    const current = locked.rows[0];
    if (!current) throw new AppError('NOT_FOUND', 'Pengajuan vendor tidak ditemukan');
    if (current.status !== 'submitted') {
      throw new AppError(
        'CONFLICT',
        `Pengajuan sudah berstatus ${current.status} dan tidak bisa disetujui lagi.`
      );
    }

    const vendors = await client.query<{ id: string }>(
      `INSERT INTO vendors
         (owner_user_id, region_code, slug, display_name, legal_name, base_address,
          description, ktp_object_key, verification_status, verified_at, verified_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', $9, $10)
       RETURNING id`,
      [
        current.user_id,
        current.region_code,
        input.slug,
        current.display_name,
        current.legal_name,
        current.base_address,
        current.description,
        current.ktp_object_key,
        input.now,
        input.actorId
      ]
    );
    const vendor = vendors.rows[0];
    if (!vendor) throw new AppError('INTERNAL_ERROR', 'vendor insert returned no row');

    // The category chosen in the wizard becomes the vendor's primary category.
    // Rows from form v1 have no category and keep the previous behaviour.
    if (current.category_id !== null) {
      await client.query(
        `INSERT INTO vendor_categories (vendor_id, category_id, is_primary)
         VALUES ($1, $2, true)
         ON CONFLICT DO NOTHING`,
        [vendor.id, current.category_id]
      );
    }

    await client.query(
      `INSERT INTO user_roles (user_id, role, vendor_id, vendor_scope, granted_by)
       VALUES ($1, 'vendor_owner', $2, $2, $3)
       ON CONFLICT (user_id, role, vendor_scope) DO NOTHING`,
      [current.user_id, vendor.id, input.actorId]
    );

    // A vendor owner must still be able to use the customer app ("Keluar mode
    // vendor" opens bookings/favorites/chat, which require `customer`). Granted
    // in the same transaction so approval never leaves the account without it;
    // an existing row is kept as-is, a revoked one is restored (migration 040).
    await client.query(
      `INSERT INTO user_roles (user_id, role, vendor_id, vendor_scope)
       VALUES ($1, 'customer', NULL, '00000000-0000-0000-0000-000000000000')
       ON CONFLICT (user_id, role, vendor_scope)
       DO UPDATE SET revoked_at = NULL WHERE user_roles.revoked_at IS NOT NULL`,
      [current.user_id]
    );

    const updated = await client.query<ApplicationRow>(
      `UPDATE vendor_applications
          SET status = 'approved',
              reviewed_by = $2,
              reviewed_at = $3,
              vendor_id = $4
        WHERE id = $1
        RETURNING ${APPLICATION_COLUMNS}`,
      [current.id, input.actorId, input.now, vendor.id]
    );
    const row = updated.rows[0];
    if (!row) throw new AppError('INTERNAL_ERROR', 'application update returned no row');

    await this.insertAudit(client, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: 'vendor.application.approve',
      entityType: 'vendor_application',
      entityId: current.id,
      beforeState: { status: current.status },
      afterState: { status: 'approved', vendor_id: vendor.id },
      requestId: null
    });

    const joined = await client.query<ApplicationRow>(
      `SELECT ${APPLICATION_SELECT} ${APPLICATION_FROM} WHERE a.id = $1`,
      [current.id]
    );
    return mapApplication(joined.rows[0] ?? row);
  }

  async reject(
    client: PoolClient,
    input: {
      applicationId: string;
      actorId: string;
      actorRole: string;
      note: string | null;
      now: Date;
    }
  ): Promise<VendorApplicationRecord> {
    // Data minimisation: a rejected application no longer needs the KTP file.
    // The key is blanked in the same transaction; the caller removes the bytes.
    const updated = await client.query<ApplicationRow>(
      `UPDATE vendor_applications
          SET status = 'rejected',
              review_note = $2,
              reviewed_by = $3,
              reviewed_at = $4,
              ktp_object_key = ''
        WHERE id = $1 AND status = 'submitted'
        RETURNING ${APPLICATION_COLUMNS}`,
      [input.applicationId, input.note, input.actorId, input.now]
    );
    const row = updated.rows[0];
    if (!row) {
      throw new AppError(
        'CONFLICT',
        'Pengajuan tidak ditemukan atau sudah diputuskan.'
      );
    }

    await this.insertAudit(client, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: 'vendor.application.reject',
      entityType: 'vendor_application',
      entityId: input.applicationId,
      beforeState: { status: 'submitted' },
      afterState: { status: 'rejected', note: input.note },
      requestId: null
    });

    const joined = await client.query<ApplicationRow>(
      `SELECT ${APPLICATION_SELECT} ${APPLICATION_FROM} WHERE a.id = $1`,
      [input.applicationId]
    );
    return mapApplication(joined.rows[0] ?? row);
  }

  /** Records every admin download of a private KTP document. */
  async recordKtpAccess(input: {
    applicationId: string;
    actorId: string;
    actorRole: string;
  }): Promise<void> {
    await this.transaction((client) =>
      this.insertAudit(client, {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: 'vendor.application.ktp_access',
        entityType: 'vendor_application',
        entityId: input.applicationId,
        beforeState: null,
        afterState: { accessed: true },
        requestId: null
      })
    );
  }

  /** `audit_logs.prev_hash`/`row_hash` are filled by the DB hash-chain trigger. */
  private async insertAudit(
    client: PoolClient,
    entry: {
      actorId: string;
      actorRole: string;
      action: string;
      entityType: string;
      entityId: string;
      beforeState: unknown;
      afterState: unknown;
      requestId: string | null;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id,
          before_state, after_state, request_id)
       VALUES ($1::uuid, $2::user_role, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        entry.actorId,
        entry.actorRole,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.beforeState === null ? null : JSON.stringify(entry.beforeState),
        entry.afterState === null ? null : JSON.stringify(entry.afterState),
        entry.requestId
      ]
    );
  }

  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return withTransaction(fn);
  }
}
