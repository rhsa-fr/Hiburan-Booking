/**
 * Frozen HTTP contract for vendor self-registration (FR-002/FR-003).
 *
 * A customer submits an application with a private KTP upload. The account
 * keeps the `customer` role until `admin_super` approves it, at which point the
 * vendor row and `vendor_owner` role are created in one transaction.
 */
import { z } from 'zod';

export const VENDOR_APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected'
] as const;

export type VendorApplicationStatus = (typeof VENDOR_APPLICATION_STATUSES)[number];

export const SUBMIT_VENDOR_APPLICATION_BODY = z
  .object({
    display_name: z.string().trim().min(2).max(150),
    legal_name: z.string().trim().min(2).max(150),
    nik: z.string().regex(/^[0-9]{16}$/, 'NIK harus 16 digit angka'),
    region_code: z.string().trim().min(1).max(10),
    base_address: z.string().trim().min(10).max(1000),
    ktp_object_key: z.string().trim().min(1).max(300)
  })
  .strict();

export type SubmitVendorApplicationInput = z.infer<typeof SUBMIT_VENDOR_APPLICATION_BODY>;

export const REVIEW_VENDOR_APPLICATION_BODY = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(500).optional()
  })
  .strict();

export type ReviewVendorApplicationInput = z.infer<typeof REVIEW_VENDOR_APPLICATION_BODY>;

export const LIST_VENDOR_APPLICATIONS_QUERY = z.object({
  status: z.enum(VENDOR_APPLICATION_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20)
});

export type ListVendorApplicationsQuery = z.infer<typeof LIST_VENDOR_APPLICATIONS_QUERY>;

export interface VendorApplicationView {
  readonly id: string;
  readonly status: VendorApplicationStatus;
  readonly display_name: string;
  readonly legal_name: string;
  /** Masked outside the admin review surface. */
  readonly nik: string;
  readonly region_code: string;
  readonly base_address: string;
  readonly review_note: string | null;
  readonly vendor_id: string | null;
  readonly created_at: string;
  readonly reviewed_at: string | null;
}

export interface VendorApplicationList {
  readonly items: VendorApplicationView[];
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
}

export interface VendorApplicationRecord {
  readonly id: string;
  readonly userId: string;
  readonly status: VendorApplicationStatus;
  readonly displayName: string;
  readonly legalName: string;
  readonly nik: string;
  readonly regionCode: string;
  readonly baseAddress: string;
  readonly ktpObjectKey: string;
  readonly reviewNote: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
  readonly vendorId: string | null;
  readonly createdAt: Date;
}
