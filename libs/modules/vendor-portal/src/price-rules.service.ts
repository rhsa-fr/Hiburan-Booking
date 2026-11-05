import { Injectable } from '@nestjs/common';
import { AppError } from '@tarlink/core/errors';
import {
  type CreatePriceRuleDto,
  type UpdatePriceRuleDto,
  validatePriceRuleInput
} from './price-rules.dto';
import { PriceRulesRepository, type PriceRuleRecord } from './price-rules.repository';

@Injectable()
export class PriceRulesService {
  constructor(private readonly repo: PriceRulesRepository) {}

  async list(packageId: string, userId: string): Promise<PriceRuleRecord[]> {
    const isOwner = await this.repo.assertPackageOwnership(packageId, userId);
    if (!isOwner) {
      throw new AppError('FORBIDDEN', 'Akses ditolak: bukan pemilik paket');
    }
    return this.repo.listRules(packageId);
  }

  async create(packageId: string, dto: CreatePriceRuleDto, userId: string): Promise<PriceRuleRecord> {
    const isOwner = await this.repo.assertPackageOwnership(packageId, userId);
    if (!isOwner) {
      throw new AppError('FORBIDDEN', 'Akses ditolak: bukan pemilik paket');
    }
    validatePriceRuleInput(dto);
    return this.repo.createRule(packageId, dto);
  }

  async update(
    packageId: string,
    ruleId: string,
    dto: UpdatePriceRuleDto,
    userId: string
  ): Promise<PriceRuleRecord> {
    const isOwner = await this.repo.assertPackageOwnership(packageId, userId);
    if (!isOwner) {
      throw new AppError('FORBIDDEN', 'Akses ditolak: bukan pemilik paket');
    }
    const existing = await this.repo.findRuleById(packageId, ruleId);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Aturan harga tidak ditemukan');
    }

    const ruleType = dto.rule_type ?? existing.rule_type;
    const merged: CreatePriceRuleDto = {
      label: dto.label ?? existing.label,
      rule_type: ruleType,
      date_from: dto.date_from !== undefined ? dto.date_from : existing.date_from,
      date_to: dto.date_to !== undefined ? dto.date_to : existing.date_to,
      dow_mask: dto.dow_mask !== undefined ? dto.dow_mask : existing.dow_mask,
      priority: dto.priority !== undefined ? dto.priority : existing.priority,
      is_active: dto.is_active !== undefined ? dto.is_active : existing.is_active,
      multiplier_bp:
        dto.multiplier_bp !== undefined
          ? dto.multiplier_bp
          : (dto.rule_type === 'fixed' ? null : existing.multiplier_bp),
      fixed_price_idr:
        dto.fixed_price_idr !== undefined
          ? dto.fixed_price_idr
          : (dto.rule_type === 'multiplier' ? null : existing.fixed_price_idr)
    };
    validatePriceRuleInput(merged);

    const updateInput: UpdatePriceRuleDto = { ...dto };
    if (dto.rule_type === 'fixed' && dto.multiplier_bp === undefined) {
      updateInput.multiplier_bp = null;
    }
    if (dto.rule_type === 'multiplier' && dto.fixed_price_idr === undefined) {
      updateInput.fixed_price_idr = null;
    }

    return this.repo.updateRule(ruleId, updateInput);
  }

  async delete(packageId: string, ruleId: string, userId: string): Promise<{ deleted: boolean }> {
    const isOwner = await this.repo.assertPackageOwnership(packageId, userId);
    if (!isOwner) {
      throw new AppError('FORBIDDEN', 'Akses ditolak: bukan pemilik paket');
    }
    const existing = await this.repo.findRuleById(packageId, ruleId);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Aturan harga tidak ditemukan');
    }
    await this.repo.deleteRule(packageId, ruleId);
    return { deleted: true };
  }
}
