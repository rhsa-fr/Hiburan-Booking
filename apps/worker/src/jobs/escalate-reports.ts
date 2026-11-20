import {
  planReportSlaNotification,
  reportSlaDedupeKey
} from '@tarlink/modules/notifications';
import { query, withTransaction } from '../db';
import { errorMessage, logLine } from '../log';
import type { JobStats } from './runner';

/**
 * FR-123/FR-124: escalate open content reports that passed their SLA.
 *
 * Escalation is visibility, not a decision: the report keeps its status, the
 * moderator still decides. What changes is that `escalated_at` is stamped once
 * and every active admin support/super receives one in-app notification, so a
 * breach cannot sit silently in the queue.
 *
 * Guarantees:
 * 1. `UPDATE ... WHERE escalated_at IS NULL` makes a retried tick idempotent.
 * 2. Notifications are deduped per (report, admin); a second tick never repeats.
 * 3. One failing report does not stop the rest; `failed` is reported per report.
 * 4. No content is hidden and no money table is touched.
 */

interface OverdueReportRow {
  id: string;
  reporter_id: string;
  target_type: string;
  sla_due_at: Date;
}

interface AdminRow {
  user_id: string;
}

const OVERDUE_SQL = `
SELECT id, reporter_id, target_type, sla_due_at
  FROM content_reports
 WHERE status IN ('open', 'reviewing')
   AND sla_due_at < now()
   AND escalated_at IS NULL
 ORDER BY sla_due_at, id
 LIMIT $1
`;

const ADMIN_RECIPIENTS_SQL = `
SELECT DISTINCT ur.user_id
  FROM user_roles ur
  JOIN users u ON u.id = ur.user_id
 WHERE ur.role IN ('admin_support', 'admin_super')
   AND ur.revoked_at IS NULL
   AND u.status = 'active'
 ORDER BY ur.user_id
`;

const ESCALATE_SQL = `
UPDATE content_reports
   SET escalated_at = now(),
       updated_at = now()
 WHERE id = $1::uuid
   AND escalated_at IS NULL
RETURNING id
`;

const NOTIFY_SQL = `
INSERT INTO notifications (user_id, type, title, body, payload, dedupe_key)
VALUES ($1::uuid, 'content_report_sla_breach', $2, $3, $4::jsonb, $5)
ON CONFLICT (dedupe_key) DO NOTHING
`;

const AUDIT_SQL = `
INSERT INTO audit_logs
  (actor_id, actor_role, action, entity_type, entity_id,
   before_state, after_state, request_id)
VALUES (NULL, NULL, 'content_report.sla_escalated', 'content_report', $1,
        $2::jsonb, $3::jsonb, NULL)
`;

export async function runEscalateReports(batch: number): Promise<JobStats> {
  const stats: JobStats = { processed: 0, skipped: 0, failed: 0 };

  const overdue = await query<OverdueReportRow>(OVERDUE_SQL, [batch]);
  if (overdue.length === 0) {
    stats.skipped += 1;
    return stats;
  }

  const admins = await query<AdminRow>(ADMIN_RECIPIENTS_SQL);

  for (const report of overdue) {
    try {
      const changed = await withTransaction(async (client) => {
        const updated = await client.query<{ id: string }>(ESCALATE_SQL, [report.id]);
        if (updated.rows.length === 0) return false;

        const notice = planReportSlaNotification({
          reportId: report.id,
          targetType: report.target_type,
          dueAt: report.sla_due_at.toISOString()
        });
        for (const admin of admins) {
          await client.query(NOTIFY_SQL, [
            admin.user_id,
            notice.title,
            notice.body,
            JSON.stringify({ report_id: report.id, target_type: report.target_type }),
            reportSlaDedupeKey(report.id, admin.user_id)
          ]);
        }

        await client.query(AUDIT_SQL, [
          report.id,
          JSON.stringify({ escalated_at: null }),
          JSON.stringify({
            escalated_at: new Date().toISOString(),
            sla_due_at: report.sla_due_at.toISOString(),
            target_type: report.target_type,
            notified_admins: admins.length
          })
        ]);
        return true;
      });

      if (changed) {
        stats.processed += 1;
        logLine(
          `escalate_reports report=${report.id} target=${report.target_type} admins=${admins.length}`
        );
      } else {
        stats.skipped += 1;
      }
    } catch (err) {
      stats.failed += 1;
      logLine(`escalate_reports_failed report=${report.id} error=${errorMessage(err)}`);
    }
  }

  return stats;
}
