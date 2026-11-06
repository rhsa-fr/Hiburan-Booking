/**
 * Chart of accounts, frozen against TECH-DESIGN-v1.0 §6.2 and the seed in §11.3.
 * Codes, names, account types, normal balances and vendor scoping must not drift.
 * The SQL seeds in `db/migrations/001_core.sql`/`002_fixes.sql` may keep a superset
 * of accounts, but this file only defines accounts the ledger actually posts to.
 */
import { AppError } from '@tarlink/core/errors';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type NormalBalance = 'debit' | 'credit';

export interface AccountDefinition {
  readonly code: string;
  readonly name: string;
  readonly accountType: AccountType;
  readonly normalBalance: NormalBalance;
  readonly vendorScoped: boolean;
}

export const ACCOUNT = {
  platform_operating_cash: {
    code: '1000',
    name: 'platform_operating_cash',
    accountType: 'asset',
    normalBalance: 'debit',
    vendorScoped: false
  },
  gateway_clearing: {
    code: '1100',
    name: 'gateway_clearing',
    accountType: 'asset',
    normalBalance: 'debit',
    vendorScoped: false
  },
  vendor_payout_clearing: {
    code: '1110',
    name: 'vendor_payout_clearing',
    accountType: 'asset',
    normalBalance: 'debit',
    vendorScoped: true
  },
  escrow_liability_vendor: {
    code: '2100',
    name: 'escrow_liability_vendor',
    accountType: 'liability',
    normalBalance: 'credit',
    vendorScoped: true
  },
  refund_payable: {
    code: '2110',
    name: 'refund_payable',
    accountType: 'liability',
    normalBalance: 'credit',
    vendorScoped: false
  },
  vendor_payable: {
    code: '2120',
    name: 'vendor_payable',
    accountType: 'liability',
    normalBalance: 'credit',
    vendorScoped: true
  },
  dispute_reserve: {
    code: '2140',
    name: 'dispute_reserve',
    accountType: 'liability',
    normalBalance: 'credit',
    vendorScoped: false
  },
  platform_revenue_commission: {
    code: '4100',
    name: 'platform_revenue_commission',
    accountType: 'revenue',
    normalBalance: 'credit',
    vendorScoped: false
  },
  platform_revenue_service_fee: {
    code: '4110',
    name: 'platform_revenue_service_fee',
    accountType: 'revenue',
    normalBalance: 'credit',
    vendorScoped: false
  },
  gateway_fee_expense: {
    code: '5100',
    name: 'gateway_fee_expense',
    accountType: 'expense',
    normalBalance: 'debit',
    vendorScoped: false
  },
  gateway_fee_absorbed: {
    code: '5110',
    name: 'gateway_fee_absorbed',
    accountType: 'expense',
    normalBalance: 'debit',
    vendorScoped: false
  }
} as const satisfies Record<string, AccountDefinition>;

export type AccountName = keyof typeof ACCOUNT;

/** Chart of accounts in code order, ready to seed `chart_of_accounts`. */
export const CHART_OF_ACCOUNTS: readonly AccountDefinition[] = Object.freeze([
  ACCOUNT.platform_operating_cash,
  ACCOUNT.gateway_clearing,
  ACCOUNT.vendor_payout_clearing,
  ACCOUNT.escrow_liability_vendor,
  ACCOUNT.refund_payable,
  ACCOUNT.vendor_payable,
  ACCOUNT.dispute_reserve,
  ACCOUNT.platform_revenue_commission,
  ACCOUNT.platform_revenue_service_fee,
  ACCOUNT.gateway_fee_expense,
  ACCOUNT.gateway_fee_absorbed
]);

const BY_CODE: ReadonlyMap<string, AccountDefinition> = new Map(
  CHART_OF_ACCOUNTS.map((account) => [account.code, account])
);

export function isKnownAccountCode(code: string): boolean {
  return BY_CODE.has(code);
}

export function getAccountByCode(code: string): AccountDefinition {
  const account = BY_CODE.get(code);
  if (!account) {
    throw new AppError('CONFLICT', `Unknown ledger account code: ${code}`);
  }
  return account;
}
