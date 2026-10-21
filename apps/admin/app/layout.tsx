import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

/**
 * Plus Jakarta Sans, di-host sendiri oleh next/font (tanpa <link> ke CDN).
 * Variabel CSS-nya menjadi `--font-jakarta`, sama dengan yang dipakai
 * tailwind.config.ts untuk seluruh keluarga sans.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-jakarta',
  fallback: ['system-ui', 'Segoe UI', 'sans-serif']
});

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
  themeColor: '#F8F9FB',
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={jakarta.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
