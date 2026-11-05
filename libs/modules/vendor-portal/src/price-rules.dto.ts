import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { isIsoDate } from '@tarlink/modules/catalog';
import { parseBody } from './vendor-portal.dto';

export type PriceRuleType = 'multiplier' | 'fixed';

export interface CreatePriceRuleDto {
  label: string;
  rule_type: PriceRuleType;
  date_from?: string | null;
  date_to?: string | null;
  dow_mask?: number;
  multiplier_bp?: number | null;
  fixed_price_idr?: string | number | bigint | null;
  priority?: number;
  is_active?: boolean;
}

export interface UpdatePriceRuleDto {
  label?: string;
  rule_type?: PriceRuleType;
  date_from?: string | null;
  date_to?: string | null;
  dow_mask?: number;
  multiplier_bp?: number | null;
  fixed_price_idr?: string | number | bigint | null;
  priority?: number;
  is_active?: boolean;
}

const isoDate = z
  .string()
  .trim()
  .refine((value) => isIsoDate(value), 'Tanggal harus berformat YYYY-MM-DD');

const nullableIsoDate = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? null : val),
  isoDate.nullable().optional()
);

export const CREATE_PRICE_RULE_BODY = z
  .object({
    label: z.string().trim().min(1).max(80),
    rule_type: z.enum(['multiplier', 'fixed']),
    date_from: nullableIsoDate,
    date_to: nullableIsoDate,
    dow_mask: z.number().int().min(1).max(127).optional().default(127),
    multiplier_bp: z.number().int().optional().nullable(),
    fixed_price_idr: z
      .union([z.bigint(), z.number().int(), z.string().trim()])
      .nullable()
      .optional(),
    priority: z.number().int().optional().default(100),
    is_active: z.boolean().optional().default(true)
  })
  .strict();

export const UPDATE_PRICE_RULE_BODY = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    rule_type: z.enum(['multiplier', 'fixed']).optional(),
    date_from: nullableIsoDate,
    date_to: nullableIsoDate,
    dow_mask: z.number().int().min(1).max(127).optional(),
    multiplier_bp: z.number().int().optional().nullable(),
    fixed_price_idr: z
      .union([z.bigint(), z.number().int(), z.string().trim()])
      .nullable()
      .optional(),
    priority: z.number().int().optional(),
    is_active: z.boolean().optional()
  })
  .strict();

export function validatePriceRuleInput(
  input: {
    label?: string;
    rule_type?: PriceRuleType;
    date_from?: string | null;
    date_to?: string | null;
    dow_mask?: number;
    multiplier_bp?: number | null;
    fixed_price_idr?: string | number | bigint | null;
    priority?: number;
    is_active?: boolean;
  },
  isUpdate = false
): void {
  if (!isUpdate || input.label !== undefined) {
    if (!input.label || input.label.trim().length === 0 || input.label.trim().length > 80) {
      throw new AppError('VALIDATION_ERROR', 'Label harus berukuran 1-80 karakter');
    }
  }

  if (input.date_from !== undefined && input.date_from !== null) {
    if (!isIsoDate(input.date_from)) {
      throw new AppError('VALIDATION_ERROR', 'date_from harus berformat YYYY-MM-DD');
    }
  }

  if (input.date_to !== undefined && input.date_to !== null) {
    if (!isIsoDate(input.date_to)) {
      throw new AppError('VALIDATION_ERROR', 'date_to harus berformat YYYY-MM-DD');
    }
  }

  if (
    input.date_from !== undefined &&
    input.date_from !== null &&
    input.date_to !== undefined &&
    input.date_to !== null
  ) {
    if (input.date_to < input.date_from) {
      throw new AppError('VALIDATION_ERROR', 'date_to harus lebih besar atau sama dengan date_from');
    }
  }

  if (input.dow_mask !== undefined) {
    if (!Number.isInteger(input.dow_mask) || input.dow_mask < 1 || input.dow_mask > 127) {
      throw new AppError('VALIDATION_ERROR', 'dow_mask harus berupa integer antara 1 dan 127');
    }
  }

  if (input.priority !== undefined) {
    if (!Number.isInteger(input.priority)) {
      throw new AppError('VALIDATION_ERROR', 'priority harus berupa integer');
    }
  }

  if (input.multiplier_bp !== undefined && input.multiplier_bp !== null) {
    if (!Number.isInteger(input.multiplier_bp) || input.multiplier_bp < 5000 || input.multiplier_bp > 30000) {
      throw new AppError(
        'VALIDATION_ERROR',
        'multiplier_bp wajib diisi antara 5000 dan 30000 untuk rule_type multiplier'
      );
    }
  }

  if (input.fixed_price_idr !== undefined && input.fixed_price_idr !== null) {
    let isValidFixed = false;
    try {
      if (typeof input.fixed_price_idr === 'bigint') {
        isValidFixed = input.fixed_price_idr > 0n;
      } else if (typeof input.fixed_price_idr === 'number') {
        isValidFixed = Number.isInteger(input.fixed_price_idr) && input.fixed_price_idr > 0;
      } else if (typeof input.fixed_price_idr === 'string') {
        const trimmed = input.fixed_price_idr.trim();
        isValidFixed = /^\d+$/.test(trimmed) && BigInt(trimmed) > 0n;
      }
    } catch {
      isValidFixed = false;
    }
    if (!isValidFixed) {
      throw new AppError(
        'VALIDATION_ERROR',
        'fixed_price_idr harus berupa angka lebih besar dari 0'
      );
    }
  }

  if (input.rule_type !== undefined) {
    if (input.rule_type !== 'multiplier' && input.rule_type !== 'fixed') {
      throw new AppError('VALIDATION_ERROR', 'rule_type harus bernilai multiplier atau fixed');
    }
  }

  if (!isUpdate || input.rule_type !== undefined) {
    const ruleType = input.rule_type;
    if (ruleType === 'multiplier') {
      if (
        input.multiplier_bp === undefined ||
        input.multiplier_bp === null ||
        !Number.isInteger(input.multiplier_bp) ||
        input.multiplier_bp < 5000 ||
        input.multiplier_bp > 30000
      ) {
        throw new AppError(
          'VALIDATION_ERROR',
          'multiplier_bp wajib diisi antara 5000 dan 30000 untuk rule_type multiplier'
        );
      }
      if (input.fixed_price_idr !== undefined && input.fixed_price_idr !== null) {
        throw new AppError(
          'VALIDATION_ERROR',
          'fixed_price_idr harus kosong atau null untuk rule_type multiplier'
        );
      }
    } else if (ruleType === 'fixed') {
      if (input.fixed_price_idr === undefined || input.fixed_price_idr === null) {
        throw new AppError(
          'VALIDATION_ERROR',
          'fixed_price_idr wajib diisi untuk rule_type fixed'
        );
      }
      if (input.multiplier_bp !== undefined && input.multiplier_bp !== null) {
        throw new AppError(
          'VALIDATION_ERROR',
          'multiplier_bp harus kosong atau null untuk rule_type fixed'
        );
      }
    }
  }
}

export function parseCreatePriceRule(body: unknown): CreatePriceRuleDto {
  const parsed = parseBody(CREATE_PRICE_RULE_BODY, body, 'Data aturan harga tidak valid');
  validatePriceRuleInput(parsed as CreatePriceRuleDto);
  return parsed as CreatePriceRuleDto;
}

export function parseUpdatePriceRule(body: unknown): UpdatePriceRuleDto {
  const parsed = parseBody(UPDATE_PRICE_RULE_BODY, body, 'Data perubahan aturan harga tidak valid');
  validatePriceRuleInput(parsed as UpdatePriceRuleDto, true);
  return parsed as UpdatePriceRuleDto;
}
