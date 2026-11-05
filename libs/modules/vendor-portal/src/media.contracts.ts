/**
 * Kontrak beku moderasi media vendor (migrasi 016, FR-107 + FR-140).
 *
 * ATURAN: file ini ditulis oleh lead. Builder hanya mengonsumsi tipe dan skema
 * di sini; jangan mengubah bentuk respons tanpa keputusan lead.
 */
import { z } from 'zod';

export const MEDIA_KINDS = ['avatar', 'banner', 'gallery', 'package_photo', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type MediaReviewStatus = (typeof MEDIA_REVIEW_STATUSES)[number];

/** Baris media milik vendor, dipakai portal vendor maupun antrean admin. */
export interface MediaRow {
  id: string;
  vendor_id: string;
  package_id: string | null;
  kind: MediaKind;
  url: string;
  status: MediaReviewStatus;
  license_statement: string;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/** Item antrean moderasi admin: media + identitas vendor pengunggah. */
export interface AdminMediaQueueItem extends MediaRow {
  vendor_name: string;
  vendor_region_code: string;
  package_name: string | null;
}

export interface MediaListResult {
  items: MediaRow[];
}

export interface AdminMediaQueueResult {
  items: AdminMediaQueueItem[];
  total: number;
  page: number;
  page_size: number;
}

/** Maksimum foto galeri yang boleh terbit per vendor (selaras dto lama: 8). */
export const MAX_GALLERY_MEDIA = 8;

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => /^https?:\/\//i.test(value), 'URL harus memakai http atau https');

const licenseStatement = z
  .string()
  .trim()
  .min(10, 'Pernyataan lisensi minimal 10 karakter')
  .max(500);

/** `POST /v1/vendor/media/link` — media berupa tautan (video/galeri eksternal). */
export const VENDOR_MEDIA_LINK_BODY = z
  .object({
    url: httpUrl,
    kind: z.enum(MEDIA_KINDS),
    package_id: z.string().uuid().nullable().optional(),
    license_statement: licenseStatement
  })
  .strict();

/** Field multipart `POST /v1/vendor/media`. */
export const VENDOR_MEDIA_UPLOAD_FIELDS = z
  .object({
    kind: z.enum(MEDIA_KINDS).default('gallery'),
    package_id: z.string().uuid().nullable().optional(),
    license_statement: licenseStatement
  })
  .strict();

export const ADMIN_MEDIA_REJECT_BODY = z
  .object({
    note: z.string().trim().min(5, 'Alasan penolakan minimal 5 karakter').max(500)
  })
  .strict();

export const ADMIN_MEDIA_QUEUE_QUERY = z
  .object({
    status: z.enum(MEDIA_REVIEW_STATUSES).default('pending'),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict();

export type VendorMediaLinkInput = z.infer<typeof VENDOR_MEDIA_LINK_BODY>;
export type VendorMediaUploadFields = z.infer<typeof VENDOR_MEDIA_UPLOAD_FIELDS>;
export type AdminMediaRejectInput = z.infer<typeof ADMIN_MEDIA_REJECT_BODY>;
export type AdminMediaQueueQuery = z.infer<typeof ADMIN_MEDIA_QUEUE_QUERY>;

/**
 * Aturan penerapan saat approve — dipakai service dan test.
 * `avatar`/`banner`/`video` menimpa kolom; `gallery` menambah; `package_photo`
 * menimpa `packages.photo_url` milik paket itu.
 */
export const MEDIA_APPLY_TARGET: Record<MediaKind, 'vendors_column' | 'vendors_gallery' | 'packages_column'> = {
  avatar: 'vendors_column',
  banner: 'vendors_column',
  video: 'vendors_column',
  gallery: 'vendors_gallery',
  package_photo: 'packages_column'
};

/**
 * Penanda untuk URL media yang belum disetujui. `ErrorCode` di platform tidak
 * punya 422, jadi lempar `AppError('VALIDATION_ERROR', msg, { reason: MEDIA_NOT_APPROVED_CODE })`
 * — status HTTP 400 dengan `details.reason` yang stabil untuk klien.
 */
export const MEDIA_NOT_APPROVED_CODE = 'MEDIA_NOT_APPROVED';

/** Penanda galeri yang sudah penuh saat approve (maksimum MAX_GALLERY_MEDIA). */
export const GALLERY_FULL_CODE = 'GALLERY_FULL';
