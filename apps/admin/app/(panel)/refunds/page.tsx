import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RefundsView } from '@/components/refunds/refunds-view';
import { Card, PageHeader, TableSkeleton } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Refund'
};

export const dynamic = 'force-dynamic';

export default function RefundsPage() {
  return (
    <div>
      <PageHeader
        title="Refund"
        description="Antrean pengembalian dana. Refund di atas ambang butuh persetujuan admin kedua."
      />
      <Suspense
        fallback={
          <Card>
            <TableSkeleton rows={5} />
          </Card>
        }
      >
        <RefundsView />
      </Suspense>
    </div>
  );
}
