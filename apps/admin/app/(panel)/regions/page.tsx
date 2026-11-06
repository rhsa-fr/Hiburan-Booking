import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegionsView } from '@/components/regions/regions-view';
import { Card, PageHeader, TableSkeleton } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Wilayah'
};

export const dynamic = 'force-dynamic';

export default function RegionsPage() {
  return (
    <div>
      <PageHeader
        title="Wilayah"
        description="Aktifkan atau nonaktifkan wilayah kerja. Wilayah nonaktif hilang dari katalog dan tidak bisa dipilih vendor baru; booking lama tidak berubah."
      />
      <Suspense
        fallback={
          <Card>
            <TableSkeleton rows={6} />
          </Card>
        }
      >
        <RegionsView />
      </Suspense>
    </div>
  );
}
