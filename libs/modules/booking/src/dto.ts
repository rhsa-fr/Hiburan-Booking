import { z } from 'zod';
import { AppError } from '../../../../apps/api/src/core/errors';
import { isIsoDate } from '../../calendar/src/availability';

const isoDate = z
  .string()
  .refine((value) => isIsoDate(value), { message: 'Tanggal harus berformat YYYY-MM-DD' });

const uuid = z.string().uuid();

export const bookingEventSchema = z
  .object({
    title: z.string().min(1).max(150),
    event_type: z.string().max(50).optional(),
    region_code: z.string().min(1).max(10),
    venue_name: z.string().max(150).optional(),
    venue_address: z.string().min(1).max(1000),
    venue_location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180)
      })
      .optional(),
    start_date: isoDate,
    end_date: isoDate,
    guest_estimate: z.number().int().min(0).max(100_000).optional(),
    notes: z.string().max(2000).optional()
  })
  .refine((event) => event.end_date >= event.start_date, {
    message: 'end_date harus >= start_date',
    path: ['end_date']
  })
  .refine(
    (event) =>
      (new Date(`${event.end_date}T00:00:00.000Z`).getTime() -
        new Date(`${event.start_date}T00:00:00.000Z`).getTime()) /
        (24 * 60 * 60 * 1000) <=
      30,
    { message: 'Rentang acara maksimum 31 hari', path: ['end_date'] }
  );

export const bookingSlotSchema = z.object({
  date: isoDate,
  session: z.enum(['day', 'night', 'full'])
});

export const bookingAddonSchema = z.object({
  addon_id: uuid,
  qty: z.number().int().min(1).max(10)
});

export const createBookingSchema = z.object({
  vendor_id: uuid,
  package_id: uuid,
  event: bookingEventSchema,
  slots: z.array(bookingSlotSchema).min(1).max(31),
  addons: z.array(bookingAddonSchema).max(20).optional().default([]),
  notes: z.string().max(2000).optional(),
  policy_version_id: uuid,
  client_generated_id: uuid.optional()
});

export const acceptBookingSchema = z
  .object({ note: z.string().max(500).optional() })
  .optional()
  .default({});

export const declineBookingSchema = z.object({
  reason_code: z.string().min(1).max(40),
  reason_note: z.string().max(1000).optional()
});

export const cancelBookingSchema = z.object({
  reason: z.string().min(1).max(500),
  reason_code: z.string().max(40).optional()
});

export const availabilityQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((range) => range.from <= range.to, {
    message: 'from harus <= to',
    path: ['from']
  })
  .refine(
    (range) =>
      (new Date(`${range.to}T00:00:00.000Z`).getTime() -
        new Date(`${range.from}T00:00:00.000Z`).getTime()) /
        (24 * 60 * 60 * 1000) <=
      90,
    { message: 'Rentang ketersediaan maksimum 90 hari', path: ['to'] }
  );

export type CreateBookingDto = z.infer<typeof createBookingSchema>;
export type AcceptBookingDto = z.infer<typeof acceptBookingSchema>;
export type DeclineBookingDto = z.infer<typeof declineBookingSchema>;
export type CancelBookingDto = z.infer<typeof cancelBookingSchema>;
export type AvailabilityQueryDto = z.infer<typeof availabilityQuerySchema>;

/** Maps zod failures to the frozen AppError envelope (400 VALIDATION_ERROR). */
export function parseInput<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Request tidak valid',
      result.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
        reason: issue.message
      }))
    );
  }
  return result.data;
}
