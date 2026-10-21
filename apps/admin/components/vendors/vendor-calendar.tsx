'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  CalendarGrid,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  DisabledAction,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Select,
  Skeleton,
  StatusBadge,
  BlockSkeleton
} from '@/components/ui';
import type { BadgeTone, CalendarGridCell } from '@/components/ui';
import { bulkUpdateVendorCalendar, getVendorCalendar } from '@/lib/api';
import { formatCalendarDayID, formatMonthYearID } from '@/lib/format';
import type {
  VendorCalendarDay,
  VendorCalendarSession,
  VendorCalendarStatus
} from '@/lib/types';
import type { VendorNotice } from './notice';

const STATUS_LABEL: Record<VendorCalendarStatus, string> = {
  available: 'Tersedia',
  blocked: 'Diblokir',
  held: 'Ditahan',
  booked: 'Terbooking',
  unconfirmed: 'Belum dikonfirmasi'
};

const STATUS_TONE: Record<VendorCalendarStatus, BadgeTone> = {
  available: 'ok',
  blocked: 'muted',
  held: 'soft',
  booked: 'primary',
  unconfirmed: 'danger'
};

const SESSION_LABEL: Record<VendorCalendarSession, string> = {
  day: 'Pagi',
  night: 'Malam',
  full: 'Penuh'
};

const SESSION_ORDER: VendorCalendarSession[] = ['day', 'night', 'full'];

const LOCKED_STATUSES: VendorCalendarStatus[] = ['held', 'booked'];

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function monthBounds(year: number, monthIndex: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return {
    from: `${year}-${pad2(monthIndex + 1)}-01`,
    to: `${year}-${pad2(monthIndex + 1)}-${pad2(last)}`
  };
}

/** Titik awal aman untuk editor: hari ini bila masih di bulan itu, selain itu tanggal 1. */
function defaultDate(bounds: { from: string; to: string }): string {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return today >= bounds.from && today <= bounds.to ? today : bounds.from;
}

function shiftMonth(year: number, monthIndex: number, delta: number): { year: number; month: number } {
  const next = new Date(Date.UTC(year, monthIndex + delta, 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
}

function isoDay(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function listDates(from: string, to: string): string[] {
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

export function VendorCalendar({
  vendorId,
  canWrite,
  rolesReady,
  onNotify
}: {
  vendorId: string;
  canWrite: boolean;
  rolesReady: boolean;
  onNotify: (notice: VendorNotice) => void;
}) {
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [rangeFrom, setRangeFrom] = useState<string | null>(null);
  const [rangeTo, setRangeTo] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [status, setStatus] = useState<'available' | 'blocked'>('available');
  const [sessions, setSessions] = useState<VendorCalendarSession[]>(['day']);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const bounds = monthBounds(cursor.year, cursor.month);
  const fallbackDate = defaultDate(bounds);
  const from = rangeFrom ?? fallbackDate;
  const to = rangeTo ?? fallbackDate;

  const calendarQuery = useQuery({
    queryKey: ['vendor-calendar', vendorId, bounds.from, bounds.to],
    queryFn: () => getVendorCalendar(vendorId, bounds.from, bounds.to)
  });

  const daysByDate = useMemo(() => {
    const map = new Map<string, VendorCalendarDay[]>();
    for (const day of calendarQuery.data?.days ?? []) {
      const existing = map.get(day.date);
      if (existing) existing.push(day);
      else map.set(day.date, [day]);
    }
    return map;
  }, [calendarQuery.data]);

  function isLockedDate(date: string): boolean {
    const days = daysByDate.get(date) ?? [];
    return days.some((day) => LOCKED_STATUSES.includes(day.status));
  }

  const rangeError = (() => {
    if (!from || !to) return 'Isi tanggal mulai dan selesai.';
    if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return 'Format tanggal belum lengkap.';
    if (from > to) return 'Tanggal mulai harus sebelum tanggal selesai.';
    if (from < bounds.from || to > bounds.to) {
      return 'Rentang harus di dalam bulan yang ditampilkan.';
    }
    return null;
  })();

  const rangeDates = rangeError ? [] : listDates(from, to);
  const lockedDates = rangeDates.filter(isLockedDate);
  const editableCount = rangeDates.length - lockedDates.length;
  const sessionsValid = sessions.length > 0;

  function toggleSession(session: VendorCalendarSession): void {
    setSessions((previous) =>
      previous.includes(session)
        ? previous.filter((item) => item !== session)
        : [...previous, session]
    );
  }

  function handleSelect(date: string): void {
    if (!anchor) {
      setAnchor(date);
      setRangeFrom(date);
      setRangeTo(date);
      return;
    }
    const start = anchor < date ? anchor : date;
    const end = anchor < date ? date : anchor;
    setRangeFrom(start);
    setRangeTo(end);
    setAnchor(null);
  }

  function changeMonth(delta: number): void {
    setCursor((previous) => shiftMonth(previous.year, previous.month, delta));
    setRangeFrom(null);
    setRangeTo(null);
    setAnchor(null);
  }

  const bulk = useMutation({
    mutationFn: () =>
      bulkUpdateVendorCalendar(vendorId, { from, to, status, sessions }),
    onSuccess: (result) => {
      setConfirmOpen(false);
      bulk.reset();
      void queryClient.invalidateQueries({ queryKey: ['vendor-calendar', vendorId] });
      onNotify({
        tone: result.updated > 0 ? 'ok' : 'warning',
        title: result.updated > 0 ? 'Kalender diperbarui' : 'Tidak ada hari yang diubah',
        description:
          result.updated > 0
            ? `${result.updated} hari diperbarui. Hari yang sudah terisi dilewati otomatis.`
            : 'Semua hari di rentang itu sedang ditahan atau terbooking, jadi tidak ada yang ditimpa.'
      });
    }
  });

  const cells: CalendarGridCell[] = [];
  {
    const totalDays = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
    for (let day = 1; day <= totalDays; day += 1) {
      const date = isoDay(cursor.year, cursor.month, day);
      const entries = [...(daysByDate.get(date) ?? [])].sort(
        (a, b) => SESSION_ORDER.indexOf(a.session) - SESSION_ORDER.indexOf(b.session)
      );
      const locked = entries.some((entry) => LOCKED_STATUSES.includes(entry.status));
      const inRange = !rangeError && date >= from && date <= to;
      const selected = inRange && (date === from || date === to);
      const label =
        entries.length > 0
          ? `${formatCalendarDayID(date)}: ${entries
              .map((entry) => `${SESSION_LABEL[entry.session]} ${STATUS_LABEL[entry.status].toLowerCase()}`)
              .join(', ')}`
          : `${formatCalendarDayID(date)}: belum ada status`;

      cells.push({
        key: date,
        day,
        ariaLabel: label,
        highlighted: inRange,
        selected,
        locked,
        onSelect: locked ? undefined : () => handleSelect(date),
        content: (
          <span className="flex flex-wrap gap-1">
            {entries.length === 0 ? (
              <span className="text-[11px] text-textMuted">—</span>
            ) : (
              entries.map((entry) => (
                <StatusBadge
                  key={`${date}-${entry.session}`}
                  tone={STATUS_TONE[entry.status]}
                  className="px-1.5 py-0.5 text-[11px]"
                >
                  {SESSION_LABEL[entry.session]}
                </StatusBadge>
              ))
            )}
          </span>
        )
      });
    }
  }

  const firstWeekday =
    (new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay() + 6) % 7;
  const trailingBlanks = Math.max(0, (7 - ((firstWeekday + cells.length) % 7)) % 7);

  const monthLabel = formatMonthYearID(cursor.year, cursor.month);
  const hasDays = (calendarQuery.data?.days.length ?? 0) > 0;

  return (
    <>
      <Card labelledBy="vendor-calendar-title">
        <CardHeader
          title={<span id="vendor-calendar-title">Kalender</span>}
          description="Status per sesi. Hari yang ditahan atau terbooking dikunci dan tidak bisa ditimpa."
          icon={<CalendarDays aria-hidden className="h-4 w-4" />}
          action={
            <div className="flex items-center gap-2">
              <IconButton
                label="Bulan sebelumnya"
                icon={<ChevronLeft aria-hidden className="h-4 w-4" />}
                onClick={() => changeMonth(-1)}
              />
              <span className="min-w-[132px] text-center text-base font-semibold text-textMain">
                {monthLabel}
              </span>
              <IconButton
                label="Bulan berikutnya"
                icon={<ChevronRight aria-hidden className="h-4 w-4" />}
                onClick={() => changeMonth(1)}
              />
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
          {(Object.keys(STATUS_LABEL) as VendorCalendarStatus[]).map((value) => (
            <StatusBadge key={value} tone={STATUS_TONE[value]}>
              {STATUS_LABEL[value]}
            </StatusBadge>
          ))}
          <span className="inline-flex items-center gap-1 text-[13px] text-textSecondary">
            <Lock aria-hidden className="h-3.5 w-3.5" />
            terkunci
          </span>
        </div>

        {calendarQuery.isPending ? (
          <BlockSkeleton rows={5} />
        ) : calendarQuery.isError ? (
          <ErrorState
            title="Kalender belum bisa dimuat"
            message={
              calendarQuery.error instanceof Error
                ? calendarQuery.error.message
                : 'Status kalender tidak bisa dimuat. Coba lagi.'
            }
            onRetry={() => void calendarQuery.refetch()}
            retrying={calendarQuery.isFetching}
          />
        ) : !hasDays ? (
          calendarQuery.data ? (
            <EmptyState
              icon={<CalendarDays aria-hidden className="h-6 w-6" />}
              title="Belum ada status kalender"
              description="Bulan ini belum punya status per sesi. Tentukan rentang di editor di bawah untuk mengisi status pertama."
              action={
                <Button variant="outline" href="#vendor-calendar-editor">
                  Atur rentang
                </Button>
              }
            />
          ) : null
        ) : (
          <CardBody className="pt-0">
            <p className="mb-3 text-sm text-textSecondary">
              Klik tanggal untuk memilih rentang. Tanggal bertanda kunci tidak bisa dipilih.
            </p>
            <CalendarGrid
              label={`Kalender vendor ${monthLabel}`}
              cells={cells}
              leadingBlanks={firstWeekday}
              trailingBlanks={trailingBlanks}
            />
          </CardBody>
        )}

        <div id="vendor-calendar-editor" className="border-t border-border px-5 py-4">
          <div className="rounded-field border border-border bg-subtle/60 p-4">
            <h3 className="text-[15px] font-semibold text-textMain">Ubah rentang</h3>
            <p className="mt-0.5 text-sm leading-relaxed text-textSecondary">
              Pilih rentang di bulan {monthLabel}, lalu tentukan status dan sesi yang ditimpa.
            </p>

            {!rolesReady ? (
              <div className="mt-4 space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-2/3" />
              </div>
            ) : (
              <>
                {!canWrite ? (
                  <Alert tone="info" className="mt-3">
                    Hanya admin finance dan admin super yang boleh mengubah kalender. Anda tetap
                    bisa melihat statusnya.
                  </Alert>
                ) : null}

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Input
                    id="calendar-from"
                    type="date"
                    label="Dari tanggal"
                    value={from}
                    min={bounds.from}
                    max={bounds.to}
                    disabled={!canWrite}
                    onChange={(event) => {
                      setAnchor(null);
                      setRangeFrom(event.target.value);
                    }}
                  />
                  <Input
                    id="calendar-to"
                    type="date"
                    label="Sampai tanggal"
                    value={to}
                    min={bounds.from}
                    max={bounds.to}
                    disabled={!canWrite}
                    onChange={(event) => {
                      setAnchor(null);
                      setRangeTo(event.target.value);
                    }}
                  />
                  <Select
                    id="calendar-status"
                    label="Status"
                    value={status}
                    disabled={!canWrite}
                    onChange={(event) => setStatus(event.target.value as 'available' | 'blocked')}
                  >
                    <option value="available">Tersedia</option>
                    <option value="blocked">Diblokir</option>
                  </Select>
                  <div>
                    <p className="mb-1.5 block text-sm font-semibold text-textMain">Sesi</p>
                    <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2">
                      {SESSION_ORDER.map((session) => (
                        <Checkbox
                          key={session}
                          id={`calendar-session-${session}`}
                          label={SESSION_LABEL[session]}
                          checked={sessions.includes(session)}
                          disabled={!canWrite}
                          onChange={() => toggleSession(session)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-sm" aria-live="polite">
                  {rangeError ? (
                    <p className="font-semibold text-danger">{rangeError}</p>
                  ) : (
                    <>
                      <p className="text-textMain">
                        <strong className="font-semibold">{editableCount} hari</strong> akan
                        diubah ·{' '}
                        <strong className="font-semibold">{lockedDates.length} hari</strong>{' '}
                        dilewati karena ditahan atau terbooking.
                      </p>
                      {!sessionsValid ? (
                        <p className="font-semibold text-danger">
                          Pilih minimal satu sesi (Pagi, Malam, atau Penuh).
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {canWrite ? (
                    <Button
                      onClick={() => {
                        bulk.reset();
                        setConfirmOpen(true);
                      }}
                      disabled={Boolean(rangeError) || !sessionsValid || editableCount === 0}
                    >
                      Terapkan ke {editableCount} hari
                    </Button>
                  ) : (
                    <DisabledAction
                      label="Terapkan perubahan"
                      reason="Hanya admin finance dan admin super yang boleh mengubah kalender."
                    />
                  )}
                  {!rangeError && lockedDates.length > 0 ? (
                    <p className="max-w-[46ch] text-[13px] leading-snug text-textSecondary">
                      API melewati hari berstatus ditahan dan terbooking; statusnya tidak berubah.
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => {
          if (bulk.isPending) return;
          setConfirmOpen(false);
          bulk.reset();
        }}
        title="Timpa status kalender?"
        description={`${formatCalendarDayID(from)} – ${formatCalendarDayID(to)} · ${STATUS_LABEL[status]} · sesi ${sessions
          .map((session) => SESSION_LABEL[session])
          .join(', ')}.`}
        consequence={
          <>
            {editableCount} hari akan ditimpa.
            {lockedDates.length > 0
              ? ` ${lockedDates.length} hari ditahan/terbooking dilewati otomatis dan statusnya tidak berubah.`
              : ' Hari yang ditahan atau terbooking tetap dilewati otomatis.'}
          </>
        }
        confirmLabel="Ya, terapkan"
        tone="primary"
        pending={bulk.isPending}
        error={bulk.isError ? bulk.error.message : null}
        onConfirm={() => bulk.mutate()}
        labelledBy="calendar-confirm-title"
      />
    </>
  );
}
