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
}

const DEFAULT_FROM = 'Tarlink <no-reply@tarlink.id>';
const DEFAULT_TIMEOUT_MS = 10_000;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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

  constructor(
    private readonly url: string,
    private readonly apiKey: string | null,
    from: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {
    this.from = from;
  }

  async sendEmail(message: EmailMessage): Promise<void> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {})
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      // Status only: the provider response body is untrusted.
      throw new Error(`Email provider rejected the message (HTTP ${response.status})`);
    }
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
      nonEmpty(env.from) ?? DEFAULT_FROM
    );
  }
  return env.nodeEnv === 'production'
    ? new UnconfiguredEmailTransport()
    : new LoggingEmailTransport();
}
