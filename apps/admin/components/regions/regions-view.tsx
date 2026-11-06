'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeleton,
  Toast
} from '@/components/ui';
import { getRegions, setRegionActive } from '@/lib/api';
import { readSession } from '@/lib/session';
import type { AdminRegion } from '@/lib/types';

const LEVEL_LABEL: Record<string, string> = {
  province: 'Provinsi',
  regency: 'Kabupaten',
  city: 'Kota',
  district: 'Kecamatan',
  village: 'Desa'
};

function isSuperAdmin(): boolean {
  return (readSession()?.role ?? '').toLowerCase().includes('super');
}

/** FR-125: wilayah aktif/nonaktif tanpa rilis kode. */
export function RegionsView() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<AdminRegion | null>(null);
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const superAdmin = isSuperAdmin();

  useEffect(() => {
    if (!toastNotice) return;
    const timer = setTimeout(() => setToastNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [toastNotice]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['regions'],
    queryFn: getRegions
  });

  const mutation = useMutation({
    mutationFn: ({ code, isActive }: { code: string; isActive: boolean }) =>
      setRegionActive(code, isActive),
    onSuccess: (region) => {
      setTarget(null);
      setToastNotice(
        region.is_active
          ? `${region.name} diaktifkan kembali.`
          : `${region.name} dinonaktifkan.`
      );
      void queryClient.invalidateQueries({ queryKey: ['regions'] });
    },
    onError: (err) => {
      setToastNotice(err instanceof Error ? err.message : 'Gagal mengubah wilayah.');
    }
  });

  const rows = data ?? [];

  return (
    <div>
      {isLoading ? (
        <Card>
          <TableSkeleton rows={6} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState
            message={error instanceof Error ? error.message : 'Daftar wilayah gagal dimuat.'}
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Belum ada wilayah"
            description="Seed wilayah belum tersedia di database ini."
          />
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeadCell>Kode</TableHeadCell>
                <TableHeadCell>Wilayah</TableHeadCell>
                <TableHeadCell>Level</TableHeadCell>
                <TableHeadCell align="right">Vendor aktif</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell align="right">Aksi</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((region) => (
                <TableRow key={region.code}>
                  <TableCell className="font-mono text-xs text-textSecondary">
                    {region.code}
                  </TableCell>
                  <TableCell className="font-semibold text-textMain">{region.name}</TableCell>
                  <TableCell className="text-textSecondary">
                    {LEVEL_LABEL[region.level] ?? region.level}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {region.vendor_count}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={region.is_active ? 'ok' : 'muted'}>
                      {region.is_active ? 'Aktif' : 'Nonaktif'}
                    </StatusBadge>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="sm"
                      variant={region.is_active ? 'ghost' : 'primary'}
                      disabled={!superAdmin || mutation.isPending}
                      title={superAdmin ? undefined : 'Butuh admin super'}
                      onClick={() => setTarget(region)}
                    >
                      {region.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target?.is_active ? 'Nonaktifkan wilayah?' : 'Aktifkan wilayah?'}
        description={
          target
            ? target.is_active
              ? `${target.name} akan hilang dari katalog dan formulir vendor baru. ${target.vendor_count} vendor aktif dan booking lama tidak berubah.`
              : `${target.name} akan tampil lagi di katalog dan formulir vendor baru.`
            : undefined
        }
        confirmLabel={target?.is_active ? 'Nonaktifkan' : 'Aktifkan'}
        tone={target?.is_active ? 'danger' : 'primary'}
        pending={mutation.isPending}
        onConfirm={() => {
          if (target) mutation.mutate({ code: target.code, isActive: !target.is_active });
        }}
      />

      {toastNotice ? (
        <Toast tone="info" title={toastNotice} onDismiss={() => setToastNotice(null)} />
      ) : null}
    </div>
  );
}
