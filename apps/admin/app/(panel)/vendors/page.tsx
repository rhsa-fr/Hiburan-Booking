'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Search, ShieldCheck, Store } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  DisabledAction,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeleton,
  TitleBlock,
  Toast,
  Toolbar,
  ToolbarFooter,
  toneForVerification,
  verificationLabel
} from '@/components/ui';
import { AddVendorModal } from '@/components/vendors/add-vendor-modal';
import { useRegion } from '@/components/workspace/region-context';
import { getVendors } from '@/lib/api';
import { formatDateID, formatPercentFromBp } from '@/lib/format';
import { MOCK_NOW } from '@/lib/mock';
import type { AlertTone } from '@/components/ui';
import { hasAnyRole, useRoles, VENDOR_WRITE_ROLES } from '@/lib/use-roles';
import { calendarFreshness } from '@/lib/vendor-freshness';
import type { VendorFilters } from '@/lib/types';

const INITIAL_FILTERS: VendorFilters = {
  q: '',
  city: '',
  verification: ''
};

interface Notice {
  tone: AlertTone;
  title: string;
  description?: string;
}

export default function VendorsPage() {
  const [filters, setFilters] = useState<VendorFilters>(INITIAL_FILTERS);
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const deferredQuery = useDeferredValue(filters.q);
  const { region, setRegion, cityFilter, options } = useRegion();
  const { roles, ready: rolesReady } = useRoles();
  const canCreate = hasAnyRole(roles, VENDOR_WRITE_ROLES);
  const router = useRouter();
  const queryClient = useQueryClient();
  const applied: VendorFilters = { ...filters, q: deferredQuery, city: cityFilter };

  const listQuery = useQuery({
    queryKey: ['vendors', applied],
    queryFn: () => getVendors(applied)
  });

  function update(patch: Partial<VendorFilters>) {
    setFilters((previous) => ({ ...previous, ...patch }));
  }

  function reset() {
    setFilters(INITIAL_FILTERS);
    setRegion('all');
  }

  const data = listQuery.data;
  const activeFilters = Boolean(filters.q || filters.verification) || region !== 'all';
  const noVendorsAtAll = data?.items.length === 0 && !activeFilters;

  return (
    <div>
      <PageHeader
        title="Vendor"
        description="Verifikasi vendor, kesegaran kalender, dan rekening pencairan. Vendor dengan kalender basi turun peringkat di pencarian."
        actions={
          rolesReady ? (
            canCreate ? (
              <Button onClick={() => setAddOpen(true)} icon={<Plus aria-hidden className="h-4 w-4" />}>
                Tambah vendor
              </Button>
            ) : (
              <DisabledAction
                label="Tambah vendor"
                reason="Hanya admin finance dan admin super yang boleh membuat vendor baru."
                icon={Store}
              />
            )
          ) : (
            <Skeleton className="h-12 w-40" />
          )
        }
      />

      <Card className="mb-4">
        <Toolbar>
          <Input
            id="vendor-q"
            label="Cari vendor"
            type="search"
            value={filters.q}
            onChange={(event) => update({ q: event.target.value })}
            placeholder="Nama vendor atau pemilik"
            leadingIcon={<Search className="h-4 w-4" />}
          />

          <Select
            id="vendor-city"
            label="Wilayah kerja"
            value={region}
            onChange={(event) => setRegion(event.target.value as typeof region)}
            hint="Mengikuti pilihan wilayah di sidebar."
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>

          <Select
            id="vendor-verification"
            label="Verifikasi"
            value={filters.verification}
            onChange={(event) => update({ verification: event.target.value })}
          >
            <option value="">Semua status</option>
            <option value="verified">Terverifikasi</option>
            <option value="pending">Menunggu verifikasi</option>
            <option value="rejected">Ditolak</option>
          </Select>

          <div className="flex items-end">
            <Button
              variant="outline"
              onClick={reset}
              disabled={!activeFilters}
              icon={<RotateCcw aria-hidden className="h-4 w-4" />}
            >
              Reset filter
            </Button>
          </div>
        </Toolbar>
        <ToolbarFooter>
          <p className="text-[13px] text-textSecondary" aria-live="polite">
            {listQuery.isLoading
              ? 'Memuat daftar vendor…'
              : listQuery.isError
                ? 'Daftar vendor gagal dimuat'
                : listQuery.isFetching
                  ? 'Memperbarui daftar…'
                  : `${data?.total ?? 0} vendor cocok`}
          </p>
        </ToolbarFooter>
      </Card>

      <Card className="overflow-hidden">
        {listQuery.isLoading ? (
          <TableSkeleton rows={6} />
        ) : listQuery.isError ? (
          <ErrorState
            message={
              listQuery.error instanceof Error
                ? listQuery.error.message
                : 'Daftar vendor tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void listQuery.refetch()}
            retrying={listQuery.isFetching}
          />
        ) : data && data.items.length === 0 ? (
          noVendorsAtAll ? (
            <EmptyState
              icon={<Store aria-hidden className="h-6 w-6" />}
              title="Belum ada vendor"
              description="Daftar vendor masih kosong. Tambahkan vendor pertama, lalu putuskan verifikasinya."
              action={
                canCreate ? (
                  <Button onClick={() => setAddOpen(true)} icon={<Plus aria-hidden className="h-4 w-4" />}>
                    Tambah vendor
                  </Button>
                ) : (
                  <DisabledAction
                    label="Tambah vendor"
                    reason="Hanya admin finance dan admin super yang boleh membuat vendor baru."
                  />
                )
              }
            />
          ) : (
            <EmptyState
              icon={<Store aria-hidden className="h-6 w-6" />}
              title="Tidak ada vendor yang cocok"
              description="Coba longgarkan filter verifikasi atau wilayah, atau cari dengan nama pemilik."
              action={
                <Button variant="outline" onClick={reset}>
                  Reset filter
                </Button>
              }
            />
          )
        ) : data ? (
          <>
            <Table
              label="Daftar vendor Tarlink dengan status verifikasi, kesegaran kalender, dan respons"
              maxHeight="max-h-[65vh]"
              className="min-w-[880px]"
            >
              <TableHead>
                <TableRow>
                  <TableHeadCell>Vendor</TableHeadCell>
                  <TableHeadCell>Kota / kategori</TableHeadCell>
                  <TableHeadCell>Verifikasi</TableHeadCell>
                  <TableHeadCell>Kalender</TableHeadCell>
                  <TableHeadCell align="right">Respons</TableHeadCell>
                  <TableHeadCell align="right">Selesai</TableHeadCell>
                  <TableHeadCell align="right">
                    <span className="sr-only">Aksi</span>
                  </TableHeadCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.items.map((vendor) => {
                  const freshness = calendarFreshness(vendor.calendar_updated_at, MOCK_NOW);
                  const href = `/vendors/${vendor.id}`;
                  return (
                    <TableRow key={vendor.id} onClick={() => router.push(href)}>
                      <TableCell>
                        <TitleBlock
                          avatar={<Avatar name={vendor.display_name ?? vendor.name} tone="soft" size="sm" />}
                          title={vendor.display_name ?? vendor.name}
                          subtitle={vendor.owner_name}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="text-[15px] text-textMain">
                          {vendor.region_code ?? vendor.city}
                        </p>
                        <p className="text-[13px] text-textSecondary">
                          {vendor.category || 'Kategori belum diisi'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={toneForVerification(vendor.verification_status)}>
                          {verificationLabel(vendor.verification_status)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        <p className="text-[13px] text-textMain">
                          {formatDateID(vendor.calendar_updated_at)}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <StatusBadge tone={freshness.tone}>{freshness.label}</StatusBadge>
                          <span className="text-[13px] text-textSecondary">
                            {freshness.days} hari lalu
                          </span>
                        </div>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum font-semibold text-textMain">
                          {formatPercentFromBp(vendor.response_rate_bp, 1)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum text-textMain">{vendor.completed_bookings}</span>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          variant="outline"
                          size="sm"
                          href={href}
                          onClick={(event) => event.stopPropagation()}
                          ariaLabel={`Buka detail vendor ${vendor.display_name ?? vendor.name}`}
                          title={`Buka detail vendor ${vendor.display_name ?? vendor.name}`}
                        >
                          Detail
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="border-t border-border px-5 py-3">
              <p className="text-sm text-textSecondary">
                Kalender di atas 14 hari ditandai{' '}
                <strong className="font-semibold text-textMain">Basi</strong>; di atas 30 hari
                vendor tidak boleh menerima booking tanpa konfirmasi ulang.
              </p>
            </div>
          </>
        ) : null}
      </Card>

      <div className="mt-4 flex items-start gap-2 text-sm text-textSecondary">
        <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Rekening pencairan hanya boleh dipakai setelah status{' '}
          <strong className="font-semibold text-textMain">verified</strong> dan melewati cooling 24
          jam. Perubahan rekening selalu membuat baris baru untuk jejak audit.
        </p>
      </div>

      <AddVendorModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(vendor) => {
          setAddOpen(false);
          void queryClient.invalidateQueries({ queryKey: ['vendors'] });
          setNotice({
            tone: 'ok',
            title: 'Vendor dibuat, menunggu verifikasi',
            description: `${vendor.display_name} · ${vendor.slug}`
          });
        }}
      />

      {notice ? (
        <Toast
          tone={notice.tone}
          title={notice.title}
          description={notice.description}
          onDismiss={() => setNotice(null)}
        />
      ) : null}
    </div>
  );
}
