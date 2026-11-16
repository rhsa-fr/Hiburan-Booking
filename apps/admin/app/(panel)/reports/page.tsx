import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportsView } from '@/components/reports/reports-view';
import { Card, PageHeader, TableSkeleton } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Laporan Konten'
};

export const dynamic = 'force-dynamic';

export default function ReportsPage() {
  return (
    <div>
      <PageHeader
        title="Laporan Konten"
        description="Tinjau laporan pengguna, putuskan takedown, dan pastikan setiap keputusan tercatat."
      />
      <Suspense
        fallback={
          <Card>
            <TableSkeleton rows={6} />
          </Card>
        }
      >
        <ReportsView />
      </Suspense>
    </div>
  );
}
