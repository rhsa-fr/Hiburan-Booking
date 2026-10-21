import type { Account, AccountBalance, JournalEntry } from './types';

/**
 * Balances are derived from the journal every time (D-06). There is no
 * `balance_after` column anywhere in the data model.
 */
export function computeAccountBalances(
  accounts: Account[],
  entries: JournalEntry[]
): AccountBalance[] {
  return accounts.map((account) => {
    let debit = 0;
    let credit = 0;
    for (const entry of entries) {
      for (const line of entry.lines) {
        if (line.account_code !== account.code) continue;
        if (line.side === 'debit') {
          debit += line.amount_idr;
        } else {
          credit += line.amount_idr;
        }
      }
    }
    const balance =
      account.normal_balance === 'debit' ? debit - credit : credit - debit;
    return {
      ...account,
      debit_idr: debit,
      credit_idr: credit,
      balance_idr: balance
    };
  });
}

export interface JournalTotals {
  debit_idr: number;
  credit_idr: number;
  balanced: boolean;
}

export function journalTotals(entry: JournalEntry): JournalTotals {
  let debit = 0;
  let credit = 0;
  for (const line of entry.lines) {
    if (line.side === 'debit') {
      debit += line.amount_idr;
    } else {
      credit += line.amount_idr;
    }
  }
  return { debit_idr: debit, credit_idr: credit, balanced: debit === credit };
}

export function accountTypeLabel(type: Account['type']): string {
  switch (type) {
    case 'asset':
      return 'Aset';
    case 'liability':
      return 'Kewajiban';
    case 'equity':
      return 'Ekuitas';
    case 'revenue':
      return 'Pendapatan';
    case 'expense':
      return 'Beban';
    default:
      return type;
  }
}
