import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateBackupCodes,
  generateChallengeToken,
  generateTotpCode,
  generateTotpSecret,
  hashBackupCode,
  hashChallengeToken,
  verifyTotpCode
} from './totp';

/** RFC 6238 Appendix B uses the ASCII bytes "12345678901234567890". */
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET = base32Encode(Buffer.from(RFC_SECRET_ASCII, 'utf8'));

/**
 * RFC 6238 SHA-1 vectors (one-time-password column). The module emits 6 digits,
 * so the expected value is the last six digits of the 8-digit vector.
 */
const RFC_VECTORS: ReadonlyArray<{ epochSeconds: number; digits8: string }> = [
  { epochSeconds: 59, digits8: '94287082' },
  { epochSeconds: 1_111_111_109, digits8: '07081804' },
  { epochSeconds: 1_111_111_111, digits8: '14050471' },
  { epochSeconds: 1_234_567_890, digits8: '89005924' },
  { epochSeconds: 2_000_000_000, digits8: '69279037' }
];

describe('base32 (RFC 4648)', () => {
  it('encodes the RFC 6238 secret without padding', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(RFC_SECRET).not.toContain('=');
    expect(RFC_SECRET).toBe(RFC_SECRET.toUpperCase());
  });

  it('round-trips random 20-byte secrets', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const bytes = randomBytes(20);
      expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    }
  });

  it('is tolerant of lowercase, spaces and padding on input', () => {
    const decoded = base32Decode('gezd gnbvgy3tqojq gezdgnbvgy3tqojq==');
    expect(decoded.toString('utf8')).toBe(RFC_SECRET_ASCII);
  });

  it('rejects characters outside the base32 alphabet', () => {
    expect(() => base32Decode('NOT-BASE32-1')).toThrow(/base32/i);
  });
});

describe('generateTotpSecret', () => {
  it('returns 160 bits as 32 base32 characters', () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(32);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it('never repeats', () => {
    const secrets = new Set(Array.from({ length: 20 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(20);
  });
});

describe('generateTotpCode', () => {
  it('matches the RFC 6238 SHA-1 vectors', () => {
    for (const vector of RFC_VECTORS) {
      const at = new Date(vector.epochSeconds * 1000);
      expect(generateTotpCode(RFC_SECRET, at)).toBe(vector.digits8.slice(-6));
    }
  });

  it('always returns six digits', () => {
    for (const vector of RFC_VECTORS) {
      expect(generateTotpCode(RFC_SECRET, new Date(vector.epochSeconds * 1000))).toMatch(/^\d{6}$/);
    }
  });
});

describe('verifyTotpCode', () => {
  const secret = generateTotpSecret();
  const at = new Date(1_700_000_000_000);
  const codeAt = (offsetSeconds: number): string =>
    generateTotpCode(secret, new Date(at.getTime() + offsetSeconds * 1000));

  it('accepts the code for the current step', () => {
    expect(verifyTotpCode(secret, codeAt(0), at)).toBe(true);
  });

  it('accepts the previous and next step (±1 window)', () => {
    expect(verifyTotpCode(secret, codeAt(-30), at)).toBe(true);
    expect(verifyTotpCode(secret, codeAt(30), at)).toBe(true);
  });

  it('rejects codes two steps away', () => {
    expect(verifyTotpCode(secret, codeAt(-60), at)).toBe(false);
    expect(verifyTotpCode(secret, codeAt(60), at)).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyTotpCode(secret, '', at)).toBe(false);
    expect(verifyTotpCode(secret, '12345', at)).toBe(false);
    expect(verifyTotpCode(secret, '1234567', at)).toBe(false);
    expect(verifyTotpCode(secret, 'abcdef', at)).toBe(false);
    expect(verifyTotpCode(secret, '12 456', at)).toBe(false);
  });

  it('rejects an all-zero window outside the current step', () => {
    expect(verifyTotpCode(secret, codeAt(-30), at, 0)).toBe(false);
  });
});

describe('buildOtpauthUri', () => {
  it('emits an otpauth URI with encoded label and issuer', () => {
    const uri = buildOtpauthUri({
      issuer: 'Tarlink Admin',
      account: 'admin@tarlink.id',
      secret: RFC_SECRET
    });
    expect(uri).toBe(
      `otpauth://totp/Tarlink%20Admin:admin%40tarlink.id?secret=${RFC_SECRET}&issuer=Tarlink%20Admin&algorithm=SHA1&digits=6&period=30`
    );
  });

  it('canonicalises a lowercase secret with padding', () => {
    const uri = buildOtpauthUri({
      issuer: 'Tarlink',
      account: 'ops',
      secret: RFC_SECRET.toLowerCase()
    });
    expect(uri).toContain(`secret=${RFC_SECRET}&`);
  });
});

describe('backup codes', () => {
  it('generates ten unique human-friendly codes by default', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it('honours a custom count and rejects invalid counts', () => {
    expect(generateBackupCodes(3)).toHaveLength(3);
    expect(() => generateBackupCodes(0)).toThrow(/kode cadangan/i);
    expect(() => generateBackupCodes(1.5)).toThrow(/kode cadangan/i);
  });

  it('hashes stably regardless of case and separators', () => {
    const hash = hashBackupCode('abcd-efgh');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBackupCode('ABCD EFGH')).toBe(hash);
    expect(hashBackupCode('ABCD-EFGH')).toBe(hash);
    expect(hashBackupCode('abcd-efgi')).not.toBe(hash);
  });
});

describe('challenge tokens', () => {
  it('generates opaque tokens and hashes them deterministically', () => {
    const first = generateChallengeToken();
    const second = generateChallengeToken();

    expect(first).not.toBe(second);
    expect(first).toHaveLength(43);
    expect(hashChallengeToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashChallengeToken(first)).toBe(hashChallengeToken(first));
    expect(hashChallengeToken(first)).not.toBe(hashChallengeToken(second));
  });
});
