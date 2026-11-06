import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ApplicationsView } from '@/components/applications/applications-view';
import { Card, PageHeader, TableSkeleton } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Pengajuan Vendor'
};

export const dynamic = 'force-dynamic';

export default function ApplicationsPage() {
  return (
    <div>
      <PageHeader
        title="Pengajuan Vendor"
        description="Tinjau pendaftaran vendor mandiri: periksa data, buka KTP privat, lalu setujui atau tolak."
      />
      <Suspense
        fallback={
          <Card>
            <TableSkeleton rows={6} />
          </Card>
        }
      >
        <ApplicationsView />
      </Suspense>
    </div>
  );
}
