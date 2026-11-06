import { Injectable } from '@nestjs/common';
import { query } from '@tarlink/core/db';
import { AppError } from '@tarlink/core/errors';
import { PUBLIC_VENDOR_CATEGORY_JOIN, PUBLIC_VENDOR_LIST_COLUMNS } from './catalog.repository';
import type { FavoriteListResult } from './contracts';
import { mapPublicVendorCard } from './mappers';
import { asPgError } from './pg-errors';
import type { PublicVendorListRow } from './rows';

@Injectable()
export class FavoriteService {
  async addFavorite(userId: string, vendorId: string): Promise<void> {
    try {
      await query(
        `INSERT INTO favorites (user_id, vendor_id)
         VALUES ($1::uuid, $2::uuid)
         ON CONFLICT DO NOTHING`,
        [userId, vendorId]
      );
    } catch (err) {
      const pg = asPgError(err);
      if (pg?.code === '23503') {
        throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan');
      }
      throw err;
    }
  }

  async removeFavorite(userId: string, vendorId: string): Promise<void> {
    await query(
      `DELETE FROM favorites
        WHERE user_id = $1::uuid
          AND vendor_id = $2::uuid`,
      [userId, vendorId]
    );
  }

  async listFavorites(userId: string, page = 1, pageSize = 20): Promise<FavoriteListResult> {
    const safePage = Math.max(1, Math.floor(page || 1));
    const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize || 20)));
    const offset = (safePage - 1) * safePageSize;

    const rows = await query<PublicVendorListRow>(
      `SELECT ${PUBLIC_VENDOR_LIST_COLUMNS}
         FROM favorites f
         JOIN vendors v ON v.id = f.vendor_id
         LEFT JOIN regions r ON r.code = v.region_code
         ${PUBLIC_VENDOR_CATEGORY_JOIN}
        WHERE f.user_id = $1::uuid
          AND v.verification_status = 'approved'
          AND v.is_active
          AND EXISTS (
                SELECT 1 FROM regions vr
                 WHERE vr.code = v.region_code
                   AND vr.is_active
              )
        ORDER BY f.created_at DESC, v.id ASC
        LIMIT $2 OFFSET $3`,
      [userId, safePageSize, offset]
    );

    const countRows = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
         FROM favorites f
         JOIN vendors v ON v.id = f.vendor_id
        WHERE f.user_id = $1::uuid
          AND v.verification_status = 'approved'
          AND v.is_active
          AND EXISTS (
                SELECT 1 FROM regions vr
                 WHERE vr.code = v.region_code
                   AND vr.is_active
              )`,
      [userId]
    );

    return {
      items: rows.map(mapPublicVendorCard),
      total: countRows[0]?.total ?? 0,
      page: safePage,
      page_size: safePageSize
    };
  }

  async isFavorite(userId: string, vendorId: string): Promise<boolean> {
    const rows = await query<{ exists: boolean }>(
      `SELECT true AS exists
         FROM favorites
        WHERE user_id = $1::uuid
          AND vendor_id = $2::uuid
        LIMIT 1`,
      [userId, vendorId]
    );
    return Boolean(rows[0]?.exists);
  }
}
