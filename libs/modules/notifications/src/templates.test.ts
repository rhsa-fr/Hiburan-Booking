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
});
