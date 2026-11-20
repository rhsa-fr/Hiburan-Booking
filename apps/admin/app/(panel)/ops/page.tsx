import type { Metadata } from 'next';
import { OpsAlertsView } from '@/components/ops/ops-alerts';
import { PageHeader } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Operasional'
};

export const dynamic = 'force-dynamic';

export default function OpsPage() {
  return (
    <div>
      <PageHeader
        title="Kesiapan operasional"
        description="Antrean yang melewati SLA, gagal kirim, atau macet — satu tempat untuk memutuskan ke mana harus pergi."
      />
      <OpsAlertsView />
    </div>
  );
}
