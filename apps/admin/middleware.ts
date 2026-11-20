import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy, toOrigin } from './lib/csp';

const DEFAULT_API_BASE_URL = 'http://localhost:3001';

export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  // Edge middleware inlines env at build time: changing these at `next start`
  // does not change the policy, the panel must be rebuilt.
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;
  // Vendor media may be served from a CDN instead of the API origin.
  const mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL || apiBaseUrl;

  const apiOrigin = toOrigin(apiBaseUrl, DEFAULT_API_BASE_URL);
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    isProduction: process.env.NODE_ENV === 'production',
    apiOrigin,
    mediaOrigin: toOrigin(mediaBaseUrl, apiOrigin)
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
  // nonce minted for a prefetch would not match the later navigation. These
  // headers are the RSC prefetch pair Next sends; document-level speculation
  // rules use `Sec-Purpose` and are NOT excluded here, so such documents still
  // receive a policy.
  //
  // Each exclusion is anchored to a whole path segment: `api` must not swallow
  // `/apikeys` or `/apidocs`.
  matcher: [
    {
      source: '/((?!api(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' }
      ]
    }
  ]
};
