import type { PoolClient } from 'pg';
import { AppError } from '@tarlink/core/errors';
import { query, withTransaction } from '@tarlink/core/db';
import type {
  SubmitVendorApplicationInput,
  VendorApplicationRecord,
  VendorApplicationStatus,
  VendorApplicationView
} from './vendor-onboarding.contracts';

const APPLICATION_COLUMNS = `
  id, user_id, status, display_name, legal_name, nik, nik_ciphertext, nik_key_id,
  region_code, base_address, ktp_object_key, review_note, reviewed_by, reviewed_at,
  vendor_id, created_at
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
    createdAt: row.created_at
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
    reviewed_at: record.reviewedAt ? record.reviewedAt.toISOString() : null
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

export class VendorOnboardingRepository {
  async findLatestByUser(userId: string): Promise<VendorApplicationRecord | null> {
    const rows = await query<ApplicationRow>(
      `SELECT ${APPLICATION_COLUMNS}
         FROM vendor_applications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId]
    );
    return rows[0] ? mapApplication(rows[0]) : null;
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

  /** Regency/city list for the onboarding form (no auth, no PII). */
  async listRegions(): Promise<Array<{ code: string; name: string; level: string }>> {
    return query<{ code: string; name: string; level: string }>(
      `SELECT code, name, level
         FROM regions
        WHERE level IN ('regency','city')
        ORDER BY sort_order, name`
    );
  }

  async regionExists(regionCode: string): Promise<boolean> {
    const rows = await query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM regions WHERE code = $1) AS exists',
      [regionCode]
    );
    return rows[0]?.exists ?? false;
  }

  async insertApplication(
    userId: string,
    input: SubmitVendorApplicationInput,
    secret: { ciphertext: Buffer; keyId: string }
  ): Promise<VendorApplicationRecord> {
    try {
      const rows = await query<ApplicationRow>(
        `INSERT INTO vendor_applications
           (user_id, display_name, legal_name, nik, nik_ciphertext, nik_key_id,
            region_code, base_address, ktp_object_key)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8)
         RETURNING ${APPLICATION_COLUMNS}`,
        [
          userId,
          input.display_name,
          input.legal_name,
          secret.ciphertext,
          secret.keyId,
          input.region_code,
          input.base_address,
          input.ktp_object_key
        ]
      );
      const row = rows[0];
      if (!row) throw new AppError('INTERNAL_ERROR', 'vendor application insert returned no row');
      return mapApplication(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'CONFLICT',
          'Pengajuan vendor untuk akun ini masih diproses.'
        );
      }
      throw error;
    }
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
    const where = input.status ? 'WHERE status = $1' : '';
    const params: Array<string | number> = input.status ? [input.status] : [];
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;

    const rows = await query<ApplicationRow>(
      `SELECT ${APPLICATION_COLUMNS}
         FROM vendor_applications
         ${where}
        ORDER BY created_at DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      [...params, input.pageSize, (input.page - 1) * input.pageSize]
    );

    const counts = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM vendor_applications ${where}`,
      params
    );

    return { items: rows.map(mapApplication), total: counts[0]?.total ?? 0 };
  }

  async findById(applicationId: string): Promise<VendorApplicationRecord | null> {
    const rows = await query<ApplicationRow>(
      `SELECT ${APPLICATION_COLUMNS} FROM vendor_applications WHERE id = $1`,
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
          ktp_object_key, verification_status, verified_at, verified_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', $8, $9)
       RETURNING id`,
      [
        current.user_id,
        current.region_code,
        input.slug,
        current.display_name,
        current.legal_name,
        current.base_address,
        current.ktp_object_key,
        input.now,
        input.actorId
      ]
    );
    const vendor = vendors.rows[0];
    if (!vendor) throw new AppError('INTERNAL_ERROR', 'vendor insert returned no row');

    await client.query(
      `INSERT INTO user_roles (user_id, role, vendor_id, vendor_scope, granted_by)
       VALUES ($1, 'vendor_owner', $2, $2, $3)
       ON CONFLICT (user_id, role, vendor_scope) DO NOTHING`,
      [current.user_id, vendor.id, input.actorId]
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

    return mapApplication(row);
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

    return mapApplication(row);
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
