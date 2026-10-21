/**
 * Google ID token verification via Google's tokeninfo endpoint.
 *
 * The verifier is an interface so `AuthService` can be tested without network.
 * Every rejection is the same `UNAUTHENTICATED` error: callers must not learn
 * whether the signature, audience, issuer or expiry failed.
 *
 * `GOOGLE_CLIENT_ID` is read by `auth.module.ts` from `process.env` (the config
 * schema in `apps/api/src/core/config.ts` is lead-owned and not extended here).
 */
import { AppError } from '@tarlink/core/errors';

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const DEFAULT_TIMEOUT_MS = 5_000;
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export interface GoogleIdentity {
  /** Google `sub`: stable, unique per Google account. */
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

export interface GoogleTokenVerifier {
  verify(idToken: string): Promise<GoogleIdentity>;
}

type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function invalidToken(): AppError {
  return new AppError('UNAUTHENTICATED', 'Google sign-in tidak valid');
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export class GoogleTokenInfoVerifier implements GoogleTokenVerifier {
  private readonly clientId: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(clientId: string, fetchImpl: FetchLike = fetch, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.clientId = clientId;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (typeof idToken !== 'string' || idToken.length === 0 || this.clientId.length === 0) {
      throw invalidToken();
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(
        `${TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`,
        { signal: controller.signal }
      );
      if (!response.ok) {
        throw invalidToken();
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const sub = asString(payload.sub);
      const email = asString(payload.email);
      const audience = asString(payload.aud);
      const issuer = asString(payload.iss);
      const emailVerified = payload.email_verified;
      const expiresAt = Number(payload.exp);

      if (!sub || !email || !email.includes('@')) {
        throw invalidToken();
      }
      if (audience !== this.clientId) {
        throw invalidToken();
      }
      if (!issuer || !GOOGLE_ISSUERS.has(issuer)) {
        throw invalidToken();
      }
      if (!(emailVerified === true || emailVerified === 'true')) {
        throw invalidToken();
      }
      if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) {
        throw invalidToken();
      }

      return { sub, email, emailVerified: true };
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Network error, abort/timeout or malformed JSON: still one generic answer.
      throw invalidToken();
    } finally {
      clearTimeout(timer);
    }
  }
}
