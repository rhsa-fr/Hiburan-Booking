/**
 * Sesi operator mock. Profil operator dan tiket 2FA disimpan di sessionStorage
 * browser (per tab). Access token disimpan di localStorage supaya semua tab
 * membaca token terbaru yang sama: refresh cookie berotasi setiap dipakai, dan
 * salinan per-tab akan saling mencabut sesi.
 *
 * Rekaman token juga menyimpan pemiliknya (`userId`). Di workstation bersama,
 * tab yang masih memegang profil operator lain tidak boleh memakai token milik
 * operator yang baru masuk: `readToken()` menolak token yang pemiliknya beda.
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

/** Rekaman token: `userId` adalah pemilik sesi yang menulisnya. */
interface StoredToken {
  token: string;
  userId: string;
}

/**
 * Access token dari API. Disimpan terpisah dari profil agar mudah dicabut.
 * `saveToken` satu-satunya penulis: token tanpa pemilik tidak bisa diverifikasi
 * di workstation bersama, jadi setiap penulisan wajib menyertakan `userId`.
 */
export function saveToken(token: string, userId: string): void {
  if (!isBrowser()) return;
  const record: StoredToken = { token, userId };
  try {
    // localStorage: satu salinan untuk seluruh browser, bukan satu per tab.
    window.localStorage.setItem(TOKEN_KEY, JSON.stringify(record));
  } catch {
    // Penyimpanan diblokir: sesi hanya berlaku selama tab hidup di memori.
  }
}

/**
 * Token hanya dikembalikan bila tidak ada profil di tab ini atau profil itu
 * memang pemilik token. Tab basi (operator lain sudah masuk di tab lain)
 * menerima `null` sehingga dialihkan ke /login, bukan memakai hak akses orang
 * lain.
 */
export function readToken(): string | null {
  if (!isBrowser()) return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Sisa format lama (token mentah tanpa pemilik) tidak bisa dipercaya.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  if (typeof record.token !== 'string' || record.token.length === 0) return null;
  if (typeof record.userId !== 'string') return null;

  const sessionUserId = readSession()?.user_id;
  if (typeof sessionUserId === 'string' && sessionUserId !== record.userId) return null;
  return record.token;
}

export function clearToken(): void {
  if (!isBrowser()) return;
  // Sesi lama (sebelum token pindah ke localStorage) masih punya salinan
  // sessionStorage; hapus keduanya supaya tidak ada token yang tertinggal.
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Tidak ada yang bisa dibersihkan.
  }
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Tidak ada yang bisa dibersihkan.
  }
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
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
  } catch {
    // Tidak ada yang bisa dibersihkan; sesi sudah dianggap berakhir.
  }
  // Token bisa berasal dari dua storage selama masa transisi.
  clearToken();
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
