import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '@tarlink/core/errors';

/**
 * Symmetric secret storage for values that must never be readable from a DB
 * dump (currently vendor bank account numbers).
 *
 * Format: IV (12 bytes) || GCM auth tag (16 bytes) || ciphertext.
 * The key never lives in PostgreSQL; `keyId` is persisted next to the payload
 * so a rotation can decrypt old rows with the previous key.
 */
export interface SecretCipher {
  readonly keyId: string;
  encrypt(plaintext: string): Buffer;
  decrypt(payload: Buffer, keyId?: string | null): string;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SecretCipherEnv {
  BANK_ACCOUNT_ENCRYPTION_KEY?: string;
  BANK_ACCOUNT_ENCRYPTION_KEY_PREVIOUS?: string;
  BANK_ACCOUNT_KEY_ID?: string;
}

interface KeyEntry {
  id: string;
  key: Buffer;
}

function parseKey(value: string | undefined, name: string): Buffer | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const key = Buffer.from(trimmed, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new AppError(
      'INTERNAL_ERROR',
      `${name} harus base64 dari ${KEY_BYTES} byte (256-bit). Buat dengan: openssl rand -base64 32`
    );
  }
  return key;
}

function decryptWith(entry: KeyEntry, payload: Buffer): string | null {
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', entry.key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    return null;
  }
}

export function createSecretCipher(env: SecretCipherEnv): SecretCipher {
  const currentKey = parseKey(env.BANK_ACCOUNT_ENCRYPTION_KEY, 'BANK_ACCOUNT_ENCRYPTION_KEY');
  if (!currentKey) {
    throw new AppError(
      'INTERNAL_ERROR',
      'BANK_ACCOUNT_ENCRYPTION_KEY belum diisi. Nomor rekening tidak bisa disimpan sebelum kunci enkripsi tersedia.'
    );
  }

  const previousKey = parseKey(
    env.BANK_ACCOUNT_ENCRYPTION_KEY_PREVIOUS,
    'BANK_ACCOUNT_ENCRYPTION_KEY_PREVIOUS'
  );
  const keyId = (env.BANK_ACCOUNT_KEY_ID ?? 'v1').trim() || 'v1';
  const active: KeyEntry = { id: keyId, key: currentKey };
  const ring: KeyEntry[] = previousKey
    ? [active, { id: `${keyId}:previous`, key: previousKey }]
    : [active];

  return {
    keyId,

    encrypt(plaintext: string): Buffer {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', active.key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, ciphertext]);
    },

    decrypt(payload: Buffer, storedKeyId?: string | null): string {
      if (payload.length <= IV_BYTES + TAG_BYTES) {
        throw new AppError('CONFLICT', 'Data rekening terenkripsi rusak atau tidak lengkap.');
      }

      // Prefer the key that was used at write time; fall back to the rest of the
      // ring so a rotation does not require re-encrypting every row.
      const preferred = storedKeyId
        ? ring.filter((entry) => entry.id === storedKeyId)
        : [];
      const candidates = preferred.length > 0 ? preferred : ring;

      for (const entry of candidates) {
        const plaintext = decryptWith(entry, payload);
        if (plaintext !== null) return plaintext;
      }

      throw new AppError(
        'CONFLICT',
        'Nomor rekening tidak bisa didekripsi. Kunci enkripsi tidak cocok dengan data tersimpan.'
      );
    }
  };
}
