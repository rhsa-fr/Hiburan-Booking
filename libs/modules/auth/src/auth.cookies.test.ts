/**
 * Unit tests for the refresh-cookie helpers. Pure string work: no Nest, no I/O,
 * so the exact `Set-Cookie` bytes are pinned down — an attribute typo here is
 * either a security hole (missing HttpOnly/Secure) or a broken login.
 */
import { describe, expect, it } from 'vitest';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  hasCookie,
  readCookie,
  serializeRefreshCookie
} from './auth.cookies';

const TOKEN = 'abc123_-xyz';

describe('serializeRefreshCookie', () => {
  it('writes the exact attribute string without Secure outside production', () => {
    expect(serializeRefreshCookie(TOKEN, { secure: false, maxAgeSeconds: 2_592_000 })).toBe(
      'tarlink_rt=abc123_-xyz; Path=/v1/auth; HttpOnly; SameSite=Strict; Max-Age=2592000'
    );
  });

  it('adds Secure only when requested', () => {
    expect(serializeRefreshCookie(TOKEN, { secure: true, maxAgeSeconds: 60 })).toBe(
      'tarlink_rt=abc123_-xyz; Path=/v1/auth; HttpOnly; SameSite=Strict; Max-Age=60; Secure'
    );
  });

  it('percent-encodes the token so a stray separator cannot inject an attribute', () => {
    expect(serializeRefreshCookie('a;b=c', { secure: false, maxAgeSeconds: 1 })).toBe(
      'tarlink_rt=a%3Bb%3Dc; Path=/v1/auth; HttpOnly; SameSite=Strict; Max-Age=1'
    );
  });

  it('uses Max-Age equal to the numeric option', () => {
    expect(serializeRefreshCookie(TOKEN, { secure: false, maxAgeSeconds: 0 })).toContain(
      '; Max-Age=0'
    );
  });
});

describe('clearRefreshCookie', () => {
  it('empties the value and expires the cookie immediately', () => {
    expect(clearRefreshCookie({ secure: false })).toBe(
      'tarlink_rt=; Path=/v1/auth; HttpOnly; SameSite=Strict; Max-Age=0'
    );
  });

  it('keeps Secure in production', () => {
    expect(clearRefreshCookie({ secure: true })).toBe(
      'tarlink_rt=; Path=/v1/auth; HttpOnly; SameSite=Strict; Max-Age=0; Secure'
    );
  });
});

describe('readCookie', () => {
  it('finds the value among several cookies', () => {
    expect(readCookie('theme=dark; tarlink_rt=abc123; locale=id', REFRESH_COOKIE_NAME)).toBe(
      'abc123'
    );
  });

  it('does not confuse a cookie whose name merely ends with the target name', () => {
    expect(readCookie('my_tarlink_rt=wrong; tarlink_rt=right', REFRESH_COOKIE_NAME)).toBe('right');
  });

  it('decodes percent-encoded values', () => {
    expect(readCookie('tarlink_rt=a%3Bb%3Dc', REFRESH_COOKIE_NAME)).toBe('a;b=c');
  });

  it('returns null when the cookie is absent', () => {
    expect(readCookie('theme=dark; locale=id', REFRESH_COOKIE_NAME)).toBeNull();
    expect(readCookie(undefined, REFRESH_COOKIE_NAME)).toBeNull();
    expect(readCookie('', REFRESH_COOKIE_NAME)).toBeNull();
  });

  it('returns null for an empty value', () => {
    expect(readCookie('tarlink_rt=', REFRESH_COOKIE_NAME)).toBeNull();
    expect(readCookie('tarlink_rt=   ; theme=dark', REFRESH_COOKIE_NAME)).toBeNull();
  });

  it('survives malformed percent-encoding without throwing', () => {
    expect(() => readCookie('tarlink_rt=%E0%A4%A', REFRESH_COOKIE_NAME)).not.toThrow();
    expect(readCookie('tarlink_rt=%E0%A4%A', REFRESH_COOKIE_NAME)).toBeNull();
  });

  it('ignores header fragments without a name/value separator', () => {
    expect(readCookie('garbage; tarlink_rt=abc', REFRESH_COOKIE_NAME)).toBe('abc');
  });
});

describe('hasCookie', () => {
  it('finds the name among several cookies with a normal value', () => {
    expect(hasCookie('theme=dark; tarlink_rt=abc123; locale=id', REFRESH_COOKIE_NAME)).toBe(true);
  });

  it('reports a cookie with an empty value as present', () => {
    expect(hasCookie('tarlink_rt=', REFRESH_COOKIE_NAME)).toBe(true);
    expect(hasCookie('tarlink_rt=   ; theme=dark', REFRESH_COOKIE_NAME)).toBe(true);
  });

  it('reports a cookie whose encoding cannot be decoded as present', () => {
    expect(hasCookie('tarlink_rt=%E0%A4%A', REFRESH_COOKIE_NAME)).toBe(true);
  });

  it('does not match a different cookie that merely ends with the name', () => {
    expect(hasCookie('my_tarlink_rt=wrong', REFRESH_COOKIE_NAME)).toBe(false);
    expect(hasCookie('my_tarlink_rt=wrong; tarlink_rt=right', REFRESH_COOKIE_NAME)).toBe(true);
  });

  it('returns false when the header is absent or holds no such cookie', () => {
    expect(hasCookie(undefined, REFRESH_COOKIE_NAME)).toBe(false);
    expect(hasCookie('', REFRESH_COOKIE_NAME)).toBe(false);
    expect(hasCookie('theme=dark; locale=id', REFRESH_COOKIE_NAME)).toBe(false);
  });
});
