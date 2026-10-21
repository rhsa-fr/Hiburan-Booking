/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Badge DevTools Next.js menutupi footer sidebar di mode dev.
  devIndicators: false,
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
    NEXT_PUBLIC_USE_MOCK: process.env.NEXT_PUBLIC_USE_MOCK ?? 'true'
  }
};

export default nextConfig;
