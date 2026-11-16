/**
 * Kontrak moderasi UGC: lapor konten (FR-123), takedown (FR-124), dan
 * blokir pengguna (FR-142).
 *
 * Kosakata sengaja didefinisikan di sini dan dicerminkan oleh CHECK di
 * `db/migrations/027_content_reports.sql`. Kalau salah satu berubah, keduanya
 * harus berubah bersama — repository tidak boleh mengirim nilai di luar daftar
 * ini karena CHECK akan menolaknya.
 */
import { z } from 'zod';

export const REPORT_TARGET_TYPES = [
  'vendor',
  'review',
  'chat_message',
  'vendor_media'
] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'fraud',
  'illegal',
  'copyright',
  'impersonation',
  'other'
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'rejected'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/**
 * Status yang boleh dipakai sebagai filter antrean admin. `pending` adalah
 * gabungan `open` + `reviewing` — satu-satunya tab yang dibutuhkan moderator
 * ("belum diputuskan") tanpa memaksa panel memanggil dua kali.
 */
export const ADMIN_REPORT_QUEUE_STATUSES = [
  'pending',
  'open',
  'reviewing',
  'resolved',
  'rejected'
] as const;
export type AdminReportQueueStatus = (typeof ADMIN_REPORT_QUEUE_STATUSES)[number];

/**
 * Aksi yang benar-benar dijalankan moderator. `user_suspended` sengaja TIDAK
 * ada di sini: penangguhan vendor punya jalur sendiri
 * (`POST /v1/admin/vendors/:id/suspend`, `admin_super`) dengan audit dan
 * pembekuan payout. Menyalinnya ke sini akan membuat dua sumber kebenaran
 * untuk transisi status yang sama.
 */
export const REPORT_ACTIONS = [
  'no_action',
  'content_removed',
  'content_restored',
  'user_warned'
] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/** Batas tinjauan: 24 jam (FR-123), 72 jam untuk hak cipta (FR-124). */
export const DEFAULT_SLA_HOURS = 24;
export const COPYRIGHT_SLA_HOURS = 72;

export function slaDueAt(reason: ReportReason, now: Date = new Date()): Date {
  const hours = reason === 'copyright' ? COPYRIGHT_SLA_HOURS : DEFAULT_SLA_HOURS;
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

const UUID = z.string().uuid();

export const CREATE_REPORT_BODY = z
  .object({
    target_type: z.enum(REPORT_TARGET_TYPES),
    target_id: UUID,
    reason: z.enum(REPORT_REASONS),
    // Minimal 10 karakter supaya "spam" saja tidak lolos; selaras dengan CHECK.
    detail: z.string().trim().min(10).max(2000),
    evidence_url: z.string().trim().url().max(2000).optional(),
    booking_id: UUID.optional()
  })
  .strict();

export type CreateReportInput = z.infer<typeof CREATE_REPORT_BODY>;

export const LIST_OWN_REPORTS_QUERY = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional()
  })
  .passthrough();

export const ADMIN_REPORT_QUEUE_QUERY = z
  .object({
    status: z.enum(ADMIN_REPORT_QUEUE_STATUSES).optional(),
    reason: z.enum(REPORT_REASONS).optional(),
    target_type: z.enum(REPORT_TARGET_TYPES).optional(),
    overdue: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional()
  })
  .passthrough();

export interface AdminReportFilters {
  status: AdminReportQueueStatus | '';
  reason: ReportReason | '';
  target_type: ReportTargetType | '';
  overdue: boolean;
  page: number;
  page_size: number;
}

export const RESOLVE_REPORT_BODY = z
  .object({
    action: z.enum(REPORT_ACTIONS),
    note: z.string().trim().min(10).max(1000)
  })
  .strict();

export type ResolveReportInput = z.infer<typeof RESOLVE_REPORT_BODY>;

export const BLOCK_USER_BODY = z
  .object({
    user_id: UUID,
    reason: z.string().trim().min(3).max(200).optional()
  })
  .strict();

export type BlockUserInput = z.infer<typeof BLOCK_USER_BODY>;

/** Satu baris `content_reports` seperti yang dikirim ke klien. */
export interface ContentReportView {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  booking_id: string | null;
  reason: ReportReason;
  detail: string;
  evidence_url: string | null;
  status: ReportStatus;
  resolution: ReportAction | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  sla_due_at: string;
  overdue: boolean;
  /** Diisi worker `escalate_reports` saat laporan terbuka melewati SLA. */
  escalated_at: string | null;
  escalated: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContentReportPage {
  items: ContentReportView[];
  total: number;
  page: number;
  page_size: number;
}

export interface BlockedUserView {
  user_id: string;
  name: string | null;
  reason: string | null;
  created_at: string;
}

/** Snapshot kecil target agar moderator tidak perlu membuka banyak tab. */
export interface ReportTargetContext {
  found: boolean;
  /** Ringkasan aman untuk panel; tidak memuat PII sensitif. */
  summary: string | null;
  /** Pemilik konten, bila relevan (dipakai untuk mencegah lapor diri sendiri). */
  owner_user_id: string | null;
  /** Konten sedang tidak tayang publik (sudah diturunkan / menunggu moderasi). */
  hidden: boolean;
  /** Pelapor berhak melaporkan target ini (mis. harus peserta chat untuk pesan). */
  can_report: boolean;
}

/* -------------------------------------------------------------------------- */
/* Banding takedown (FR-124)                                                   */
/* -------------------------------------------------------------------------- */

export const APPEAL_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

/**
 * Banding hanya bisa diajukan pemilik konten dalam 30 hari setelah laporan
 * diputuskan. Alasan lebih panjang dari laporan karena harus menjelaskan
 * mengapa keputusan takedown keliru.
 */
export const APPEAL_WINDOW_DAYS = 30;

export const CREATE_APPEAL_BODY = z
  .object({
    reason: z.string().trim().min(20).max(2000),
    evidence_url: z.string().trim().url().max(2000).optional()
  })
  .strict();

export type CreateAppealInput = z.infer<typeof CREATE_APPEAL_BODY>;

export const RESOLVE_APPEAL_BODY = z
  .object({
    status: z.enum(['accepted', 'rejected']),
    note: z.string().trim().min(10).max(1000)
  })
  .strict();

export type ResolveAppealInput = z.infer<typeof RESOLVE_APPEAL_BODY>;

export const ADMIN_APPEAL_QUEUE_QUERY = z
  .object({
    status: z.enum(APPEAL_STATUSES).optional(),
    page: z.coerce.number().int().min(1).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional()
  })
  .passthrough();

export interface AdminAppealFilters {
  status: AppealStatus | '';
  page: number;
  page_size: number;
}

/** Satu baris banding + potongan laporan asal yang aman ditampilkan. */
export interface ContentReportAppealView {
  id: string;
  report_id: string;
  appellant_id: string;
  reason: string;
  evidence_url: string | null;
  /** Berkas bukti privat sudah dilampirkan (FR-124). Path-nya tidak pernah dikirim ke klien. */
  has_evidence_file: boolean;
  status: AppealStatus;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  target_type: ReportTargetType;
  target_id: string;
  report_resolution: ReportAction | null;
  report_resolved_at: string | null;
}

export interface ContentReportAppealPage {
  items: ContentReportAppealView[];
  total: number;
  page: number;
  page_size: number;
}

/** Yang dilihat pemilik konten: tanpa identitas pelapor atau isi laporan. */
export interface OwnedTakedownView {
  report_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  resolved_at: string;
  appeal_deadline_at: string;
  appeal_id: string | null;
  appeal_status: AppealStatus | null;
  appeal_created_at: string | null;
  appeal_decided_at: string | null;
  appeal_decision_note: string | null;
  /** Bukti berkas privat sudah dilampirkan pemilik konten (FR-124). */
  appeal_has_evidence_file: boolean;
}

export interface OwnedTakedownPage {
  items: OwnedTakedownView[];
  total: number;
  page: number;
  page_size: number;
}

export const OWNED_TAKEDOWN_QUERY = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional()
  })
  .passthrough();
