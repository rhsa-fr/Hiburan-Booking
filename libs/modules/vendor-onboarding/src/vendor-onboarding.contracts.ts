/**
 * Frozen HTTP contract for vendor self-registration (FR-002/FR-003).
 *
 * A customer submits an application with a private KTP upload. The account
 * keeps the `customer` role until `admin_super` approves it, at which point the
 * vendor row and `vendor_owner` role are created in one transaction.
 *
 * Form v2 (migration 041) adds the staged wizard: category, experience,
 * description, personnel, equipment and the accepted Ketentuan Mitra version.
 * The server writes `form_version = 2` itself; it is never read from the body.
 */
import { z } from 'zod';

export const VENDOR_APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected'
] as const;

export type VendorApplicationStatus = (typeof VENDOR_APPLICATION_STATUSES)[number];

const CATEGORY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Postgres `char_length()` counts Unicode code points; JS `.length` counts
 * UTF-16 units, so 20 emoji measure 40 here but 20 in the database. Every
 * length limit below counts the same way the column check does.
 */
function charLength(value: string): number {
  return Array.from(value).length;
}

function charLimited(min: number, max: number, message: string) {
  return z
    .string()
    .trim()
    .refine((value) => {
      const length = charLength(value);
      return length >= min && length <= max;
    }, message);
}

export const SUBMIT_VENDOR_APPLICATION_BODY = z
  .object({
    display_name: charLimited(2, 150, 'Nama tampilan 2-150 karakter'),
    legal_name: charLimited(2, 150, 'Nama legal 2-150 karakter'),
    nik: z.string().regex(/^[0-9]{16}$/, 'NIK harus 16 digit angka'),
    region_code: z.string().trim().min(1).max(10),
    base_address: charLimited(10, 1000, 'Alamat 10-1000 karakter'),
    ktp_object_key: z.string().trim().min(1).max(300),
    category_slug: z.string().trim().min(2).max(50).regex(CATEGORY_SLUG),
    years_active: z.number().int().min(0).max(80),
    description: charLimited(40, 1000, 'Deskripsi 40-1000 karakter'),
    personnel_count: z.number().int().min(1).max(1000),
    equipment_summary: charLimited(20, 1000, 'Ringkasan peralatan 20-1000 karakter'),
    // Missing/empty is stored as NULL; only a real https link is kept. The DB
    // CHECK in migration 041 requires `^https://[^[:space:]]+$`, so a bare
    // scheme ("https://") must fail here instead of becoming a 500 later.
    portfolio_url: z
      .union([
        z
          .string()
          .trim()
          .regex(/^https:\/\/\S+$/)
          .refine((value) => charLength(value) <= 300, 'Portofolio maks 300 karakter'),
        z.literal(''),
        z.null()
      ])
      .optional()
      .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
    agreement_policy_version_id: z.string().uuid()
  })
  .strict();

export type SubmitVendorApplicationInput = z.infer<typeof SUBMIT_VENDOR_APPLICATION_BODY>;

/** Request metadata recorded with the consent row; never derived from the body. */
export interface SubmitVendorApplicationContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

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
  /** Additive form v2 fields; legacy rows report `1` and null the rest. */
  readonly form_version: number;
  readonly category_slug: string | null;
  readonly category_name: string | null;
  readonly years_active: number | null;
  readonly description: string | null;
  readonly personnel_count: number | null;
  readonly equipment_summary: string | null;
  readonly portfolio_url: string | null;
  readonly agreement_version_id: string | null;
  readonly agreement_version: number | null;
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
  /** Empty when only the encrypted form is stored; hydrate before displaying. */
  readonly nik: string;
  /** AES-256-GCM payload for new rows (migrasi 019). */
  readonly nikCiphertext: Buffer | null;
  readonly nikKeyId: string | null;
  readonly regionCode: string;
  readonly baseAddress: string;
  readonly ktpObjectKey: string;
  readonly reviewNote: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
  readonly vendorId: string | null;
  readonly createdAt: Date;
  readonly formVersion: number;
  readonly categoryId: number | null;
  readonly categorySlug: string | null;
  readonly categoryName: string | null;
  readonly yearsActive: number | null;
  readonly description: string | null;
  readonly personnelCount: number | null;
  readonly equipmentSummary: string | null;
  readonly portfolioUrl: string | null;
  readonly agreementPolicyVersionId: string | null;
  readonly agreementVersion: number | null;
}

/* ------------------------------------------------------------ eligibility */

export const ELIGIBILITY_BLOCKER_CODES = [
  'ACCOUNT_INACTIVE',
  'NAME_MISSING',
  'PHONE_MISSING',
  'EMAIL_NOT_VERIFIED',
  'VENDOR_ACCOUNT_EXISTS',
  'APPLICATION_OPEN',
  'POLICY_UNAVAILABLE'
] as const;

export type EligibilityBlockerCode = (typeof ELIGIBILITY_BLOCKER_CODES)[number];

export interface EligibilityBlocker {
  readonly code: EligibilityBlockerCode;
  readonly message: string;
}

export interface VendorEligibilityAccount {
  readonly name: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly email_verified: boolean;
}

/** The active Ketentuan Mitra document the client must accept before submitting. */
export interface VendorPolicyDocument {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly body_hash: string;
  readonly effective_from: string;
  readonly body: Record<string, unknown>;
}

export interface VendorEligibilityView {
  readonly can_submit: boolean;
  readonly blockers: EligibilityBlocker[];
  readonly account: VendorEligibilityAccount;
  readonly application: VendorApplicationView | null;
  readonly policy: VendorPolicyDocument | null;
  readonly categories: Array<{ slug: string; name: string }>;
}

/* -------------------------------------------------------- repository rows */

export interface VendorAccountRecord {
  readonly name: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly emailVerifiedAt: Date | null;
  readonly status: string;
}

export interface VendorCategoryRecord {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly isActive: boolean;
}

export interface VendorPolicyRecord {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly bodyHash: string;
  readonly effectiveFrom: Date;
  readonly body: Record<string, unknown>;
}
