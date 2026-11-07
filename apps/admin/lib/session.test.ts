import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupBrowserEnv, installBrowserEnv, type BrowserEnv } from '../test/browser-env';
import {
  clearSession,
  readMfaTicket,
  readSession,
  readToken,
  saveMfaTicket,
  saveSession,
  saveToken,
  type OperatorSession
} from './session';

const TOKEN_KEY = 'tarlink.admin.token';
const SESSION_KEY = 'tarlink.admin.session';
const MFA_KEY = 'tarlink.admin.mfa';

let env: BrowserEnv;

beforeEach(() => {
  env = installBrowserEnv();
});

afterEach(() => {
  cleanupBrowserEnv();
});

function operatorProfile(userId: string): OperatorSession {
  return {
    operator_name: 'Sari',
    role: 'admin_finance',
    logged_in_at: '2026-01-01T00:00:00.000Z',
    user_id: userId
  };
}

describe('token storage', () => {
  it('saveToken lalu readToken mengembalikan token yang sama tanpa profil operator', () => {
    saveToken('access-1', 'u1');

    expect(readToken()).toBe('access-1');
    expect(JSON.parse(env.localStorage.getItem(TOKEN_KEY) ?? 'null')).toEqual({
      token: 'access-1',
      userId: 'u1'
    });
  });

  it('readToken menerima token bila profil tab dimiliki operator yang sama', () => {
    saveSession(operatorProfile('u1'));
    saveToken('access-1', 'u1');

    expect(readToken()).toBe('access-1');
  });

  it('readToken menolak token milik operator lain (tab basi di workstation bersama)', () => {
    saveSession(operatorProfile('u2'));
    saveToken('access-1', 'u1');

    expect(readToken()).toBeNull();
  });

  it('readToken menolak rekaman token tanpa userId', () => {
    env.localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: 'access-1' }));

    expect(readToken()).toBeNull();
  });

  it('readToken menolak token format lama (string mentah tanpa pemilik)', () => {
    env.localStorage.setItem(TOKEN_KEY, 'legacy-raw-token');

    expect(readToken()).toBeNull();
  });

  it('clearSession menghapus token dari localStorage dan sessionStorage plus profil tab', () => {
    env.localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: 'access-1', userId: 'u1' }));
    // Sisa masa transisi: salinan token lama masih ada di sessionStorage.
    env.sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: 'legacy', userId: 'u1' }));
    saveSession(operatorProfile('u1'));

    clearSession();

    expect(env.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(env.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(env.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('is safe on the server where window is undefined', () => {
    cleanupBrowserEnv();

    expect(readToken()).toBeNull();
    expect(readSession()).toBeNull();
    expect(readMfaTicket()).toBeNull();
    expect(() => saveToken('access-1', 'u1')).not.toThrow();
    expect(() => saveSession(operatorProfile('u1'))).not.toThrow();
    expect(() => clearSession()).not.toThrow();
  });
});

describe('tiket 2FA', () => {
  it('readMfaTicket mengembalikan tiket yang masih berlaku', () => {
    saveMfaTicket({ kind: 'enroll', token: 'enroll-token', expiresIn: 300 });

    const ticket = readMfaTicket();

    expect(ticket).toMatchObject({ kind: 'enroll', token: 'enroll-token' });
    expect(ticket?.expires_at).toBeGreaterThan(Date.now());
  });

  it('readMfaTicket mengembalikan null dan menghapus tiket kedaluwarsa', () => {
    env.sessionStorage.setItem(
      MFA_KEY,
      JSON.stringify({ kind: 'verify', token: 'ticket', expires_at: Date.now() - 1_000 })
    );

    expect(readMfaTicket()).toBeNull();
    expect(env.sessionStorage.getItem(MFA_KEY)).toBeNull();
  });

  it('readMfaTicket mengembalikan null dan menghapus tiket rusak', () => {
    env.sessionStorage.setItem(MFA_KEY, 'not-json');

    expect(readMfaTicket()).toBeNull();
    expect(env.sessionStorage.getItem(MFA_KEY)).toBeNull();
  });

  it('readMfaTicket mengembalikan null dan menghapus tiket dengan kind tak dikenal', () => {
    env.sessionStorage.setItem(
      MFA_KEY,
      JSON.stringify({ kind: 'login', token: 'ticket', expires_at: Date.now() + 60_000 })
    );

    expect(readMfaTicket()).toBeNull();
    expect(env.sessionStorage.getItem(MFA_KEY)).toBeNull();
  });
});
