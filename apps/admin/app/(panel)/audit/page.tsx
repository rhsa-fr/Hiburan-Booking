'use client';

import { useQuery } from '@tanstack/react-query';
import { ScrollText, ShieldCheck } from 'lucide-react';
import {
  BlockSkeleton,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TableSkeleton,
  TitleBlock
} from '@/components/ui';
import { getAuditLog } from '@/lib/api';
import { auditActionLabel, auditReference, auditSummary } from '@/lib/audit';
import { axisLabel, formatDateTimeID, statusLabel } from '@/lib/format';
import { roleLabel } from '@/lib/session';

export default function AuditPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['audit'],
    queryFn: getAuditLog
  });

  const actions = data?.actions ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit"
        description="Jejak tindakan operator dan setiap perubahan status booking: siapa, kapan, apa yang berubah, dan alasannya."
      />

      {isLoading ? (
        <>
          <Card>
            <TableSkeleton rows={5} />
          </Card>
          <Card>
            <TableSkeleton rows={8} />
          </Card>
        </>
      ) : isError ? (
        <Card>
          <ErrorState
            message={
              error instanceof Error
                ? error.message
                : 'Riwayat audit tidak bisa dimuat. Periksa koneksi lalu coba lagi.'
            }
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        </Card>
      ) : data ? (
        <>
          <Card className="overflow-hidden">
            <CardHeader
              icon={<ShieldCheck aria-hidden className="h-[17px] w-[17px]" />}
              title="Tindakan operator"
              description={`${actions.length} tindakan terakhir, terbaru di atas.`}
            />
            {actions.length === 0 ? (
              <EmptyState
                title="Belum ada tindakan operator"
                description="Pelunasan manual dan keputusan vendor akan tercatat di sini beserta pelakunya."
              />
            ) : (
              <Table
                label="Tindakan operator"
                maxHeight="max-h-[60vh]"
                className="min-w-[1040px]"
              >
                <TableHead>
                  <TableRow>
                    <TableHeadCell>Waktu</TableHeadCell>
                    <TableHeadCell>Pelaku</TableHeadCell>
                    <TableHeadCell>Aksi</TableHeadCell>
                    <TableHeadCell>Ringkasan</TableHeadCell>
                    <TableHeadCell>Referensi</TableHeadCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {actions.map((action) => (
                    <TableRow key={action.seq}>
                      <TableCell>
                        <span className="text-[13px] text-textSecondary">
                          {formatDateTimeID(action.created_at)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-[260px] flex-col items-start gap-1">
                          <span className="break-all text-[15px] text-textMain">
                            {action.actor_label}
                          </span>
                          {action.actor_role ? (
                            <StatusBadge tone="soft">{roleLabel(action.actor_role)}</StatusBadge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-[15px] text-textMain">
                          {auditActionLabel(action.action)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="break-words text-[13px] text-textSecondary">
                          {auditSummary(action.before, action.after)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="block max-w-[240px] break-all text-[13px] text-textSecondary">
                          {auditReference(action.after, action.request_id)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              icon={<ScrollText aria-hidden className="h-[17px] w-[17px]" />}
              title="Riwayat perubahan status"
              description={`${data.total} baris audit, terbaru di atas.`}
              action={
                <Button variant="outline" size="sm" href="/ledger">
                  Lihat jurnal
                </Button>
              }
            />
            {data.events.length === 0 ? (
              <EmptyState
                title="Belum ada jejak audit"
                description="Setiap kali status booking berubah, perubahannya tercatat di sini."
                action={
                  <Button variant="outline" href="/bookings">
                    Lihat booking
                  </Button>
                }
              />
            ) : (
              <Table
                label="Riwayat audit perubahan status booking"
                maxHeight="max-h-[70vh]"
                className="min-w-[900px]"
              >
                <TableHead>
                  <TableRow>
                    <TableHeadCell>Waktu</TableHeadCell>
                    <TableHeadCell>Booking</TableHeadCell>
                    <TableHeadCell>Sumbu</TableHeadCell>
                    <TableHeadCell>Perubahan</TableHeadCell>
                    <TableHeadCell>Pelaku</TableHeadCell>
                    <TableHeadCell>Catatan</TableHeadCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>
                        <span className="text-[13px] text-textSecondary">
                          {formatDateTimeID(event.at)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <TitleBlock title={event.booking_code} subtitle={event.booking_id} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone="muted">{axisLabel(event.axis)}</StatusBadge>
                      </TableCell>
                      <TableCell>
                        <p className="text-[15px] text-textMain">
                          {event.from_status === '-'
                            ? 'Dibuat'
                            : statusLabel(event.axis, event.from_status)}{' '}
                          <span aria-hidden className="text-textMuted">
                            →
                          </span>{' '}
                          {statusLabel(event.axis, event.to_status)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className="text-[15px] text-textMain">{event.actor}</span>
                      </TableCell>
                      <TableCell>
                        <span className="max-w-[320px] text-[13px] text-textSecondary">
                          {event.note ?? '—'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
