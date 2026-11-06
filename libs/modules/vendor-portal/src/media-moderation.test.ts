import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, clientQueryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  clientQueryMock: vi.fn()
}));

const mockClient = {
  query: clientQueryMock
};

vi.mock('@tarlink/core/db', () => ({
  query: queryMock,
  withTransaction: vi.fn(async (fn: (client: any) => Promise<any>) => fn(mockClient))
}));

import { AppError } from '@tarlink/core/errors';
import {
  GALLERY_FULL_CODE,
  MAX_GALLERY_MEDIA,
  MEDIA_NOT_APPROVED_CODE
} from './media.contracts';
import { MediaAdminController } from './media-admin.controller';
import { MediaRepository } from './media.repository';
import { MediaReviewService } from './media-review.service';
import type { MediaService } from './media.service';
import { VendorPortalController } from './vendor-portal.controller';
import { VendorPortalService } from './vendor-portal.service';

const VENDOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const REVIEWER_ID = '44444444-4444-4444-8444-444444444444';
const MEDIA_ID = '55555555-5555-4555-8555-555555555555';
const PACKAGE_ID = '66666666-6666-4666-8666-666666666666';

describe('Media Moderation', () => {
  let mediaRepo: MediaRepository;
  let reviewService: MediaReviewService;
  let adminController: MediaAdminController;
  let vendorPortalController: VendorPortalController;
  let mockVendorPortalService: Partial<VendorPortalService>;
  let mockMediaService: Partial<MediaService>;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryMock.mockReset();
    clientQueryMock.mockReset();

    mediaRepo = new MediaRepository();
    reviewService = new MediaReviewService(mediaRepo);
    adminController = new MediaAdminController(reviewService);

    mockVendorPortalService = {
      requireVendor: vi.fn().mockResolvedValue({
        id: VENDOR_ID,
        owner_user_id: USER_ID,
        verification_status: 'approved'
      }),
      assertVendorCanEditCatalogue: vi.fn()
    };

    mockMediaService = {
      save: vi.fn().mockResolvedValue({
        url: 'http://localhost:3001/v1/media/test-image.jpg',
        filename: 'test-image.jpg'
      })
    };

    vendorPortalController = new VendorPortalController(
      mockVendorPortalService as unknown as VendorPortalService,
      mockMediaService as unknown as MediaService,
      mediaRepo
    );
  });

  describe('1. Submission validation & 2. Upload does not touch vendors columns', () => {
    it('rejects upload when license statement is missing or shorter than 10 characters', async () => {
      const user = { id: USER_ID, roles: ['vendor_owner'] as any };
      const req = { protocol: 'http', get: () => 'localhost' } as any;
      const file = {
        originalname: 'test.jpg',
        mimetype: 'image/jpeg',
        size: 100,
        buffer: Buffer.from('test')
      };

      // Missing license_statement
      await expect(
        vendorPortalController.upload(file, { kind: 'gallery' }, req, user)
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });

      // Too short license_statement (< 10 chars)
      await expect(
        vendorPortalController.upload(
          file,
          { kind: 'gallery', license_statement: 'pendek' },
          req,
          user
        )
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });
    });

    it('rejects link submission when license statement is missing or too short', async () => {
      const user = { id: USER_ID, roles: ['vendor_owner'] as any };

      await expect(
        vendorPortalController.createMediaLink(
          { url: 'https://example.com/video.mp4', kind: 'video' },
          user
        )
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });

      await expect(
        vendorPortalController.createMediaLink(
          {
            url: 'https://example.com/video.mp4',
            kind: 'video',
            license_statement: 'too short'
          },
          user
        )
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });
    });

    it('upload saves media and inserts pending submission without touching vendors columns', async () => {
      const user = { id: USER_ID, roles: ['vendor_owner'] as any };
      const req = { protocol: 'http', get: () => 'localhost' } as any;
      const file = {
        originalname: 'test.jpg',
        mimetype: 'image/jpeg',
        size: 100,
        buffer: Buffer.from('test')
      };

      const insertedDbRow = {
        id: MEDIA_ID,
        vendor_id: VENDOR_ID,
        package_id: null,
        kind: 'gallery',
        url: 'http://localhost:3001/v1/media/test-image.jpg',
        storage_key: 'test-image.jpg',
        license_statement: 'Saya pemilik hak cipta foto ini',
        status: 'pending',
        review_note: null,
        reviewed_at: null,
        created_at: new Date('2026-11-04T12:00:00Z')
      };

      queryMock.mockResolvedValueOnce([insertedDbRow]);

      const res = await vendorPortalController.upload(
        file,
        {
          kind: 'gallery',
          license_statement: 'Saya pemilik hak cipta foto ini'
        },
        req,
        user
      );

      expect(res.data.media).toMatchObject({
        id: MEDIA_ID,
        vendor_id: VENDOR_ID,
        status: 'pending',
        url: 'http://localhost:3001/v1/media/test-image.jpg'
      });

      // Assert that DB was queried ONLY for INSERT INTO vendor_media, never UPDATE vendors
      expect(queryMock).toHaveBeenCalledTimes(1);
      const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO vendor_media');
      expect(sql).not.toContain('UPDATE vendors');
    });
  });

  describe('3. Approve applies each kind to the right column', () => {
    const baseMediaRow = {
      id: MEDIA_ID,
      vendor_id: VENDOR_ID,
      package_id: null,
      license_statement: 'Lisensi resmi hak cipta',
      status: 'pending',
      review_note: null,
      reviewed_at: null,
      created_at: new Date('2026-11-04T12:00:00Z')
    };

    it('applies avatar to vendors.avatar_url', async () => {
      const avatarRow = { ...baseMediaRow, kind: 'avatar', url: 'https://cdn.example.com/avatar.jpg' };
      clientQueryMock
        .mockResolvedValueOnce([avatarRow]) // findByIdForUpdate
        .mockResolvedValueOnce([{ id: VENDOR_ID }]) // UPDATE vendors SET avatar_url
        .mockResolvedValueOnce([{ ...avatarRow, status: 'approved', reviewed_by: REVIEWER_ID, reviewed_at: new Date() }]); // updateStatus

      const res = await reviewService.approve(MEDIA_ID, REVIEWER_ID);

      expect(res.status).toBe('approved');
      expect(clientQueryMock).toHaveBeenCalledTimes(3);

      const [applySql, applyParams] = clientQueryMock.mock.calls[1] as [string, unknown[]];
      expect(applySql).toContain('UPDATE vendors SET avatar_url = $2');
      expect(applyParams).toEqual([VENDOR_ID, avatarRow.url]);
    });

    it('applies banner to vendors.banner_url', async () => {
      const bannerRow = { ...baseMediaRow, kind: 'banner', url: 'https://cdn.example.com/banner.jpg' };
      clientQueryMock
        .mockResolvedValueOnce([bannerRow])
        .mockResolvedValueOnce([{ id: VENDOR_ID }])
        .mockResolvedValueOnce([{ ...bannerRow, status: 'approved', reviewed_by: REVIEWER_ID, reviewed_at: new Date() }]);

      const res = await reviewService.approve(MEDIA_ID, REVIEWER_ID);

      expect(res.status).toBe('approved');
      const [applySql, applyParams] = clientQueryMock.mock.calls[1] as [string, unknown[]];
      expect(applySql).toContain('UPDATE vendors SET banner_url = $2');
      expect(applyParams).toEqual([VENDOR_ID, bannerRow.url]);
    });

    it('applies video to vendors.video_url', async () => {
      const videoRow = { ...baseMediaRow, kind: 'video', url: 'https://cdn.example.com/video.mp4' };
      clientQueryMock
        .mockResolvedValueOnce([videoRow])
        .mockResolvedValueOnce([{ id: VENDOR_ID }])
        .mockResolvedValueOnce([{ ...videoRow, status: 'approved', reviewed_by: REVIEWER_ID, reviewed_at: new Date() }]);

      const res = await reviewService.approve(MEDIA_ID, REVIEWER_ID);

      expect(res.status).toBe('approved');
      const [applySql, applyParams] = clientQueryMock.mock.calls[1] as [string, unknown[]];
      expect(applySql).toContain('UPDATE vendors SET video_url = $2');
      expect(applyParams).toEqual([VENDOR_ID, videoRow.url]);
    });

    it('applies package_photo to packages.photo_url', async () => {
      const pkgPhotoRow = {
        ...baseMediaRow,
        kind: 'package_photo',
        package_id: PACKAGE_ID,
        url: 'https://cdn.example.com/pkg.jpg'
      };
      clientQueryMock
        .mockResolvedValueOnce([pkgPhotoRow])
        .mockResolvedValueOnce([{ id: PACKAGE_ID }]) // UPDATE packages RETURNING id
        .mockResolvedValueOnce([{ ...pkgPhotoRow, status: 'approved', reviewed_by: REVIEWER_ID, reviewed_at: new Date() }]);

      const res = await reviewService.approve(MEDIA_ID, REVIEWER_ID);

      expect(res.status).toBe('approved');
      const [applySql, applyParams] = clientQueryMock.mock.calls[1] as [string, unknown[]];
      expect(applySql).toContain('UPDATE packages');
      expect(applySql).toContain('SET photo_url = $3');
      expect(applyParams).toEqual([PACKAGE_ID, VENDOR_ID, pkgPhotoRow.url]);
    });

    it('appends gallery to vendors.photo_urls when not already present', async () => {
      const galleryRow = { ...baseMediaRow, kind: 'gallery', url: 'https://cdn.example.com/gallery1.jpg' };
      clientQueryMock
        .mockResolvedValueOnce([galleryRow])
        .mockResolvedValueOnce([{ photo_urls: ['https://cdn.example.com/existing.jpg'] }]) // SELECT photo_urls FOR UPDATE
        .mockResolvedValueOnce([{ id: VENDOR_ID }]) // UPDATE vendors SET photo_urls
        .mockResolvedValueOnce([{ ...galleryRow, status: 'approved', reviewed_by: REVIEWER_ID, reviewed_at: new Date() }]);

      const res = await reviewService.approve(MEDIA_ID, REVIEWER_ID);

      expect(res.status).toBe('approved');
      const [updateSql, updateParams] = clientQueryMock.mock.calls[2] as [string, unknown[]];
      expect(updateSql).toContain('UPDATE vendors SET photo_urls = $2');
      expect(updateParams).toEqual([
        VENDOR_ID,
        ['https://cdn.example.com/existing.jpg', 'https://cdn.example.com/gallery1.jpg']
      ]);
    });
  });

  describe('4. Foreign package_photo rejection', () => {
    it('throws NOT_FOUND when approving package_photo of a foreign or nonexistent package', async () => {
      const pkgPhotoRow = {
        id: MEDIA_ID,
        vendor_id: VENDOR_ID,
        package_id: PACKAGE_ID,
        kind: 'package_photo',
        url: 'https://cdn.example.com/pkg.jpg',
        license_statement: 'Lisensi karya sendiri',
        status: 'pending',
        review_note: null,
        reviewed_at: null,
        created_at: new Date()
      };

      clientQueryMock
        .mockResolvedValueOnce([pkgPhotoRow])
        .mockResolvedValueOnce([]); // UPDATE packages returns 0 rows (foreign vendor)

      await expect(reviewService.approve(MEDIA_ID, REVIEWER_ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Paket tidak ditemukan untuk vendor ini'
      });
    });
  });

  describe('5. Gallery cap enforcement', () => {
    it('throws VALIDATION_ERROR with GALLERY_FULL code when gallery is full (MAX_GALLERY_MEDIA)', async () => {
      const galleryRow = {
        id: MEDIA_ID,
        vendor_id: VENDOR_ID,
        package_id: null,
        kind: 'gallery',
        url: 'https://cdn.example.com/photo-overflow.jpg',
        license_statement: 'Lisensi resmi karya sendiri',
        status: 'pending',
        review_note: null,
        reviewed_at: null,
        created_at: new Date()
      };

      // 8 existing photos
      const eightPhotos = Array.from({ length: MAX_GALLERY_MEDIA }, (_, i) => `https://cdn.example.com/photo-${i}.jpg`);

      clientQueryMock
        .mockResolvedValueOnce([galleryRow])
        .mockResolvedValueOnce([{ photo_urls: eightPhotos }]);

      await expect(reviewService.approve(MEDIA_ID, REVIEWER_ID)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { reason: GALLERY_FULL_CODE }
      });
    });

    it('does not throw when gallery is full but the approved URL is already present in photo_urls', async () => {
      const galleryUrl = 'https://cdn.example.com/photo-0.jpg';
      const galleryRow = {
        id: MEDIA_ID,
        vendor_id: VENDOR_ID,
        package_id: null,
        kind: 'gallery',
        url: galleryUrl,
        license_statement: 'Lisensi resmi karya sendiri',
        status: 'pending',
        review_note: null,
        reviewed_at: null,
        created_at: new Date()
      };

      const eightPhotos = Array.from({ length: MAX_GALLERY_MEDIA }, (_, i) => `https://cdn.example.com/photo-${i}.jpg`);

      clientQueryMock
        .mockResolvedValueOnce([galleryRow])
        .mockResolvedValueOnce([{ photo_urls: eightPhotos }])
        .mockResolvedValueOnce([{ ...galleryRow, status: 'approved', reviewed_by: REVIEWER_ID, reviewed_at: new Date() }]);

      const res = await reviewService.approve(MEDIA_ID, REVIEWER_ID);
      expect(res.status).toBe('approved');
    });
  });

  describe('6. Reject without note rejected by schema', () => {
    it('throws VALIDATION_ERROR when note is missing or shorter than 5 characters', async () => {
      await expect(reviewService.reject(MEDIA_ID, REVIEWER_ID, '')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });

      await expect(reviewService.reject(MEDIA_ID, REVIEWER_ID, 'bad')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });

      const user = { id: REVIEWER_ID, roles: ['admin_support'] as any };
      await expect(adminController.reject(MEDIA_ID, { note: '123' }, user)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR'
      });
    });

    it('rejects successfully when valid note is provided', async () => {
      const pendingRow = {
        id: MEDIA_ID,
        vendor_id: VENDOR_ID,
        package_id: null,
        kind: 'banner',
        url: 'https://cdn.example.com/banner.jpg',
        license_statement: 'Lisensi resmi saya',
        status: 'pending',
        review_note: null,
        reviewed_at: null,
        created_at: new Date()
      };

      clientQueryMock
        .mockResolvedValueOnce([pendingRow])
        .mockResolvedValueOnce([
          {
            ...pendingRow,
            status: 'rejected',
            reviewed_by: REVIEWER_ID,
            review_note: 'Gambar buram dan tidak jelas',
            reviewed_at: new Date()
          }
        ]);

      const res = await reviewService.reject(MEDIA_ID, REVIEWER_ID, 'Gambar buram dan tidak jelas');
      expect(res.status).toBe('rejected');
      expect(res.review_note).toBe('Gambar buram dan tidak jelas');
    });
  });

  describe('7. Non-pending approve & reject throw CONFLICT', () => {
    it('throws CONFLICT when approving a media row that is already approved', async () => {
      clientQueryMock.mockResolvedValueOnce([
        {
          id: MEDIA_ID,
          vendor_id: VENDOR_ID,
          package_id: null,
          kind: 'avatar',
          url: 'https://cdn.example.com/avatar.jpg',
          license_statement: 'Lisensi karya sendiri',
          status: 'approved',
          review_note: null,
          reviewed_at: new Date(),
          created_at: new Date()
        }
      ]);

      await expect(reviewService.approve(MEDIA_ID, REVIEWER_ID)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Media sudah diproses sebelumnya'
      });
    });

    it('throws CONFLICT when rejecting a media row that is already rejected', async () => {
      clientQueryMock.mockResolvedValueOnce([
        {
          id: MEDIA_ID,
          vendor_id: VENDOR_ID,
          package_id: null,
          kind: 'avatar',
          url: 'https://cdn.example.com/avatar.jpg',
          license_statement: 'Lisensi karya sendiri',
          status: 'rejected',
          review_note: 'Foto tidak jelas',
          reviewed_at: new Date(),
          created_at: new Date()
        }
      ]);

      await expect(
        reviewService.reject(MEDIA_ID, REVIEWER_ID, 'Mencoba tolak lagi dengan note panjang')
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Media sudah diproses sebelumnya'
      });
    });
  });

  describe('8. Admin controller UUID validation', () => {
    it('throws NOT_FOUND when :id is not a valid UUID', async () => {
      const user = { id: REVIEWER_ID, roles: ['admin_support'] as any };
      await expect(adminController.approve('not-a-uuid', user)).rejects.toMatchObject({
        code: 'NOT_FOUND'
      });
      await expect(
        adminController.reject('not-a-uuid', { note: 'Alasan penolakan valid' }, user)
      ).rejects.toMatchObject({
        code: 'NOT_FOUND'
      });
    });
  });

  describe('9. Vendor scoping (cannot see/delete another vendor media)', () => {
    it('listMedia queries media belonging only to the authenticated vendor', async () => {
      const user = { id: USER_ID, roles: ['vendor_owner'] as any };
      queryMock.mockResolvedValueOnce([
        {
          id: MEDIA_ID,
          vendor_id: VENDOR_ID,
          package_id: null,
          kind: 'gallery',
          url: 'https://cdn.example.com/gal.jpg',
          license_statement: 'Pernyataan lisensi',
          status: 'pending',
          review_note: null,
          reviewed_at: null,
          created_at: new Date()
        }
      ]);

      const res = await vendorPortalController.listMedia(user);
      expect(res.data.items).toHaveLength(1);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE vendor_id = $1::uuid');
      expect(params).toEqual([VENDOR_ID]);
    });

    it('deleteMedia throws NOT_FOUND when attempting to delete another vendor media', async () => {
      const user = { id: USER_ID, roles: ['vendor_owner'] as any };
      // Media belongs to OTHER_VENDOR_ID
      queryMock.mockResolvedValueOnce([
        {
          id: MEDIA_ID,
          vendor_id: OTHER_VENDOR_ID,
          package_id: null,
          kind: 'gallery',
          url: 'https://cdn.example.com/gal.jpg',
          license_statement: 'Pernyataan lisensi',
          status: 'pending',
          review_note: null,
          reviewed_at: null,
          created_at: new Date()
        }
      ]);

      await expect(vendorPortalController.deleteMedia(MEDIA_ID, user)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Media tidak ditemukan'
      });
    });

    it('deleteMedia throws CONFLICT when media is not in pending status', async () => {
      const user = { id: USER_ID, roles: ['vendor_owner'] as any };
      queryMock.mockResolvedValueOnce([
        {
          id: MEDIA_ID,
          vendor_id: VENDOR_ID,
          package_id: null,
          kind: 'gallery',
          url: 'https://cdn.example.com/gal.jpg',
          license_statement: 'Pernyataan lisensi',
          status: 'approved',
          review_note: null,
          reviewed_at: new Date(),
          created_at: new Date()
        }
      ]);

      await expect(vendorPortalController.deleteMedia(MEDIA_ID, user)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Hanya media berstatus pending yang dapat dihapus'
      });
    });

    it('deleteMedia successfully deletes pending own media', async () => {
      const user = { id: USER_ID, roles: ['vendor_owner'] as any };
      queryMock
        .mockResolvedValueOnce([
          {
            id: MEDIA_ID,
            vendor_id: VENDOR_ID,
            package_id: null,
            kind: 'gallery',
            url: 'https://cdn.example.com/gal.jpg',
            license_statement: 'Pernyataan lisensi',
            status: 'pending',
            review_note: null,
            reviewed_at: null,
            created_at: new Date()
          }
        ]) // findById
        .mockResolvedValueOnce([{ id: MEDIA_ID }]); // DELETE RETURNING id

      await expect(vendorPortalController.deleteMedia(MEDIA_ID, user)).resolves.toBeUndefined();
      expect(queryMock).toHaveBeenCalledTimes(2);
      const [delSql, delParams] = queryMock.mock.calls[1] as [string, unknown[]];
      expect(delSql).toContain('DELETE FROM vendor_media');
      expect(delParams).toEqual([MEDIA_ID]);
    });
  });

  // Regresi dari audit reviewer (F-01, F-02): tidak boleh ada jalur tulis media
  // yang melewati moderasi, dan package_id tidak boleh dipakai lintas vendor.
  describe('9. Review fixes: package ownership & package photo_url', () => {
    const user = { id: USER_ID, roles: ['vendor_owner'] as any };
    const req = { protocol: 'http', get: () => 'localhost' } as any;
    const file = {
      originalname: 'test.jpg',
      mimetype: 'image/jpeg',
      size: 100,
      buffer: Buffer.from('test')
    };
    const license = 'Saya pemilik hak cipta foto ini';

    it('rejects package_photo upload when the package belongs to another vendor', async () => {
      queryMock.mockResolvedValueOnce([]); // packageBelongsToVendor -> tidak ada baris

      await expect(
        vendorPortalController.upload(
          file,
          { kind: 'package_photo', package_id: PACKAGE_ID, license_statement: license },
          req,
          user
        )
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const [sql] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('FROM packages');
      expect(sql).toContain('vendor_id');
      // Tidak boleh ada INSERT setelah kepemilikan gagal.
      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('rejects package_photo link when the package belongs to another vendor', async () => {
      queryMock.mockResolvedValueOnce([]);

      await expect(
        vendorPortalController.createMediaLink(
          {
            url: 'https://example.com/photo.jpg',
            kind: 'package_photo',
            package_id: PACKAGE_ID,
            license_statement: license
          },
          user
        )
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('accepts package_photo upload for a package owned by the vendor', async () => {
      queryMock
        .mockResolvedValueOnce([{ id: PACKAGE_ID }]) // kepemilikan lolos
        .mockResolvedValueOnce([
          {
            id: MEDIA_ID,
            vendor_id: VENDOR_ID,
            package_id: PACKAGE_ID,
            kind: 'package_photo',
            url: 'http://localhost:3001/v1/media/test-image.jpg',
            storage_key: 'test-image.jpg',
            license_statement: license,
            status: 'pending',
            review_note: null,
            reviewed_at: null,
            created_at: new Date()
          }
        ]);

      const result = await vendorPortalController.upload(
        file,
        { kind: 'package_photo', package_id: PACKAGE_ID, license_statement: license },
        req,
        user
      );
      expect(result.data.media.status).toBe('pending');
      expect(queryMock).toHaveBeenCalledTimes(2);
    });

    function buildService(approvedUrls: string[]) {
      const catalog = {
        createPackage: vi.fn().mockResolvedValue({ id: PACKAGE_ID }),
        updatePackage: vi.fn().mockResolvedValue({ id: PACKAGE_ID })
      };
      const mediaRepoStub = {
        findApprovedUrls: vi.fn().mockResolvedValue(new Set(approvedUrls))
      };
      const repoStub = {
        findVendorByOwner: vi.fn().mockResolvedValue({
          id: VENDOR_ID,
          owner_user_id: USER_ID,
          verification_status: 'approved'
        })
      };
      const service = new VendorPortalService(
        repoStub as any,
        catalog as any,
        mediaRepoStub as any
      );
      return { service, catalog, mediaRepoStub };
    }

    it('createPackage rejects an unapproved photo_url', async () => {
      const { service, catalog } = buildService([]);

      await expect(
        service.createPackage(USER_ID, {
          name: 'Paket Emas',
          duration_minutes: 120,
          base_price_idr: 5_000_000,
          photo_url: 'https://evil.test/unapproved.jpg'
        } as any)
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { reason: MEDIA_NOT_APPROVED_CODE }
      });
      expect(catalog.createPackage).not.toHaveBeenCalled();
    });

    it('createPackage accepts an approved photo_url', async () => {
      const approved = 'http://localhost:3001/v1/media/approved.jpg';
      const { service, catalog } = buildService([approved]);

      await service.createPackage(USER_ID, {
        name: 'Paket Emas',
        duration_minutes: 120,
        base_price_idr: 5_000_000,
        photo_url: approved
      } as any);
      expect(catalog.createPackage).toHaveBeenCalledTimes(1);
    });

    it('updatePackage rejects an unapproved photo_url', async () => {
      const { service, catalog } = buildService([]);

      await expect(
        service.updatePackage(USER_ID, PACKAGE_ID, {
          photo_url: 'https://evil.test/unapproved.jpg'
        } as any)
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { reason: MEDIA_NOT_APPROVED_CODE }
      });
      expect(catalog.updatePackage).not.toHaveBeenCalled();
    });

    it('updatePackage without photo_url skips the moderation check', async () => {
      const { service, catalog, mediaRepoStub } = buildService([]);

      await service.updatePackage(USER_ID, PACKAGE_ID, { name: 'Nama Baru' } as any);
      expect(mediaRepoStub.findApprovedUrls).not.toHaveBeenCalled();
      expect(catalog.updatePackage).toHaveBeenCalledTimes(1);
    });
  });
});
