/**
 * Sesi operator mock. Disimpan di sessionStorage browser supaya "Keluar"
 * benar-benar menghapus sesi, bukan sekadar berpindah halaman.
 * Aman dipanggil dari server: fungsi ini mengecek typeof window.
 */

export interface OperatorSession {
  operator_name: string;
  role: string;
  logged_in_at: string;
}

const SESSION_KEY = 'tarlink.admin.session';
const TOKEN_KEY = 'tarlink.admin.token';

/** Access token dari API. Disimpan terpisah dari profil agar mudah dicabut. */
export function saveToken(token: string): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Penyimpanan diblokir: sesi hanya berlaku selama tab hidup di memori.
  }
}

export function readToken(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearToken(): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Tidak ada yang bisa dibersihkan.
  }
}

export const DEFAULT_OPERATOR: OperatorSession = {
  operator_name: 'Sari Wulandari',
  role: 'Admin finance',
  logged_in_at: '2026-10-21T09:15:00+07:00'
};

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function saveSession(session: OperatorSession): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Penyimpanan diblokir (mode privat): sesi hanya berlaku di memori.
  }
}

export function readSession(): OperatorSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as OperatorSession).operator_name === 'string' &&
      typeof (parsed as OperatorSession).role === 'string'
    ) {
      return parsed as OperatorSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Tidak ada yang bisa dibersihkan; sesi sudah dianggap berakhir.
  }
}

/** Peran internal dibaca sebagai bahasa sehari-hari, bukan kode basis data. */
export function roleLabel(role: string): string {
  switch (role) {
    case 'admin_finance':
      return 'Admin finance';
    case 'admin_super':
      return 'Admin super';
    case 'admin_support':
      return 'Admin support';
    default:
      return role;
  }
}
