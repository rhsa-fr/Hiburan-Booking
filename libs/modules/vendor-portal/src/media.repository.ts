import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '@tarlink/core/db';
import { AppError } from '@tarlink/core/errors';
import {
  GALLERY_FULL_CODE,
  MAX_GALLERY_MEDIA,
  type AdminMediaQueueItem,
  type AdminMediaQueueQuery,
  type AdminMediaQueueResult,
  type MediaKind,
  type MediaReviewStatus,
  type MediaRow
} from './media.contracts';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function mapMediaRow(row: any): MediaRow {
  return {
    id: row.id,
    vendor_id: row.vendor_id,
    package_id: row.package_id ?? null,
    kind: row.kind,
    url: row.url,
    status: row.status,
    license_statement: row.license_statement,
    review_note: row.review_note ?? null,
    reviewed_at: toIso(row.reviewed_at),
    created_at: toIso(row.created_at) ?? ''
  };
}

export function mapAdminMediaQueueItem(row: any): AdminMediaQueueItem {
  return {
    ...mapMediaRow(row),
    vendor_name: row.vendor_name,
    vendor_region_code: row.vendor_region_code,
    package_name: row.package_name ?? null
  };
}

async function runQuery<T extends QueryResultRow>(
  client: PoolClient | undefined,
  text: string,
  params: readonly unknown[] = []
): Promise<T[]> {
  if (client) {
    const res = await client.query<T>(text, params as unknown[]);
    return Array.isArray(res) ? res : res.rows;
  }
  return query<T>(text, params);
}

export interface InsertMediaInput {
  vendor_id: string;
  package_id?: string | null;
  kind: MediaKind;
  url: string;
  storage_key?: string | null;
  license_statement: string;
  status?: MediaReviewStatus;
  submitted_by?: string | null;
}

export interface UpdateMediaStatusInput {
  status: MediaReviewStatus;
  reviewed_by: string;
  review_note?: string | null;
}

@Injectable()
export class MediaRepository {
  async insertSubmission(input: InsertMediaInput, client?: PoolClient): Promise<MediaRow> {
    try {
      const rows = await runQuery<any>(
        client,
        `INSERT INTO vendor_media (
           vendor_id, package_id, kind, url, storage_key, license_statement, status, submitted_by
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid
         ) RETURNING id, vendor_id, package_id, kind, url, storage_key, license_statement,
                     status, review_note, reviewed_at, created_at`,
        [
          input.vendor_id,
          input.package_id ?? null,
          input.kind,
          input.url,
          input.storage_key ?? null,
          input.license_statement,
          input.status ?? 'pending',
          input.submitted_by ?? null
        ]
      );
      return mapMediaRow(rows[0]);
    } catch (err: unknown) {
      const pg = err as { code?: string };
      if (pg?.code === '23505') {
        throw new AppError(
          'CONFLICT',
          'Foto paket untuk paket ini sudah ada dalam antrean atau telah disetujui'
        );
      }
      throw err;
    }
  }

  async listByVendor(vendorId: string, client?: PoolClient): Promise<MediaRow[]> {
    if (!isUuid(vendorId)) return [];
    const rows = await runQuery<any>(
      client,
      `SELECT id, vendor_id, package_id, kind, url, storage_key, license_statement,
              status, review_note, reviewed_at, created_at
         FROM vendor_media
        WHERE vendor_id = $1::uuid
        ORDER BY created_at DESC, id DESC`,
      [vendorId]
    );
    return rows.map(mapMediaRow);
  }

  async listQueue(
    queryInput: AdminMediaQueueQuery,
    client?: PoolClient
  ): Promise<AdminMediaQueueResult> {
    const page = Math.max(1, queryInput.page || 1);
    const pageSize = Math.min(100, Math.max(1, queryInput.page_size || 20));
    const offset = (page - 1) * pageSize;

    const countRows = await runQuery<{ count: string | number }>(
      client,
      `SELECT COUNT(*)::int AS count
         FROM vendor_media
        WHERE status = $1`,
      [queryInput.status]
    );
    const total = Number(countRows[0]?.count ?? 0);

    const rows = await runQuery<any>(
      client,
      `SELECT
         vm.id,
         vm.vendor_id,
         vm.package_id,
         vm.kind,
         vm.url,
         vm.status,
         vm.license_statement,
         vm.review_note,
         vm.reviewed_at,
         vm.created_at,
         v.display_name AS vendor_name,
         v.region_code AS vendor_region_code,
         p.name AS package_name
       FROM vendor_media vm
       JOIN vendors v ON v.id = vm.vendor_id
       LEFT JOIN packages p ON p.id = vm.package_id
       WHERE vm.status = $1
       ORDER BY vm.created_at ASC, vm.id ASC
       LIMIT $2 OFFSET $3`,
      [queryInput.status, pageSize, offset]
    );

    return {
      items: rows.map(mapAdminMediaQueueItem),
      total,
      page,
      page_size: pageSize
    };
  }

  async findById(id: string, client?: PoolClient): Promise<MediaRow | null> {
    if (!isUuid(id)) return null;
    const rows = await runQuery<any>(
      client,
      `SELECT id, vendor_id, package_id, kind, url, storage_key, license_statement,
              status, review_note, reviewed_at, created_at
         FROM vendor_media
        WHERE id = $1::uuid
        LIMIT 1`,
      [id]
    );
    return rows[0] ? mapMediaRow(rows[0]) : null;
  }

  async findByIdForUpdate(client: PoolClient, id: string): Promise<MediaRow | null> {
    if (!isUuid(id)) return null;
    const rows = await runQuery<any>(
      client,
      `SELECT id, vendor_id, package_id, kind, url, storage_key, license_statement,
              status, review_note, reviewed_at, created_at
         FROM vendor_media
        WHERE id = $1::uuid
        FOR UPDATE`,
      [id]
    );
    return rows[0] ? mapMediaRow(rows[0]) : null;
  }

  async updateStatus(
    client: PoolClient,
    id: string,
    update: UpdateMediaStatusInput
  ): Promise<MediaRow> {
    const rows = await runQuery<any>(
      client,
      `UPDATE vendor_media
          SET status = $2,
              reviewed_by = $3::uuid,
              review_note = $4,
              reviewed_at = now(),
              updated_at = now()
        WHERE id = $1::uuid
        RETURNING id, vendor_id, package_id, kind, url, storage_key, license_statement,
                  status, review_note, reviewed_at, created_at`,
      [id, update.status, update.reviewed_by, update.review_note ?? null]
    );
    if (!rows[0]) {
      throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
    }
    return mapMediaRow(rows[0]);
  }

  async applyToPublicColumn(client: PoolClient, media: MediaRow): Promise<void> {
    switch (media.kind) {
      case 'avatar': {
        const rows = await runQuery<{ id: string }>(
          client,
          `UPDATE vendors SET avatar_url = $2, updated_at = now() WHERE id = $1::uuid RETURNING id`,
          [media.vendor_id, media.url]
        );
        if (rows.length === 0) {
          throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
        }
        break;
      }
      case 'banner': {
        const rows = await runQuery<{ id: string }>(
          client,
          `UPDATE vendors SET banner_url = $2, updated_at = now() WHERE id = $1::uuid RETURNING id`,
          [media.vendor_id, media.url]
        );
        if (rows.length === 0) {
          throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
        }
        break;
      }
      case 'video': {
        const rows = await runQuery<{ id: string }>(
          client,
          `UPDATE vendors SET video_url = $2, updated_at = now() WHERE id = $1::uuid RETURNING id`,
          [media.vendor_id, media.url]
        );
        if (rows.length === 0) {
          throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
        }
        break;
      }
      case 'package_photo': {
        if (!media.package_id) {
          throw new AppError('NOT_FOUND', 'Paket tidak ditemukan untuk vendor ini');
        }
        const rows = await runQuery<{ id: string }>(
          client,
          `UPDATE packages
              SET photo_url = $3, updated_at = now()
            WHERE id = $1::uuid AND vendor_id = $2::uuid
            RETURNING id`,
          [media.package_id, media.vendor_id, media.url]
        );
        if (rows.length === 0) {
          throw new AppError('NOT_FOUND', 'Paket tidak ditemukan untuk vendor ini');
        }
        break;
      }
      case 'gallery': {
        const rows = await runQuery<{ photo_urls: string[] | null }>(
          client,
          `SELECT photo_urls FROM vendors WHERE id = $1::uuid FOR UPDATE`,
          [media.vendor_id]
        );
        const row = rows[0];
        if (!row) {
          throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
        }
        const current = row.photo_urls ?? [];
        if (!current.includes(media.url)) {
          if (current.length >= MAX_GALLERY_MEDIA) {
            throw new AppError(
              'VALIDATION_ERROR',
              'Galeri foto vendor sudah mencapai batas maksimum',
              { reason: GALLERY_FULL_CODE }
            );
          }
          await runQuery(
            client,
            `UPDATE vendors SET photo_urls = $2, updated_at = now() WHERE id = $1::uuid`,
            [media.vendor_id, [...current, media.url]]
          );
        }
        break;
      }
    }
  }

  /** Kepemilikan paket dicek sebelum submission `package_photo` (anti-IDOR). */
  async packageBelongsToVendor(
    packageId: string,
    vendorId: string,
    client?: PoolClient
  ): Promise<boolean> {
    if (!isUuid(packageId) || !isUuid(vendorId)) return false;
    const rows = await runQuery<{ id: string }>(
      client,
      `SELECT id FROM packages WHERE id = $1::uuid AND vendor_id = $2::uuid LIMIT 1`,
      [packageId, vendorId]
    );
    return rows.length > 0;
  }

  async findApprovedUrls(
    vendorId: string,
    urls: string[],
    client?: PoolClient
  ): Promise<Set<string>> {
    if (!isUuid(vendorId) || urls.length === 0) {
      return new Set<string>();
    }
    const cleanUrls = Array.from(
      new Set(urls.filter((u) => typeof u === 'string' && u.trim().length > 0))
    );
    if (cleanUrls.length === 0) {
      return new Set<string>();
    }
    const rows = await runQuery<{ url: string }>(
      client,
      `SELECT DISTINCT url
         FROM vendor_media
        WHERE vendor_id = $1::uuid
          AND status = 'approved'
          AND url = ANY($2::text[])`,
      [vendorId, cleanUrls]
    );
    return new Set(rows.map((r) => r.url));
  }

  async deleteById(id: string, client?: PoolClient): Promise<boolean> {
    if (!isUuid(id)) return false;
    const rows = await runQuery<{ id: string }>(
      client,
      `DELETE FROM vendor_media WHERE id = $1::uuid RETURNING id`,
      [id]
    );
    return rows.length > 0;
  }
}
