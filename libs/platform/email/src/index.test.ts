import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpEmailTransport,
  LoggingEmailTransport,
  UnconfiguredEmailTransport,
  createEmailTransport
} from './index';

const MESSAGE = { to: 'pelanggan@example.com', subject: 'Pesanan diterima — TRL-1', text: 'Halo' };
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Read back what the transport actually posted, without trusting its internals. */
function posted(fetchMock: ReturnType<typeof vi.fn>): {
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const call = fetchMock.mock.calls[0] as [string, RequestInit] | undefined;
  if (!call) throw new Error('fetch was not called');
  return {
    headers: call[1].headers as Record<string, string>,
    body: JSON.parse(String(call[1].body)) as Record<string, unknown>
  };
}

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

  it('fails closed in production when the endpoint is blank', async () => {
    const transport = createEmailTransport({
      nodeEnv: 'production',
      apiUrl: '',
      apiKey: 'brevo-key',
      provider: 'brevo'
    });
    expect(transport).toBeInstanceOf(UnconfiguredEmailTransport);
    await expect(transport.sendEmail(MESSAGE)).rejects.toThrow(/EMAIL_API_URL/);
  });

  it('passes a case-insensitive brevo provider through to the payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);

    await createEmailTransport({
      nodeEnv: 'production',
      apiUrl: BREVO_URL,
      apiKey: 'brevo-key',
      from: 'a@b.c',
      provider: '  BrEvO '
    }).sendEmail(MESSAGE);

    const { headers, body } = posted(fetchMock);
    expect(headers['api-key']).toBe('brevo-key');
    expect(body.textContent).toBe(MESSAGE.text);
    expect(body).not.toHaveProperty('from');
  });

  it('falls back to the resend payload for an unknown provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    await createEmailTransport({
      nodeEnv: 'production',
      apiUrl: 'https://mail.example.com/send',
      apiKey: 'secret-key',
      provider: 'sendgrid'
    }).sendEmail(MESSAGE);

    const { headers, body } = posted(fetchMock);
    expect(headers.authorization).toBe('Bearer secret-key');
    expect(headers['api-key']).toBeUndefined();
    expect(body).toEqual({
      from: 'Tarlink <no-reply@tarlink.id>',
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text
    });
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

  it('posts the brevo payload with an api-key header and no resend fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);

    await new HttpEmailTransport(BREVO_URL, 'brevo-key', 'Tarlink <no-reply@tarlink.id>', {
      provider: 'brevo'
    }).sendEmail(MESSAGE);

    const { headers, body } = posted(fetchMock);
    expect(headers['api-key']).toBe('brevo-key');
    expect(headers.authorization).toBeUndefined();
    expect(body).toEqual({
      sender: { name: 'Tarlink', email: 'no-reply@tarlink.id' },
      to: [{ email: MESSAGE.to }],
      subject: MESSAGE.subject,
      textContent: MESSAGE.text
    });
    expect(body).not.toHaveProperty('from');
    expect(body).not.toHaveProperty('text');
  });

  it('sends a bare brevo sender email without a name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);

    await new HttpEmailTransport(BREVO_URL, 'brevo-key', ' no-reply@tarlink.id ', {
      provider: 'brevo'
    }).sendEmail(MESSAGE);

    expect(posted(fetchMock).body.sender).toEqual({ email: 'no-reply@tarlink.id' });
  });

  it('maps the html part to htmlContent for brevo', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);

    await new HttpEmailTransport(BREVO_URL, 'brevo-key', 'a@b.c', { provider: 'brevo' }).sendEmail({
      ...MESSAGE,
      html: '<p>Halo</p>'
    });

    expect(posted(fetchMock).body.htmlContent).toBe('<p>Halo</p>');
  });

  it('rejects a brevo message without an api key before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const transport = new HttpEmailTransport(BREVO_URL, null, 'a@b.c', { provider: 'brevo' });
    await expect(transport.sendEmail(MESSAGE)).rejects.toThrow(/EMAIL_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unusable brevo sender before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const transport = new HttpEmailTransport(BREVO_URL, 'brevo-key', '   ', { provider: 'brevo' });
    await expect(transport.sendEmail(MESSAGE)).rejects.toThrow(/EMAIL_FROM/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
