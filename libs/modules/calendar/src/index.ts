/**
 * Public surface of the calendar module. Everything else is internal.
 */
export { CalendarModule } from './calendar.module';
export { CalendarService } from './calendar.service';
export type { AvailabilityDay, AvailabilityResult } from './calendar.service';
export { CalendarRepository } from './calendar.repository';
export type {
  BlockDateInput,
  BlockDatesOptions,
  BlockDatesResult,
  CalendarSlotRow,
  ReserveOptions,
  ReserveSlotInput
} from './calendar.repository';
export {
  BOOKABLE_CALENDAR_SESSIONS,
  CALENDAR_SESSIONS,
  CALENDAR_SLOT_STATUSES,
  STALE_THRESHOLD_DAYS,
  applyStaleness,
  availabilityStateFor,
  compareSession,
  enumerateDates,
  isCalendarStale,
  isIsoDate
} from './availability';
export type {
  AvailabilityState,
  BookableCalendarSession,
  CalendarSession,
  CalendarSlotProjection,
  CalendarSlotStatus
} from './availability';
