import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ModerationView } from '@/components/moderation/moderation-view';
import { Card, PageHeader, TableSkeleton } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Moderasi Media'
};

export const dynamic = 'force-dynamic';

export default function ModerationPage() {
  return (
    <div>
      <PageHeader
        title="Moderasi Media"
        description="Tinjau dan verifikasi media yang diunggah vendor sebelum tayang ke pelanggan."
      />
      <Suspense
        fallback={
          <Card>
            <TableSkeleton rows={6} />
          </Card>
        }
      >
        <ModerationView />
      </Suspense>
    </div>
  );
}
