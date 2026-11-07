import { describe, expect, it, vi } from 'vitest';
import { buildContentSecurityPolicy, toOrigin, type CspOptions } from './csp';

const NONCE = 'abc';
const API_ORIGIN = 'http://localhost:3001';
const MEDIA_ORIGIN = 'http://cdn.localhost:3001';

function build(overrides: Partial<CspOptions> = {}): string {
  return buildContentSecurityPolicy({
    nonce: NONCE,
    isProduction: true,
    apiOrigin: API_ORIGIN,
    mediaOrigin: MEDIA_ORIGIN,
    ...overrides
  });
}

/** Returns the `name` directive (header + sources) from a serialised policy. */
function directive(policy: string, name: string): string {
  const found = policy
    .split('; ')
    .find((part) => part === name || part.startsWith(`${name} `));
  if (!found) throw new Error(`missing directive: ${name}`);
  return found;
}

describe('buildContentSecurityPolicy', () => {
  it('carries the per-request nonce in script-src', () => {
    const policy = build();
    expect(directive(policy, 'script-src')).toContain(`'nonce-${NONCE}'`);
  });

  it('keeps strict-dynamic and never allows unsafe-inline scripts in production', () => {
    const policy = build();
    const scriptSrc = directive(policy, 'script-src');

    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).toContain('https://accounts.google.com');
  });

  it('does not allow ws: connections in production', () => {
    const policy = build();
    const connectSrc = directive(policy, 'connect-src');

    expect(connectSrc).toContain(API_ORIGIN);
    expect(connectSrc).not.toContain('ws:');
  });

  it('adds unsafe-eval and the dev websocket only outside production', () => {
    const policy = build({ isProduction: false });

    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(policy, 'connect-src')).toContain('ws:');
  });

  it('lists the api and media origins once each and collapses duplicates', () => {
    const policy = build({ mediaOrigin: API_ORIGIN });
    const imgSrc = directive(policy, 'img-src');

    expect(imgSrc.split(API_ORIGIN)).toHaveLength(2);
    expect(imgSrc).toContain('blob:');
    expect(policy.split(API_ORIGIN)).toHaveLength(3); // img-src + connect-src only
  });

  it('keeps the media origin distinct from the api origin', () => {
    const imgSrc = directive(build(), 'img-src');

    expect(imgSrc).toContain(API_ORIGIN);
    expect(imgSrc).toContain(MEDIA_ORIGIN);
  });

  it('keeps unsafe-inline for styles and allows the Google button stylesheet', () => {
    const policy = build();
    const styleSrc = directive(policy, 'style-src');

    expect(styleSrc).toContain("'unsafe-inline'");
    expect(styleSrc).toContain('https://accounts.google.com');
    expect(styleSrc).not.toContain(`'nonce-${NONCE}'`);
  });

  it('allows Google account avatars in img-src', () => {
    expect(directive(build(), 'img-src')).toContain('https://*.googleusercontent.com');
  });

  it('emits the directives in the documented order', () => {
    const names = build()
      .split('; ')
      .map((part) => part.split(' ')[0]);

    expect(names).toEqual([
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'font-src',
      'connect-src',
      'frame-src',
      'frame-ancestors',
      'base-uri',
      'form-action',
      'object-src'
    ]);
  });

  it('hardens the navigation and embedding directives', () => {
    const policy = build();

    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(policy, 'form-action')).toBe("form-action 'self'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(policy).not.toContain('upgrade-insecure-requests');
  });
});

describe('toOrigin', () => {
  it('keeps the origin and strips path/query', () => {
    expect(toOrigin('https://api.example.com/v1?x=1', 'https://fallback')).toBe(
      'https://api.example.com'
    );
  });

  it('falls back for blank values', () => {
    expect(toOrigin('   ', 'https://fallback')).toBe('https://fallback');
  });

  it('falls back for injected or malformed values instead of splicing them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(toOrigin('https://api.example.com; script-src *', 'https://fallback')).toBe(
        'https://fallback'
      );
      expect(toOrigin('bukan-url', 'https://fallback')).toBe('https://fallback');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('falls back for non-network schemes', () => {
    expect(toOrigin('file:///etc/passwd', 'https://fallback')).toBe('https://fallback');
  });
});
