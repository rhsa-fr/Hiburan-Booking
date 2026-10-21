import { describe, expect, it } from 'vitest';
import {
  auditActionLabel,
  auditReference,
  auditSummary
} from '../../../../apps/admin/lib/audit';
import { mapAuditAction } from './mappers';
import type { AuditActionRow } from './rows';

const ACTOR_ID = 'efc699a1-0000-4000-8000-000000000000';

function row(overrides: Partial<AuditActionRow> = {}): AuditActionRow {
  return {
    seq: '26',
    created_at: new Date('2026-10-21T13:56:00.000Z'),
    actor_id: ACTOR_ID,
    actor_label: 'admin@tarlink.id',
    actor_role: 'admin_super',
    action: 'booking.settle_manual',
    entity_type: 'booking',
    entity_id: 'c96efcb1-0000-4000-8000-000000000000',
    before_state: { payment_status: 'dp_paid', outstanding_idr: 3_550_000 },
    after_state: {
      payment_status: 'fully_paid',
      reference: 'BCA 21/10/2026',
      journal_entry_id: '50afa44c-783e-49a7-aeeb-453243d0b255'
    },
    request_id: 'P2AUDIT-1',
    ...overrides
  };
}

describe('audit humaniser', () => {
  it('labels known actions in Indonesian and falls back to the raw action', () => {
    expect(auditActionLabel('booking.settle_manual')).toBe('Pelunasan manual dicatat');
    expect(auditActionLabel('vendor.approve')).toBe('Vendor disetujui');
    expect(auditActionLabel('vendor.reject')).toBe('Vendor ditolak');
    expect(auditActionLabel('platform_settings.update')).toBe('platform_settings.update');
  });

  it('summarises the payment transition plus the short journal id', () => {
    expect(
      auditSummary(
        { payment_status: 'dp_paid' },
        { payment_status: 'fully_paid', journal_entry_id: '50afa44c-783e' }
      )
    ).toBe('dp_paid → fully_paid · jurnal 50afa44c');
  });

  it('renders a neutral dash when the snapshots carry nothing to show', () => {
    expect(auditSummary(null, null)).toBe('—');
  });

  it('shows the bank reference and the request id when present', () => {
    expect(auditReference({ reference: 'BCA 21/10/2026' }, 'P2AUDIT-1')).toBe(
      'BCA 21/10/2026 · P2AUDIT-1'
    );
    expect(auditReference({}, null)).toBe('—');
  });
});

describe('mapAuditAction', () => {
  it('maps the real audit_logs columns without reshaping before/after', () => {
    expect(mapAuditAction(row())).toEqual({
      seq: 26,
      created_at: '2026-10-21T13:56:00.000Z',
      actor_id: ACTOR_ID,
      actor_label: 'admin@tarlink.id',
      actor_role: 'admin_super',
      action: 'booking.settle_manual',
      entity: 'booking',
      entity_id: 'c96efcb1-0000-4000-8000-000000000000',
      before: { payment_status: 'dp_paid', outstanding_idr: 3_550_000 },
      after: {
        payment_status: 'fully_paid',
        reference: 'BCA 21/10/2026',
        journal_entry_id: '50afa44c-783e-49a7-aeeb-453243d0b255'
      },
      request_id: 'P2AUDIT-1'
    });
  });

  it('falls back to the actor uuid when the users row is gone', () => {
    const mapped = mapAuditAction(row({ actor_label: null }));
    expect(mapped.actor_label).toBe(ACTOR_ID);
  });

  it('falls back to Sistem when the audit row has no actor at all', () => {
    const mapped = mapAuditAction(row({ actor_id: null, actor_label: null }));
    expect(mapped.actor_label).toBe('Sistem');
    expect(mapped.actor_id).toBeNull();
  });
});
