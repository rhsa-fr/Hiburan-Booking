import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

/**
 * Font panel memakai stack sistem. `next/font/google` sempat membuat build
 * produksi gagal ketika jaringan ke Google Fonts bermasalah; panel operasi
 * tidak boleh bergantung pada fetch font saat build.
 */

/**
 * CSP panel memakai nonce per request (apps/admin/middleware.ts), dan Next hanya
 * menempelkan nonce ke <script>-nya saat rute dirender dinamis. Karena itu
 * seluruh rute panel dipaksa dinamis; prerender statis memang dilepas.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    default: 'Tarlink Admin',
    template: '%s · Tarlink Admin'
  },
  description:
    'Panel operasi Tarlink untuk booking, vendor, pencairan dana, dan jurnal keuangan.',
  applicationName: 'Tarlink Admin'
};

export const viewport: Viewport = {
  themeColor: '#ECEBE6',
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
