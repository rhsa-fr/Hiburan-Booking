import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy } from './lib/csp';

const DEFAULT_API_BASE_URL = 'http://localhost:3001';

/** Normalises an absolute URL to its origin; keeps the raw value when parsing fails. */
function toOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  // Vendor media may be served from a CDN instead of the API origin.
  const mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL ?? apiBaseUrl;

  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    isProduction: process.env.NODE_ENV === 'production',
    apiOrigin: toOrigin(apiBaseUrl),
    mediaOrigin: toOrigin(mediaBaseUrl)
  });

  // Next picks the nonce up from the CSP header of the *request*, so the header
  // must be forwarded on the request as well as set on the response. Without the
  // request copy, Next's own <script> tags would render without a nonce and the
  // page would break in the browser.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  return response;
}

export const config = {
  // Prefetch requests render no HTML and must not be matched: the nonce would
  // rotate on every prefetch while Next caches the prefetched payload, so a
  // nonce minted for a prefetch would not match the later navigation. Prefetches
  // skip the middleware; the real navigation response carries the CSP.
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' }
      ]
    }
  ]
};
