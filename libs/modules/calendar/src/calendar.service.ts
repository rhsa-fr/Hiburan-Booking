import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { withTransaction } from '../../../../apps/api/src/core/db';
import {
  BOOKABLE_CALENDAR_SESSIONS,
  applyStaleness,
  availabilityStateFor,
  compareSession,
  enumerateDates,
  isCalendarStale,
  STALE_THRESHOLD_DAYS,
  type AvailabilityState,
  type CalendarSession
} from './availability';
import {
  CalendarRepository,
  type BlockDateInput,
  type BlockDatesOptions,
  type BlockDatesResult,
  type ReserveOptions,
  type ReserveSlotInput
} from './calendar.repository';

export interface AvailabilityDay {
  date: string;
  session: CalendarSession;
  availability_state: AvailabilityState;
  hold_expires_at: string | null;
}

export interface AvailabilityResult {
  vendor_id: string;
  from: string;
  to: string;
  calendar_updated_at: string | null;
  stale: boolean;
  stale_threshold_days: number;
  days: AvailabilityDay[];
}

@Injectable()
export class CalendarService {
  constructor(private readonly repo: CalendarRepository) {}

  /**
   * Transaction-scoped methods: the booking service owns the transaction so a
   * booking status write, its slot reservation and its outbox row commit
   * together (§8.1).
   */
  reserve(
    client: PoolClient,
    vendorId: string,
    slots: readonly ReserveSlotInput[],
    options: ReserveOptions
  ): Promise<void> {
    return this.repo.reserve(client, vendorId, slots, options);
  }

  confirmBooked(client: PoolClient, vendorId: string, bookingId: string): Promise<number> {
    return this.repo.confirmBooked(client, vendorId, bookingId);
  }

  releaseHold(client: PoolClient, vendorId: string, bookingId: string): Promise<number> {
    return this.repo.releaseHold(client, vendorId, bookingId);
  }

  blockDates(
    vendorId: string,
    entries: readonly BlockDateInput[],
    options: BlockDatesOptions = {}
  ): Promise<BlockDatesResult> {
    return withTransaction((client) => this.repo.blockDates(client, vendorId, entries, options));
  }

  /** D-10 projection: no row is `unconfirmed`, never `available`. */
  async listAvailability(
    vendorId: string,
    from: string,
    to: string,
    now: Date = new Date()
  ): Promise<AvailabilityResult> {
    const { rows, calendarUpdatedAt } = await this.repo.listAvailability(vendorId, from, to);
    const stale = isCalendarStale(calendarUpdatedAt, now);
    const keyed = new Map(rows.map((row) => [`${row.date}|${row.session}`, row]));

    const days: AvailabilityDay[] = [];
    const push = (date: string, session: CalendarSession): void => {
      const row = keyed.get(`${date}|${session}`) ?? null;
      days.push({
        date,
        session,
        availability_state: applyStaleness(availabilityStateFor(row, now), stale),
        hold_expires_at: row?.hold_expires_at ? row.hold_expires_at.toISOString() : null
      });
    };

    for (const date of enumerateDates(from, to)) {
      for (const session of BOOKABLE_CALENDAR_SESSIONS) {
        push(date, session);
      }
    }

    // `full` is only meaningful when the vendor wrote it explicitly.
    for (const row of rows) {
      if (row.session === 'full') push(row.date, 'full');
    }

    days.sort(
      (a, b) => a.date.localeCompare(b.date) || compareSession(a.session, b.session)
    );

    return {
      vendor_id: vendorId,
      from,
      to,
      calendar_updated_at: calendarUpdatedAt ? calendarUpdatedAt.toISOString() : null,
      stale,
      stale_threshold_days: STALE_THRESHOLD_DAYS,
      days
    };
  }
}
