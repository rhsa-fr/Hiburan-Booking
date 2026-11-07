/** @type {import('next').NextConfig} */

// The panel talks to the API cross-origin with credentials, and renders KTP
// images through blob URLs, so both origins must be allowlisted in the CSP.
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

/** @param {string} value */
function toOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    // Keep the raw value rather than dropping the allowlisted origin entirely.
    return value;
  }
}

const apiOrigin = toOrigin(apiBaseUrl);
// Vendor media may be served from a CDN instead of the API origin.
const mediaOrigin = toOrigin(process.env.MEDIA_PUBLIC_BASE_URL || apiBaseUrl);
const imageOrigins = [...new Set([apiOrigin, mediaOrigin])].join(' ');
const isProduction = process.env.NODE_ENV === 'production';

const contentSecurityPolicy = [
  "default-src 'self'",
  // Google Identity Services powers the optional Google sign-in on /login.
  // next dev evaluates generated code with eval(); production does not need it.
  `script-src 'self' 'unsafe-inline' https://accounts.google.com${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${imageOrigins} https://accounts.google.com`,
  "font-src 'self' data:",
  // ws: is required by the dev HMR socket only.
  `connect-src 'self' ${apiOrigin} https://accounts.google.com${isProduction ? '' : ' ws:'}`,
  "frame-src 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Badge DevTools Next.js menutupi footer sidebar di mode dev.
  devIndicators: false,
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
    // Default real API. Set NEXT_PUBLIC_USE_MOCK=true explicitly for mock mode.
    NEXT_PUBLIC_USE_MOCK: process.env.NEXT_PUBLIC_USE_MOCK ?? 'false'
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;
