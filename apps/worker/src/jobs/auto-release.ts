import { buildEntry, postEntry } from '../../../../libs/modules/ledger/src/index';
import { enqueue } from '../../../../libs/platform/outbox/src/index';
import { query, withTransaction } from '../db';
import { errorMessage, logLine } from '../log';
import {
  autoReleaseSkipReason,
  clawbackDeadlineFor,
  OPEN_DISPUTE_SQL
} from './decisions';
import type { JobStats } from './runner';

interface CandidateRow {
  id: string;
}

interface ReleaseRow {
  id: string;
  code: string;
  vendor_id: string;
  lifecycle_status: string;
  payment_status: string;
  settlement_status: string;
  dispute_window_ends_at: Date | null;
  price_package_idr: string;
  service_fee_idr: string;
  total_customer_idr: string;
  vendor_entitlement_idr: string;
  commission_bp: number;
  commission_threshold_idr: string;
  commission_bp_tier2: number;
  commission_min_idr: string;
  commission_cap_idr: string;
  row_version: number;
}

const SELECT_DUE_SQL = `
SELECT b.id
  FROM bookings b
 WHERE b.settlement_status = 'held'
   AND b.lifecycle_status = 'completed'
   AND b.dispute_window_ends_at IS NOT NULL
   AND b.dispute_window_ends_at <= now()
   AND NOT EXISTS (
         SELECT 1 FROM disputes d
          WHERE d.booking_id = b.id
            AND d.status IN (${OPEN_DISPUTE_SQL}))
   AND NOT EXISTS (
         SELECT 1 FROM journal_entries je
          WHERE je.booking_id = b.id
            AND je.event_type = 'release')
 ORDER BY b.dispute_window_ends_at, b.id
 LIMIT $1
`;

const SELECT_FOR_UPDATE_SQL = `
SELECT id, code, vendor_id, lifecycle_status, payment_status, settlement_status,
       dispute_window_ends_at, price_package_idr, service_fee_idr,
       total_customer_idr, vendor_entitlement_idr,
       commission_bp, commission_threshold_idr, commission_bp_tier2,
       commission_min_idr, commission_cap_idr, row_version
  FROM bookings
 WHERE id = $1
 FOR UPDATE
`;

const UPDATE_SQL = `
UPDATE bookings
   SET settlement_status = 'released',
       released_at = $2::timestamptz,
       row_version = row_version + 1
 WHERE id = $1
   AND settlement_status = 'held'
   AND lifecycle_status = 'completed'
 RETURNING id
`;

const INSERT_HISTORY_SQL = `
INSERT INTO booking_status_history
  (booking_id, axis, from_state, to_state, event, actor_id, actor_role, note)
VALUES ($1, 'settlement', 'held', 'released', 'settlement.release_auto', NULL, NULL, $2)
`;

/**
 * S-02 / FR-119: release escrow to the vendor once the pre-release dispute
 * window (`scheduled_end_at + 7 days`) has closed without an open dispute.
 *
 * This moves money, so it is guarded twice:
 * 1. the row is re-read `FOR UPDATE` and the pure decision re-run inside the
 *    transaction (`autoReleaseSkipReason`), including a fresh open-dispute and
 *    existing-release-entry check;
 * 2. the ledger is posted through `buildEntry`/`postEntry`, whose
 *    `source_event_key` (`booking:<id>:released`) is UNIQUE — a duplicate is a
 *    no-op, never a second entry.
 * The status update happens in the same transaction, so a booking can never be
 * `released` without its journal entry, or the reverse.
 */
export async function runAutoRelease(batch: number): Promise<JobStats> {
  const rows = await query<CandidateRow>(SELECT_DUE_SQL, [batch]);
  const stats: JobStats = { processed: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    try {
      const outcome = await withTransaction(async (client) => {
        const locked = await client.query<ReleaseRow>(SELECT_FOR_UPDATE_SQL, [row.id]);
        const booking = locked.rows[0];
        if (!booking) return { moved: false, reason: 'not_found' } as const;

        const disputes = await client.query(
          `SELECT 1 FROM disputes WHERE booking_id = $1 AND status IN (${OPEN_DISPUTE_SQL}) LIMIT 1`,
          [booking.id]
        );
        const releaseEntry = await client.query(
          `SELECT 1 FROM journal_entries WHERE booking_id = $1 AND event_type = 'release' LIMIT 1`,
          [booking.id]
        );

        const now = new Date();
        const vendorEntitlementIdr = BigInt(booking.vendor_entitlement_idr);
        const reason = autoReleaseSkipReason(
          {
            lifecycle_status: booking.lifecycle_status,
            payment_status: booking.payment_status,
            settlement_status: booking.settlement_status,
            dispute_window_ends_at: booking.dispute_window_ends_at,
            vendor_entitlement_idr: vendorEntitlementIdr
          },
          now,
          disputes.rows.length > 0,
          releaseEntry.rows.length > 0
        );
        if (reason) return { moved: false, reason } as const;

        const entry = buildEntry('release', {
          bookingId: booking.id,
          vendorId: booking.vendor_id,
          // Funds held in escrow = what the customer actually paid in.
          escrowIdr: BigInt(booking.total_customer_idr),
          // D-17: commission base is the package price only.
          commissionBaseIdr: BigInt(booking.price_package_idr),
          serviceFeeIdr: BigInt(booking.service_fee_idr),
          // Per-booking commission snapshot, same as the manual release path
          // (libs/modules/admin eligibility): never the hard-coded defaults.
          commissionConfig: {
            bp1: booking.commission_bp,
            threshold: BigInt(booking.commission_threshold_idr),
            bp2: booking.commission_bp_tier2,
            min: BigInt(booking.commission_min_idr),
            cap: BigInt(booking.commission_cap_idr)
          },
          occurredAt: now,
          sourceEventKey: `booking:${booking.id}:released`,
          memo: `Auto release ${booking.code} after dispute window`
        });
        const posted = await postEntry(client, entry);

        const updated = await client.query(UPDATE_SQL, [booking.id, now.toISOString()]);
        if (updated.rows.length === 0) {
          throw new Error(`settlement release guard rejected booking ${booking.id}`);
        }

        await client.query(INSERT_HISTORY_SQL, [
          booking.id,
          'dispute window closed with no open dispute (worker)'
        ]);

        await enqueue(
          client,
          'booking.released',
          {
            booking_id: booking.id,
            code: booking.code,
            vendor_id: booking.vendor_id,
            settlement_status: 'released',
            released_at: now.toISOString(),
            vendor_entitlement_idr: vendorEntitlementIdr.toString(),
            journal_entry_id: posted.id,
            clawback_deadline: clawbackDeadlineFor(now).toISOString()
          },
          {
            aggregateType: 'booking',
            aggregateId: booking.id,
            aggregateVersion: booking.row_version + 1,
            dedupeKey: `booking.released:${booking.id}`
          }
        );

        return { moved: true, reason: null } as const;
      });

      if (outcome.moved) {
        stats.processed += 1;
      } else {
        stats.skipped += 1;
        logLine(`job=auto_release skipped=1 booking=${row.id} skipped_reason=${outcome.reason}`);
      }
    } catch (err) {
      stats.failed += 1;
      logLine(`job=auto_release failed=1 booking=${row.id} error=${errorMessage(err)}`);
    }
  }

  return stats;
}
