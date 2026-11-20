import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '@tarlink/core/db';
import { AppError } from '@tarlink/core/errors';
import {
  planAppealDecisionNotification,
  planReportResolvedNotification,
  planTakedownNotification,
  reportAppealDecisionDedupeKey,
  reportResolvedDedupeKey,
  reportTakedownDedupeKey
} from '@tarlink/modules/notifications';
import { APPEAL_WINDOW_DAYS } from './moderation.contracts';
import type {
  AdminAppealFilters,
  AdminReportFilters,
  AppealStatus,
  BlockUserInput,
  ContentReportAppealView,
  ContentReportView,
  CreateAppealInput,
  CreateReportInput,
  ReportAction,
  ReportReason,
  ReportStatus,
  ReportTargetContext,
  ReportTargetType
} from './moderation.contracts';

export interface ContentReportRow {
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
  resolved_at: Date | null;
  sla_due_at: Date;
  escalated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface BlockedUserRow {
  user_id: string;
  name: string | null;
  reason: string | null;
  created_at: Date;
}

export interface AuditEntry {
  actorId: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeState: unknown;
  afterState: unknown;
  requestId: string | null;
}

export interface ResolveReportCommand {
  reportId: string;
  action: ReportAction;
  note: string;
  actorId: string;
  actorRole: string | null;
  requestId: string | null;
}

export interface ContentReportAppealRow {
  id: string;
  report_id: string;
  appellant_id: string;
  reason: string;
  evidence_url: string | null;
  /** Object key privat bukti berkas; `null` = tidak ada berkas. */
  evidence_file_path: string | null;
  status: AppealStatus;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
  target_type: ReportTargetType;
  target_id: string;
  report_resolution: ReportAction | null;
  report_resolved_at: Date | null;
}

export interface ResolveAppealCommand {
  appealId: string;
  status: 'accepted' | 'rejected';
  note: string;
  actorId: string;
  actorRole: string | null;
  requestId: string | null;
}

export interface OwnedTakedownRow {
  report_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  resolved_at: Date;
  appeal_deadline_at: Date;
  appeal_id: string | null;
  appeal_status: AppealStatus | null;
  appeal_created_at: Date | null;
  appeal_decided_at: Date | null;
  appeal_decision_note: string | null;
  appeal_has_evidence_file: boolean;
}

const REPORT_COLUMNS = `id, reporter_id, target_type, target_id, booking_id, reason,
  detail, evidence_url, status, resolution, resolution_note, resolved_by,
  resolved_at, sla_due_at, escalated_at, created_at, updated_at`;

const APPEAL_COLUMNS = `a.id, a.report_id, a.appellant_id, a.reason, a.evidence_url,
  a.evidence_file_path,
  a.status, a.decision_note, a.decided_by, a.decided_at, a.created_at, a.updated_at,
  r.target_type, r.target_id, r.resolution AS report_resolution,
  r.resolved_at AS report_resolved_at`;

const APPEAL_JOIN = `
  FROM content_report_appeals a
  JOIN content_reports r ON r.id = a.report_id`;

const OWNED_TAKEDOWN_WHERE = `
  r.status = 'resolved'
  AND r.resolution = 'content_removed'
  AND (
    (r.target_type = 'review' AND EXISTS (
      SELECT 1 FROM reviews v WHERE v.id = r.target_id AND v.customer_id = $1::uuid
    ))
    OR (r.target_type = 'chat_message' AND EXISTS (
      SELECT 1 FROM chat_messages m
       WHERE m.id = r.target_id AND m.sender_id = $1::uuid
    ))
    OR (r.target_type = 'vendor_media' AND EXISTS (
      SELECT 1 FROM vendor_media m
        JOIN vendors v ON v.id = m.vendor_id
       WHERE m.id = r.target_id AND v.owner_user_id = $1::uuid
    ))
  )`;

const OWNED_TAKEDOWN_SELECT = `
  SELECT r.id AS report_id,
         r.target_type::text AS target_type,
         r.target_id,
         r.reason::text AS reason,
         r.resolved_at,
         (r.resolved_at + interval '${APPEAL_WINDOW_DAYS} days') AS appeal_deadline_at,
         a.id AS appeal_id,
         a.status AS appeal_status,
         a.created_at AS appeal_created_at,
         a.decided_at AS appeal_decided_at,
         a.decision_note AS appeal_decision_note,
         (a.evidence_file_path IS NOT NULL) AS appeal_has_evidence_file
    FROM content_reports r
    LEFT JOIN content_report_appeals a ON a.report_id = r.id
   WHERE ${OWNED_TAKEDOWN_WHERE}`;

/** `null` -> undefined so the view never emits `null` where the type says optional. */
function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function uniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '23505'
  );
}

export function toReportView(row: ContentReportRow, now: Date = new Date()): ContentReportView {
  const open = row.status === 'open' || row.status === 'reviewing';
  return {
    id: row.id,
    reporter_id: row.reporter_id,
    target_type: row.target_type,
    target_id: row.target_id,
    booking_id: row.booking_id,
    reason: row.reason,
    detail: row.detail,
    evidence_url: row.evidence_url,
    status: row.status,
    resolution: row.resolution,
    resolution_note: row.resolution_note,
    resolved_by: row.resolved_by,
    resolved_at: iso(row.resolved_at),
    sla_due_at: row.sla_due_at.toISOString(),
    overdue: open && row.sla_due_at.getTime() < now.getTime(),
    escalated_at: iso(row.escalated_at),
    escalated: row.escalated_at !== null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  };
}

export function toAppealView(row: ContentReportAppealRow): ContentReportAppealView {
  return {
    id: row.id,
    report_id: row.report_id,
    appellant_id: row.appellant_id,
    reason: row.reason,
    evidence_url: row.evidence_url,
    has_evidence_file: row.evidence_file_path !== null,
    status: row.status,
    decision_note: row.decision_note,
    decided_by: row.decided_by,
    decided_at: iso(row.decided_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    target_type: row.target_type,
    target_id: row.target_id,
    report_resolution: row.report_resolution,
    report_resolved_at: iso(row.report_resolved_at)
  };
}

/**
 * Moderasi UGC.
 *
 * Semua keputusan yang mengubah konten dan penulisan audit berjalan dalam satu
 * transaksi: tidak boleh ada laporan berstatus `resolved` kalau takedown-nya
 * gagal, dan tidak boleh ada konten hilang tanpa jejak audit.
 */
export class ModerationRepository {
  constructor(private readonly pool: Pool) {}

  /* ------------------------------------------------------------ laporan */

  async createReport(
    reporterId: string,
    input: CreateReportInput,
    slaDueAt: Date
  ): Promise<ContentReportRow> {
    const result = await this.pool.query<ContentReportRow>(
      `INSERT INTO content_reports
         (reporter_id, target_type, target_id, booking_id, reason, detail, evidence_url, sla_due_at)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, $8)
       RETURNING ${REPORT_COLUMNS}`,
      [
        reporterId,
        input.target_type,
        input.target_id,
        input.booking_id ?? null,
        input.reason,
        input.detail,
        input.evidence_url ?? null,
        slaDueAt
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error('content report insert returned no row');
    return row;
  }

  async findById(id: string): Promise<ContentReportRow | null> {
    const result = await this.pool.query<ContentReportRow>(
      `SELECT ${REPORT_COLUMNS} FROM content_reports WHERE id = $1::uuid`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async listByReporter(
    reporterId: string,
    limit: number,
    offset: number
  ): Promise<ContentReportRow[]> {
    const result = await this.pool.query<ContentReportRow>(
      `SELECT ${REPORT_COLUMNS}
         FROM content_reports
        WHERE reporter_id = $1::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [reporterId, limit, offset]
    );
    return result.rows;
  }

  async countByReporter(reporterId: string): Promise<number> {
    const result = await this.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM content_reports WHERE reporter_id = $1::uuid`,
      [reporterId]
    );
    return result.rows[0]?.total ?? 0;
  }

  async listQueue(filters: AdminReportFilters): Promise<ContentReportRow[]> {
    const { where, params } = buildQueueWhere(filters);
    params.push(filters.page_size, (filters.page - 1) * filters.page_size);
    const result = await this.pool.query<ContentReportRow>(
      `SELECT ${REPORT_COLUMNS}
         FROM content_reports
         ${where}
        ORDER BY
          -- Laporan terbuka yang sudah lewat SLA selalu di atas.
          (status IN ('open','reviewing') AND sla_due_at < now()) DESC,
          sla_due_at ASC,
          created_at ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return result.rows;
  }

  async countQueue(filters: AdminReportFilters): Promise<number> {
    const { where, params } = buildQueueWhere(filters);
    const result = await this.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM content_reports ${where}`,
      params
    );
    return result.rows[0]?.total ?? 0;
  }

  /* ----------------------------------------------------- banding (FR-124) */

  async findAppealById(id: string): Promise<ContentReportAppealRow | null> {
    const result = await this.pool.query<ContentReportAppealRow>(
      `SELECT ${APPEAL_COLUMNS} ${APPEAL_JOIN} WHERE a.id = $1::uuid`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async findAppealByReport(reportId: string): Promise<ContentReportAppealRow | null> {
    const result = await this.pool.query<ContentReportAppealRow>(
      `SELECT ${APPEAL_COLUMNS} ${APPEAL_JOIN} WHERE a.report_id = $1::uuid`,
      [reportId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Stores the private object key for the evidence file and records the audit in
   * the same transaction. Only a `pending` appeal can change: a decided appeal is
   * final, so a late upload must fail instead of silently rewriting history.
   */
  async attachAppealEvidenceFile(command: {
    appealId: string;
    objectKey: string;
    previousObjectKey: string | null;
    actorId: string;
    actorRole: string | null;
    requestId: string | null;
  }): Promise<ContentReportAppealRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<{ id: string }>(
        `UPDATE content_report_appeals
            SET evidence_file_path = $2,
                updated_at = now()
          WHERE id = $1::uuid
            AND status = 'pending'
          RETURNING id`,
        [command.appealId, command.objectKey]
      );
      if (updated.rows.length === 0) {
        throw new AppError('CONFLICT', 'Banding sudah diputuskan dan tidak bisa diubah.');
      }
      await this.insertAudit(client, {
        actorId: command.actorId,
        actorRole: command.actorRole,
        action: 'content_report.appeal_evidence_uploaded',
        entityType: 'content_report_appeal',
        entityId: command.appealId,
        beforeState: { evidence_file: command.previousObjectKey !== null },
        afterState: { evidence_file: true },
        requestId: command.requestId
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    const row = await this.findAppealById(command.appealId);
    if (!row) throw new AppError('INTERNAL_ERROR', 'Banding gagal dibaca kembali');
    return row;
  }

  /**
   * Private evidence can contain identity documents, so every admin read is
   * audited even though it changes nothing. A failure here is escalated: the
   * route treats an unaudited read as not allowed.
   */
  async auditAppealEvidenceViewed(command: {
    appealId: string;
    actorId: string;
    actorRole: string | null;
    requestId: string | null;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.insertAudit(client, {
        actorId: command.actorId,
        actorRole: command.actorRole,
        action: 'content_report.appeal_evidence_viewed',
        entityType: 'content_report_appeal',
        entityId: command.appealId,
        beforeState: {},
        afterState: { viewed: true },
        requestId: command.requestId
      });
    } finally {
      client.release();
    }
  }

  /**
   * `UNIQUE (report_id)` makes a second appeal impossible. The caller maps the
   * unique violation to `CONFLICT`; a retry never creates a second row.
   */
  async createAppeal(
    appellantId: string,
    reportId: string,
    input: CreateAppealInput
  ): Promise<ContentReportAppealRow> {
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO content_report_appeals (report_id, appellant_id, reason, evidence_url)
       VALUES ($1::uuid, $2::uuid, $3, $4)
       RETURNING id`,
      [reportId, appellantId, input.reason, input.evidence_url ?? null]
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new AppError('INTERNAL_ERROR', 'Banding gagal disimpan');
    const row = await this.findAppealById(id);
    if (!row) throw new AppError('INTERNAL_ERROR', 'Banding gagal dibaca kembali');
    return row;
  }

  async listAppeals(filters: AdminAppealFilters): Promise<ContentReportAppealRow[]> {
    const params: unknown[] = [];
    let where = '';
    if (filters.status) {
      params.push(filters.status);
      where = `WHERE a.status = $${params.length}`;
    }
    params.push(filters.page_size, (filters.page - 1) * filters.page_size);
    const result = await this.pool.query<ContentReportAppealRow>(
      `SELECT ${APPEAL_COLUMNS}
       ${APPEAL_JOIN}
       ${where}
       ORDER BY
         CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,
         a.created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return result.rows;
  }

  async countAppeals(filters: AdminAppealFilters): Promise<number> {
    const params: unknown[] = [];
    let where = '';
    if (filters.status) {
      params.push(filters.status);
      where = `WHERE a.status = $${params.length}`;
    }
    const result = await this.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM content_report_appeals a ${where}`,
      params
    );
    return result.rows[0]?.total ?? 0;
  }

  /**
   * Reports that ended in `content_removed` and whose target belongs to the
   * viewer. The reporter's identity/detail is deliberately not selected: the
   * content owner only needs the category, deadline, and appeal state.
   */
  async listOwnedTakedowns(
    userId: string,
    limit: number,
    offset: number
  ): Promise<OwnedTakedownRow[]> {
    const result = await this.pool.query<OwnedTakedownRow>(
      `${OWNED_TAKEDOWN_SELECT}
       ORDER BY r.resolved_at DESC, r.id
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  }

  async countOwnedTakedowns(userId: string): Promise<number> {
    const result = await this.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
         FROM content_reports r
        WHERE ${OWNED_TAKEDOWN_WHERE}`,
      [userId]
    );
    return result.rows[0]?.total ?? 0;
  }

  /**
   * Decision is final and single-shot. Acceptance restores reviews and chat
   * messages; rejected media returns to the moderation queue because takedown
   * cleared its public columns. The original report is never rewritten.
   */
  async resolveAppeal(command: ResolveAppealCommand): Promise<ContentReportAppealRow> {
    return withTransaction(async (client) => {
      const locked = await client.query<ContentReportAppealRow>(
        `SELECT ${APPEAL_COLUMNS} ${APPEAL_JOIN} WHERE a.id = $1::uuid FOR UPDATE OF a`,
        [command.appealId]
      );
      const appeal = locked.rows[0];
      if (!appeal) throw new AppError('NOT_FOUND', 'Banding tidak ditemukan');
      if (appeal.status !== 'pending') {
        throw new AppError('CONFLICT', 'Banding ini sudah diputuskan');
      }

      const reportResult = await client.query<ContentReportRow>(
        `SELECT ${REPORT_COLUMNS} FROM content_reports WHERE id = $1::uuid FOR UPDATE`,
        [appeal.report_id]
      );
      const report = reportResult.rows[0];
      if (!report) throw new AppError('NOT_FOUND', 'Laporan tidak ditemukan');

      let effect = 'none';
      if (command.status === 'accepted') {
        try {
          effect = await this.restoreAppealedContent(client, report);
        } catch (err) {
          // A package photo can collide with a replacement uploaded after the
          // takedown. Keep the appeal pending and ask the moderator to resolve
          // the active media first instead of returning an opaque 500.
          if (uniqueViolation(err)) {
            throw new AppError(
              'CONFLICT',
              'Media aktif lain sudah ada untuk paket ini; selesaikan media tersebut lebih dulu'
            );
          }
          throw err;
        }
      }

      const updated = await client.query<{ id: string }>(
        `UPDATE content_report_appeals
            SET status = $2,
                decision_note = $3,
                decided_by = $4::uuid,
                decided_at = now(),
                updated_at = now()
          WHERE id = $1::uuid
          RETURNING id`,
        [command.appealId, command.status, command.note, command.actorId]
      );
      if (!updated.rows[0]) throw new AppError('NOT_FOUND', 'Banding tidak ditemukan');

      await this.insertAudit(client, {
        actorId: command.actorId,
        actorRole: command.actorRole,
        action: `content_report.appeal_${command.status}`,
        entityType: 'content_report_appeal',
        entityId: command.appealId,
        beforeState: { status: 'pending', report_id: appeal.report_id },
        afterState: {
          status: command.status,
          decision_note: command.note,
          effect,
          target_type: report.target_type
        },
        requestId: command.requestId
      });

      await this.insertAppellantNotification(
        client,
        appeal,
        report.target_type,
        command.status
      );

      const row = await client.query<ContentReportAppealRow>(
        `SELECT ${APPEAL_COLUMNS} ${APPEAL_JOIN} WHERE a.id = $1::uuid`,
        [command.appealId]
      );
      const resolved = row.rows[0];
      if (!resolved) throw new AppError('INTERNAL_ERROR', 'Banding gagal dibaca kembali');
      return resolved;
    });
  }

  private async restoreAppealedContent(
    client: PoolClient,
    report: ContentReportRow
  ): Promise<string> {
    switch (report.target_type) {
      case 'review': {
        const result = await client.query(
          `UPDATE reviews
              SET hidden_at = NULL, hidden_reason = NULL
            WHERE id = $1::uuid
            RETURNING id`,
          [report.target_id]
        );
        if (!result.rows[0]) throw new AppError('NOT_FOUND', 'Ulasan tidak ditemukan');
        return 'review_restored';
      }
      case 'chat_message': {
        const result = await client.query(
          `UPDATE chat_messages
              SET hidden_at = NULL, hidden_reason = NULL
            WHERE id = $1::uuid
            RETURNING id`,
          [report.target_id]
        );
        if (!result.rows[0]) throw new AppError('NOT_FOUND', 'Pesan chat tidak ditemukan');
        return 'chat_message_restored';
      }
      case 'vendor_media': {
        const result = await client.query(
          `UPDATE vendor_media
              SET status = 'pending',
                  reviewed_by = NULL,
                  reviewed_at = NULL,
                  review_note = NULL,
                  updated_at = now()
            WHERE id = $1::uuid
            RETURNING id`,
          [report.target_id]
        );
        if (!result.rows[0]) throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
        return 'media_requeued';
      }
      case 'vendor':
        throw new AppError(
          'VALIDATION_ERROR',
          'Banding tidak berlaku untuk penangguhan vendor; gunakan jalur penangguhan'
        );
    }
  }

  private async insertAppellantNotification(
    client: PoolClient,
    appeal: ContentReportAppealRow,
    targetType: ReportTargetType,
    status: 'accepted' | 'rejected'
  ): Promise<void> {
    const notice = planAppealDecisionNotification(status, targetType);
    await client.query(
      `INSERT INTO notifications (user_id, type, title, body, payload, dedupe_key)
       VALUES ($1::uuid, 'content_report_appeal_decided', $2, $3, $4::jsonb, $5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        appeal.appellant_id,
        notice.title,
        notice.body,
        JSON.stringify({
          appeal_id: appeal.id,
          report_id: appeal.report_id,
          status
        }),
        reportAppealDecisionDedupeKey(appeal.id)
      ]
    );
  }

  /* ------------------------------------------------- konteks target */

  /** Konteks target untuk otorisasi pelapor dan ringkasan panel. */
  async targetContext(
    targetType: ReportTargetType,
    targetId: string,
    viewerId: string
  ): Promise<ReportTargetContext> {
    switch (targetType) {
      case 'vendor': {
        const rows = await this.pool.query<{
          id: string;
          display_name: string | null;
          owner_user_id: string;
          verification_status: string;
        }>(
          `SELECT id, display_name, owner_user_id,
                  verification_status::text AS verification_status
             FROM vendors WHERE id = $1::uuid`,
          [targetId]
        );
        const row = rows.rows[0];
        if (!row) return miss();
        return {
          found: true,
          summary: `Vendor ${row.display_name ?? row.id} (${row.verification_status})`,
          owner_user_id: row.owner_user_id,
          hidden: row.verification_status !== 'approved',
          can_report: true
        };
      }
      case 'review': {
        const rows = await this.pool.query<{
          id: string;
          customer_id: string;
          rating: number;
          comment: string | null;
          hidden_at: Date | null;
        }>(
          `SELECT id, customer_id, rating, comment, hidden_at
             FROM reviews WHERE id = $1::uuid`,
          [targetId]
        );
        const row = rows.rows[0];
        if (!row) return miss();
        const excerpt = (row.comment ?? '').slice(0, 80);
        return {
          found: true,
          summary: `Ulasan ${row.rating}/5${excerpt ? `: ${excerpt}` : ''}`,
          owner_user_id: row.customer_id,
          hidden: row.hidden_at !== null,
          can_report: true
        };
      }
      case 'chat_message': {
        const rows = await this.pool.query<{
          id: string;
          booking_id: string;
          sender_id: string;
          body: string;
          hidden_at: Date | null;
          is_customer: boolean;
          is_vendor_owner: boolean;
          is_vendor_member: boolean;
        }>(
          `SELECT m.id, m.booking_id, m.sender_id, m.body, m.hidden_at,
                  (b.customer_id = $2::uuid) AS is_customer,
                  EXISTS (
                    SELECT 1 FROM vendors v
                     WHERE v.id = b.vendor_id AND v.owner_user_id = $2::uuid
                  ) AS is_vendor_owner,
                  EXISTS (
                    SELECT 1 FROM vendor_members vm
                     WHERE vm.vendor_id = b.vendor_id
                       AND vm.user_id = $2::uuid
                       AND vm.is_active
                  ) AS is_vendor_member
             FROM chat_messages m
             JOIN bookings b ON b.id = m.booking_id
            WHERE m.id = $1::uuid`,
          [targetId, viewerId]
        );
        const row = rows.rows[0];
        if (!row) return miss();
        const participant =
          row.is_customer || row.is_vendor_owner || row.is_vendor_member;
        return {
          found: true,
          summary: `Pesan chat: ${row.body.slice(0, 80)}`,
          owner_user_id: row.sender_id,
          hidden: row.hidden_at !== null,
          // Pesan di luar booking pelapor tidak boleh dilaporkan (anti-fishing).
          can_report: participant
        };
      }
      case 'vendor_media': {
        const rows = await this.pool.query<{
          id: string;
          kind: string;
          status: string;
          vendor_id: string;
          owner_user_id: string;
        }>(
          `SELECT m.id, m.kind::text AS kind, m.status::text AS status, m.vendor_id,
                  v.owner_user_id
             FROM vendor_media m
             JOIN vendors v ON v.id = m.vendor_id
            WHERE m.id = $1::uuid`,
          [targetId]
        );
        const row = rows.rows[0];
        if (!row) return miss();
        return {
          found: true,
          summary: `Media ${row.kind} vendor (${row.status})`,
          owner_user_id: row.owner_user_id,
          hidden: row.status !== 'approved',
          can_report: true
        };
      }
    }
  }

  async userExists(userId: string): Promise<boolean> {
    const rows = await this.pool.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1::uuid AND status <> 'deleted'`,
      [userId]
    );
    return rows.rows.length > 0;
  }

  /** Admin boleh membaca konteks laporan lintas pelapor. */
  async userDisplayName(userId: string): Promise<string | null> {
    const rows = await this.pool.query<{ name: string | null }>(
      `SELECT name FROM users WHERE id = $1::uuid`,
      [userId]
    );
    return rows.rows[0]?.name ?? null;
  }

  /* ------------------------------------------------------------ blokir */

  async blockUser(blockerId: string, input: BlockUserInput): Promise<BlockedUserRow> {
    await this.pool.query(
      `INSERT INTO user_blocks (blocker_id, blocked_id, reason)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [blockerId, input.user_id, input.reason ?? null]
    );
    const rows = await this.pool.query<BlockedUserRow>(
      `SELECT ub.blocked_id AS user_id, u.name, ub.reason, ub.created_at
         FROM user_blocks ub
         JOIN users u ON u.id = ub.blocked_id
        WHERE ub.blocker_id = $1::uuid AND ub.blocked_id = $2::uuid`,
      [blockerId, input.user_id]
    );
    const row = rows.rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'Pengguna tidak ditemukan');
    return row;
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM user_blocks WHERE blocker_id = $1::uuid AND blocked_id = $2::uuid`,
      [blockerId, blockedId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listBlocks(blockerId: string): Promise<BlockedUserRow[]> {
    const result = await this.pool.query<BlockedUserRow>(
      `SELECT ub.blocked_id AS user_id, u.name, ub.reason, ub.created_at
         FROM user_blocks ub
         JOIN users u ON u.id = ub.blocked_id
        WHERE ub.blocker_id = $1::uuid
        ORDER BY ub.created_at DESC`,
      [blockerId]
    );
    return result.rows;
  }

  /** Dipakai jalur chat untuk menyembunyikan pesan dari pihak yang diblokir. */
  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const rows = await this.pool.query<{ one: number }>(
      `SELECT 1 AS one FROM user_blocks
        WHERE blocker_id = $1::uuid AND blocked_id = $2::uuid`,
      [blockerId, blockedId]
    );
    return rows.rows.length > 0;
  }

  /* ----------------------------------------------------------- resolusi */

  /**
   * Satu transaksi: kunci laporan, terapkan aksi konten, tandai selesai,
   * tulis audit. Laporan yang sudah diputuskan ditolak (tidak boleh dobel).
   */
  async resolveReport(command: ResolveReportCommand): Promise<{
    report: ContentReportRow;
    auditBefore: Record<string, unknown>;
    auditAfter: Record<string, unknown>;
    removed: string;
  }> {
    return withTransaction(async (client) => {
      const locked = await client.query<ContentReportRow>(
        `SELECT ${REPORT_COLUMNS} FROM content_reports WHERE id = $1::uuid FOR UPDATE`,
        [command.reportId]
      );
      const report = locked.rows[0];
      if (!report) throw new AppError('NOT_FOUND', 'Laporan tidak ditemukan');
      if (report.status === 'resolved' || report.status === 'rejected') {
        throw new AppError('CONFLICT', 'Laporan ini sudah diputuskan');
      }

      const removed = await this.applyAction(client, report, command);

      const updated = await client.query<ContentReportRow>(
        `UPDATE content_reports
            SET status = 'resolved',
                resolution = $2,
                resolution_note = $3,
                resolved_by = $4::uuid,
                resolved_at = now(),
                updated_at = now()
          WHERE id = $1::uuid
          RETURNING ${REPORT_COLUMNS}`,
        [command.reportId, command.action, command.note, command.actorId]
      );
      const resolved = updated.rows[0];
      if (!resolved) throw new AppError('NOT_FOUND', 'Laporan tidak ditemukan');

      const beforeState = {
        status: report.status,
        resolution: report.resolution,
        resolution_note: report.resolution_note,
        target_type: report.target_type,
        target_id: report.target_id,
        target_hidden: false
      };
      const afterState = {
        status: resolved.status,
        resolution: resolved.resolution,
        resolution_note: resolved.resolution_note,
        target_type: resolved.target_type,
        target_id: resolved.target_id,
        target_hidden: command.action === 'content_removed'
      };

      await this.insertAudit(client, {
        actorId: command.actorId,
        actorRole: command.actorRole,
        action: `content_report.${command.action}`,
        entityType: 'content_report',
        entityId: command.reportId,
        beforeState,
        afterState,
        requestId: command.requestId
      });

      await this.insertReporterNotification(client, resolved, command.action);
      if (command.action === 'content_removed') {
        await this.insertTakedownNotification(client, resolved);
      }

      return { report: resolved, auditBefore: beforeState, auditAfter: afterState, removed };
    });
  }

  /**
   * FR-123: the reporter learns the outcome without polling. The note written
   * by the moderator stays internal; only a product-safe summary is sent.
   * `dedupe_key` keeps a transaction retry from creating a second notice.
   */
  private async insertReporterNotification(
    client: PoolClient,
    report: ContentReportRow,
    action: ReportAction
  ): Promise<void> {
    const notice = planReportResolvedNotification(action, report.target_type);
    await client.query(
      `INSERT INTO notifications (user_id, type, title, body, payload, dedupe_key)
       VALUES ($1::uuid, 'content_report_resolved', $2, $3, $4::jsonb, $5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        report.reporter_id,
        notice.title,
        notice.body,
        JSON.stringify({
          report_id: report.id,
          target_type: report.target_type,
          resolution: action
        }),
        reportResolvedDedupeKey(report.id)
      ]
    );
  }

  /**
   * The content owner learns that their content was hidden and that an appeal
   * is available. The reporter's identity and the moderator note stay out of
   * this notice.
   */
  private async insertTakedownNotification(
    client: PoolClient,
    report: ContentReportRow
  ): Promise<void> {
    const ownerId = await this.targetOwnerId(client, report);
    if (!ownerId) return;
    const notice = planTakedownNotification(report.target_type);
    await client.query(
      `INSERT INTO notifications (user_id, type, title, body, payload, dedupe_key)
       VALUES ($1::uuid, 'content_takedown', $2, $3, $4::jsonb, $5)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        ownerId,
        notice.title,
        notice.body,
        JSON.stringify({
          report_id: report.id,
          target_type: report.target_type
        }),
        reportTakedownDedupeKey(report.id)
      ]
    );
  }

  private async targetOwnerId(
    client: PoolClient,
    report: ContentReportRow
  ): Promise<string | null> {
    switch (report.target_type) {
      case 'review': {
        const rows = await client.query<{ owner: string }>(
          `SELECT customer_id AS owner FROM reviews WHERE id = $1::uuid`,
          [report.target_id]
        );
        return rows.rows[0]?.owner ?? null;
      }
      case 'chat_message': {
        const rows = await client.query<{ owner: string }>(
          `SELECT sender_id AS owner FROM chat_messages WHERE id = $1::uuid`,
          [report.target_id]
        );
        return rows.rows[0]?.owner ?? null;
      }
      case 'vendor_media': {
        const rows = await client.query<{ owner: string }>(
          `SELECT v.owner_user_id AS owner
             FROM vendor_media m
             JOIN vendors v ON v.id = m.vendor_id
            WHERE m.id = $1::uuid`,
          [report.target_id]
        );
        return rows.rows[0]?.owner ?? null;
      }
      case 'vendor':
        // Vendor takedown uses the suspension path, which has its own notice.
        return null;
    }
  }

  /** Terapkan aksi ke konten target. Mengembalikan deskripsi singkat aksi. */
  private async applyAction(
    client: PoolClient,
    report: ContentReportRow,
    command: ResolveReportCommand
  ): Promise<string> {
    const reason = `Laporan ${report.id}: ${command.note}`;

    if (command.action === 'no_action' || command.action === 'user_warned') {
      return 'none';
    }

    if (command.action === 'content_restored') {
      if (report.target_type === 'review') {
        await client.query(
          `UPDATE reviews SET hidden_at = NULL, hidden_reason = NULL WHERE id = $1::uuid`,
          [report.target_id]
        );
        return 'review_restored';
      }
      if (report.target_type === 'chat_message') {
        await client.query(
          `UPDATE chat_messages SET hidden_at = NULL, hidden_reason = NULL WHERE id = $1::uuid`,
          [report.target_id]
        );
        return 'chat_message_restored';
      }
      throw new AppError(
        'VALIDATION_ERROR',
        'Pemulihan konten hanya berlaku untuk ulasan atau pesan chat'
      );
    }

    // content_removed
    if (report.target_type === 'review') {
      await client.query(
        `UPDATE reviews
            SET hidden_at = now(), hidden_reason = $2
          WHERE id = $1::uuid AND hidden_at IS NULL`,
        [report.target_id, reason]
      );
      return 'review_hidden';
    }
    if (report.target_type === 'chat_message') {
      await client.query(
        `UPDATE chat_messages
            SET hidden_at = now(), hidden_reason = $2
          WHERE id = $1::uuid AND hidden_at IS NULL`,
        [report.target_id, reason]
      );
      return 'chat_message_hidden';
    }
    if (report.target_type === 'vendor_media') {
      await this.removeMedia(client, report.target_id, command.actorId, reason);
      return 'media_rejected';
    }
    throw new AppError(
      'VALIDATION_ERROR',
      'Untuk vendor gunakan aksi user_warned atau jalur penangguhan vendor'
    );
  }

  /**
   * Takedown media: tolak baris `vendor_media`, lalu bersihkan kolom publik
   * vendor/paket yang masih menunjuk URL itu. Media yang belum pernah
   * disetujui tidak menyentuh kolom publik sama sekali.
   */
  private async removeMedia(
    client: PoolClient,
    mediaId: string,
    actorId: string,
    reason: string
  ): Promise<void> {
    const media = await client.query<{ id: string; vendor_id: string }>(
      `SELECT id, vendor_id FROM vendor_media WHERE id = $1::uuid FOR UPDATE`,
      [mediaId]
    );
    const row = media.rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'Media tidak ditemukan');

    await client.query(
      `UPDATE vendor_media
          SET status = 'rejected',
              reviewed_by = $2::uuid,
              review_note = $3,
              reviewed_at = now(),
              updated_at = now()
        WHERE id = $1::uuid`,
      [mediaId, actorId, reason]
    );

    await client.query(
      `UPDATE vendors v
          SET avatar_url = CASE WHEN m.kind = 'avatar' AND v.avatar_url = m.url
                                THEN NULL ELSE v.avatar_url END,
              banner_url = CASE WHEN m.kind = 'banner' AND v.banner_url = m.url
                                THEN NULL ELSE v.banner_url END,
              video_url  = CASE WHEN m.kind = 'video'  AND v.video_url  = m.url
                                THEN NULL ELSE v.video_url END,
              photo_urls = CASE WHEN m.kind = 'gallery'
                                THEN array_remove(v.photo_urls, m.url)
                                ELSE v.photo_urls END,
              updated_at = now()
         FROM vendor_media m
        WHERE m.id = $1::uuid AND v.id = m.vendor_id`,
      [mediaId]
    );

    await client.query(
      `UPDATE packages p
          SET photo_url = NULL
         FROM vendor_media m
        WHERE m.id = $1::uuid
          AND m.kind = 'package_photo'
          AND p.id = m.package_id
          AND p.photo_url = m.url`,
      [mediaId]
    );
  }

  private async insertAudit(client: PoolClient, entry: AuditEntry): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id,
          before_state, after_state, request_id)
       VALUES ($1::uuid, $2::user_role, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        entry.actorId,
        entry.actorRole,
        entry.action,
        entry.entityType,
        entry.entityId,
        JSON.stringify(entry.beforeState),
        JSON.stringify(entry.afterState),
        entry.requestId
      ]
    );
  }
}

function miss(): ReportTargetContext {
  return {
    found: false,
    summary: null,
    owner_user_id: null,
    hidden: false,
    can_report: false
  };
}

function buildQueueWhere(filters: AdminReportFilters): {
  where: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status === 'pending') {
    clauses.push(`status IN ('open','reviewing')`);
  } else if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filters.reason) {
    params.push(filters.reason);
    clauses.push(`reason = $${params.length}`);
  }
  if (filters.target_type) {
    params.push(filters.target_type);
    clauses.push(`target_type = $${params.length}`);
  }
  if (filters.overdue) {
    clauses.push(`status IN ('open','reviewing') AND sla_due_at < now()`);
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}
