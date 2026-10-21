'use client';

import {
  Activity,
  Clock3,
  MessagesSquare,
  ShieldAlert,
  Wallet
} from 'lucide-react';
import {
  ActivityList,
  Card,
  CardHeader,
  KeyValue,
  Meter,
  StatusBadge
} from '@/components/ui';
import type { ActivityItemData } from '@/components/ui';
import { formatPercentFromBp, relativeFrom } from '@/lib/format';
import { MOCK_NOW } from '@/lib/mock';
import type { ActionQueueItem, OperationHealth } from '@/lib/types';

const QUEUE_ICONS: Record<ActionQueueItem['kind'], typeof Wallet> = {
  release: Wallet,
  dp: Clock3,
  dispute: ShieldAlert,
  response: MessagesSquare,
  counter: MessagesSquare
};

const SEVERITY_BADGE: Record<
  ActionQueueItem['severity'],
  { label: string; tone: 'soft' | 'danger' | 'muted' }
> = {
  attention: { label: 'Perlu tindakan', tone: 'soft' },
  danger: { label: 'Mendesak', tone: 'danger' },
  info: { label: 'Informasi', tone: 'muted' }
};

export function ActionQueueCard({ items }: { items: ActionQueueItem[] }) {
  const activity: ActivityItemData[] = items.map((item) => {
    const Icon = QUEUE_ICONS[item.kind];
    const severity = SEVERITY_BADGE[item.severity];
    return {
      id: item.id,
      title: item.title,
      description: `${item.code} · ${item.detail} · ${relativeFrom(MOCK_NOW, item.due_at)}`,
      icon: <Icon className="h-4 w-4" />,
      tone: item.severity === 'danger' ? 'danger' : item.severity === 'attention' ? 'soft' : 'default',
      href: item.href,
      badge: <StatusBadge tone={severity.tone}>{severity.label}</StatusBadge>
    };
  });

  return (
    <Card>
      <CardHeader
        icon={<Activity aria-hidden className="h-[17px] w-[17px]" />}
        title="Perlu tindakan"
        description="Lima item terlama menurut tenggat. Paling atas yang paling mendesak."
      />
      <ActivityList
        items={activity}
        emptyTitle="Tidak ada tindakan mendesak"
        emptyDescription="Antrean kosong. Booking baru akan muncul di sini begitu tenggatnya masuk."
      />
    </Card>
  );
}

function HealthRow({
  label,
  bp,
  targetBp,
  targetLabel
}: {
  label: string;
  bp: number;
  targetBp: number;
  targetLabel: string;
}) {
  const below = bp < targetBp;
  return (
    <div className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-medium text-textMain">{label}</p>
        <p className="tnum text-lg font-bold text-textMain">{formatPercentFromBp(bp, 1)}</p>
      </div>
      <Meter percent={bp / 100} tone={below ? 'primary' : 'ok'} className="mt-2.5" />
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-textSecondary">{targetLabel}</span>
        <span className={below ? 'font-semibold text-primary' : 'font-medium text-ok'}>
          {below ? 'Di bawah target' : 'Di atas target'}
        </span>
      </div>
    </div>
  );
}

export function OperationHealthCard({ health }: { health: OperationHealth }) {
  return (
    <Card>
      <CardHeader
        icon={<ShieldAlert aria-hidden className="h-[17px] w-[17px]" />}
        title="Kesehatan operasi"
        description="Dihitung dari vendor aktif dan seluruh booking seed."
      />
      <div className="divide-y divide-border">
        <HealthRow
          label="Response rate vendor"
          bp={health.response_rate_bp}
          targetBp={health.response_target_bp}
          targetLabel={`Target ≥ ${formatPercentFromBp(health.response_target_bp, 0)}`}
        />
        <HealthRow
          label="Konversi DP"
          bp={health.dp_conversion_bp}
          targetBp={health.dp_target_bp}
          targetLabel={`Target ≥ ${formatPercentFromBp(health.dp_target_bp, 0)}`}
        />
      </div>
      <div className="px-5 py-4">
        <KeyValue
          layout="grid"
          className="rounded-none border-0 bg-transparent p-0"
          items={[
            {
              label: 'Double booking',
              value: health.double_bookings === 0 ? '0 · aman' : `${health.double_bookings} bentrok`,
              tone: health.double_bookings === 0 ? 'ok' : 'danger'
            },
            {
              label: 'Median jawaban vendor',
              value: `${health.median_response_minutes} menit`
            }
          ]}
        />
        <p className="mt-4 text-[13px] leading-relaxed text-textSecondary">
          Double booking dijaga oleh exclusion constraint slot, bukan oleh pengecekan UI.
        </p>
      </div>
    </Card>
  );
}
