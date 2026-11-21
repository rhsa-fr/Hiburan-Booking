/**
 * OTP email rendering, no network. The transport is stubbed so the tests prove
 * what `sendOtp` actually hands over (subject, plain text, HTML) and that the
 * code never escapes into a thrown message. The email is asserted to carry no
 * link at all: copying is done by long-pressing the code block.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import {
  HttpMailer,
  LoggingMailer,
  buildOtpEmail,
  createMailer,
  type OtpEmail,
  type OtpEmailPurpose
} from './mailer';

const COPY_HINT = 'Tekan lama kode di atas, lalu pilih Salin.';

function emailFor(purpose: OtpEmailPurpose, code = '123456'): OtpEmail {
  return { to: 'pelanggan@example.com', code, ttlSeconds: 600, purpose };
}

const PURPOSES: ReadonlyArray<{
  purpose: OtpEmailPurpose;
  subject: string;
  heading: string;
  action: string;
}> = [
  {
    purpose: 'login',
    subject: 'Kode masuk Tarlink',
    heading: 'Kode masuk',
    action: 'masuk'
  },
  {
    purpose: 'register',
    subject: 'Kode verifikasi pendaftaran Tarlink',
    heading: 'Verifikasi pendaftaran',
    action: 'verifikasi pendaftaran'
  },
  {
    purpose: 'password_reset',
    subject: 'Kode reset kata sandi Tarlink',
    heading: 'Reset kata sandi',
    action: 'reset kata sandi'
  }
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('buildOtpEmail', () => {
  it.each(PURPOSES)(
    'renders the $purpose subject, heading, code and copy hint',
    ({ purpose, subject, heading, action }) => {
      const built = buildOtpEmail(emailFor(purpose));

      expect(built.subject).toBe(subject);
      expect(built.html).toContain(`>${heading}<`);
      expect(built.html).toContain('123456');
      expect(built.html).toContain('Tekan lama kode');
      expect(built.text).toContain(`Kode ${action}: 123456`);
      expect(built.text).toContain('Tekan lama kode');
      expect(built.text).toContain('Berlaku 10 menit. Jangan bagikan kode ini ke siapa pun.');
      expect(built.html).toContain(
        'Jangan bagikan kode ini ke siapa pun, termasuk yang mengaku dari Tarlink.'
      );
      expect(built.html).toContain('Email otomatis dari Tarlink. Jangan balas email ini.');
    }
  );

  it('carries no link and no absolute url in either part', () => {
    const built = buildOtpEmail(emailFor('login'));

    for (const part of [built.html, built.text]) {
      expect(part).not.toContain('http://');
      expect(part).not.toContain('https://');
    }
    expect(built.html).not.toContain('<a ');
    expect(built.html).not.toContain('href=');
    expect(built.html).not.toContain('Salin kode');
  });

  it('places the copy hint under the code block, before the expiry note', () => {
    const built = buildOtpEmail(emailFor('login'));
    const codeBlock = built.html.indexOf('user-select:all');
    const hint = built.html.indexOf(COPY_HINT);
    const note = built.html.indexOf('Berlaku 10 menit.');

    expect(codeBlock).toBeGreaterThan(-1);
    expect(hint).toBeGreaterThan(codeBlock);
    expect(note).toBeGreaterThan(hint);
  });

  it('puts the code on its own line in the plain-text part', () => {
    const built = buildOtpEmail(emailFor('password_reset'));
    const lines = built.text.split('\n');

    expect(lines[0]).toBe('Kode reset kata sandi: 123456');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe(COPY_HINT);
    expect(lines[3]).toBe('Berlaku 10 menit. Jangan bagikan kode ini ke siapa pun.');
    expect(built.text).not.toContain('Salin:');
    expect(built.html).toContain('123456');
  });

  it('keeps the code selectable and out of the recipient address', () => {
    const built = buildOtpEmail(emailFor('login'));

    expect(built.html).toContain('user-select:all');
    expect(built.html).toContain('-webkit-user-select:all');
    expect(built.html).not.toContain('pelanggan@example.com');
    expect(built.text).not.toContain('pelanggan@example.com');
  });

  it('never puts the code in the subject line', () => {
    for (const { purpose } of PURPOSES) {
      const built = buildOtpEmail(emailFor(purpose));
      expect(built.subject).not.toContain('123456');
    }
  });
});

describe('HttpMailer.sendOtp', () => {
  function postedBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
    const call = fetchMock.mock.calls[0] as [string, RequestInit] | undefined;
    if (!call) throw new Error('fetch was not called');
    return JSON.parse(String(call[1].body)) as Record<string, string>;
  }

  it('posts the branded html together with the plain-text fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    await new HttpMailer(
      'https://mail.example.com/send',
      null,
      'Tarlink <no-reply@tarlink.id>'
    ).sendOtp(emailFor('login'));

    const body = postedBody(fetchMock);
    expect(body.to).toBe('pelanggan@example.com');
    expect(body.subject).toBe('Kode masuk Tarlink');
    expect(body.text).toContain('123456');
    expect(body.text).toContain(COPY_HINT);
    expect(body.html).toContain('123456');
    expect(body.html).toContain(COPY_HINT);
    expect(body.html).not.toContain('https://mail.example.com');
  });

  it('maps a provider failure to UPSTREAM_ERROR without leaking the code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'provider down' })
    );

    const mailer = new HttpMailer('https://mail.example.com/send', null, 'Tarlink <a@b.c>');
    const error = await mailer.sendOtp(emailFor('login')).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('UPSTREAM_ERROR');
    expect((error as AppError).message).toBe('Email OTP gagal dikirim');
    expect(String((error as AppError).message)).not.toContain('123456');
  });

  it('sends the same link-free email through createMailer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    const mailer = createMailer({
      nodeEnv: 'test',
      apiUrl: 'https://mail.example.com/send'
    });
    await mailer.sendOtp(emailFor('register'));

    const body = postedBody(fetchMock);
    expect(body.text).toContain('123456');
    expect(body.html).toContain('123456');
    expect(body.html).not.toContain('http://');
    expect(body.html).not.toContain('https://');
  });

  it('never prints the code through the development mailer', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await new LoggingMailer().sendOtp(emailFor('login'));

    const line = String(info.mock.calls[0]?.[0] ?? '');
    expect(line).toContain('pelanggan@example.com');
    expect(line).not.toContain('123456');
  });

  it('falls back to the logging mailer outside production', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const mailer = createMailer({ nodeEnv: 'test' });
    expect(mailer).toBeInstanceOf(LoggingMailer);
    await mailer.sendOtp(emailFor('login'));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed in production when no provider endpoint is configured', async () => {
    const mailer = createMailer({ nodeEnv: 'production' });
    const error = await mailer.sendOtp(emailFor('login')).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('UPSTREAM_ERROR');
    expect((error as AppError).message).toBe('Provider email belum dikonfigurasi');
  });
});
