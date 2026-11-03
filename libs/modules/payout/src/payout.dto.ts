import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { SUPPORTED_BANK_CODES } from './banks';

export const CREATE_BANK_ACCOUNT_BODY = z
  .object({
    bank_code: z.enum(SUPPORTED_BANK_CODES as unknown as [string, ...string[]]),
    account_number: z.string().trim().min(6).max(40),
    account_holder_name: z.string().trim().min(2).max(100)
  })
  .strict();

export const CREATE_PAYOUT_BODY = z
  .object({
    vendor_id: z.string().uuid(),
    booking_ids: z.array(z.string().uuid()).min(1).max(200).optional()
  })
  .strict();

export const APPROVE_PAYOUT_BODY = z
  .object({
    note: z.string().trim().max(500).optional()
  })
  .strict();

export const REJECT_PAYOUT_BODY = z
  .object({
    reason: z.string().trim().min(5).max(500)
  })
  .strict();

export const REJECT_BANK_ACCOUNT_BODY = z
  .object({
    reason: z.string().trim().min(5).max(500)
  })
  .strict();

export const PAYOUT_QUERY = z
  .object({
    status: z
      .enum(['requested', 'approved', 'processing', 'paid', 'failed', 'rejected', 'cancelled'])
      .optional(),
    vendor_id: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional()
  })
  .passthrough();

export type CreateBankAccountInput = z.infer<typeof CREATE_BANK_ACCOUNT_BODY>;
export type CreatePayoutInput = z.infer<typeof CREATE_PAYOUT_BODY>;

export function parseBody<T>(schema: z.ZodType<T>, body: unknown, message: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', message, parsed.error.issues);
  }
  return parsed.data;
}
