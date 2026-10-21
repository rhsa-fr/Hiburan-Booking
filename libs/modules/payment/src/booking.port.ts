/**
 * Outbound port to the booking domain (TECH-DESIGN §2.2).
 *
 * The booking module owns every booking status transition. The payment module
 * never writes `bookings`: it only states what happened ("the DP of this
 * amount was paid at this instant") and lets the booking module apply the
 * L-11 transition together with its status history rows, the outbox event, the
 * `scheduled_*`/`dispute_window_ends_at` derivation and the calendar
 * `held -> booked` flip.
 *
 * Frozen cross-module contract (T8-DELTA):
 *   `applyDpPaid({ bookingId, amountIdr, now }): Promise<void>`
 *
 * The booking module accepts the caller's `PoolClient` as an optional second
 * argument. The payment module always passes it, so the booking transition
 * runs inside the very transaction that posts the journal entry and marks the
 * payment paid (§6.1 rule 7): the DP money path is atomic.
 */
import type { PoolClient } from 'pg';
import type { BookingService } from '@tarlink/modules/booking';
import { AppError } from '@tarlink/core/errors';

export interface DpPaidInput {
  readonly bookingId: string;
  readonly amountIdr: bigint;
  readonly now: Date;
}

/** Settlement input; `allowAfterCompletion` is only used by the manual path. */
export interface FullyPaidInput extends DpPaidInput {
  readonly allowAfterCompletion?: boolean;
}

export interface BookingPaymentPort {
  /** L-11: `accepted/unpaid` -> `confirmed/dp_paid`. */
  applyDpPaid(input: DpPaidInput, client?: PoolClient): Promise<void>;
  /** Settlement: `dp_paid` -> `fully_paid`. Owned by the booking module too. */
  applyFullyPaid(input: FullyPaidInput, client?: PoolClient): Promise<void>;
}

type ApplyTransition = (input: FullyPaidInput, client?: PoolClient) => Promise<void>;

/**
 * Reads an optional transition method off an unknown candidate. Used for the
 * settlement transition, which the booking module has not published yet: the
 * payment module fails loudly instead of writing a booking row itself.
 */
function readOptionalTransition(candidate: unknown, method: string): ApplyTransition | undefined {
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const fn = (candidate as Record<string, unknown>)[method];
  if (typeof fn !== 'function') return undefined;
  // Bound to the instance: the booking service uses `this` internally.
  return (fn as ApplyTransition).bind(candidate);
}

/** Adapts the booking module's service to the payment module's port. */
export function asBookingPaymentPort(booking: BookingService): BookingPaymentPort {
  const applyFullyPaid = readOptionalTransition(booking, 'applyFullyPaid');
  return {
    applyDpPaid: (input: DpPaidInput, client?: PoolClient): Promise<void> =>
      booking.applyDpPaid(input, client),
    applyFullyPaid: applyFullyPaid
      ? (input: FullyPaidInput, client?: PoolClient): Promise<void> => applyFullyPaid(input, client)
      : async (): Promise<void> => {
          throw new AppError(
            'CONFLICT',
            'the settlement transition is owned by the booking module (BookingService.applyFullyPaid is not published)'
          );
        }
  };
}
