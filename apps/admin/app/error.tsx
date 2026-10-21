'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button, Card, PageHeader } from '@/components/ui';

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-7">
        <PageHeader
          title="Halaman gagal dimuat"
          description="Ada yang tidak beres saat panel membuka halaman ini. Data di server tidak berubah, jadi aman untuk mencoba lagi."
        />
        <Card className="px-6 py-8">
          <div className="flex flex-col items-center text-center">
            <span
              aria-hidden
              className="grid h-14 w-14 place-items-center rounded-card border border-danger/20 bg-danger/10 text-danger"
            >
              <AlertTriangle className="h-6 w-6" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-textMain">Terjadi kesalahan</h2>
            <p className="mt-1 max-w-[52ch] text-base leading-relaxed text-textSecondary">
              {error.message ||
                'Halaman ini tidak bisa ditampilkan. Muat ulang, atau kembali ke ringkasan operasi.'}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button
                onClick={reset}
                icon={<RotateCw aria-hidden className="h-4 w-4" />}
              >
                Coba lagi
              </Button>
              <Button variant="outline" href="/">
                Kembali ke dashboard
              </Button>
            </div>
            {error.digest ? (
              <p className="mt-4 text-[13px] text-textMuted">
                Kode kesalahan: <span className="tnum">{error.digest}</span>
              </p>
            ) : null}
          </div>
        </Card>
      </main>
    </div>
  );
}
