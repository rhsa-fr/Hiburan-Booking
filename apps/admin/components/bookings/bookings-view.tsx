'use client';

import { useQuery } from '@tanstack/react-query';
import { Eye, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { BookingDetail } from '@/components/bookings/booking-detail';
import {
  Avatar,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  InlineSelect,
  Input,
  PageHeader,
  Pagination,
  Select,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeleton,
  TitleBlock,
  Toolbar,
  ToolbarFooter,
  statusLabel
} from '@/components/ui';
import { useRegion } from '@/components/workspace/region-context';
import { getBooking, getBookings } from '@/lib/api';
import { formatDateID, formatIDR, formatTimeID } from '@/lib/format';
import type { Booking, BookingFilters } from '@/lib/types';

const STATUS_OPTIONS: Array<{ group: string; options: Array<[string, string]> }> = [
  {
    group: 'Siklus booking',
    options: [
      ['lifecycle:requested', 'Diminta'],
      ['lifecycle:countered', 'Ditawar'],
      ['lifecycle:accepted', 'Diterima'],
      ['lifecycle:confirmed', 'Terkonfirmasi'],
      ['lifecycle:in_progress', 'Berlangsung'],
      ['lifecycle:completed', 'Selesai'],
      ['lifecycle:cancelled', 'Dibatalkan'],
      ['lifecycle:rejected', 'Ditolak'],
      ['lifecycle:expired', 'Kedaluwarsa'],
      ['lifecycle:no_show', 'Tidak hadir']
    ]
  },
  {
    group: 'Pembayaran',
    options: [
      ['payment:unpaid', 'Belum bayar'],
      ['payment:dp_paid', 'DP dibayar'],
      ['payment:fully_paid', 'Lunas'],
      ['payment:partially_refunded', 'Refund sebagian'],
      ['payment:refunded', 'Direfund']
    ]
  },
  {
    group: 'Pencairan',
    options: [
      ['settlement:not_eligible', 'Belum layak'],
      ['settlement:held', 'Ditahan'],
      ['settlement:disputed', 'Sengketa'],
      ['settlement:released', 'Dicairkan'],
      ['settlement:clawed_back', 'Clawback']
    ]
  }
];

function hasActiveFilters(filters: BookingFilters): boolean {
  return Boolean(filters.status || filters.city || filters.q || filters.range !== 'all');
}

export function BookingsView() {
  const searchParams = useSearchParams();
  const codeParam = searchParams.get('code');
  const queryParam = searchParams.get('q');
  const statusParam = searchParams.get('status');
  const paymentParam = searchParams.get('payment_status');

  const [filters, setFilters] = useState<BookingFilters>(() => ({
    status: paymentParam ? `payment:${paymentParam}` : (statusParam ?? ''),
    range: 'all',
    city: '',
    q: queryParam ?? codeParam ?? '',
    sort: 'created_desc',
    page: 1,
    page_size: 8
  }));
  const [selected, setSelected] = useState<Booking | null>(null);
  const deferredQuery = useDeferredValue(filters.q);
  const { region, setRegion, cityFilter, options } = useRegion();
  const applied: BookingFilters = { ...filters, q: deferredQuery, city: cityFilter };
  const openedCodeRef = useRef<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['bookings', applied],
    queryFn: () => getBookings(applied)
  });

  // Tautan dari antrean "Perlu tindakan" dan dari legenda donut memakai
  // ?code= / ?payment_status=. Keduanya harus benar-benar membuka datanya.
  useEffect(() => {
    if (!codeParam || !data || openedCodeRef.current === codeParam) return;
    const match = data.items.find((booking) => booking.code === codeParam);
    if (match) {
      openedCodeRef.current = codeParam;
      setSelected(match);
      return;
    }
    let cancelled = false;
    void getBooking(codeParam)
      .then((detail) => {
        if (cancelled) return;
        openedCodeRef.current = codeParam;
        setSelected(detail.booking);
      })
      .catch(() => {
        // Kode tidak dikenal: biarkan daftar tetap tampil apa adanya.
      });
    return () => {
      cancelled = true;
    };
  }, [codeParam, data]);

  function update(patch: Partial<BookingFilters>) {
    setFilters((previous) => ({
      ...previous,
      ...patch,
      page: patch.page ?? 1
    }));
  }

  function reset() {
    setFilters({
      status: '',
      range: 'all',
      city: '',
      q: '',
      sort: 'created_desc',
      page: 1,
      page_size: 8
    });
    setRegion('all');
  }

  const total = data?.total ?? 0;
  const page = data?.page ?? filters.page;
  const pageSize = data?.page_size ?? filters.page_size;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const resolved = !isLoading && !isError && data !== undefined;

  return (
    <div>
      <PageHeader
        title="Booking"
        description="Semua booking dengan tiga status terpisah: siklus, pembayaran, dan pencairan. Klik baris untuk melihat rincian uang dan timeline."
        actions={
          <Button variant="outline" href="/release">
            Antrean pencairan
          </Button>
        }
      />

      <Card className="mb-4">
        <Toolbar>
          <Input
            id="filter-q"
            label="Cari booking"
            type="search"
            value={filters.q}
            onChange={(event) => update({ q: event.target.value })}
            placeholder="Kode atau nama"
            leadingIcon={<Search className="h-4 w-4" />}
          />

          <Select
            id="filter-status"
            label="Status (semua sumbu)"
            value={filters.status}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">Semua status</option>
            {STATUS_OPTIONS.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>

          <Select
            id="filter-city"
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
            id="filter-range"
            label="Tanggal masuk"
            value={filters.range}
            onChange={(event) =>
              update({ range: event.target.value as BookingFilters['range'] })
            }
          >
            <option value="all">Semua tanggal</option>
            <option value="7d">7 hari terakhir</option>
            <option value="30d">30 hari terakhir</option>
            <option value="month">Bulan ini</option>
          </Select>
        </Toolbar>

        <ToolbarFooter>
          <p className="flex items-center gap-2 text-[13px] text-textSecondary" aria-live="polite">
            <SlidersHorizontal aria-hidden className="h-4 w-4" />
            {isLoading
              ? 'Memuat daftar booking…'
              : isError
                ? 'Daftar booking gagal dimuat'
                : isFetching
                  ? 'Memperbarui daftar…'
                  : `${total} booking cocok`}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <InlineSelect
              id="filter-sort"
              label="Urutkan"
              value={filters.sort}
              onChange={(value) => update({ sort: value as BookingFilters['sort'] })}
              options={[
                { value: 'created_desc', label: 'Terbaru masuk' },
                { value: 'event_asc', label: 'Acara terdekat' },
                { value: 'event_desc', label: 'Acara terjauh' }
              ]}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={!hasActiveFilters(filters) && region === 'all'}
              icon={<RotateCcw aria-hidden className="h-4 w-4" />}
            >
              Reset filter
            </Button>
          </div>
        </ToolbarFooter>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={6} />
        ) : isError ? (
          <ErrorState
            message={
              error instanceof Error
                ? error.message
                : 'Daftar booking tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title="Tidak ada booking yang cocok"
            description="Filter saat ini tidak menemukan booking. Longgarkan status, wilayah, atau rentang tanggal."
            action={
              <Button
                variant="outline"
                onClick={reset}
                icon={<RotateCcw aria-hidden className="h-4 w-4" />}
              >
                Reset filter
              </Button>
            }
          />
        ) : data ? (
          <>
            <div className="hidden xl:block">
              <Table
                label="Daftar booking Tarlink beserta status siklus, pembayaran, dan pencairan"
                className="min-w-[920px]"
              >
                <TableHead>
                  <TableRow>
                    <TableHeadCell>Booking</TableHeadCell>
                    <TableHeadCell>Vendor</TableHeadCell>
                    <TableHeadCell
                      sort={
                        filters.sort === 'event_asc'
                          ? 'asc'
                          : filters.sort === 'event_desc'
                            ? 'desc'
                            : 'none'
                      }
                      onSort={() =>
                        update({
                          sort: filters.sort === 'event_asc' ? 'event_desc' : 'event_asc'
                        })
                      }
                    >
                      Tanggal acara
                    </TableHeadCell>
                    <TableHeadCell align="right">Nilai</TableHeadCell>
                    <TableHeadCell>Status</TableHeadCell>
                    <TableHeadCell align="right">
                      <span className="sr-only">Aksi</span>
                    </TableHeadCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.items.map((booking) => (
                    <TableRow key={booking.id} onClick={() => setSelected(booking)}>
                      <TableCell>
                        <TitleBlock
                          avatar={<Avatar name={booking.customer_name} tone="primary" size="sm" />}
                          title={booking.code}
                          subtitle={booking.customer_name}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="max-w-[220px] truncate text-[15px] font-medium text-textMain">
                          {booking.vendor_name}
                        </p>
                        <p className="text-[13px] text-textSecondary">{booking.city}</p>
                      </TableCell>
                      <TableCell>
                        <p className="whitespace-nowrap text-[15px] text-textMain">
                          {formatDateID(booking.event_start_at)}
                        </p>
                        <p className="whitespace-nowrap text-[13px] text-textSecondary">
                          {formatTimeID(booking.event_start_at)} WIB
                        </p>
                      </TableCell>
                      <TableCell align="right">
                        <span className="tnum whitespace-nowrap font-semibold text-textMain">
                          {formatIDR(booking.total_customer_idr)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusPill axis="lifecycle" value={booking.lifecycle_status} />
                        <p className="mt-1.5 whitespace-nowrap text-[13px] text-textSecondary">
                          {statusLabel('payment', booking.payment_status)} ·{' '}
                          {statusLabel('settlement', booking.settlement_status)}
                        </p>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(booking);
                          }}
                          ariaLabel={`Lihat detail ${booking.code}`}
                          title={`Lihat detail ${booking.code}`}
                          className="h-9 min-h-9 w-9 px-0"
                        >
                          <Eye aria-hidden className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-border xl:hidden">
              {data.items.map((booking) => (
                <li key={booking.id} className="px-4 py-4">
                  <TitleBlock
                    avatar={<Avatar name={booking.customer_name} tone="primary" size="sm" />}
                    title={booking.code}
                    subtitle={`${booking.vendor_name} · ${booking.city}`}
                  />
                  <div className="mt-3 flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-textSecondary">
                      {formatDateID(booking.event_start_at)} ·{' '}
                      {formatTimeID(booking.event_start_at)} WIB
                    </span>
                    <span className="tnum text-[15px] font-semibold text-textMain">
                      {formatIDR(booking.total_customer_idr)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StatusPill axis="lifecycle" value={booking.lifecycle_status} />
                    <StatusPill axis="payment" value={booking.payment_status} />
                    <StatusPill axis="settlement" value={booking.settlement_status} />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(booking)}
                    className="mt-3 w-full"
                    icon={<Eye aria-hidden className="h-4 w-4" />}
                  >
                    Lihat detail
                  </Button>
                </li>
              ))}
            </ul>

            <Pagination
              page={page}
              pageCount={pageCount}
              start={start}
              end={end}
              total={total}
              unit="booking"
              onPageChange={(next) => update({ page: next })}
            />
          </>
        ) : null}
      </Card>

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        labelledBy="booking-drawer-title"
        title={selected ? selected.vendor_name : 'Detail booking'}
      >
        {selected ? <BookingDetail booking={selected} variant="drawer" /> : null}
      </Drawer>

      <p className="mt-4 text-[13px] text-textSecondary">
        Pencarian memakai kode, nama vendor, atau nama pelanggan. Filter tanggal memakai tanggal
        booking masuk, bukan tanggal acara. Wilayah mengikuti pilihan di sidebar.
      </p>
    </div>
  );
}
