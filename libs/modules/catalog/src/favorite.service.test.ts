import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@tarlink/core/db', () => ({
  query: queryMock,
  withTransaction: vi.fn()
}));

import { FavoriteController } from './favorite.controller';
import { FavoriteService } from './favorite.service';
import type { PublicVendorListRow } from './rows';
import type { AuthenticatedRequest } from '@tarlink/platform/auth';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const INVALID_UUID = 'not-a-uuid';

const SAMPLE_ROW: PublicVendorListRow = {
  id: VENDOR_ID,
  slug: 'tarling-dian',
  display_name: 'Tarling Dangdut Dian',
  region_code: '3209',
  region_name: 'Kabupaten Cirebon',
  base_address: 'Jl. Merdeka 1',
  description: 'Tarling dangdut',
  avatar_url: 'https://example.com/avatar.jpg',
  banner_url: 'https://example.com/banner.jpg',
  photo_urls: ['https://example.com/p1.jpg'],
  video_url: 'https://youtube.com/watch?v=123',
  rating_sum: 24,
  rating_count: 5,
  response_rate_bp: 9200,
  category_slug: 'tarling',
  category_name: 'Tarling & Dangdut',
  min_dp_bp: 3000,
  starting_price_idr: '5000000',
  package_count: 3
};

describe('FavoriteService', () => {
  let service: FavoriteService;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryMock.mockReset();
    service = new FavoriteService();
  });

  describe('addFavorite', () => {
    it('inserts into favorites table on conflict do nothing', async () => {
      queryMock.mockResolvedValueOnce([]);

      await service.addFavorite(USER_ID, VENDOR_ID);

      expect(queryMock).toHaveBeenCalledTimes(1);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO favorites');
      expect(sql).toContain('ON CONFLICT DO NOTHING');
      expect(params).toEqual([USER_ID, VENDOR_ID]);
    });

    it('translates pg foreign_key_violation (23503) to NOT_FOUND', async () => {
      queryMock.mockRejectedValueOnce({
        code: '23503',
        message: 'violates foreign key constraint "favorites_vendor_id_fkey"'
      });

      await expect(service.addFavorite(USER_ID, VENDOR_ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Vendor tidak ditemukan'
      });
    });

    it('re-throws unexpected database errors', async () => {
      queryMock.mockRejectedValueOnce(new Error('Connection terminated'));

      await expect(service.addFavorite(USER_ID, VENDOR_ID)).rejects.toThrow('Connection terminated');
    });
  });

  describe('removeFavorite', () => {
    it('deletes from favorites by user_id and vendor_id', async () => {
      queryMock.mockResolvedValueOnce([]);

      await service.removeFavorite(USER_ID, VENDOR_ID);

      expect(queryMock).toHaveBeenCalledTimes(1);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DELETE FROM favorites');
      expect(sql).toContain('user_id = $1::uuid');
      expect(sql).toContain('vendor_id = $2::uuid');
      expect(params).toEqual([USER_ID, VENDOR_ID]);
    });
  });

  describe('listFavorites', () => {
    it('queries favorites joined with vendors and returns mapped items with pagination', async () => {
      queryMock
        .mockResolvedValueOnce([SAMPLE_ROW])
        .mockResolvedValueOnce([{ total: 1 }]);

      const result = await service.listFavorites(USER_ID, 1, 20);

      expect(queryMock).toHaveBeenCalledTimes(2);

      const [listSql, listParams] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(listSql).toContain('FROM favorites f');
      expect(listSql).toContain('JOIN vendors v ON v.id = f.vendor_id');
      expect(listSql).toContain("v.verification_status = 'approved'");
      expect(listSql).toContain('ORDER BY f.created_at DESC, v.id ASC');
      expect(listParams).toEqual([USER_ID, 20, 0]);

      const [countSql, countParams] = queryMock.mock.calls[1] as [string, unknown[]];
      expect(countSql).toContain('SELECT COUNT(*)::int AS total');
      expect(countParams).toEqual([USER_ID]);

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.page_size).toBe(20);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: VENDOR_ID,
        slug: 'tarling-dian',
        display_name: 'Tarling Dangdut Dian',
        region_code: '3209',
        region_name: 'Kabupaten Cirebon',
        rating: 4.8,
        rating_count: 5,
        starting_price_idr: 5000000,
        package_count: 3
      });
    });

    it('calculates correct offset for arbitrary page and page size', async () => {
      queryMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      const result = await service.listFavorites(USER_ID, 3, 10);

      expect(result.page).toBe(3);
      expect(result.page_size).toBe(10);
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);

      const [, listParams] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(listParams).toEqual([USER_ID, 10, 20]);
    });
  });

  describe('isFavorite', () => {
    it('returns true when row exists', async () => {
      queryMock.mockResolvedValueOnce([{ exists: true }]);

      const res = await service.isFavorite(USER_ID, VENDOR_ID);

      expect(res).toBe(true);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SELECT true AS exists');
      expect(sql).toContain('FROM favorites');
      expect(sql).toContain('user_id = $1::uuid');
      expect(sql).toContain('vendor_id = $2::uuid');
      expect(params).toEqual([USER_ID, VENDOR_ID]);
    });

    it('returns false when no row exists', async () => {
      queryMock.mockResolvedValueOnce([]);

      const res = await service.isFavorite(USER_ID, VENDOR_ID);

      expect(res).toBe(false);
    });
  });
});

describe('FavoriteController', () => {
  let controller: FavoriteController;
  let service: FavoriteService;

  const mockReq: AuthenticatedRequest = {
    headers: {},
    user: { id: USER_ID, roles: ['customer'] }
  };

  beforeEach(() => {
    service = new FavoriteService();
    controller = new FavoriteController(service);
  });

  describe('POST /favorites/:vendorId', () => {
    it('delegates to service.addFavorite when valid UUID is passed', async () => {
      const spy = vi.spyOn(service, 'addFavorite').mockResolvedValueOnce();

      await controller.addFavorite(VENDOR_ID, mockReq);

      expect(spy).toHaveBeenCalledWith(USER_ID, VENDOR_ID);
    });

    it('rejects invalid vendorId with VALIDATION_ERROR', async () => {
      await expect(controller.addFavorite(INVALID_UUID, mockReq)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });
    });

    it('rejects unauthenticated requests', async () => {
      const unauthReq: AuthenticatedRequest = { headers: {} };
      await expect(controller.addFavorite(VENDOR_ID, unauthReq)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED'
      });
    });
  });

  describe('DELETE /favorites/:vendorId', () => {
    it('delegates to service.removeFavorite when valid UUID is passed', async () => {
      const spy = vi.spyOn(service, 'removeFavorite').mockResolvedValueOnce();

      await controller.removeFavorite(VENDOR_ID, mockReq);

      expect(spy).toHaveBeenCalledWith(USER_ID, VENDOR_ID);
    });

    it('rejects invalid vendorId with VALIDATION_ERROR', async () => {
      await expect(controller.removeFavorite(INVALID_UUID, mockReq)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });
    });
  });

  describe('GET /favorites', () => {
    it('delegates to service.listFavorites with default pagination', async () => {
      const expected = { items: [], total: 0, page: 1, page_size: 20 };
      const spy = vi.spyOn(service, 'listFavorites').mockResolvedValueOnce(expected);

      const res = await controller.listFavorites({}, mockReq);

      expect(spy).toHaveBeenCalledWith(USER_ID, 1, 20);
      expect(res).toEqual(expected);
    });

    it('delegates to service.listFavorites with query params', async () => {
      const expected = { items: [], total: 0, page: 2, page_size: 15 };
      const spy = vi.spyOn(service, 'listFavorites').mockResolvedValueOnce(expected);

      const res = await controller.listFavorites({ page: '2', page_size: '15' }, mockReq);

      expect(spy).toHaveBeenCalledWith(USER_ID, 2, 15);
      expect(res).toEqual(expected);
    });
  });

  describe('GET /favorites/:vendorId', () => {
    it('returns { data: { is_favorite: true } } when vendor is favorited', async () => {
      const spy = vi.spyOn(service, 'isFavorite').mockResolvedValueOnce(true);

      const res = await controller.isFavorite(VENDOR_ID, mockReq);

      expect(spy).toHaveBeenCalledWith(USER_ID, VENDOR_ID);
      expect(res).toEqual({ data: { is_favorite: true } });
    });

    it('returns { data: { is_favorite: false } } when vendor is not favorited', async () => {
      const spy = vi.spyOn(service, 'isFavorite').mockResolvedValueOnce(false);

      const res = await controller.isFavorite(VENDOR_ID, mockReq);

      expect(spy).toHaveBeenCalledWith(USER_ID, VENDOR_ID);
      expect(res).toEqual({ data: { is_favorite: false } });
    });

    it('rejects invalid vendorId with VALIDATION_ERROR', async () => {
      await expect(controller.isFavorite(INVALID_UUID, mockReq)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });
    });

    it('rejects unauthenticated requests', async () => {
      const unauthReq: AuthenticatedRequest = { headers: {} };
      await expect(controller.isFavorite(VENDOR_ID, unauthReq)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED'
      });
    });
  });
});
