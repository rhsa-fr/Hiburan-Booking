/**
 * Email delivery port (ADR 0011).
 *
 * The provider is not chosen yet, so the service depends on `Mailer` only.
 * `LoggingMailer` is for development/test and never prints the code.
 * `HttpMailer` posts to a generic provider endpoint configured by env.
 */
import { AppError } from '@tarlink/core/errors';
import { HttpEmailTransport, type EmailTransport } from '@tarlink/platform/email';

/** Why the code was sent; decides the subject line only. */
export type OtpEmailPurpose = 'login' | 'register' | 'password_reset';

export interface OtpEmail {
  readonly to: string;
  readonly code: string;
  readonly ttlSeconds: number;
  /** A login code must never be accepted by the register/reset endpoints. */
  readonly purpose: OtpEmailPurpose;
}

export interface Mailer {
  sendOtp(input: OtpEmail): Promise<void>;
}

/** Rendered email parts handed to the transport. */
export interface BuiltOtpEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const OTP_SUBJECTS: Record<OtpEmailPurpose, string> = {
  login: 'Kode masuk Tarlink',
  register: 'Kode verifikasi pendaftaran Tarlink',
  password_reset: 'Kode reset kata sandi Tarlink'
};

const OTP_HEADINGS: Record<OtpEmailPurpose, string> = {
  login: 'Kode masuk',
  register: 'Verifikasi pendaftaran',
  password_reset: 'Reset kata sandi'
};

const OTP_INTROS: Record<OtpEmailPurpose, string> = {
  login: 'Gunakan kode ini untuk masuk ke akun Tarlink kamu.',
  register: 'Gunakan kode ini untuk menyelesaikan pendaftaran akun Tarlink kamu.',
  password_reset: 'Gunakan kode ini untuk membuat kata sandi baru untuk akun Tarlink kamu.'
};

/** Short label used by the plain-text part only. */
const OTP_TEXT_ACTIONS: Record<OtpEmailPurpose, string> = {
  login: 'masuk',
  register: 'verifikasi pendaftaran',
  password_reset: 'reset kata sandi'
};

/**
 * Email palette. Inline styles only: Gmail and Outlook strip `<style>` blocks,
 * and no external image is allowed, so the wordmark is text.
 */
const INK = '#0B1220';
const LIME = '#D7F36A';
const PAPER = '#F6F3EC';
const CARD = '#FFFFFF';
const MUTED = '#5B6472';
const LINE = '#E7E1D6';
const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
const MONO_STACK = "'Courier New',Courier,monospace";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Mail clients cannot copy from a button, so the code block itself is the copy
 * target. The hint is the only call to action and it needs no URL.
 */
const OTP_COPY_HINT = 'Tekan lama kode di atas, lalu pilih Salin.';

/**
 * Pure renderer for the OTP email; `sendOtp` and the tests share it.
 * The code is the only dynamic payload and it is never logged here. The email
 * carries no link at all: copying happens by long-pressing the code itself.
 */
export function buildOtpEmail(input: OtpEmail): BuiltOtpEmail {
  const subject = OTP_SUBJECTS[input.purpose];
  const heading = OTP_HEADINGS[input.purpose];
  const intro = OTP_INTROS[input.purpose];
  const action = OTP_TEXT_ACTIONS[input.purpose];
  const minutes = Math.max(1, Math.floor(input.ttlSeconds / 60));
  const code = input.code;
  const note = `Berlaku ${minutes} menit. Jangan bagikan kode ini ke siapa pun, termasuk yang mengaku dari Tarlink.`;
  const safeCode = escapeHtml(code);

  const text = [
    `Kode ${action}: ${code}`,
    '',
    OTP_COPY_HINT,
    `Berlaku ${minutes} menit. Jangan bagikan kode ini ke siapa pun.`
  ].join('\n');

  // Table-based layout with inline CSS: the only markup every mail client agrees on.
  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPER};padding:24px 12px;">
<tr>
<td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;background-color:${CARD};border:1px solid ${LINE};border-radius:16px;">
<tr>
<td style="padding:24px 24px 0 24px;font-family:${FONT_STACK};font-size:20px;font-weight:700;line-height:1.2;letter-spacing:-0.4px;color:${INK};">Tarlink</td>
</tr>
<tr>
<td style="padding:16px 24px 0 24px;font-family:${FONT_STACK};">
<h1 style="margin:0;font-size:20px;line-height:1.3;color:${INK};">${escapeHtml(heading)}</h1>
<p style="margin:8px 0 0 0;font-size:14px;line-height:1.6;color:${MUTED};">${escapeHtml(intro)}</p>
</td>
</tr>
<tr>
<td style="padding:20px 24px 0 24px;">
<div style="background-color:${LIME};border-radius:12px;padding:20px 12px;text-align:center;font-family:${MONO_STACK};font-size:32px;font-weight:700;line-height:1.2;letter-spacing:8px;color:${INK};user-select:all;-webkit-user-select:all;-ms-user-select:all;">${safeCode}</div>
</td>
</tr>
<tr>
<td style="padding:12px 24px 0 24px;font-family:${FONT_STACK};text-align:center;">
<p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};">${escapeHtml(OTP_COPY_HINT)}</p>
</td>
</tr>
<tr>
<td style="padding:12px 24px 0 24px;font-family:${FONT_STACK};">
<p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};">${escapeHtml(note)}</p>
</td>
</tr>
<tr>
<td style="padding:24px;font-family:${FONT_STACK};">
<hr style="border:0;border-top:1px solid ${LINE};margin:0 0 16px 0;" />
<p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">Email otomatis dari Tarlink. Jangan balas email ini.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}

/** Unknown/blank provider names keep the Resend dialect the transport started with. */
function parseProvider(value: string | undefined): 'resend' | 'brevo' {
  return value?.trim().toLowerCase() === 'brevo' ? 'brevo' : 'resend';
}

export class LoggingMailer implements Mailer {
  async sendOtp(input: OtpEmail): Promise<void> {
    // The code is deliberately omitted; use `OTP_DEV_MODE` + `dev_code`.
    console.info(
      `[mailer] ${input.purpose} OTP email to ${input.to} (code omitted, ttl ${input.ttlSeconds}s)`
    );
  }
}

export class HttpMailer implements Mailer {
  private readonly transport: EmailTransport;

  constructor(url: string, apiKey: string | null, from: string, provider?: string) {
    // Shared transport (FR-051): the OTP email and booking notifications post
    // the same provider payload, so the HTTP/timeout logic lives in one place.
    // The 3-argument form stays valid and means the Resend-shaped body.
    this.transport = new HttpEmailTransport(url, apiKey, from, {
      provider: parseProvider(provider)
    });
  }

  async sendOtp(input: OtpEmail): Promise<void> {
    const email = buildOtpEmail(input);
    try {
      await this.transport.sendEmail({
        to: input.to,
        subject: email.subject,
        // Plain-text stays always present: some clients and screen readers use it.
        text: email.text,
        html: email.html
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
  /** Payload dialect of `apiUrl`; defaults to the Resend-shaped body. */
  readonly provider?: string;
}

export function createMailer(env: MailerEnv): Mailer {
  if (env.apiUrl) {
    return new HttpMailer(
      env.apiUrl,
      env.apiKey ?? null,
      env.from ?? 'Tarlink <no-reply@tarlink.id>',
      env.provider
    );
  }
  return env.nodeEnv === 'production' ? new UnconfiguredMailer() : new LoggingMailer();
}
