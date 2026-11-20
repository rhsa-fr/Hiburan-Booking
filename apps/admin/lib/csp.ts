/**
 * Single source of truth for the panel's Content-Security-Policy.
 *
 * This module imports nothing from `next/server` and uses no Node-only API, so
 * the Edge middleware bundle and the Node unit-test lane can both evaluate it.
 * The middleware owns the per-request nonce and writes the returned string onto
 * both the forwarded request and the response.
 */

export type CspOptions = {
  /** Per-request nonce, base64 encoded. Also forwarded as the `x-nonce` header. */
  nonce: string;
  /** Adds the development-only escape hatches (`'unsafe-eval'` and `ws:`). */
  isProduction: boolean;
  /** Absolute origin of the Tarlink API, e.g. `http://localhost:3001`. */
  apiOrigin: string;
  /** Absolute origin serving vendor media; may be the same as `apiOrigin`. */
  mediaOrigin: string;
};

const GOOGLE_IDENTITY = 'https://accounts.google.com';
/** Avatars embedded by Google Identity Services. */
const GOOGLE_AVATARS = 'https://*.googleusercontent.com';

/**
 * Normalises an absolute URL to its origin. A blank value falls back to the
 * given origin, and a malformed value is reported and dropped: splicing the raw
 * string into the CSP header could append unintended sources.
 */
export function toOrigin(value: string, fallback: string): string {
  const candidate = value.trim();
  if (!candidate) return fallback;
  try {
    const origin = new URL(candidate).origin;
    // `file:` and other non-network schemes stringify as "null".
    if (origin === 'null') return fallback;
    return origin;
  } catch {
    console.warn(`[csp] mengabaikan origin tidak valid: ${candidate.slice(0, 80)}`);
    return fallback;
  }
}

/** Collapses duplicates while dropping blank values (failed origin parsing). */
function unique(values: string[]): string[] {
  return [...new Set(values)].filter((value) => value.length > 0);
}

export function buildContentSecurityPolicy(options: CspOptions): string {
  const { nonce, isProduction, apiOrigin, mediaOrigin } = options;

  // Google Identity Services is injected at runtime by a nonced Next chunk, so
  // 'strict-dynamic' is what actually authorises it; the explicit host stays as
  // a fallback for browsers that ignore 'strict-dynamic'. No 'unsafe-inline':
  // inline scripts must carry the per-request nonce.
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    GOOGLE_IDENTITY,
    ...(isProduction ? [] : ["'unsafe-eval'"])
  ].join(' ');

  // 'unsafe-inline' is required and has no nonce alternative: next/font emits an
  // inline @font-face block, and the chart components in components/ui.tsx pass
  // style attributes (bar height, grid columns, conic-gradient, width %). A
  // style nonce cannot cover style attributes, so it would break both without
  // buying script protection. Google Identity Services also loads its button
  // stylesheet from accounts.google.com/gsi/style.
  const styleSrc = ["'self'", "'unsafe-inline'", GOOGLE_IDENTITY].join(' ');

  const imgSrc = [
    "'self'",
    'data:',
    'blob:',
    ...unique([apiOrigin, mediaOrigin]),
    GOOGLE_IDENTITY,
    GOOGLE_AVATARS
  ].join(' ');

  // ws: is needed by the dev HMR socket only.
  const connectSrc = [
    "'self'",
    ...unique([apiOrigin]),
    GOOGLE_IDENTITY,
    ...(isProduction ? [] : ['ws:'])
  ].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src ${imgSrc}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    `frame-src 'self' ${GOOGLE_IDENTITY}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ');
}
