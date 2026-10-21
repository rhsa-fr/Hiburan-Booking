/**
 * Calendar persistence (TECH-DESIGN §5.8, §8.1, §5.11).
 *
 * `booking_slots` is the authoritative reservation record; its GiST exclusion
 * constraints (23P01) are the final arbiter. `calendar_slots` is the projection
 * read by search. Both are written inside the caller's transaction.
 */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { query } from '../../../../apps/api/src/core/db';
import { AppError } from '../../../../apps/api/src/core/errors';
import type { CalendarSession, CalendarSlotStatus } from './availability';

export interface ReserveSlotInput {
  bookingId: string;
  date: string;
  session: CalendarSession;
  startTime?: string | null;
  endTime?: string | null;
}

export interface ReserveOptions {
  /** true at ACCEPT (L-03/L-07); false for a `requested` booking (L-01). */
  blocking: boolean;
  /** Required when blocking: mirrors bookings.payment_deadline (D-18). */
  holdExpiresAt?: Date | null;
}

export interface BlockDateInput {
  date: string;
  session: CalendarSession;
  note?: string | null;
}

export interface BlockDatesOptions {
  source?: 'vendor' | 'admin';
  updatedBy?: string | null;
}

export interface BlockDatesResult {
  blocked: number;
  skipped: number;
}

export type CalendarSlotRow = {
  date: string;
  session: CalendarSession;
  status: CalendarSlotStatus;
  hold_expires_at: Date | null;
};

export type CalendarAvailabilityRow = {
  calendar_updated_at: Date | null;
};

function isPgError(
  err: unknown
): err is { code: string; constraint?: string; detail?: string; message?: string } {
  return typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string';
}

function unavailable(slot: ReserveSlotInput, cause?: string): AppError {
  return new AppError(
    'SLOT_UNAVAILABLE',
    `Slot ${slot.date} sesi ${slot.session} sudah dipesan vendor lain.`,
    { date: slot.date, session: slot.session, cause }
  );
}

function blockedByVendor(slot: ReserveSlotInput, cause?: string): AppError {
  return new AppError(
    'SLOT_UNAVAILABLE',
    `Slot ${slot.date} sesi ${slot.session} diblokir vendor.`,
    { date: slot.date, session: slot.session, cause }
  );
}

/**
 * Messages of the trigger `assert_booking_slot_calendar_available`
 * (db/migrations/001_core.sql). It raises 23514 — not 23P01 — when the slot is
 * blocked by the vendor or already held by another booking.
 */
const SLOT_BLOCKED_MESSAGE = 'diblokir vendor';
const SLOT_HELD_MESSAGE = 'sudah dipegang booking lain';

/** 23P01 = exclusion_violation, raised by both booking_slots constraints. */
function mapReservationError(err: unknown, slot: ReserveSlotInput): unknown {
  if (isPgError(err)) {
    if (err.code === '23P01') {
      return unavailable(slot, err.constraint ?? err.code);
    }
    if (err.code === '23514') {
      const message = typeof err.message === 'string' ? err.message : '';
      if (message.includes(SLOT_BLOCKED_MESSAGE)) {
        return blockedByVendor(slot, err.constraint ?? 'booking_slot_calendar_guard');
      }
      if (message.includes(SLOT_HELD_MESSAGE)) {
        return unavailable(slot, err.constraint ?? 'booking_slot_calendar_guard');
      }
    }
  }
  return err;
}

@Injectable()
export class CalendarRepository {
  /**
   * Inserts booking_slots and, when blocking, flips calendar_slots to `held`
   * with the same hold_expires_at as the booking payment deadline.
   */
  async reserve(
    client: PoolClient,
    vendorId: string,
    slots: readonly ReserveSlotInput[],
    options: ReserveOptions
  ): Promise<void> {
    if (slots.length === 0) return;
    if (options.blocking && !options.holdExpiresAt) {
      throw new AppError('VALIDATION_ERROR', 'hold_expires_at wajib diisi saat memblokir slot');
    }

    // Deterministic order prevents two concurrent multi-slot accepts from
    // deadlocking on each other (TECH-DESIGN §8.1).
    const ordered = [...slots].sort(
      (a, b) => a.date.localeCompare(b.date) || a.session.localeCompare(b.session)
    );

    for (const slot of ordered) {
      try {
        await client.query(
          `INSERT INTO booking_slots
             (booking_id, vendor_id, date, session, start_time, end_time, is_blocking)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (booking_id, date, session) DO UPDATE
             SET is_blocking = EXCLUDED.is_blocking,
                 start_time = COALESCE(EXCLUDED.start_time, booking_slots.start_time),
                 end_time = COALESCE(EXCLUDED.end_time, booking_slots.end_time),
                 updated_at = now()`,
          [
            slot.bookingId,
            vendorId,
            slot.date,
            slot.session,
            slot.startTime ?? null,
            slot.endTime ?? null,
            options.blocking
          ]
        );

        if (!options.blocking) continue;

        const result = await client.query(
          `INSERT INTO calendar_slots
             (vendor_id, date, session, status, source, booking_id, hold_expires_at)
           VALUES ($1, $2, $3, 'held', 'booking', $4, $5)
           ON CONFLICT (vendor_id, date, session) DO UPDATE
             SET status = 'held',
                 source = EXCLUDED.source,
                 booking_id = EXCLUDED.booking_id,
                 hold_expires_at = EXCLUDED.hold_expires_at,
                 updated_at = now()
             WHERE calendar_slots.status = 'available'
                OR (calendar_slots.status = 'held'
                    AND (calendar_slots.hold_expires_at IS NULL
                         OR calendar_slots.hold_expires_at <= now()))
                OR calendar_slots.booking_id = EXCLUDED.booking_id
           RETURNING id`,
          [vendorId, slot.date, slot.session, slot.bookingId, options.holdExpiresAt]
        );

        if ((result.rowCount ?? 0) === 0) {
          throw unavailable(slot, 'calendar_slot_taken');
        }
      } catch (err) {
        throw mapReservationError(err, slot);
      }
    }
  }

  /** L-11: a paid DP turns the held slots into booked ones. */
  async confirmBooked(
    client: PoolClient,
    vendorId: string,
    bookingId: string
  ): Promise<number> {
    const result = await client.query(
      `UPDATE calendar_slots
          SET status = 'booked',
              hold_expires_at = NULL,
              updated_at = now()
        WHERE vendor_id = $1
          AND booking_id = $2
          AND status IN ('held', 'booked')`,
      [vendorId, bookingId]
    );

    await client.query(
      `UPDATE booking_slots
          SET is_blocking = true,
              updated_at = now()
        WHERE booking_id = $1
          AND vendor_id = $2
          AND is_blocking = false`,
      [bookingId, vendorId]
    );

    return result.rowCount ?? 0;
  }

  /**
   * Idempotent: releasing a booking that no longer owns a slot is a no-op.
   * Used by cancel/expire paths, never by no_show (the slot stays booked as
   * evidence).
   */
  async releaseHold(client: PoolClient, vendorId: string, bookingId: string): Promise<number> {
    const released = await client.query(
      `UPDATE calendar_slots
          SET status = 'available',
              booking_id = NULL,
              hold_expires_at = NULL,
              source = 'booking',
              updated_at = now()
        WHERE vendor_id = $1
          AND booking_id = $2
          AND status IN ('held', 'booked')`,
      [vendorId, bookingId]
    );

    await client.query(
      `UPDATE booking_slots
          SET is_blocking = false,
              updated_at = now()
        WHERE booking_id = $1
          AND vendor_id = $2
          AND is_blocking = true`,
      [bookingId, vendorId]
    );

    return released.rowCount ?? 0;
  }

  /**
   * Blocks explicit dates for a vendor. Never overwrites `held`/`booked` rows;
   * those are returned as `skipped` so the caller can report the conflict.
   */
  async blockDates(
    client: PoolClient,
    vendorId: string,
    entries: readonly BlockDateInput[],
    options: BlockDatesOptions = {}
  ): Promise<BlockDatesResult> {
    const source = options.source ?? 'vendor';
    let blocked = 0;

    for (const entry of entries) {
      const result = await client.query(
        `INSERT INTO calendar_slots
           (vendor_id, date, session, status, source, note, updated_by)
         VALUES ($1, $2, $3, 'blocked', $4, $5, $6)
         ON CONFLICT (vendor_id, date, session) DO UPDATE
           SET status = 'blocked',
               source = EXCLUDED.source,
               note = EXCLUDED.note,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()
           WHERE calendar_slots.status = 'available'
         RETURNING id`,
        [vendorId, entry.date, entry.session, source, entry.note ?? null, options.updatedBy ?? null]
      );
      blocked += result.rowCount ?? 0;
    }

    return { blocked, skipped: entries.length - blocked };
  }

  async listAvailability(
    vendorId: string,
    from: string,
    to: string
  ): Promise<{ rows: CalendarSlotRow[]; calendarUpdatedAt: Date | null }> {
    const vendor = await query<CalendarAvailabilityRow>(
      `SELECT calendar_updated_at FROM vendors WHERE id = $1`,
      [vendorId]
    );
    if (vendor.length === 0) {
      throw new AppError('NOT_FOUND', `Vendor ${vendorId} tidak ditemukan`);
    }

    const rows = await query<CalendarSlotRow>(
      `SELECT date::text AS date,
              session,
              status,
              hold_expires_at
         FROM calendar_slots
        WHERE vendor_id = $1
          AND date BETWEEN $2 AND $3
        ORDER BY date, session`,
      [vendorId, from, to]
    );

    return {
      rows,
      calendarUpdatedAt: vendor[0]?.calendar_updated_at ?? null
    };
  }
}
