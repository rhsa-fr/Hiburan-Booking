/**
 * TOTP (RFC 6238: HMAC-SHA1, 6 digits, 30-second step) and the helpers the
 * admin 2FA flow needs (RFC 4648 base32, backup codes, opaque challenge
 * tokens).
 *
 * This module is pure: no database, no network, no filesystem — only
 * `node:crypto`. The secret is accepted as base32 because that is what
 * authenticator apps consume; callers are responsible for encrypting it at
 * rest (`totp_secret_encrypted`).
 *
 * Policy choices:
 * - ±1 step tolerance so a slightly slow client clock still works; ±2 is
 *   rejected to keep the replay window at 90 seconds at most.
 * - Verification compares every candidate in constant time instead of
 *   returning on the first match, so timing does not reveal the step offset.
 * - Backup codes are hashed after normalisation (uppercase, dashes and spaces
 *   removed) so a user can type them with or without the display dashes.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual
} from 'node:crypto';
import { AppError } from '@tarlink/core/errors';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_SECRET_BYTES = 20;
export const TOTP_DEFAULT_WINDOW = 1;
export const BACKUP_CODE_COUNT = 10;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** No I, O, 0 or 1: unreadable characters are the main source of typos. */
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BACKUP_GROUP_LENGTH = 4;
const BACKUP_GROUP_COUNT = 2;
const BACKUP_CODE_MAX = 50;
const CHALLENGE_TOKEN_BYTES = 32;

/** RFC 4648 base32, uppercase, no padding. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/** Tolerant decoder: accepts lowercase, spaces, dashes and trailing `=`. */
export function base32Decode(input: string): Buffer {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/=+$/, '');

  if (cleaned.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Secret TOTP kosong.');
  }

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new AppError('VALIDATION_ERROR', `Karakter base32 tidak valid: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** 20 random bytes (160-bit) as canonical base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

function stepFor(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

function codeForStep(key: Buffer, step: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));

  const digest = createHmac('sha1', key).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function generateTotpCode(secret: string, at: Date): string {
  return codeForStep(base32Decode(secret), stepFor(at));
}

export function verifyTotpCode(
  secret: string,
  code: string,
  at: Date = new Date(),
  window: number = TOTP_DEFAULT_WINDOW
): boolean {
  if (!Number.isInteger(window) || window < 0) {
    throw new AppError('VALIDATION_ERROR', 'Window TOTP harus bilangan bulat >= 0.');
  }

  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;

  const key = base32Decode(secret);
  const candidate = Buffer.from(normalized, 'utf8');
  const step = stepFor(at);

  // Evaluate every step: no early return, so the loop cost is identical for
  // "matched at offset 0" and "matched nowhere".
  let matched = 0;
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(codeForStep(key, step + offset), 'utf8');
    matched |= timingSafeEqual(candidate, expected) ? 1 : 0;
  }

  return matched === 1;
}

export interface OtpauthUriInput {
  readonly issuer: string;
  readonly account: string;
  readonly secret: string;
}

/** `otpauth://` URI for authenticator apps (no QR dependency needed). */
export function buildOtpauthUri({ issuer, account, secret }: OtpauthUriInput): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const canonicalSecret = base32Encode(base32Decode(secret));
  const query = [
    `secret=${encodeURIComponent(canonicalSecret)}`,
    `issuer=${encodeURIComponent(issuer)}`,
    'algorithm=SHA1',
    `digits=${TOTP_DIGITS}`,
    `period=${TOTP_PERIOD_SECONDS}`
  ].join('&');

  return `otpauth://totp/${label}?${query}`;
}

function randomBackupCode(): string {
  const groups: string[] = [];
  for (let group = 0; group < BACKUP_GROUP_COUNT; group += 1) {
    let value = '';
    for (let index = 0; index < BACKUP_GROUP_LENGTH; index += 1) {
      value += BACKUP_ALPHABET.charAt(randomInt(0, BACKUP_ALPHABET.length));
    }
    groups.push(value);
  }
  return groups.join('-');
}

/** Human-friendly, non-ambiguous, unique backup codes (`XXXX-XXXX`). */
export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): string[] {
  if (!Number.isInteger(count) || count < 1 || count > BACKUP_CODE_MAX) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Jumlah kode cadangan harus antara 1 dan ${BACKUP_CODE_MAX}.`
    );
  }

  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(randomBackupCode());
  }
  return [...codes];
}

/** Uppercase and drop the display separators, so typing is forgiving. */
function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(normalizeBackupCode(code), 'utf8').digest('hex');
}

/** 32 random bytes, base64url, never stored in plaintext. */
export function generateChallengeToken(): string {
  return randomBytes(CHALLENGE_TOKEN_BYTES).toString('base64url');
}

export function hashChallengeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
