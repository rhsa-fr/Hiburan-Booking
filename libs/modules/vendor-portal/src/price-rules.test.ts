import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import {
  type CreatePriceRuleDto,
  type UpdatePriceRuleDto,
  parseCreatePriceRule,
  parseUpdatePriceRule,
  validatePriceRuleInput
} from './price-rules.dto';
import { PriceRulesController } from './price-rules.controller';
import { PriceRulesRepository, type PriceRuleRecord } from './price-rules.repository';
import { PriceRulesService } from './price-rules.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';
const PACKAGE_ID = '22222222-2222-4222-8222-222222222222';
const RULE_ID = '33333333-3333-4333-8333-333333333333';

const MOCK_MULTIPLIER_RULE: PriceRuleRecord = {
  id: RULE_ID,
  package_id: PACKAGE_ID,
  label: 'Weekend Peak',
  rule_type: 'multiplier',
  date_from: '2026-06-01',
  date_to: '2026-08-31',
  dow_mask: 96,
  multiplier_bp: 12500,
  fixed_price_idr: null,
  priority: 50,
  is_active: true,
  created_at: new Date('2026-05-01T00:00:00Z'),
  updated_at: new Date('2026-05-01T00:00:00Z')
};

const MOCK_FIXED_RULE: PriceRuleRecord = {
  id: '44444444-4444-4444-8444-444444444444',
  package_id: PACKAGE_ID,
  label: 'Malam Tahun Baru',
  rule_type: 'fixed',
  date_from: '2026-12-31',
  date_to: '2026-12-31',
  dow_mask: 127,
  multiplier_bp: null,
  fixed_price_idr: '25000000',
  priority: 10,
  is_active: true,
  created_at: new Date('2026-05-01T00:00:00Z'),
  updated_at: new Date('2026-05-01T00:00:00Z')
};

function createService(repoOverrides: Partial<PriceRulesRepository> = {}) {
  const repo = new PriceRulesRepository();
  Object.assign(repo, repoOverrides);
  const service = new PriceRulesService(repo);
  return { service, repo };
}

describe('Seasonal Price Rules (FR-109)', () => {
  describe('DTO & Validation constraints', () => {
    it('throws validation error when multiplier_bp is below 5000', () => {
      const invalidInput: CreatePriceRuleDto = {
        label: 'Low Multiplier',
        rule_type: 'multiplier',
        multiplier_bp: 4999
      };
      expect(() => validatePriceRuleInput(invalidInput)).toThrow(AppError);
      expect(() => validatePriceRuleInput(invalidInput)).toThrowError(
        /multiplier_bp wajib diisi antara 5000 dan 30000/
      );
    });

    it('throws validation error when multiplier_bp is above 30000', () => {
      const invalidInput: CreatePriceRuleDto = {
        label: 'High Multiplier',
        rule_type: 'multiplier',
        multiplier_bp: 30001
      };
      expect(() => validatePriceRuleInput(invalidInput)).toThrow(AppError);
      expect(() => validatePriceRuleInput(invalidInput)).toThrowError(
        /multiplier_bp wajib diisi antara 5000 dan 30000/
      );
    });

    it('throws validation error when multiplier_bp is missing for multiplier rule', () => {
      const invalidInput: CreatePriceRuleDto = {
        label: 'Missing Multiplier',
        rule_type: 'multiplier'
      };
      expect(() => validatePriceRuleInput(invalidInput)).toThrow(AppError);
      expect(() => validatePriceRuleInput(invalidInput)).toThrowError(
        /multiplier_bp wajib diisi antara 5000 dan 30000/
      );
    });

    it('throws validation error when multiplier rule includes fixed_price_idr', () => {
      const invalidInput: CreatePriceRuleDto = {
        label: 'Conflicting Fields',
        rule_type: 'multiplier',
        multiplier_bp: 15000,
        fixed_price_idr: 1000000
      };
      expect(() => validatePriceRuleInput(invalidInput)).toThrow(AppError);
      expect(() => validatePriceRuleInput(invalidInput)).toThrowError(
        /fixed_price_idr harus kosong atau null untuk rule_type multiplier/
      );
    });

    it('throws validation error when fixed rule requires fixed_price_idr > 0 (0 or negative)', () => {
      expect(() =>
        validatePriceRuleInput({
          label: 'Zero Price',
          rule_type: 'fixed',
          fixed_price_idr: 0
        })
      ).toThrow(AppError);

      expect(() =>
        validatePriceRuleInput({
          label: 'Negative Price',
          rule_type: 'fixed',
          fixed_price_idr: -50000
        })
      ).toThrow(AppError);

      expect(() =>
        validatePriceRuleInput({
          label: 'Negative String Price',
          rule_type: 'fixed',
          fixed_price_idr: '-1000'
        })
      ).toThrow(AppError);

      expect(() =>
        validatePriceRuleInput({
          label: 'Zero Bigint Price',
          rule_type: 'fixed',
          fixed_price_idr: 0n
        })
      ).toThrow(AppError);
    });

    it('throws validation error when fixed rule is missing fixed_price_idr', () => {
      const invalidInput: CreatePriceRuleDto = {
        label: 'Missing Fixed Price',
        rule_type: 'fixed'
      };
      expect(() => validatePriceRuleInput(invalidInput)).toThrow(AppError);
      expect(() => validatePriceRuleInput(invalidInput)).toThrowError(
        /fixed_price_idr wajib diisi untuk rule_type fixed/
      );
    });

    it('throws validation error when fixed rule includes multiplier_bp', () => {
      const invalidInput: CreatePriceRuleDto = {
        label: 'Conflicting Fixed Rule',
        rule_type: 'fixed',
        fixed_price_idr: 2000000,
        multiplier_bp: 12000
      };
      expect(() => validatePriceRuleInput(invalidInput)).toThrow(AppError);
      expect(() => validatePriceRuleInput(invalidInput)).toThrowError(
        /multiplier_bp harus kosong atau null untuk rule_type fixed/
      );
    });

    it('throws validation error when date_to < date_from', () => {
      const invalidInput: CreatePriceRuleDto = {
        label: 'Inverted Range',
        rule_type: 'multiplier',
        multiplier_bp: 12000,
        date_from: '2026-07-15',
        date_to: '2026-07-10'
      };
      expect(() => validatePriceRuleInput(invalidInput)).toThrow(AppError);
      expect(() => validatePriceRuleInput(invalidInput)).toThrowError(
        /date_to harus lebih besar atau sama dengan date_from/
      );
    });

    it('throws validation error on invalid date formats or dow_mask bounds', () => {
      expect(() =>
        validatePriceRuleInput({
          label: 'Bad Date',
          rule_type: 'multiplier',
          multiplier_bp: 10000,
          date_from: '2026/05/01'
        })
      ).toThrow(AppError);

      expect(() =>
        validatePriceRuleInput({
          label: 'Bad Dow',
          rule_type: 'multiplier',
          multiplier_bp: 10000,
          dow_mask: 0
        })
      ).toThrow(AppError);

      expect(() =>
        validatePriceRuleInput({
          label: 'Bad Dow Max',
          rule_type: 'multiplier',
          multiplier_bp: 10000,
          dow_mask: 128
        })
      ).toThrow(AppError);
    });

    it('validates and parses valid create and update bodies with zod parsers', () => {
      const createBody = {
        label: 'High Season',
        rule_type: 'multiplier',
        date_from: '2026-06-01',
        date_to: '2026-06-30',
        dow_mask: 127,
        multiplier_bp: 15000,
        priority: 50
      };
      const parsedCreate = parseCreatePriceRule(createBody);
      expect(parsedCreate.label).toBe('High Season');
      expect(parsedCreate.multiplier_bp).toBe(15000);
      expect(parsedCreate.is_active).toBe(true);

      const updateBody = {
        label: 'Updated Label',
        multiplier_bp: 18000
      };
      const parsedUpdate = parseUpdatePriceRule(updateBody);
      expect(parsedUpdate.label).toBe('Updated Label');
      expect(parsedUpdate.multiplier_bp).toBe(18000);
    });
  });

  describe('Ownership checks in PriceRulesService', () => {
    it('rejects non-owner on list with 403 FORBIDDEN AppError', async () => {
      const { service } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(false)
      });
      await expect(service.list(PACKAGE_ID, OTHER_USER_ID)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403
      });
    });

    it('rejects non-owner on create with 403 FORBIDDEN AppError', async () => {
      const { service } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(false)
      });
      const dto: CreatePriceRuleDto = {
        label: 'Peak',
        rule_type: 'multiplier',
        multiplier_bp: 12000
      };
      await expect(service.create(PACKAGE_ID, dto, OTHER_USER_ID)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403
      });
    });

    it('rejects non-owner on update with 403 FORBIDDEN AppError', async () => {
      const { service } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(false)
      });
      const dto: UpdatePriceRuleDto = { label: 'New Label' };
      await expect(service.update(PACKAGE_ID, RULE_ID, dto, OTHER_USER_ID)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403
      });
    });

    it('rejects non-owner on delete with 403 FORBIDDEN AppError', async () => {
      const { service } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(false)
      });
      await expect(service.delete(PACKAGE_ID, RULE_ID, OTHER_USER_ID)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403
      });
    });
  });

  describe('CRUD flow in PriceRulesService', () => {
    it('list returns price rules for package', async () => {
      const { service, repo } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        listRules: vi.fn().mockResolvedValue([MOCK_MULTIPLIER_RULE, MOCK_FIXED_RULE])
      });

      const result = await service.list(PACKAGE_ID, USER_ID);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(RULE_ID);
      expect(repo.assertPackageOwnership).toHaveBeenCalledWith(PACKAGE_ID, USER_ID);
      expect(repo.listRules).toHaveBeenCalledWith(PACKAGE_ID);
    });

    it('create validates constraints and saves multiplier rule', async () => {
      const { service, repo } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        createRule: vi.fn().mockResolvedValue(MOCK_MULTIPLIER_RULE)
      });

      const dto: CreatePriceRuleDto = {
        label: 'Weekend Peak',
        rule_type: 'multiplier',
        multiplier_bp: 12500,
        date_from: '2026-06-01',
        date_to: '2026-08-31',
        dow_mask: 96,
        priority: 50
      };

      const result = await service.create(PACKAGE_ID, dto, USER_ID);
      expect(result).toEqual(MOCK_MULTIPLIER_RULE);
      expect(repo.createRule).toHaveBeenCalledWith(PACKAGE_ID, dto);
    });

    it('create validates constraints and saves fixed price rule', async () => {
      const { service, repo } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        createRule: vi.fn().mockResolvedValue(MOCK_FIXED_RULE)
      });

      const dto: CreatePriceRuleDto = {
        label: 'Malam Tahun Baru',
        rule_type: 'fixed',
        fixed_price_idr: 25000000,
        date_from: '2026-12-31',
        date_to: '2026-12-31',
        dow_mask: 127,
        priority: 10
      };

      const result = await service.create(PACKAGE_ID, dto, USER_ID);
      expect(result).toEqual(MOCK_FIXED_RULE);
      expect(repo.createRule).toHaveBeenCalledWith(PACKAGE_ID, dto);
    });

    it('create throws VALIDATION_ERROR if multiplier_bp is invalid', async () => {
      const { service, repo } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        createRule: vi.fn()
      });

      const dto: CreatePriceRuleDto = {
        label: 'Invalid Multiplier',
        rule_type: 'multiplier',
        multiplier_bp: 4000
      };

      await expect(service.create(PACKAGE_ID, dto, USER_ID)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400
      });
      expect(repo.createRule).not.toHaveBeenCalled();
    });

    it('update updates an existing rule', async () => {
      const updatedRule: PriceRuleRecord = {
        ...MOCK_MULTIPLIER_RULE,
        multiplier_bp: 15000
      };

      const { service, repo } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        findRuleById: vi.fn().mockResolvedValue(MOCK_MULTIPLIER_RULE),
        updateRule: vi.fn().mockResolvedValue(updatedRule)
      });

      const dto: UpdatePriceRuleDto = { multiplier_bp: 15000 };
      const result = await service.update(PACKAGE_ID, RULE_ID, dto, USER_ID);
      expect(result.multiplier_bp).toBe(15000);
      expect(repo.updateRule).toHaveBeenCalledWith(RULE_ID, dto);
    });

    it('update throws NOT_FOUND when rule does not exist', async () => {
      const { service } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        findRuleById: vi.fn().mockResolvedValue(null)
      });

      await expect(
        service.update(PACKAGE_ID, 'non-existent-rule-id', { label: 'New' }, USER_ID)
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404
      });
    });

    it('update switching rule_type clears obsolete value', async () => {
      const updatedFixedRule: PriceRuleRecord = {
        ...MOCK_MULTIPLIER_RULE,
        rule_type: 'fixed',
        multiplier_bp: null,
        fixed_price_idr: '5000000'
      };

      const { service, repo } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        findRuleById: vi.fn().mockResolvedValue(MOCK_MULTIPLIER_RULE),
        updateRule: vi.fn().mockResolvedValue(updatedFixedRule)
      });

      const dto: UpdatePriceRuleDto = {
        rule_type: 'fixed',
        fixed_price_idr: 5000000
      };

      const result = await service.update(PACKAGE_ID, RULE_ID, dto, USER_ID);
      expect(result.rule_type).toBe('fixed');
      expect(repo.updateRule).toHaveBeenCalledWith(RULE_ID, {
        rule_type: 'fixed',
        fixed_price_idr: 5000000,
        multiplier_bp: null
      });
    });

    it('delete removes rule and returns deleted status', async () => {
      const { service, repo } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        findRuleById: vi.fn().mockResolvedValue(MOCK_MULTIPLIER_RULE),
        deleteRule: vi.fn().mockResolvedValue(true)
      });

      const result = await service.delete(PACKAGE_ID, RULE_ID, USER_ID);
      expect(result).toEqual({ deleted: true });
      expect(repo.deleteRule).toHaveBeenCalledWith(PACKAGE_ID, RULE_ID);
    });

    it('delete throws NOT_FOUND when rule does not exist', async () => {
      const { service, repo } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        findRuleById: vi.fn().mockResolvedValue(null),
        deleteRule: vi.fn()
      });

      await expect(service.delete(PACKAGE_ID, 'not-found-id', USER_ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404
      });
      expect(repo.deleteRule).not.toHaveBeenCalled();
    });
  });

  describe('PriceRulesController', () => {
    const mockUser = { id: USER_ID, roles: ['vendor_owner' as const] };

    it('GET returns { data: rules }', async () => {
      const { service } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        listRules: vi.fn().mockResolvedValue([MOCK_MULTIPLIER_RULE])
      });
      const controller = new PriceRulesController(service);

      const res = await controller.list(PACKAGE_ID, mockUser);
      expect(res).toEqual({ data: [MOCK_MULTIPLIER_RULE] });
    });

    it('POST returns { data: createdRule } with 201 status', async () => {
      const { service } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        createRule: vi.fn().mockResolvedValue(MOCK_MULTIPLIER_RULE)
      });
      const controller = new PriceRulesController(service);

      const body = {
        label: 'Weekend Peak',
        rule_type: 'multiplier',
        multiplier_bp: 12500,
        date_from: '2026-06-01',
        date_to: '2026-08-31'
      };

      const res = await controller.create(PACKAGE_ID, body, mockUser);
      expect(res).toEqual({ data: MOCK_MULTIPLIER_RULE });
    });

    it('PUT returns { data: updatedRule }', async () => {
      const updated = { ...MOCK_MULTIPLIER_RULE, label: 'Super Peak' };
      const { service } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        findRuleById: vi.fn().mockResolvedValue(MOCK_MULTIPLIER_RULE),
        updateRule: vi.fn().mockResolvedValue(updated)
      });
      const controller = new PriceRulesController(service);

      const res = await controller.update(PACKAGE_ID, RULE_ID, { label: 'Super Peak' }, mockUser);
      expect(res).toEqual({ data: updated });
    });

    it('DELETE returns { data: { deleted: true } }', async () => {
      const { service } = createService({
        assertPackageOwnership: vi.fn().mockResolvedValue(true),
        findRuleById: vi.fn().mockResolvedValue(MOCK_MULTIPLIER_RULE),
        deleteRule: vi.fn().mockResolvedValue(true)
      });
      const controller = new PriceRulesController(service);

      const res = await controller.delete(PACKAGE_ID, RULE_ID, mockUser);
      expect(res).toEqual({ data: { deleted: true } });
    });
  });
});
