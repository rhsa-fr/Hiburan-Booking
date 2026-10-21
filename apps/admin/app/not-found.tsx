import { Compass } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-page">
      <main className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-7">
        <PageHeader
          title="Halaman tidak ditemukan"
          description="Tautan ini tidak menuju ke halaman mana pun di panel Tarlink."
        />
        <Card>
          <EmptyState
            icon={<Compass aria-hidden className="h-6 w-6" />}
            title="Alamat tidak dikenali"
            description="Cek kembali tautan yang Anda buka. Semua halaman yang tersedia ada di menu sidebar."
            action={
              <Button href="/" variant="primary">
                Kembali ke dashboard
              </Button>
            }
          />
        </Card>
      </main>
    </div>
  );
}
