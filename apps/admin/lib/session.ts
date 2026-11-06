/**
 * Sesi operator mock. Disimpan di sessionStorage browser supaya "Keluar"
 * benar-benar menghapus sesi, bukan sekadar berpindah halaman.
 * Aman dipanggil dari server: fungsi ini mengecek typeof window.
 */

export interface OperatorSession {
  operator_name: string;
  role: string;
  logged_in_at: string;
  /** Id operator dari `POST /auth/login`; dipakai payout untuk maker-checker. */
  user_id?: string;
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

/* -------------------------------------------------------------------------- */
/* Tiket handoff 2FA (FR-128)                                                 */
/* -------------------------------------------------------------------------- */

const MFA_KEY = 'tarlink.admin.mfa';

export type MfaTicketKind = 'verify' | 'enroll';

/** Tiket diterima dari `POST /auth/login` lalu dipakai halaman 2FA. */
export interface MfaTicketInput {
  kind: MfaTicketKind;
  token: string;
  /** `expires_in` dari API, dalam detik. */
  expiresIn: number;
}

export interface MfaTicket {
  kind: MfaTicketKind;
  token: string;
  /** Epoch ms. Tiket yang sudah lewat dianggap tidak ada. */
  expires_at: number;
}

/**
 * Tiket hanya hidup di tab ini dan hanya sampai API menyatakan kedaluwarsa.
 * Access token tidak pernah disimpan di sini: sesi baru dibuat setelah kode sah.
 */
export function saveMfaTicket(input: MfaTicketInput): void {
  if (!isBrowser()) return;
  const ticket: MfaTicket = {
    kind: input.kind,
    token: input.token,
    expires_at: Date.now() + input.expiresIn * 1000
  };
  try {
    window.sessionStorage.setItem(MFA_KEY, JSON.stringify(ticket));
  } catch {
    // Penyimpanan diblokir: halaman 2FA akan mengalihkan kembali ke /login.
  }
}

export function readMfaTicket(): MfaTicket | null {
  if (!isBrowser()) return null;
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(MFA_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearMfaTicket();
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    clearMfaTicket();
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== 'verify' && kind !== 'enroll') {
    clearMfaTicket();
    return null;
  }
  if (typeof record.token !== 'string' || record.token.length === 0) {
    clearMfaTicket();
    return null;
  }
  if (typeof record.expires_at !== 'number' || !Number.isFinite(record.expires_at)) {
    clearMfaTicket();
    return null;
  }
  if (record.expires_at <= Date.now()) {
    clearMfaTicket();
    return null;
  }

  return { kind, token: record.token, expires_at: record.expires_at };
}

export function clearMfaTicket(): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(MFA_KEY);
  } catch {
    // Tidak ada yang bisa dibersihkan.
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
