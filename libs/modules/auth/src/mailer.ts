/**
 * Email delivery port (ADR 0011).
 *
 * The provider is not chosen yet, so the service depends on `Mailer` only.
 * `LoggingMailer` is for development/test and never prints the code.
 * `HttpMailer` posts to a generic provider endpoint configured by env.
 */
import { AppError } from '@tarlink/core/errors';
import { HttpEmailTransport, type EmailTransport } from '@tarlink/platform/email';

export interface OtpEmail {
  readonly to: string;
  readonly code: string;
  readonly ttlSeconds: number;
}

export interface Mailer {
  sendOtp(input: OtpEmail): Promise<void>;
}

export class LoggingMailer implements Mailer {
  async sendOtp(input: OtpEmail): Promise<void> {
    // The code is deliberately omitted; use `OTP_DEV_MODE` + `dev_code`.
    console.info(`[mailer] OTP email to ${input.to} (code omitted, ttl ${input.ttlSeconds}s)`);
  }
}

export class HttpMailer implements Mailer {
  private readonly transport: EmailTransport;

  constructor(url: string, apiKey: string | null, from: string) {
    // Shared transport (FR-051): the OTP email and booking notifications post
    // the same provider payload, so the HTTP/timeout logic lives in one place.
    this.transport = new HttpEmailTransport(url, apiKey, from);
  }

  async sendOtp(input: OtpEmail): Promise<void> {
    try {
      await this.transport.sendEmail({
        to: input.to,
        subject: 'Kode OTP Tarlink',
        text: `Kode OTP kamu: ${input.code}. Berlaku ${Math.floor(input.ttlSeconds / 60)} menit.`
      });
    } catch {
      // Provider errors are not user-facing details; keep the API contract.
      throw new AppError('UPSTREAM_ERROR', 'Email OTP gagal dikirim');
    }
  }
}

/** Production must configure a real provider; otherwise OTP is impossible. */
class UnconfiguredMailer implements Mailer {
  async sendOtp(): Promise<void> {
    throw new AppError('UPSTREAM_ERROR', 'Provider email belum dikonfigurasi');
  }
}

export interface MailerEnv {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly apiUrl?: string;
  readonly apiKey?: string;
  readonly from?: string;
}

export function createMailer(env: MailerEnv): Mailer {
  if (env.apiUrl) {
    return new HttpMailer(env.apiUrl, env.apiKey ?? null, env.from ?? 'Tarlink <no-reply@tarlink.id>');
  }
  return env.nodeEnv === 'production' ? new UnconfiguredMailer() : new LoggingMailer();
}
