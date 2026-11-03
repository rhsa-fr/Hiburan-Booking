import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretCipher } from './index';

const key = (): string => randomBytes(32).toString('base64');

describe('createSecretCipher', () => {
  it('round-trips a bank account number', () => {
    const cipher = createSecretCipher({ BANK_ACCOUNT_ENCRYPTION_KEY: key() });
    const payload = cipher.encrypt('1234567890');
    expect(payload).toBeInstanceOf(Buffer);
    expect(payload.includes(Buffer.from('1234567890'))).toBe(false);
    expect(cipher.decrypt(payload)).toBe('1234567890');
  });

  it('uses a fresh IV for every encryption', () => {
    const cipher = createSecretCipher({ BANK_ACCOUNT_ENCRYPTION_KEY: key() });
    expect(cipher.encrypt('1234567890').equals(cipher.encrypt('1234567890'))).toBe(false);
  });

  it('rejects tampered ciphertext', () => {
    const cipher = createSecretCipher({ BANK_ACCOUNT_ENCRYPTION_KEY: key() });
    const payload = cipher.encrypt('1234567890');
    payload[payload.length - 1] = payload[payload.length - 1]! ^ 0xff;
    expect(() => cipher.decrypt(payload)).toThrow(/tidak bisa didekripsi/i);
  });

  it('decrypts with the previous key after rotation', () => {
    const oldKey = key();
    const before = createSecretCipher({
      BANK_ACCOUNT_ENCRYPTION_KEY: oldKey,
      BANK_ACCOUNT_KEY_ID: 'v1'
    });
    const payload = before.encrypt('9876543210');

    const after = createSecretCipher({
      BANK_ACCOUNT_ENCRYPTION_KEY: key(),
      BANK_ACCOUNT_ENCRYPTION_KEY_PREVIOUS: oldKey,
      BANK_ACCOUNT_KEY_ID: 'v2'
    });

    expect(after.keyId).toBe('v2');
    expect(after.decrypt(payload, 'v1')).toBe('9876543210');
  });

  it('fails closed when the key is missing or malformed', () => {
    expect(() => createSecretCipher({})).toThrow(/BANK_ACCOUNT_ENCRYPTION_KEY/i);
    expect(() =>
      createSecretCipher({ BANK_ACCOUNT_ENCRYPTION_KEY: Buffer.from('too-short').toString('base64') })
    ).toThrow(/base64 dari 32 byte/i);
  });
});
