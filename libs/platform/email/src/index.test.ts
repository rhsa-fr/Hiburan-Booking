import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpEmailTransport,
  LoggingEmailTransport,
  UnconfiguredEmailTransport,
  createEmailTransport
} from './index';

const MESSAGE = { to: 'pelanggan@example.com', subject: 'Pesanan diterima — TRL-1', text: 'Halo' };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createEmailTransport', () => {
  it('uses HTTP when an endpoint is configured, in every environment', () => {
    expect(
      createEmailTransport({ nodeEnv: 'production', apiUrl: 'https://mail.example.com/send' })
    ).toBeInstanceOf(HttpEmailTransport);
    expect(
      createEmailTransport({ nodeEnv: 'test', apiUrl: 'https://mail.example.com/send' })
    ).toBeInstanceOf(HttpEmailTransport);
  });

  it('treats a blank endpoint as unset', () => {
    expect(createEmailTransport({ nodeEnv: 'development', apiUrl: '   ' })).toBeInstanceOf(
      LoggingEmailTransport
    );
  });

  it('fails closed in production without a provider', async () => {
    const transport = createEmailTransport({ nodeEnv: 'production' });
    expect(transport).toBeInstanceOf(UnconfiguredEmailTransport);
    await expect(transport.sendEmail(MESSAGE)).rejects.toThrow(/EMAIL_API_URL/);
  });

  it('logs outside production instead of throwing', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const transport = createEmailTransport({ nodeEnv: 'development' });
    await transport.sendEmail(MESSAGE);
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0] ?? '');
    expect(line).toContain('pelanggan@example.com');
    // Body may hold an OTP code or personal data.
    expect(line).not.toContain('Halo');
  });
});

describe('HttpEmailTransport', () => {
  it('posts the provider payload with the bearer key and no html part by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new HttpEmailTransport(
      'https://mail.example.com/send',
      'secret-key',
      'Tarlink <no-reply@tarlink.id>'
    );
    await transport.sendEmail(MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mail.example.com/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      from: 'Tarlink <no-reply@tarlink.id>',
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text
    });
    expect(init.signal).toBeDefined();
  });

  it('includes the html part only when supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await new HttpEmailTransport('https://mail.example.com/send', null, 'a@b.c').sendEmail({
      ...MESSAGE,
      html: '<p>Halo</p>'
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.html).toBe('<p>Halo</p>');
    expect(
      ((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>)
        .authorization
    ).toBeUndefined();
  });

  it('throws without leaking the provider response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'internal detail' })
    );

    const transport = new HttpEmailTransport('https://mail.example.com/send', null, 'a@b.c');
    await expect(transport.sendEmail(MESSAGE)).rejects.toThrow(
      'Email provider rejected the message (HTTP 500)'
    );
  });
});
