import { AppError } from '@tarlink/core/errors';
import { SlidingWindowLimiter } from '@tarlink/platform/rate-limit';
import {
  APPEAL_WINDOW_DAYS,
  slaDueAt,
  type AdminAppealFilters,
  type AdminReportFilters,
  type BlockedUserView,
  type BlockUserInput,
  type ContentReportAppealPage,
  type ContentReportAppealView,
  type ContentReportPage,
  type ContentReportView,
  type CreateAppealInput,
  type CreateReportInput,
  type OwnedTakedownPage,
  type OwnedTakedownView,
  type ResolveAppealInput,
  type ResolveReportInput,
  type ReportTargetType
} from './moderation.contracts';
import { ModerationRepository, toAppealView, toReportView } from './moderation.repository';

export interface ModerationActor {
  readonly id: string;
  readonly roles: readonly string[];
}

/** Label target untuk pesan error yang bisa dibaca pengguna. */
const TARGET_LABEL: Record<ReportTargetType, string> = {
  vendor: 'Vendor',
  review: 'Ulasan',
  chat_message: 'Pesan chat',
  vendor_media: 'Media vendor'
};

const DEFAULT_PAGE_SIZE = 20;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Anti-spam cap for `POST /reports`: 10 reports per user per hour. A report
 * creates a queue row and, on escalation, admin notifications, so an
 * authenticated script must not be able to fill the queue at will. In-memory
 * per process like the auth limiters; the real protection is still auth.
 */
export const REPORT_RATE_LIMIT_MAX = 10;
export const REPORT_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

/** Appeals are rarer than reports; cap them lower but keep the same window. */
export const APPEAL_RATE_LIMIT_MAX = 5;

function uniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '23505'
  );
}

function pageBounds(page?: number, pageSize?: number): { page: number; pageSize: number } {
  const safePage = Math.max(1, Math.floor(page ?? 1));
  const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize ?? DEFAULT_PAGE_SIZE)));
  return { page: safePage, pageSize: safeSize };
}

/**
 * Aturan moderasi UGC.
 *
 * Yang dijaga di sini (bukan di controller):
 * - target harus ada dan pelapor berhak melaporkannya (pesan chat hanya untuk
 *   peserta booking; konten sendiri tidak bisa dilaporkan);
 * - satu pelapor tidak bisa menumpuk laporan terbuka untuk target yang sama;
 * - keputusan moderator hanya sekali per laporan (tidak ada resolve ganda);
 * - pelapor selalu bisa membaca status laporannya sendiri (FR-123 AC).
 */
export class ModerationService {
  private readonly reportLimiter = new SlidingWindowLimiter({
    max: REPORT_RATE_LIMIT_MAX,
    windowMs: REPORT_RATE_LIMIT_WINDOW_SECONDS * 1000
  });

  private readonly appealLimiter = new SlidingWindowLimiter({
    max: APPEAL_RATE_LIMIT_MAX,
    windowMs: REPORT_RATE_LIMIT_WINDOW_SECONDS * 1000
  });

  constructor(private readonly repository: ModerationRepository) {}

  /* ------------------------------------------------------------ laporan */

  async createReport(actor: ModerationActor, input: CreateReportInput): Promise<ContentReportView> {
    const context = await this.repository.targetContext(
      input.target_type,
      input.target_id,
      actor.id
    );

    if (!context.found) {
      throw new AppError('NOT_FOUND', `${TARGET_LABEL[input.target_type]} tidak ditemukan`);
    }
    if (!context.can_report) {
      throw new AppError('FORBIDDEN', 'Kamu tidak berhak melaporkan konten ini');
    }
    if (context.owner_user_id === actor.id) {
      throw new AppError('VALIDATION_ERROR', 'Konten milik sendiri tidak perlu dilaporkan');
    }
    if (!this.reportLimiter.attempt(actor.id)) {
      throw new AppError(
        'RATE_LIMITED',
        `Terlalu banyak laporan. Maksimal ${REPORT_RATE_LIMIT_MAX} laporan per jam; coba lagi nanti.`
      );
    }

    try {
      const row = await this.repository.createReport(
        actor.id,
        input,
        slaDueAt(input.reason)
      );
      return toReportView(row);
    } catch (err) {
      if (uniqueViolation(err)) {
        throw new AppError(
          'CONFLICT',
          'Laporan untuk konten ini masih ditinjau. Tunggu keputusan admin sebelum melapor lagi.'
        );
      }
      throw err;
    }
  }

  async listOwnReports(
    actor: ModerationActor,
    page?: number,
    pageSize?: number
  ): Promise<ContentReportPage> {
    const bounds = pageBounds(page, pageSize);
    const [rows, total] = await Promise.all([
      this.repository.listByReporter(
        actor.id,
        bounds.pageSize,
        (bounds.page - 1) * bounds.pageSize
      ),
      this.repository.countByReporter(actor.id)
    ]);
    return {
      items: rows.map((row) => toReportView(row)),
      total,
      page: bounds.page,
      page_size: bounds.pageSize
    };
  }

  /** 404 (bukan 403) untuk laporan orang lain: keberadaannya tidak dibocorkan. */
  async getOwnReport(actor: ModerationActor, reportId: string): Promise<ContentReportView> {
    const row = await this.repository.findById(reportId);
    if (!row || row.reporter_id !== actor.id) {
      throw new AppError('NOT_FOUND', 'Laporan tidak ditemukan');
    }
    return toReportView(row);
  }

  /**
   * Takedown list for the content owner (the appellant), without the reporter's
   * identity or report body. Includes the appeal deadline and current appeal.
   */
  async listTakedownsAgainstMe(
    actor: ModerationActor,
    page?: number,
    pageSize?: number
  ): Promise<OwnedTakedownPage> {
    const bounds = pageBounds(page, pageSize);
    const [rows, total] = await Promise.all([
      this.repository.listOwnedTakedowns(
        actor.id,
        bounds.pageSize,
        (bounds.page - 1) * bounds.pageSize
      ),
      this.repository.countOwnedTakedowns(actor.id)
    ]);
    return {
      items: rows.map(
        (row): OwnedTakedownView => ({
          report_id: row.report_id,
          target_type: row.target_type,
          target_id: row.target_id,
          reason: row.reason,
          resolved_at: row.resolved_at.toISOString(),
          appeal_deadline_at: row.appeal_deadline_at.toISOString(),
          appeal_id: row.appeal_id,
          appeal_status: row.appeal_status,
          appeal_created_at: iso(row.appeal_created_at),
          appeal_decided_at: iso(row.appeal_decided_at),
          appeal_decision_note: row.appeal_decision_note,
          appeal_has_evidence_file: row.appeal_has_evidence_file
        })
      ),
      total,
      page: bounds.page,
      page_size: bounds.pageSize
    };
  }

  /* --------------------------------------------------------------- admin */

  async listQueue(filters: AdminReportFilters): Promise<ContentReportPage> {
    const [rows, total] = await Promise.all([
      this.repository.listQueue(filters),
      this.repository.countQueue(filters)
    ]);
    return {
      items: rows.map((row) => toReportView(row)),
      total,
      page: filters.page,
      page_size: filters.page_size
    };
  }

  async getReport(reportId: string): Promise<ContentReportView> {
    const row = await this.repository.findById(reportId);
    if (!row) throw new AppError('NOT_FOUND', 'Laporan tidak ditemukan');
    return toReportView(row);
  }

  async resolve(
    actor: ModerationActor,
    actorRole: string,
    reportId: string,
    input: ResolveReportInput,
    requestId: string | null
  ): Promise<ContentReportView> {
    const result = await this.repository.resolveReport({
      reportId,
      action: input.action,
      note: input.note,
      actorId: actor.id,
      actorRole,
      requestId
    });
    return toReportView(result.report);
  }

  /* --------------------------------------------------- banding (FR-124) */

  /**
   * Only the owner of removed content may appeal, only for report resolutions
   * that actually hid something, and only within the appeal window. A stranger
   * gets `NOT_FOUND` so the report's existence is not disclosed.
   */
  async createAppeal(
    actor: ModerationActor,
    reportId: string,
    input: CreateAppealInput
  ): Promise<ContentReportAppealView> {
    const report = await this.repository.findById(reportId);
    if (!report) throw new AppError('NOT_FOUND', 'Laporan tidak ditemukan');
    if (report.status !== 'resolved' || report.resolution !== 'content_removed') {
      throw new AppError(
        'VALIDATION_ERROR',
        'Banding hanya bisa diajukan untuk konten yang diturunkan'
      );
    }
    if (report.target_type === 'vendor') {
      throw new AppError(
        'VALIDATION_ERROR',
        'Banding tidak berlaku untuk penangguhan vendor; gunakan jalur penangguhan'
      );
    }
    if (!report.resolved_at) {
      throw new AppError('VALIDATION_ERROR', 'Waktu keputusan laporan tidak tersedia');
    }
    const ageDays = (Date.now() - report.resolved_at.getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays > APPEAL_WINDOW_DAYS) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Batas banding ${APPEAL_WINDOW_DAYS} hari setelah keputusan sudah lewat`
      );
    }

    const context = await this.repository.targetContext(
      report.target_type,
      report.target_id,
      actor.id
    );
    if (!context.found || context.owner_user_id !== actor.id) {
      throw new AppError('NOT_FOUND', 'Laporan tidak ditemukan');
    }
    if (!context.hidden) {
      throw new AppError('VALIDATION_ERROR', 'Konten sudah tayang; banding tidak diperlukan');
    }

    if (!this.appealLimiter.attempt(actor.id)) {
      throw new AppError(
        'RATE_LIMITED',
        `Terlalu banyak banding. Maksimal ${APPEAL_RATE_LIMIT_MAX} banding per jam; coba lagi nanti.`
      );
    }

    try {
      const row = await this.repository.createAppeal(actor.id, reportId, input);
      return toAppealView(row);
    } catch (err) {
      if (uniqueViolation(err)) {
        throw new AppError('CONFLICT', 'Banding untuk laporan ini sudah diajukan');
      }
      throw err;
    }
  }

  /** The appellant can read their own appeal; anybody else gets 404. */
  async getOwnAppeal(
    actor: ModerationActor,
    reportId: string
  ): Promise<ContentReportAppealView> {
    const row = await this.repository.findAppealByReport(reportId);
    if (!row || row.appellant_id !== actor.id) {
      throw new AppError('NOT_FOUND', 'Banding tidak ditemukan');
    }
    return toAppealView(row);
  }

  async listAppeals(filters: AdminAppealFilters): Promise<ContentReportAppealPage> {
    const bounds = pageBounds(filters.page, filters.page_size);
    const normalised: AdminAppealFilters = {
      status: filters.status,
      page: bounds.page,
      page_size: bounds.pageSize
    };
    const [rows, total] = await Promise.all([
      this.repository.listAppeals(normalised),
      this.repository.countAppeals(normalised)
    ]);
    return {
      items: rows.map((row) => toAppealView(row)),
      total,
      page: bounds.page,
      page_size: bounds.pageSize
    };
  }

  async getAppeal(appealId: string): Promise<ContentReportAppealView> {
    const row = await this.repository.findAppealById(appealId);
    if (!row) throw new AppError('NOT_FOUND', 'Banding tidak ditemukan');
    return toAppealView(row);
  }

  async resolveAppeal(
    actor: ModerationActor,
    actorRole: string,
    appealId: string,
    input: ResolveAppealInput,
    requestId: string | null
  ): Promise<ContentReportAppealView> {
    const row = await this.repository.resolveAppeal({
      appealId,
      status: input.status,
      note: input.note,
      actorId: actor.id,
      actorRole,
      requestId
    });
    return toAppealView(row);
  }

  /* -------------------------------------------------------------- blokir */

  async block(actor: ModerationActor, input: BlockUserInput): Promise<BlockedUserView> {
    if (input.user_id === actor.id) {
      throw new AppError('VALIDATION_ERROR', 'Tidak bisa memblokir diri sendiri');
    }
    if (!(await this.repository.userExists(input.user_id))) {
      throw new AppError('NOT_FOUND', 'Pengguna tidak ditemukan');
    }
    const row = await this.repository.blockUser(actor.id, input);
    return {
      user_id: row.user_id,
      name: row.name,
      reason: row.reason,
      created_at: row.created_at.toISOString()
    };
  }

  /** Idempoten: memblokir ulang atau membuka blokir yang tidak ada tetap 204. */
  async unblock(actor: ModerationActor, userId: string): Promise<void> {
    await this.repository.unblockUser(actor.id, userId);
  }

  async listBlocks(actor: ModerationActor): Promise<BlockedUserView[]> {
    const rows = await this.repository.listBlocks(actor.id);
    return rows.map((row) => ({
      user_id: row.user_id,
      name: row.name,
      reason: row.reason,
      created_at: row.created_at.toISOString()
    }));
  }

  /** Dipakai jalur chat/WebSocket agar pesan pihak yang diblokir tidak tampil. */
  async isBlocked(viewerId: string, senderId: string): Promise<boolean> {
    if (viewerId === senderId) return false;
    return this.repository.isBlocked(viewerId, senderId);
  }
}
