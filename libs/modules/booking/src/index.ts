/**
 * Public surface of the booking module. Everything else is internal.
 */
export { BookingModule } from './booking.module';
export { BookingService, auditActorToken } from './booking.service';
export type {
  AuditActorToken,
  BookingPricingView,
  BookingSlotView,
  BookingStatePort,
  BookingView,
  ListBookingsResult
} from './booking.service';
export { BookingRepository, bookingStateFromRow } from './booking.repository';
export type {
  AutoCompletableRow,
  BookingRow,
  BookingSlotRow,
  BookingStatusPatch,
  ListForVendorOptions,
  NewBookingAddon,
  NewBookingRecord,
  OutboxInput,
  StatusHistoryInput
} from './booking.repository';
export { BookingController } from './booking.controller';
export { AvailabilityController } from './availability.controller';
export { CurrentUser } from './current-user.decorator';
export type { AuthUser } from './current-user.decorator';
export {
  deriveScheduleWindow,
  jakartaLocalToUtc,
  normalizeLocalTime,
  slotWindow,
  JAKARTA_UTC_OFFSET,
  SESSION_DEFAULT_WINDOW
} from './schedule';
export type {
  BookingSlotTimeRow,
  ScheduleWindow,
  SlotWindow
} from './schedule';
export {
  currentRequestId,
  RequestIdInterceptor,
  runWithRequestScope
} from './request-context';
export type { RequestScope } from './request-context';
export {
  acceptBookingSchema,
  availabilityQuerySchema,
  bookingAddonSchema,
  bookingEventSchema,
  bookingSlotSchema,
  cancelBookingSchema,
  createBookingSchema,
  declineBookingSchema,
  parseInput
} from './dto';
export type {
  AcceptBookingDto,
  AvailabilityQueryDto,
  CancelBookingDto,
  CreateBookingDto,
  DeclineBookingDto
} from './dto';
export {
  assertLegalCombination,
  applyTransition,
  canTransition,
  initialBookingState,
  isLegalCombination,
  isTerminalLifecycle,
  legalSettlementsFor,
  transitionsFor,
  LIFECYCLE_STATUSES,
  PAYMENT_STATUSES,
  SETTLEMENT_STATUSES,
  TRANSITIONS
} from './state-machine';
export type {
  ActorRole,
  BookingAction,
  BookingState,
  DerivedFields,
  GuardId,
  LifecycleStatus,
  PaymentStatus,
  SettlementStatus,
  StatusAxis,
  StatusChange,
  TransitionContext,
  TransitionDef,
  TransitionResult
} from './state-machine';
