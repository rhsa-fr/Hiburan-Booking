import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from './middleware';

function run(path = '/bookings'): ReturnType<typeof middleware> {
  return middleware(new NextRequest(new URL(path, 'http://localhost:3002')));
}

/** Reads a header the middleware forwarded to the request. */
function forwarded(response: ReturnType<typeof middleware>, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name.toLowerCase()}`);
}

function nonceFrom(policy: string): string | null {
  return policy.match(/'nonce-([^']+)'/)?.[1] ?? null;
}

function scriptSrc(policy: string): string {
  const found = policy.split('; ').find((part) => part.startsWith('script-src '));
  if (!found) throw new Error('missing script-src');
  return found;
}

describe('admin middleware CSP', () => {
  it('sets a nonce-bearing CSP on the response', () => {
    const response = run();
    const policy = response.headers.get('Content-Security-Policy');

    expect(policy).not.toBeNull();
    expect(nonceFrom(policy as string)).not.toBeNull();
    expect(scriptSrc(policy as string)).toContain("'strict-dynamic'");
    expect(scriptSrc(policy as string)).not.toContain("'unsafe-inline'");
  });

  it('forwards the same CSP and nonce on the request headers', () => {
    const response = run();
    const policy = response.headers.get('Content-Security-Policy');
    const nonce = nonceFrom(policy as string);

    expect(forwarded(response, 'Content-Security-Policy')).toBe(policy);
    expect(forwarded(response, 'x-nonce')).toBe(nonce);
  });

  it('mints a fresh nonce per request', () => {
    const first = nonceFrom(run().headers.get('Content-Security-Policy') as string);
    const second = nonceFrom(run().headers.get('Content-Security-Policy') as string);

    expect(first).not.toBeNull();
    expect(first).not.toBe(second);
  });
});
