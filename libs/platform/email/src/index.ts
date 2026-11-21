/**
 * Email delivery port (FR-051, ADR 0011).
 *
 * One transport for every transactional email: OTP codes and booking status
 * notifications post the same JSON body to `EMAIL_API_URL`. The provider is
 * deliberately generic — swapping providers is a configuration change, not a
 * code change.
 *
 * Rules kept here:
 * 1. Never log the message body: an OTP body contains the code.
 * 2. A provider failure throws. Callers decide whether that retries a job
 *    (worker outbox) or fails a request (OTP request).
 * 3. Every request has a timeout: a hung provider must not stall a worker tick.
 */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain-text body. Always sent; HTML is an optional alternative part. */
  readonly text: string;
  readonly html?: string;
}

export interface EmailTransport {
  sendEmail(message: EmailMessage): Promise<void>;
}

export interface EmailTransportEnv {
  readonly nodeEnv: string;
  /** Provider endpoint. Empty/whitespace counts as unset. */
  readonly apiUrl?: string;
  readonly apiKey?: string;
  readonly from?: string;
  /**
   * Payload dialect of `apiUrl`. 'brevo' speaks the Brevo SMTP API; anything
   * else (including unset) means the Resend-shaped body this transport has
   * always posted.
   */
  readonly provider?: string;
}

export type EmailProvider = 'resend' | 'brevo';

const DEFAULT_FROM = 'Tarlink <no-reply@tarlink.id>';
const DEFAULT_TIMEOUT_MS = 10_000;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Unknown/blank providers keep the original Resend dialect (backward compatible). */
function parseProvider(value: string | undefined): EmailProvider {
  return nonEmpty(value)?.toLowerCase() === 'brevo' ? 'brevo' : 'resend';
}

interface BrevoSender {
  email: string;
  name?: string;
}

const NAMED_SENDER = /^\s*(.*?)\s*<([^<>]+)>\s*$/;
const BARE_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * Brevo wants `{ sender: { email, name? } }`; `EMAIL_FROM` stays one string for
 * every provider, so it is parsed here. A malformed sender fails before the
 * request instead of sending mail the provider will reject.
 */
function parseBrevoSender(from: string): BrevoSender {
  const raw = from.trim();
  const named = NAMED_SENDER.exec(raw);
  const email = (named ? named[2] : raw)?.trim() ?? '';
  if (!BARE_EMAIL.test(email)) {
    throw new Error(
      'EMAIL_FROM tidak valid; Brevo butuh "Nama <email@domain>" atau "email@domain"'
    );
  }
  const name = (named?.[1] ?? '').trim();
  return name ? { email, name } : { email };
}

interface HttpRequestParts {
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Development/test transport: records that a message would have been sent. */
export class LoggingEmailTransport implements EmailTransport {
  async sendEmail(message: EmailMessage): Promise<void> {
    // Subject only — the body may contain an OTP code or personal data.
    console.info(`[email] skipped to=${message.to} subject=${JSON.stringify(message.subject)}`);
  }
}

export class HttpEmailTransport implements EmailTransport {
  private readonly from: string;
  private readonly provider: EmailProvider;
  private readonly timeoutMs: number;

  constructor(
    private readonly url: string,
    private readonly apiKey: string | null,
    from: string,
    options: { provider?: EmailProvider; timeoutMs?: number } = {}
  ) {
    this.from = from;
    this.provider = options.provider ?? 'resend';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    // Built before `fetch`: a Brevo request missing its key or a usable sender
    // must fail here, never reach the network unauthenticated.
    const request =
      this.provider === 'brevo' ? this.brevoRequest(message) : this.resendRequest(message);

    const response = await fetch(this.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      // Status only: the provider response body is untrusted.
      throw new Error(`Email provider rejected the message (HTTP ${response.status})`);
    }
  }

  private resendRequest(message: EmailMessage): HttpRequestParts {
    return {
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: {
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {})
      }
    };
  }

  private brevoRequest(message: EmailMessage): HttpRequestParts {
    if (!this.apiKey) {
      throw new Error('EMAIL_API_KEY belum dikonfigurasi; Brevo menolak email tanpa api-key');
    }
    return {
      headers: {
        'content-type': 'application/json',
        'api-key': this.apiKey
      },
      body: {
        sender: parseBrevoSender(this.from),
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        ...(message.html ? { htmlContent: message.html } : {})
      }
    };
  }
}

/** Production without a provider: fail closed instead of silently dropping mail. */
export class UnconfiguredEmailTransport implements EmailTransport {
  async sendEmail(): Promise<void> {
    throw new Error('EMAIL_API_URL belum dikonfigurasi; email tidak bisa dikirim');
  }
}

export function createEmailTransport(env: EmailTransportEnv): EmailTransport {
  const url = nonEmpty(env.apiUrl);
  if (url) {
    return new HttpEmailTransport(
      url,
      nonEmpty(env.apiKey) ?? null,
      nonEmpty(env.from) ?? DEFAULT_FROM,
      { provider: parseProvider(env.provider) }
    );
  }
  return env.nodeEnv === 'production'
    ? new UnconfiguredEmailTransport()
    : new LoggingEmailTransport();
}
