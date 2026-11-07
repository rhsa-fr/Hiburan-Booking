import { describe, expect, it } from 'vitest';
import { planNotification } from './templates';

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
