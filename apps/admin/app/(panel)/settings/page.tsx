'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { SettingsForm } from '@/components/settings/settings-form';
import {
  BlockSkeleton,
  Button,
  Card,
  ErrorState,
  PageHeader,
  Toast
} from '@/components/ui';
import { getSettings, saveSettings } from '@/lib/api';
import { useState } from 'react';
import type { PlatformSettings } from '@/lib/types';

export default function SettingsPage() {
  const [saved, setSaved] = useState(false);

  const query = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const mutation = useMutation({
    mutationFn: (next: PlatformSettings) => saveSettings(next),
    onSuccess: () => setSaved(true)
  });

  return (
    <div>
      <PageHeader
        title="Platform"
        description="Komisi bertingkat (D-17) dan batas bayar DP (D-18). Semua perhitungan memakai bilangan bulat rupiah, tanpa pembulatan ke atas."
        actions={
          <Button variant="outline" href="/bookings">
            Lihat impact ke booking
          </Button>
        }
      />

      {query.isLoading ? (
        <Card>
          <BlockSkeleton rows={8} />
        </Card>
      ) : query.isError ? (
        <Card>
          <ErrorState
            message={
              query.error instanceof Error
                ? query.error.message
                : 'Pengaturan tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        </Card>
      ) : query.data ? (
        <>
          <SettingsForm
            settings={query.data}
            saving={mutation.isPending}
            onSave={(next) => {
              setSaved(false);
              mutation.mutate(next);
            }}
          />

          {mutation.isError ? (
            <p role="alert" className="mt-4 text-sm font-semibold text-danger">
              {mutation.error.message}
            </p>
          ) : null}

          {saved ? (
            <Toast
              tone="ok"
              title="Pengaturan tersimpan"
              description="Nilai baru berlaku untuk booking yang dibuat berikutnya."
              onDismiss={() => setSaved(false)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
