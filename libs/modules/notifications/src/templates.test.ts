import { describe, expect, it } from 'vitest';
import {
  planEmailNotification,
  planNotification,
  planReportResolvedNotification,
  planReportSlaNotification,
  reportResolvedDedupeKey,
  reportSlaDedupeKey
} from './templates';

const payload = { booking_id: 'b-1', code: 'BK-261105-0001' };

describe('planNotification', () => {
  it('routes a new request to the vendor only', () => {
    expect(planNotification('booking.requested', payload)).toEqual({
      audience: 'vendor',
      title: 'Pesanan baru masuk',
      body: 'BK-261105-0001 menunggu responsmu.'
    });
  });

  it('routes acceptance to the customer', () => {
    expect(planNotification('booking.accepted', payload)?.audience).toBe('customer');
  });

  it('notifies both sides for money and completion events', () => {
    for (const event of ['booking.confirmed', 'booking.fully_paid', 'booking.completed']) {
      expect(planNotification(event, payload)?.audience).toBe('both');
    }
  });

  it('falls back to a generic code when the payload omits it', () => {
    expect(planNotification('booking.cancelled', {})?.body).toContain('Pesanan');
  });

  it('ignores unknown events', () => {
    expect(planNotification('vendor.media.approved', payload)).toBeNull();
  });

  it('leaves internal relay events silent', () => {
    for (const event of [
      'payment.dp_succeeded',
      'vendor.media.approved',
      'payout.settled',
      'not-a-booking-event'
    ]) {
      expect(planNotification(event, payload)).toBeNull();
    }
  });
});

describe('planNotification — disputes', () => {
  it('tells both sides that the money is held while the dispute is open', () => {
    expect(planNotification('booking.dispute_opened', payload)).toEqual({
      audience: 'both',
      title: 'Sengketa dibuka',
      body: 'BK-261105-0001: dana ditahan sampai admin memutuskan.'
    });
  });

  it.each([
    ['refund_full', 'BK-261105-0001: refund diputuskan. Dana dikembalikan sesuai keputusan admin.'],
    ['refund_partial', 'BK-261105-0001: refund diputuskan. Dana dikembalikan sesuai keputusan admin.'],
    ['release_to_vendor', 'BK-261105-0001: dana diteruskan ke vendor.'],
    ['reject', 'BK-261105-0001: sengketa ditolak.'],
    ['no_action', 'BK-261105-0001: sengketa ditolak.']
  ])('reports the %s outcome to both sides', (resolution, body) => {
    expect(planNotification('booking.dispute_resolved', { ...payload, resolution })).toEqual({
      audience: 'both',
      title: 'Sengketa diputuskan',
      body
    });
  });

  it('falls back to a neutral body when the resolution is missing or unknown', () => {
    const expected = 'BK-261105-0001: sengketa sudah diputuskan.';
    expect(planNotification('booking.dispute_resolved', payload)?.body).toBe(expected);
    expect(
      planNotification('booking.dispute_resolved', { ...payload, resolution: 'split' })?.body
    ).toBe(expected);
  });
});

describe('planEmailNotification (FR-051)', () => {
  it('wraps the in-app copy with a subject that carries the booking code', () => {
    const plan = planEmailNotification('booking.accepted', payload);
    expect(plan).not.toBeNull();
    expect(plan?.subject).toBe('Pesanan diterima vendor — BK-261105-0001');
    expect(plan?.text.startsWith('BK-261105-0001 sudah diterima.')).toBe(true);
    expect(plan?.text).toContain('Buka aplikasi Tarlink');
    expect(plan?.text).toContain('mohon jangan dibalas');
  });

  it('keeps the audience of the in-app plan so only the right side is emailed', () => {
    expect(planEmailNotification('booking.requested', payload)?.audience).toBe('vendor');
    expect(planEmailNotification('booking.fully_paid', payload)?.audience).toBe('both');
  });

  it('covers every user-facing booking event', () => {
    const events = [
      'booking.requested',
      'booking.accepted',
      'booking.rejected',
      'booking.cancelled',
      'booking.checked_in',
      'booking.no_show',
      'booking.confirmed',
      'booking.fully_paid',
      'booking.completed',
      'booking.expired',
      'booking.dispute_opened',
      'booking.dispute_resolved'
    ];
    for (const event of events) {
      expect(planEmailNotification(event, payload), event).not.toBeNull();
    }
  });

  it('never emails an internal event', () => {
    for (const event of ['payment.dp_succeeded', 'payout.settled', 'booking.released']) {
      expect(planEmailNotification(event, payload), event).toBeNull();
    }
  });

  it('falls back to a generic code when the payload omits it', () => {
    expect(planEmailNotification('booking.cancelled', {})?.subject).toBe(
      'Pesanan dibatalkan — Pesanan'
    );
  });
});

describe('planReportResolvedNotification (FR-123)', () => {
  it('tells the reporter what happened without exposing moderator notes', () => {
    expect(planReportResolvedNotification('content_removed', 'review')).toEqual({
      title: 'Laporan ulasan diturunkan',
      body: 'Konten ulasan yang kamu laporkan sudah diturunkan setelah ditinjau.'
    });
    expect(planReportResolvedNotification('no_action', 'vendor')).toEqual({
      title: 'Laporan vendor ditinjau',
      body: 'Setelah ditinjau, tidak ada pelanggaran yang ditemukan pada laporanmu.'
    });
  });

  it.each(['content_restored', 'user_warned', 'user_suspended'])(
    'covers the %s decision',
    (action) => {
      const notice = planReportResolvedNotification(action, 'chat_message');
      expect(notice.title.length).toBeGreaterThan(0);
      expect(notice.body.length).toBeGreaterThan(0);
    }
  );

  it('falls back safely for an unknown action or target', () => {
    expect(planReportResolvedNotification('mystery', 'mystery')).toEqual({
      title: 'Laporan konten ditinjau',
      body: 'Laporanmu sudah diputuskan oleh moderator.'
    });
  });
});

describe('planReportSlaNotification (FR-123/124 escalation)', () => {
  it('names the target, the short report id, and the due time', () => {
    const notice = planReportSlaNotification({
      reportId: '12345678-aaaa-bbbb-cccc-dddddddddddd',
      targetType: 'vendor_media',
      dueAt: '2026-11-08T03:00:00.000Z'
    });
    expect(notice.title).toBe('Laporan lewat SLA');
    expect(notice.body).toContain('media vendor');
    expect(notice.body).toContain('12345678');
    expect(notice.body).toContain('2026-11-08 03:00 UTC');
    expect(notice.body).not.toContain('12345678-aaaa');
  });

  it('builds channel-specific dedupe keys', () => {
    expect(reportResolvedDedupeKey('r-1')).toBe('content_report:r-1:resolved');
    expect(reportSlaDedupeKey('r-1', 'u-1')).toBe('content_report:r-1:sla:u-1');
  });
});
