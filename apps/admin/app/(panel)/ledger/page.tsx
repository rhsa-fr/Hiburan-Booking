'use client';

import { useQuery } from '@tanstack/react-query';
import { JournalLedger } from '@/components/ledger/journal-ledger';
import {
  BlockSkeleton,
  Card,
  ErrorState,
  PageHeader
} from '@/components/ui';
import { getLedger } from '@/lib/api';

export default function LedgerPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['ledger'],
    queryFn: getLedger
  });

  return (
    <div>
      <PageHeader
        title="Jurnal"
        description="Setiap rupiah punya dua sisi. Buka entri untuk melihat baris debit dan kredit, lalu cek saldo akun yang selalu dihitung ulang dari jurnal."
      />

      {isLoading ? (
        <Card>
          <BlockSkeleton rows={8} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState
            message={
              error instanceof Error
                ? error.message
                : 'Jurnal tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        </Card>
      ) : data ? (
        <JournalLedger data={data} />
      ) : null}
    </div>
  );
}
