'use client';

import { BarChart3, PieChart } from 'lucide-react';
import {
  BarChart,
  Button,
  Card,
  CardHeader,
  DonutChart,
  PeriodTabs
} from '@/components/ui';
import type { DonutSegment } from '@/components/ui';
import type { DailyBookingPoint, PaymentMixSlice } from '@/lib/types';

const MIX_COLORS: Record<string, DonutSegment['color']> = {
  unpaid: 'muted',
  dp_paid: 'primary',
  fully_paid: 'ok',
  partially_refunded: 'soft',
  refunded: 'danger'
};

export function BookingTrendCard({
  points7d,
  points30d,
  range,
  onRangeChange
}: {
  points7d: DailyBookingPoint[];
  points30d: DailyBookingPoint[];
  range: '7d' | '30d';
  onRangeChange: (range: '7d' | '30d') => void;
}) {
  const points = range === '7d' ? points7d : points30d;
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const peak = points.reduce(
    (best, point) => (point.count > best.count ? point : best),
    points[0] ?? { date: '', label: '-', count: 0 }
  );

  return (
    <Card>
      <CardHeader
        icon={<BarChart3 aria-hidden className="h-[17px] w-[17px]" />}
        title="Booking masuk per hari"
        description={`Total ${total} booking masuk pada periode ini.`}
        action={
          <PeriodTabs
            items={[
              { id: '7d', label: '7 hari' },
              { id: '30d', label: '30 hari' }
            ]}
            value={range}
            onChange={(id) => onRangeChange(id === '30d' ? '30d' : '7d')}
            ariaLabel="Pilih periode grafik booking"
          />
        }
      />
      <div className="px-5 pb-5">
        <BarChart
          data={points.map((point, index) => ({
            label: point.label,
            value: point.count,
            highlight: index === points.length - 1
          }))}
          unit="booking"
          emptyNote="Belum ada booking masuk pada periode ini."
        />
        <p className="mt-4 text-[13px] text-textSecondary">
          Puncak: <span className="tnum font-semibold text-textMain">{peak.count} booking</span> pada{' '}
          <span className="font-semibold text-textMain">{peak.label}</span>. Data dihitung dari
          tanggal booking dibuat, bukan tanggal acara.
        </p>
      </div>
    </Card>
  );
}

export function PaymentMixCard({ mix }: { mix: PaymentMixSlice[] }) {
  const segments: DonutSegment[] = mix.map((slice) => ({
    id: slice.status,
    label: slice.label,
    value: slice.count,
    color: MIX_COLORS[slice.status] ?? 'muted',
    href: `/bookings?payment_status=${slice.status}`
  }));
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <Card>
      <CardHeader
        icon={<PieChart aria-hidden className="h-[17px] w-[17px]" />}
        title="Status pembayaran"
        description="Sebaran status pembayaran seluruh booking seed."
        action={
          <Button variant="outline" size="sm" href="/payments">
            Lihat pembayaran
          </Button>
        }
      />
      <div className="px-5 pb-5">
        <DonutChart
          segments={segments}
          centerLabel="Total booking"
          centerValue={String(total)}
          unit="booking"
          emptyNote="Belum ada data pembayaran."
        />
        <p className="mt-3 text-[13px] text-textSecondary">
          Klik nama status untuk membuka daftar booking dengan status pembayaran tersebut.
        </p>
      </div>
    </Card>
  );
}
