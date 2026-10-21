/**
 * Presentasi baris `audit_logs`. `before`/`after` adalah snapshot jsonb, jadi
 * setiap pembacaan field memakai guard tipe; aksi yang tidak dikenal tampil
 * apa adanya supaya tidak ada baris yang hilang dari layar.
 */

const ACTION_LABELS: Record<string, string> = {
  'booking.settle_manual': 'Pelunasan manual dicatat',
  'vendor.approve': 'Vendor disetujui',
  'vendor.reject': 'Vendor ditolak'
};

function strField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.length > 0 ? field : null;
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** `dp_paid → fully_paid · jurnal 50afa44c` */
export function auditSummary(before: unknown, after: unknown): string {
  const parts: string[] = [];
  const from = strField(before, 'payment_status');
  const to = strField(after, 'payment_status');
  if (from && to && from !== to) {
    parts.push(`${from} → ${to}`);
  } else if (to) {
    parts.push(to);
  }
  const journal = strField(after, 'journal_entry_id');
  if (journal) parts.push(`jurnal ${journal.slice(0, 8)}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** Referensi bank operator dulu, lalu request id sebagai korelasi. */
export function auditReference(after: unknown, requestId: string | null): string {
  const parts = [strField(after, 'reference'), requestId].filter(
    (part): part is string => Boolean(part)
  );
  return parts.length > 0 ? parts.join(' · ') : '—';
}
