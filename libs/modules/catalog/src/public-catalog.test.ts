import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Public catalog routes: `query()` is stubbed, everything else is real
 * (repository SQL builder -> service -> mapper -> controller validation), so
 * the assertions pin both the wire shape and the filters the SQL must carry.
 */
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@tarlink/core/db', () => ({
  query: queryMock,
  withTransaction: vi.fn()
}));

import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';
import { PublicCatalogController } from './public-catalog.controller';
import type {
  PolicyDbRow,
  PublicAddonDbRow,
  PublicPackageDbRow,
  PublicVendorDetailRow,
  PublicVendorListRow
} from './rows';

const VENDOR_ID = '4c75c3ac-2f72-40c3-a0f4-d0b115dab377';
const OTHER_VENDOR_ID = '58bb4ecb-78d0-4407-b5ab-aa23d10c93fc';
const PACKAGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HIDDEN_PACKAGE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADDON_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const LIST_ROW: PublicVendorListRow = {
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

const DETAIL_ROW: PublicVendorDetailRow = {
  id: VENDOR_ID,
  slug: 'tarling-dian',
  display_name: 'Tarling Dangdut Dian',
  legal_name: null,
  description: 'Tarling dangdut',
  region_code: '3209',
  region_name: 'Kabupaten Cirebon',
  base_address: 'Jl. Merdeka 1',
  avatar_url: 'https://example.com/avatar.jpg',
  banner_url: 'https://example.com/banner.jpg',
  photo_urls: ['https://example.com/p1.jpg'],
  video_url: 'https://youtube.com/watch?v=123',
  lat: -6.7,
  lng: 108.5,
  service_radius_km: 25,
  transport_fee_per_km_idr: '5000',
  min_dp_bp: 3000,
  rating_sum: 24,
  rating_count: 5,
  response_rate_bp: 9200,
  category_slug: 'tarling',
  category_name: 'Tarling & Dangdut',
  whatsapp: '6281200000001'
};

const PACKAGE_ROW: PublicPackageDbRow = {
  id: PACKAGE_ID,
  name: 'Paket 6 jam',
  description: 'Enam jam',
  photo_url: 'https://example.com/pkg.jpg',
  duration_minutes: 360,
  personnel_count: 6,
  base_price_idr: '5000000'
};

const ADDON_ROW: PublicAddonDbRow = {
  id: ADDON_ID,
  package_id: PACKAGE_ID,
  name: 'Sound tambahan',
  price_idr: '100000',
  unit: 'unit',
  max_qty: 5
};

const POLICY_ROW: PolicyDbRow = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  code: 'cancellation',
  version: 1,
  body_hash: '9319e1c7',
  effective_from: new Date('2026-10-20T17:00:00.000Z'),
  body: { currency: 'IDR', tiers: [{ min_days_before: 30, refund_percent_bp: 10000 }] }
};

function service(): CatalogService {
  return new CatalogService(new CatalogRepository());
}

function controller(): PublicCatalogController {
  return new PublicCatalogController(service());
}

function sqlOf(callIndex: number): string {
  return String(queryMock.mock.calls[callIndex]?.[0] ?? '');
}

function paramsOf(callIndex: number): unknown[] {
  return (queryMock.mock.calls[callIndex]?.[1] as unknown[]) ?? [];
}

describe('GET /vendors', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns the frozen envelope with rating derived from rating_sum/count', async () => {
    queryMock.mockResolvedValueOnce([LIST_ROW]).mockResolvedValueOnce([{ total: 1 }]);

    const result = await controller().vendors({});

    expect(result).toEqual({
      items: [
        {
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
          rating: 4.8,
          rating_count: 5,
          response_rate_bp: 9200,
          category_slug: 'tarling',
          category_name: 'Tarling & Dangdut',
          min_dp_bp: 3000,
          starting_price_idr: 5000000,
          package_count: 3
        }
      ],
      total: 1,
      page: 1,
      page_size: 20
    });
    expect(sqlOf(0)).toContain("v.verification_status = 'approved'");
    expect(sqlOf(0)).toContain('AND v.is_active');
    expect(sqlOf(0)).toContain('ORDER BY v.rating_count DESC, v.display_name ASC');
  });

  it('reports rating null (not 0) and starting price null for an unrated vendor', async () => {
    queryMock
      .mockResolvedValueOnce([
        { ...LIST_ROW, rating_sum: 0, rating_count: 0, starting_price_idr: null, package_count: 0 }
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const [item] = (await service().listPublicVendors({
      q: null,
      region: null,
      category: null,
      date: null,
      session: null,
      sort: 'rating',
      page: 1,
      page_size: 20
    })).items;

    expect(item?.rating).toBeNull();
    expect(item?.starting_price_idr).toBeNull();
    expect(item?.package_count).toBe(0);
  });

  it('applies q and region filters and pagination to the SQL', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

    await service().listPublicVendors({
      q: 'tarling',
      region: '32',
      category: null,
      date: null,
      session: null,
      sort: 'rating',
      page: 2,
      page_size: 5
    });

    expect(sqlOf(0)).toContain('v.display_name ILIKE $1');
    expect(sqlOf(0)).toContain("v.region_code LIKE $2 || '%'");
    expect(paramsOf(0)).toEqual(['%tarling%', '32', null, null, null, 5, 5]);
    expect(sqlOf(1)).toContain('COUNT(*)::int AS total');
    expect(paramsOf(1)).toEqual(['%tarling%', '32', null, null, null]);
  });

  it('escapes LIKE wildcards in q', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

    await service().listPublicVendors({
      q: '100%_a',
      region: null,
      category: null,
      date: null,
      session: null,
      sort: 'rating',
      page: 1,
      page_size: 20
    });

    expect(paramsOf(0)[0]).toBe('%100\\%\\_a%');
  });

  it('filters by category, date, and session, and pushes sort into SQL', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

    await service().listPublicVendors({
      q: null,
      region: null,
      category: 'organ-tunggal',
      date: '2026-12-05',
      session: 'night',
      sort: 'price_asc',
      page: 1,
      page_size: 20
    });

    expect(sqlOf(0)).toContain('c.slug = $3');
    expect(sqlOf(0)).toContain('cs.date = $4::date');
    expect(sqlOf(0)).toContain("cs.status = 'available'");
    expect(sqlOf(0)).toContain('starting_price_idr ASC NULLS LAST');
    expect(paramsOf(0)).toEqual([null, null, 'organ-tunggal', '2026-12-05', 'night', 20, 0]);
    expect(paramsOf(1)).toEqual([null, null, 'organ-tunggal', '2026-12-05', 'night']);
  });

  it('uses name sort when requested', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

    await service().listPublicVendors({
      q: null,
      region: null,
      category: null,
      date: null,
      session: null,
      sort: 'name_asc',
      page: 1,
      page_size: 20
    });

    expect(sqlOf(0)).toContain('v.display_name ASC, v.id ASC');
  });
});

describe('GET /categories', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns active categories in display order', async () => {
    queryMock.mockResolvedValueOnce([
      { slug: 'tarling', name: 'Tarling & Dangdut', sort_order: 1 },
      { slug: 'organ-tunggal', name: 'Organ Tunggal', sort_order: 2 }
    ]);

    const result = await controller().categories();

    expect(result).toEqual({
      items: [
        { slug: 'tarling', name: 'Tarling & Dangdut', sort_order: 1 },
        { slug: 'organ-tunggal', name: 'Organ Tunggal', sort_order: 2 }
      ]
    });
    expect(sqlOf(0)).toContain('WHERE is_active');
    expect(sqlOf(0)).toContain('ORDER BY sort_order ASC, name ASC');
  });
});

describe('GET /vendors/:idOrSlug', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('looks the vendor up by uuid and builds vendor + packages + addons', async () => {
    queryMock
      .mockResolvedValueOnce([DETAIL_ROW])
      .mockResolvedValueOnce([PACKAGE_ROW])
      .mockResolvedValueOnce([ADDON_ROW]);

    const result = await controller().vendor(VENDOR_ID);

    expect(sqlOf(0)).toContain('v.id = $1::uuid');
    expect(sqlOf(0)).toContain("v.verification_status = 'approved'");
    expect(paramsOf(0)).toEqual([VENDOR_ID]);
    expect(result.vendor).toEqual({
      id: VENDOR_ID,
      slug: 'tarling-dian',
      display_name: 'Tarling Dangdut Dian',
      legal_name: null,
      description: 'Tarling dangdut',
      region_code: '3209',
      region_name: 'Kabupaten Cirebon',
      base_address: 'Jl. Merdeka 1',
      avatar_url: 'https://example.com/avatar.jpg',
      banner_url: 'https://example.com/banner.jpg',
      photo_urls: ['https://example.com/p1.jpg'],
      video_url: 'https://youtube.com/watch?v=123',
      location: { lat: -6.7, lng: 108.5 },
      service_radius_km: 25,
      transport_fee_per_km_idr: 5000,
      min_dp_bp: 3000,
      rating: 4.8,
      rating_count: 5,
      response_rate_bp: 9200,
      category_slug: 'tarling',
      category_name: 'Tarling & Dangdut',
      whatsapp: '6281200000001'
    });
    expect(result.packages).toEqual([
      {
        id: PACKAGE_ID,
        name: 'Paket 6 jam',
        description: 'Enam jam',
        photo_url: 'https://example.com/pkg.jpg',
        duration_minutes: 360,
        personnel_count: 6,
        base_price_idr: 5000000,
        inclusions: [],
        addons: [
          {
            id: ADDON_ID,
            name: 'Sound tambahan',
            price_idr: 100000,
            unit: 'unit',
            max_qty: 5
          }
        ]
      }
    ]);
    // No internal columns may leak into the public payload.
    expect(JSON.stringify(result)).not.toContain('commission');
    expect(JSON.stringify(result)).not.toContain('npwp');
    expect(JSON.stringify(result)).not.toContain('owner_user_id');
  });

  it('looks the vendor up by slug when the path is not a uuid', async () => {
    queryMock
      .mockResolvedValueOnce([DETAIL_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service().getPublicVendor('tarling-dian');

    expect(sqlOf(0)).toContain('v.slug = $1');
    expect(sqlOf(0)).not.toContain('$1::uuid');
    expect(paramsOf(0)).toEqual(['tarling-dian']);
  });

  it('hides inactive packages and addons in SQL', async () => {
    queryMock
      .mockResolvedValueOnce([DETAIL_ROW])
      .mockResolvedValueOnce([PACKAGE_ROW])
      .mockResolvedValueOnce([]);

    const result = await service().getPublicVendor(VENDOR_ID);

    expect(sqlOf(1)).toContain('AND p.is_active');
    expect(sqlOf(2)).toContain('AND a.is_active');
    expect(result.packages.map((row) => row.id)).toEqual([PACKAGE_ID]);
    expect(result.packages.some((row) => row.id === HIDDEN_PACKAGE_ID)).toBe(false);
    expect(result.packages[0]?.addons).toEqual([]);
  });

  it('404s an unknown vendor (and a non-approved one, which the SQL filters out)', async () => {
    queryMock.mockResolvedValueOnce([]);

    await expect(service().getPublicVendor('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Vendor tidak ditemukan'
    });
  });

  it('reports location null when base_location is absent', async () => {
    queryMock
      .mockResolvedValueOnce([{ ...DETAIL_ROW, lat: null, lng: null, whatsapp: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service().getPublicVendor(VENDOR_ID);

    expect(result.vendor.location).toBeNull();
    expect(result.vendor.whatsapp).toBeNull();
  });
});

describe('GET /policies/:code', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns the newest active version and passes body through', async () => {
    queryMock.mockResolvedValueOnce([POLICY_ROW]);

    const result = await controller().policy('cancellation');

    expect(result).toEqual({
      id: POLICY_ROW.id,
      code: 'cancellation',
      version: 1,
      body_hash: '9319e1c7',
      effective_from: '2026-10-20T17:00:00.000Z',
      body: POLICY_ROW.body
    });
    expect(sqlOf(0)).toContain('AND is_active');
    expect(sqlOf(0)).toContain('(effective_to IS NULL OR effective_to > now())');
    expect(sqlOf(0)).toContain('ORDER BY effective_from DESC, created_at DESC');
    expect(sqlOf(0)).toContain('LIMIT 1');
    expect(paramsOf(0)).toEqual(['cancellation']);
  });

  it('404s when the code has no active version', async () => {
    queryMock.mockResolvedValueOnce([]);

    await expect(controller().policy('nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Kebijakan tidak ditemukan'
    });
  });
});

describe('GET /vendors validation', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('rejects page_size over 50 with VALIDATION_ERROR', async () => {
    await expect(controller().vendors({ page_size: '51' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('rejects non-numeric and zero page values', async () => {
    await expect(controller().vendors({ page: 'abc' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    await expect(controller().vendors({ page: '0' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('rejects unknown query params', async () => {
    await expect(controller().vendors({ page_size: '3', foo: 'bar' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('rejects q longer than 80 chars', async () => {
    await expect(controller().vendors({ q: 'x'.repeat(81) })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('coerces string query values and defaults page/page_size', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

    const result = await controller().vendors({ page: '2', page_size: '3' });

    expect(result.page).toBe(2);
    expect(result.page_size).toBe(3);
    expect(sqlOf(0)).toContain('LIMIT $6 OFFSET $7');
    expect(paramsOf(0)).toEqual([null, null, null, null, null, 3, 3]);
  });

  it('treats a blank q/region as absent', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

    await controller().vendors({ q: '  ', region: '' });

    expect(paramsOf(0)).toEqual([null, null, null, null, null, 20, 0]);
  });

  it('rejects invalid date, session, category slug, and sort', async () => {
    await expect(controller().vendors({ date: '05-12-2026' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    await expect(controller().vendors({ session: 'morning' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    await expect(controller().vendors({ category: 'Tarling Dangdut' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    await expect(controller().vendors({ sort: 'newest' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });
});
