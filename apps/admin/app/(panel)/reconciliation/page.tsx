import type { Metadata } from 'next';
import { ReconciliationView } from '@/components/reconciliation/reconciliation-view';
import { PageHeader } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Rekonsiliasi'
};

export const dynamic = 'force-dynamic';

export default function ReconciliationPage() {
  return (
    <div>
      <PageHeader
        title="Rekonsiliasi"
        description="Membandingkan pembayaran di gateway (webhook) dengan baris payments. Tidak memposting jurnal."
      />
      <ReconciliationView />
    </div>
  );
}
