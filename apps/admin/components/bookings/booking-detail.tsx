import {
  ArrowLeft,
  Ban,
  ExternalLink,
  MessageSquare,
  ShieldAlert,
  Wallet
} from 'lucide-react';
import {
  Button,
  DisabledAction,
  KeyValue,
  StatusPill,
  axisLabel,
  statusLabel
} from '@/components/ui';
import {
  formatDateID,
  formatDateTimeID,
  formatIDR,
  formatPercentFromBp,
  relativeFrom
} from '@/lib/format';
import { MOCK_NOW } from '@/lib/mock';
import type { Booking, Dispute, Payment, StatusAxis } from '@/lib/types';

const AXES: StatusAxis[] = ['lifecycle', 'payment', 'settlement'];

const DISPUTE_LABELS: Record<string, string> = {
  open: 'Terbuka',
  resolved_to_vendor: 'Diputuskan ke vendor',
  resolved_refund: 'Diputuskan refund',
  resolved_clawback: 'Diputuskan clawback',
  rejected: 'Ditolak'
};

const PAYMENT_KIND_LABELS: Record<Payment['kind'], string> = {
  dp: 'DP',
  settlement: 'Pelunasan',
  refund: 'Refund'
};

const PAYMENT_STATUS_LABELS: Record<Payment['status'], string> = {
  pending: 'Menunggu',
  paid: 'Berhasil',
  failed: 'Gagal',
  expired: 'Kedaluwarsa'
};

export function BookingDetail({
  booking,
  payments,
  dispute,
  variant
}: {
  booking: Booking;
  payments?: Payment[];
  dispute?: Dispute | null;
  variant: 'drawer' | 'page';
}) {
  const timeline = [...booking.status_history].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
  const releaseCandidate =
    booking.lifecycle_status === 'completed' &&
    booking.payment_status === 'fully_paid' &&
    booking.settlement_status === 'held' &&
    !dispute;

  return (
    <div className={variant === 'drawer' ? 'space-y-6 p-5' : 'space-y-7'}>
      <section aria-labelledby="booking-summary">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-textSecondary">Kode booking</p>
            <p id="booking-summary" className="tnum mt-0.5 text-xl font-semibold tracking-[-0.01em]">
              {booking.code}
            </p>
            <p className="mt-1 text-sm text-textSecondary">Dibuat {formatDateTimeID(booking.created_at)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-textSecondary">Total tagihan</p>
            <p className="tnum mt-0.5 text-2xl font-semibold tracking-[-0.01em]">
              {formatIDR(booking.total_customer_idr)}
            </p>
          </div>
        </div>

        <KeyValue
          layout="grid"
          className="mt-5"
          items={[
            { label: 'Vendor', value: booking.vendor_name },
            { label: 'Kota acara', value: booking.city },
            { label: 'Pelanggan', value: booking.customer_name },
            { label: 'Jadwal acara', value: formatDateTimeID(booking.event_start_at) }
          ]}
        />
      </section>

      <section aria-labelledby="booking-axes">
        <h3 id="booking-axes" className="text-sm font-semibold uppercase tracking-[0.12em] text-textSecondary">
          Status tiga sumbu
        </h3>
        <div className="mt-2.5 grid grid-cols-1 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {AXES.map((axis) => {
            const value =
              axis === 'lifecycle'
                ? booking.lifecycle_status
                : axis === 'payment'
                  ? booking.payment_status
                  : booking.settlement_status;
            return (
              <div key={axis} className="px-4 py-3.5">
                <p className="text-sm text-textSecondary">{axisLabel(axis)}</p>
                <div className="mt-2">
                  <StatusPill axis={axis} value={value} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="booking-money">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="booking-money" className="text-[17px] font-semibold tracking-[-0.01em]">
            Rincian uang
          </h3>
          <span className="text-sm text-textSecondary">IDR, tanpa desimal</span>
        </div>
        <KeyValue
          className="mt-3"
          items={[
            { label: 'Harga paket', value: formatIDR(booking.price_package_idr) },
            {
              label: 'Biaya layanan',
              hint: `(${formatPercentFromBp(booking.service_fee_bp, 0)})`,
              value: formatIDR(booking.service_fee_idr)
            },
            {
              label: 'Total tagihan',
              value: formatIDR(booking.total_customer_idr),
              emphasis: true
            },
            {
              label: 'DP',
              hint: `(${formatPercentFromBp(booking.dp_min_bp, 0)})`,
              value: formatIDR(booking.dp_amount_idr)
            },
            { label: 'Sisa pelunasan', value: formatIDR(booking.remaining_idr) },
            {
              label: 'Komisi tier-1',
              hint: `(${formatPercentFromBp(booking.commission_bp, 0)} s.d. ${formatIDR(
                booking.commission_threshold_idr
              )})`,
              value: formatIDR(booking.commission_tier1_idr)
            },
            {
              label: 'Komisi tier-2',
              hint: `(${formatPercentFromBp(booking.commission_bp_tier2, 0)} di atas ambang)`,
              value: formatIDR(booking.commission_tier2_idr)
            },
            {
              label: 'Total komisi',
              value: formatIDR(booking.commission_idr),
              emphasis: true
            },
            {
              label: 'Hak vendor',
              hint: '(harga paket - komisi)',
              value: formatIDR(booking.vendor_entitlement_idr),
              emphasis: true,
              tone: 'ok'
            }
          ]}
        />
        <p className="mt-2 text-sm leading-snug text-textSecondary">
          Komisi dihitung dari harga paket sebelum biaya layanan (D-17). Nilai tersimpan per
          booking dan tidak berubah saat pengaturan platform diubah.
        </p>
      </section>

      {booking.respond_deadline ||
      booking.payment_deadline ||
      booking.dispute_window_ends_at ||
      booking.released_at ? (
        <section aria-labelledby="booking-deadlines">
          <h3
            id="booking-deadlines"
            className="text-[17px] font-semibold tracking-[-0.01em]"
          >
            Tenggat dan jendela
          </h3>
          <KeyValue
            className="mt-3"
            items={[
              ...(booking.respond_deadline
                ? [
                    {
                      label: 'Batas jawaban vendor',
                      value: (
                        <>
                          <span className="block text-base font-medium text-textMain">
                            {formatDateTimeID(booking.respond_deadline)}
                          </span>
                          <span className="text-sm text-textSecondary">
                            {relativeFrom(MOCK_NOW, booking.respond_deadline)}
                          </span>
                        </>
                      )
                    }
                  ]
                : []),
              ...(booking.payment_deadline
                ? [
                    {
                      label: 'Batas bayar DP',
                      value: (
                        <>
                          <span className="block text-base font-medium text-textMain">
                            {formatDateTimeID(booking.payment_deadline)}
                          </span>
                          <span
                            className={
                              new Date(booking.payment_deadline).getTime() <
                              new Date(MOCK_NOW).getTime()
                                ? 'text-sm font-semibold text-danger'
                                : 'text-sm text-textSecondary'
                            }
                          >
                            {relativeFrom(MOCK_NOW, booking.payment_deadline)}
                          </span>
                        </>
                      )
                    }
                  ]
                : []),
              ...(booking.dispute_window_ends_at
                ? [
                    {
                      label: 'Jendela sengketa berakhir',
                      value: (
                        <>
                          <span className="block text-base font-medium text-textMain">
                            {formatDateID(booking.dispute_window_ends_at)}
                          </span>
                          <span className="text-sm text-textSecondary">
                            {relativeFrom(MOCK_NOW, booking.dispute_window_ends_at)}
                          </span>
                        </>
                      )
                    }
                  ]
                : []),
              ...(booking.released_at
                ? [
                    {
                      label: 'Dana dicairkan',
                      value: (
                        <span className="text-base font-medium text-ok">
                          {formatDateTimeID(booking.released_at)}
                        </span>
                      )
                    }
                  ]
                : [])
            ]}
          />
        </section>
      ) : null}

      {dispute ? (
        <section
          aria-labelledby="booking-dispute"
          className="rounded-card border border-danger/25 bg-danger/10 p-4"
        >
          <div className="flex items-center gap-2 text-danger">
            <ShieldAlert aria-hidden className="h-5 w-5" />
            <h3 id="booking-dispute" className="text-base font-semibold">
              Sengketa · {DISPUTE_LABELS[dispute.status] ?? dispute.status}
            </h3>
          </div>
          <p className="mt-2 text-base leading-relaxed text-textMain">{dispute.reason}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-textSecondary">Dibuka</dt>
              <dd className="mt-0.5 font-medium text-textMain">{formatDateTimeID(dispute.opened_at)}</dd>
            </div>
            <div>
              <dt className="text-textSecondary">Batas SLA</dt>
              <dd className="mt-0.5 font-medium text-textMain">{formatDateTimeID(dispute.sla_due_at)}</dd>
            </div>
            {dispute.resolved_at ? (
              <div>
                <dt className="text-textSecondary">Diputuskan</dt>
                <dd className="mt-0.5 font-medium text-textMain">
                  {formatDateTimeID(dispute.resolved_at)}
                </dd>
              </div>
            ) : null}
            {dispute.customer_share_idr > 0 ? (
              <div>
                <dt className="text-textSecondary">Porsi pelanggan</dt>
                <dd className="tnum mt-0.5 font-medium text-textMain">
                  {formatIDR(dispute.customer_share_idr)}
                </dd>
              </div>
            ) : null}
          </dl>
          {dispute.resolution_note ? (
            <p className="mt-3 text-sm leading-relaxed text-textSecondary">{dispute.resolution_note}</p>
          ) : null}
        </section>
      ) : null}

      {payments && payments.length > 0 ? (
        <section aria-labelledby="booking-payments">
          <h3 id="booking-payments" className="text-[17px] font-semibold tracking-[-0.01em]">
            Pembayaran
          </h3>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-base font-medium text-textMain">
                    {PAYMENT_KIND_LABELS[payment.kind]} · {PAYMENT_STATUS_LABELS[payment.status]}
                  </p>
                  <p className="truncate text-sm text-textSecondary">
                    {payment.method}
                    {payment.gateway_ref ? ` · ${payment.gateway_ref}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tnum text-base font-medium text-textMain">
                    {formatIDR(payment.amount_idr)}
                  </p>
                  <p className="text-sm text-textSecondary">
                    {payment.paid_at ? formatDateTimeID(payment.paid_at) : 'Belum dibayar'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="booking-timeline">
        <h3 id="booking-timeline" className="text-[17px] font-semibold tracking-[-0.01em]">
          Timeline status
        </h3>
        <ol className="mt-4 ml-1.5 space-y-5 border-l border-border pl-5">
          {timeline.map((entry) => (
            <li key={entry.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-surface"
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-border bg-subtle px-2 py-0.5 text-[13px] font-semibold text-textSecondary">
                  {axisLabel(entry.axis)}
                </span>
                <span className="text-sm font-semibold text-textMain">
                  {entry.from_status === '-'
                    ? 'Dibuat'
                    : statusLabel(entry.axis, entry.from_status)}{' '}
                  <span aria-hidden className="text-textSecondary">
                    →
                  </span>{' '}
                  {statusLabel(entry.axis, entry.to_status)}
                </span>
              </div>
              <p className="mt-1 text-sm text-textSecondary">
                {formatDateTimeID(entry.at)} · {entry.actor}
              </p>
              {entry.note ? (
                <p className="mt-1 text-base leading-relaxed text-textMain/85">{entry.note}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="booking-actions" className="border-t border-border pt-5">
        <h3 id="booking-actions" className="text-sm font-semibold uppercase tracking-[0.12em] text-textSecondary">
          Tindakan
        </h3>
        <div className="mt-3 flex flex-wrap items-start gap-3">
          {variant === 'drawer' ? (
            <Button
              href={`/bookings/${booking.id}`}
              icon={<ExternalLink aria-hidden className="h-4 w-4" />}
            >
              Buka halaman penuh
            </Button>
          ) : (
            <Button
              variant="outline"
              href="/bookings"
              icon={<ArrowLeft aria-hidden className="h-4 w-4" />}
            >
              Kembali ke daftar
            </Button>
          )}
          {releaseCandidate ? (
            <Button
              variant="outline"
              href="/release"
              icon={<Wallet aria-hidden className="h-4 w-4" />}
            >
              Buka antrean pencairan
            </Button>
          ) : null}
          <DisabledAction
            label="Batalkan booking"
            reason="Butuh alasan wajib, approval admin_super, dan alur refund. Belum tersedia di build mock ini."
            icon={Ban}
          />
          <DisabledAction
            label="Kirim ulang WhatsApp"
            reason="Integrasi WhatsApp belum terhubung di mode mock. Hubungi vendor memakai nomor di profil vendor."
            icon={MessageSquare}
          />
        </div>
        {variant === 'drawer' ? (
          <p className="mt-3 text-sm text-textSecondary">
            <Button
              variant="ghost"
              size="sm"
              href={`/bookings/${booking.id}`}
              className="-ml-3"
            >
              Tautan langsung ke booking ini
            </Button>
          </p>
        ) : null}
      </section>
    </div>
  );
}
