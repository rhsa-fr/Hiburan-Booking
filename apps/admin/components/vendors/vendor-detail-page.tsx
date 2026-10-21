'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, SearchX, ShieldCheck, Star, Store } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  BlockSkeleton,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  KeyValue,
  PageHeader,
  StatusBadge,
  StatusPill,
  Toast,
  toneForVerification,
  verificationLabel
} from '@/components/ui';
import type { KeyValueItem } from '@/components/ui';
import { VendorCalendar } from '@/components/vendors/vendor-calendar';
import { VendorPackages } from '@/components/vendors/vendor-packages';
import { VendorVerification } from '@/components/vendors/vendor-verification';
import type { VendorNotice } from '@/components/vendors/notice';
import { getVendor } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { formatDateID, formatIDR, formatPercentFromBp } from '@/lib/format';
import { hasAnyRole, useRoles, VENDOR_VERIFY_ROLES, VENDOR_WRITE_ROLES } from '@/lib/use-roles';
import type { VendorDetail } from '@/lib/types';

function optionalNumber(value: number | null | undefined, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : '—';
}

function ratingLabel(ratingX10: number): string {
  if (!ratingX10) return '—';
  return `${Math.trunc(ratingX10 / 10)},${ratingX10 % 10}`;
}

/**
 * Konteks operasional yang dulu ada di drawer daftar: rekening pencairan dan
 * booking terakhir. Tetap dipertahankan di halaman detail.
 */
function VendorOperations({ detail }: { detail: VendorDetail }) {
  const { vendor, recent_bookings } = detail;
  const bank = vendor.bank_account;
  const hasBank = Boolean(bank.bank_name || bank.account_number_masked || bank.account_holder);

  return (
    <Card labelledBy="vendor-operations-title">
      <CardHeader
        title={<span id="vendor-operations-title">Rekening &amp; aktivitas</span>}
        description="Status pencairan dan booking terakhir vendor ini."
        icon={<ShieldCheck aria-hidden className="h-4 w-4" />}
        action={
          <StatusBadge tone={toneForVerification(bank.status)}>
            Rekening {verificationLabel(bank.status).toLowerCase()}
          </StatusBadge>
        }
      />
      <CardBody className="space-y-4 pt-0">
        <KeyValue
          layout="grid"
          items={[
            {
              label: 'Response rate',
              value: formatPercentFromBp(vendor.response_rate_bp, 1)
            },
            {
              label: 'Rating',
              value: (
                <span className="flex items-center gap-1.5">
                  <Star aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="tnum">{ratingLabel(vendor.rating_x10)}</span>
                </span>
              )
            },
            { label: 'Acara selesai', value: String(vendor.completed_bookings) },
            {
              label: 'Cooling rekening',
              value: bank.cooling_until ? formatDateID(bank.cooling_until) : '—'
            }
          ]}
        />

        {hasBank ? (
          <KeyValue
            items={[
              { label: 'Bank', value: bank.bank_name || '—' },
              { label: 'Nomor rekening', value: bank.account_number_masked || '—' },
              { label: 'Nama pemilik', value: bank.account_holder || '—' }
            ]}
          />
        ) : (
          <p className="rounded-field bg-subtle px-4 py-3 text-sm text-textSecondary">
            Rekening pencairan belum diisi. Payout tidak bisa diproses sebelum rekening
            terverifikasi.
          </p>
        )}

        {bank.rejection_reason ? (
          <p className="rounded-field bg-danger/10 px-3 py-2 text-sm text-danger">
            {bank.rejection_reason}
          </p>
        ) : null}

        <div className="border-t border-border pt-4">
          <h3 className="text-[15px] font-semibold text-textMain">Booking terakhir</h3>
          {recent_bookings.length === 0 ? (
            <p className="mt-1 text-sm text-textSecondary">Belum ada booking untuk vendor ini.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-field border border-border">
              {recent_bookings.slice(0, 3).map((booking) => (
                <li key={booking.id}>
                  <Link
                    href={`/bookings/${booking.id}`}
                    className="flex min-h-12 items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-subtle"
                  >
                    <span className="min-w-0">
                      <span className="tnum block text-sm font-semibold text-textMain">
                        {booking.code}
                      </span>
                      <span className="block truncate text-[13px] text-textSecondary">
                        {formatDateID(booking.event_start_at)} · {booking.customer_name}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tnum hidden text-[13px] text-textMain sm:inline">
                        {formatIDR(booking.total_customer_idr)}
                      </span>
                      <StatusPill axis="lifecycle" value={booking.lifecycle_status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

export function VendorDetailPage({ vendorId }: { vendorId: string }) {
  const [notice, setNotice] = useState<VendorNotice | null>(null);
  const { roles, ready: rolesReady } = useRoles();
  const canVerify = hasAnyRole(roles, VENDOR_VERIFY_ROLES);
  const canWrite = hasAnyRole(roles, VENDOR_WRITE_ROLES);
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['vendor', vendorId],
    queryFn: () => getVendor(vendorId)
  });

  const vendor = detailQuery.data?.vendor;
  const notFound = detailQuery.error instanceof ApiError && detailQuery.error.status === 404;

  function handleChanged(): void {
    void detailQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ['vendors'] });
  }

  if (detailQuery.isLoading) {
    return (
      <div>
        <PageHeader title="Detail vendor" description="Memuat profil, paket, dan kalender vendor." />
        <Card>
          <BlockSkeleton rows={8} />
        </Card>
      </div>
    );
  }

  if (detailQuery.isError || !vendor) {
    return (
      <div>
        <PageHeader
          title="Detail vendor"
          description="Profil, verifikasi, paket, dan kalender vendor."
          actions={
            <Button variant="outline" href="/vendors" icon={<ArrowLeft aria-hidden className="h-4 w-4" />}>
              Kembali ke daftar
            </Button>
          }
        />
        <Card>
          {notFound ? (
            <EmptyState
              icon={<SearchX aria-hidden className="h-6 w-6" />}
              title="Vendor tidak ditemukan"
              description="Tautan ini menunjuk vendor yang tidak ada di server. Mungkin sudah dihapus atau salah ketik."
              action={
                <Button variant="outline" href="/vendors">
                  Kembali ke daftar vendor
                </Button>
              }
            />
          ) : (
            <ErrorState
              message={
                detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : 'Detail vendor tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
              }
              onRetry={() => void detailQuery.refetch()}
              retrying={detailQuery.isFetching}
            />
          )}
        </Card>
      </div>
    );
  }

  const displayName = vendor.display_name ?? vendor.name;
  const profileItems: KeyValueItem[] = [
    { label: 'Slug', value: <span className="tnum">{vendor.slug ?? '—'}</span> },
    {
      label: 'Wilayah',
      value: vendor.region_code ?? vendor.city,
      hint: vendor.region_code && vendor.city ? vendor.city : undefined
    },
    { label: 'Pemilik', value: vendor.owner_name },
    { label: 'Kontak', value: vendor.phone || '—' },
    ...(vendor.owner_email ? [{ label: 'Email', value: vendor.owner_email }] : []),
    { label: 'Nama legal', value: vendor.legal_name ?? '—' },
    { label: 'Alamat markas', value: vendor.base_address ?? '—' },
    {
      label: 'Radius layanan',
      value:
        vendor.service_radius_km === null || vendor.service_radius_km === undefined
          ? '—'
          : `${optionalNumber(vendor.service_radius_km, ' km')} · gratis ${optionalNumber(
              vendor.free_radius_km,
              ' km'
            )}`
    },
    {
      label: 'Biaya transport',
      value:
        typeof vendor.transport_fee_per_km_idr === 'number'
          ? `${formatIDR(vendor.transport_fee_per_km_idr)} / km`
          : '—'
    },
    {
      label: 'DP minimum',
      value:
        typeof vendor.min_dp_bp === 'number' ? formatPercentFromBp(vendor.min_dp_bp, 0) : '—'
    },
    {
      label: 'Status vendor',
      value: vendor.is_active ? 'Aktif' : 'Nonaktif',
      tone: vendor.is_active ? 'ok' : 'default'
    }
  ];

  return (
    <div>
      <PageHeader
        title={displayName}
        description={vendor.description ?? 'Profil, verifikasi, paket, dan kalender vendor.'}
        meta={
          <>
            <StatusBadge tone={toneForVerification(vendor.verification_status)}>
              {verificationLabel(vendor.verification_status)}
            </StatusBadge>
            <span className="tnum">{vendor.slug ?? 'slug belum tersedia'}</span>
            <span aria-hidden>·</span>
            <span>{vendor.region_code ?? vendor.city}</span>
            <span aria-hidden>·</span>
            <span>Pemilik: {vendor.owner_name}</span>
            {vendor.verified_at ? (
              <>
                <span aria-hidden>·</span>
                <span>Diverifikasi {formatDateID(vendor.verified_at)}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <Button variant="outline" href="/vendors" icon={<ArrowLeft aria-hidden className="h-4 w-4" />}>
            Kembali ke daftar
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <VendorVerification
            vendor={vendor}
            canVerify={canVerify}
            rolesReady={rolesReady}
            onNotify={setNotice}
            onChanged={handleChanged}
          />
          {detailQuery.data ? <VendorOperations detail={detailQuery.data} /> : null}
        </div>

        <Card labelledBy="vendor-profile-title">
          <CardHeader
            title={<span id="vendor-profile-title">Profil vendor</span>}
            description="Data yang dikirim API. Tanda — berarti field belum diisi."
            icon={<Store aria-hidden className="h-4 w-4" />}
          />
          <CardBody className="pt-0">
            <KeyValue items={profileItems} layout="grid" />
          </CardBody>
        </Card>
      </div>

      {!vendor.is_active ? (
        <Alert tone="warning" className="mt-4">
          Vendor sedang nonaktif. Paket dan kalender tetap bisa diubah, tetapi vendor tidak muncul
          untuk pelanggan.
        </Alert>
      ) : null}

      <div className="mt-4 space-y-4">
        <VendorPackages
          vendorId={vendor.id}
          canWrite={canWrite}
          rolesReady={rolesReady}
          onNotify={setNotice}
        />
        <VendorCalendar
          vendorId={vendor.id}
          canWrite={canWrite}
          rolesReady={rolesReady}
          onNotify={setNotice}
        />
      </div>

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
