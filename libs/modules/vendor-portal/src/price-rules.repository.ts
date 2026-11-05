import { Injectable } from '@nestjs/common';
import { getPool } from '@tarlink/core/db';
import { AppError } from '@tarlink/core/errors';
import type { CreatePriceRuleDto, PriceRuleType, UpdatePriceRuleDto } from './price-rules.dto';

export interface PriceRuleRecord {
  id: string;
  package_id: string;
  label: string;
  rule_type: PriceRuleType;
  date_from: string | null;
  date_to: string | null;
  dow_mask: number;
  multiplier_bp: number | null;
  fixed_price_idr: string | null;
  priority: number;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

@Injectable()
export class PriceRulesRepository {
  async assertPackageOwnership(packageId: string, ownerUserId: string): Promise<boolean> {
    if (!isUuid(packageId) || !isUuid(ownerUserId)) {
      return false;
    }
    const res = await getPool().query(
      `SELECT 1 FROM packages p JOIN vendors v ON p.vendor_id = v.id WHERE p.id = $1 AND v.owner_user_id = $2`,
      [packageId, ownerUserId]
    );
    return (res.rowCount ?? res.rows.length) > 0;
  }

  async listRules(packageId: string): Promise<PriceRuleRecord[]> {
    if (!isUuid(packageId)) {
      return [];
    }
    const res = await getPool().query<PriceRuleRecord>(
      `SELECT id, package_id, label, rule_type, date_from::text AS date_from, date_to::text AS date_to, dow_mask, multiplier_bp, fixed_price_idr, priority, is_active, created_at, updated_at
         FROM package_price_rules
        WHERE package_id = $1
        ORDER BY priority ASC, id ASC`,
      [packageId]
    );
    return res.rows;
  }

  async findRuleById(packageId: string, ruleId: string): Promise<PriceRuleRecord | null> {
    if (!isUuid(packageId) || !isUuid(ruleId)) {
      return null;
    }
    const res = await getPool().query<PriceRuleRecord>(
      `SELECT id, package_id, label, rule_type, date_from::text AS date_from, date_to::text AS date_to, dow_mask, multiplier_bp, fixed_price_idr, priority, is_active, created_at, updated_at
         FROM package_price_rules
        WHERE package_id = $1 AND id = $2`,
      [packageId, ruleId]
    );
    return res.rows[0] ?? null;
  }

  async createRule(packageId: string, input: CreatePriceRuleDto): Promise<PriceRuleRecord> {
    const fixedPrice =
      input.rule_type === 'fixed' && input.fixed_price_idr != null
        ? String(input.fixed_price_idr)
        : null;
    const multiplierBp =
      input.rule_type === 'multiplier' && input.multiplier_bp != null
        ? input.multiplier_bp
        : null;

    const res = await getPool().query<PriceRuleRecord>(
      `INSERT INTO package_price_rules (
         package_id, label, rule_type, date_from, date_to, dow_mask,
         multiplier_bp, fixed_price_idr, priority, is_active
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
       )
       RETURNING id, package_id, label, rule_type, date_from::text AS date_from, date_to::text AS date_to, dow_mask, multiplier_bp, fixed_price_idr, priority, is_active, created_at, updated_at`,
      [
        packageId,
        input.label,
        input.rule_type,
        input.date_from ?? null,
        input.date_to ?? null,
        input.dow_mask ?? 127,
        multiplierBp,
        fixedPrice,
        input.priority ?? 100,
        input.is_active ?? true
      ]
    );
    const record = res.rows[0];
    if (!record) {
      throw new AppError('INTERNAL_ERROR', 'Gagal membuat aturan harga');
    }
    return record;
  }

  async updateRule(ruleId: string, input: UpdatePriceRuleDto): Promise<PriceRuleRecord> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.label !== undefined) {
      sets.push(`label = $${idx++}`);
      values.push(input.label);
    }
    if (input.rule_type !== undefined) {
      sets.push(`rule_type = $${idx++}`);
      values.push(input.rule_type);
    }
    if (input.date_from !== undefined) {
      sets.push(`date_from = $${idx++}`);
      values.push(input.date_from ?? null);
    }
    if (input.date_to !== undefined) {
      sets.push(`date_to = $${idx++}`);
      values.push(input.date_to ?? null);
    }
    if (input.dow_mask !== undefined) {
      sets.push(`dow_mask = $${idx++}`);
      values.push(input.dow_mask);
    }
    if (input.multiplier_bp !== undefined) {
      sets.push(`multiplier_bp = $${idx++}`);
      values.push(input.multiplier_bp ?? null);
    }
    if (input.fixed_price_idr !== undefined) {
      sets.push(`fixed_price_idr = $${idx++}`);
      values.push(input.fixed_price_idr != null ? String(input.fixed_price_idr) : null);
    }
    if (input.priority !== undefined) {
      sets.push(`priority = $${idx++}`);
      values.push(input.priority);
    }
    if (input.is_active !== undefined) {
      sets.push(`is_active = $${idx++}`);
      values.push(input.is_active);
    }

    sets.push(`updated_at = now()`);
    values.push(ruleId);

    const sql = `UPDATE package_price_rules
                    SET ${sets.join(', ')}
                  WHERE id = $${idx}
              RETURNING id, package_id, label, rule_type, date_from::text AS date_from, date_to::text AS date_to, dow_mask, multiplier_bp, fixed_price_idr, priority, is_active, created_at, updated_at`;

    const res = await getPool().query<PriceRuleRecord>(sql, values);
    const updated = res.rows[0];
    if (!updated) {
      throw new AppError('NOT_FOUND', 'Aturan harga tidak ditemukan');
    }
    return updated;
  }

  async deleteRule(packageId: string, ruleId: string): Promise<boolean> {
    if (!isUuid(packageId) || !isUuid(ruleId)) {
      return false;
    }
    const res = await getPool().query(
      `DELETE FROM package_price_rules WHERE package_id = $1 AND id = $2`,
      [packageId, ruleId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
