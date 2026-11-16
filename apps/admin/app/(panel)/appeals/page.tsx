import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppealsView } from '@/components/reports/appeals-view';
import { Card, PageHeader, TableSkeleton } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Banding Takedown'
};

export const dynamic = 'force-dynamic';

export default function AppealsPage() {
  return (
    <div>
      <PageHeader
        title="Banding takedown"
        description="Tinjau banding pemilik konten atas takedown. Setiap keputusan wajib bercatatan dan masuk audit."
      />
      <Suspense
        fallback={
          <Card>
            <TableSkeleton rows={5} />
          </Card>
        }
      >
        <AppealsView />
      </Suspense>
    </div>
  );
}
