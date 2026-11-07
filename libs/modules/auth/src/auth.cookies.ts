/**
 * Refresh-token cookie helpers for the browser-facing admin panel.
 *
 * The refresh token is opaque and lives for 30 days; in the panel it is carried
 * by an HttpOnly cookie so JavaScript (and therefore an XSS payload) cannot
 * read it. Mobile keeps using the `refresh_token` body field, which is why the
 * helpers here are pure and only ever called on the opt-in `cookie: true` path.
 *
 * `Path=/v1/auth` limits the cookie to the routes that need it and
 * `SameSite=Strict` keeps a third-party page from driving a refresh with the
 * victim's cookie.
 */

/** Cookie name shared by the writer, the reader and the clearing header. */
export const REFRESH_COOKIE_NAME = 'tarlink_rt';

/** Only the auth routes accept the refresh credential. */
const COOKIE_PATH = '/v1/auth';

export interface RefreshCookieOptions {
  readonly secure: boolean;
  readonly maxAgeSeconds: number;
}

/** Builds the `Set-Cookie` value that stores a rotated refresh token. */
export function serializeRefreshCookie(token: string, options: RefreshCookieOptions): string {
  const attributes = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${options.maxAgeSeconds}`
  ];
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** Builds the `Set-Cookie` value that drops the refresh cookie on logout. */
export function clearRefreshCookie(options: { secure: boolean }): string {
  const attributes = [
    `${REFRESH_COOKIE_NAME}=`,
    `Path=${COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

/**
 * Whether the raw `Cookie` header names `name` at all.
 *
 * `readCookie` cannot tell "absent" from "present but unusable", which is why
 * this predicate exists: a corrupt cookie must still be cleared instead of
 * being resent on every request. Values (empty, undecodable or otherwise) and
 * the `=` separator are deliberately irrelevant here.
 */
export function hasCookie(header: string | undefined, name: string): boolean {
  if (typeof header !== 'string' || header.length === 0) return false;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    const rawName = separator === -1 ? part : part.slice(0, separator);
    if (rawName.trim() === name) return true;
  }
  return false;
}

/**
 * First `name=value` pair from a raw `Cookie` header. Returns null for a
 * missing header, an empty value or undecodable percent-encoding, so a
 * malformed cookie can never turn into a 500.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (typeof header !== 'string' || header.length === 0) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const raw = part.slice(separator + 1).trim();
    if (raw.length === 0) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}
