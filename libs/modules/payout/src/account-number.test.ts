import { describe, expect, it } from 'vitest';
import {
  hashAccountNumber,
  maskAccountNumber,
  normalizeAccountNumber
} from './account-number';
import { bankDisplayName, isSupportedBank, SUPPORTED_BANKS } from './banks';

describe('account number helpers', () => {
  it('normalises separators and keeps digits', () => {
    expect(normalizeAccountNumber('123-456 789.0')).toBe('1234567890');
  });

  it('rejects non-digits and out-of-range lengths', () => {
    expect(() => normalizeAccountNumber('12ab5678')).toThrow(/angka/);
    expect(() => normalizeAccountNumber('123')).toThrow(/6–20/);
    expect(() => normalizeAccountNumber('1'.repeat(21))).toThrow(/6–20/);
  });

  it('masks all but the last four digits', () => {
    expect(maskAccountNumber('1234567890')).toBe('****7890');
  });

  it('hashes bank + number deterministically', () => {
    const first = hashAccountNumber('bca', '1234567890');
    expect(first).toHaveLength(64);
    expect(first).toBe(hashAccountNumber('bca', '1234567890'));
    expect(first).not.toBe(hashAccountNumber('bni', '1234567890'));
  });
});

describe('bank catalogue', () => {
  it('knows the Iris codes used by the payout form', () => {
    expect(isSupportedBank('bca')).toBe(true);
    expect(isSupportedBank('BCA')).toBe(false);
    expect(bankDisplayName('cimb')).toBe('CIMB Niaga');
    expect(SUPPORTED_BANKS.length).toBeGreaterThanOrEqual(10);
  });
});
