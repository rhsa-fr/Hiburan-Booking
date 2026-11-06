/**
 * Outbox event -> in-app notification copy.
 *
 * Pure mapping shared by the worker relay and its tests. A `null` result means
 * the event is not user-facing (internal relay) and must not create a row.
 */
export type NotificationAudience = 'customer' | 'vendor' | 'both';

export interface NotificationPlan {
  audience: NotificationAudience;
  title: string;
  body: string;
}

function bookingCode(payload: Record<string, unknown>): string {
  const code = payload.code;
  return typeof code === 'string' && code.length > 0 ? code : 'Pesanan';
}

export function planNotification(
  eventType: string,
  payload: Record<string, unknown>
): NotificationPlan | null {
  const code = bookingCode(payload);

  switch (eventType) {
    case 'booking.requested':
      return {
        audience: 'vendor',
        title: 'Pesanan baru masuk',
        body: `${code} menunggu responsmu.`
      };
    case 'booking.accepted':
      return {
        audience: 'customer',
        title: 'Pesanan diterima vendor',
        body: `${code} sudah diterima. Selesaikan pembayaran DP sebelum batas waktu.`
      };
    case 'booking.rejected':
      return {
        audience: 'customer',
        title: 'Pesanan ditolak vendor',
        body: `${code} tidak bisa dilanjutkan. Cari vendor lain di Jelajah.`
      };
    case 'booking.cancelled':
      return {
        audience: 'both',
        title: 'Pesanan dibatalkan',
        body: `${code} sudah dibatalkan.`
      };
    case 'booking.checked_in':
      return {
        audience: 'customer',
        title: 'Vendor sudah tiba',
        body: `Vendor untuk ${code} sudah check-in di lokasi acara.`
      };
    case 'booking.no_show':
      return {
        audience: 'customer',
        title: 'Vendor tidak hadir',
        body: `${code} ditandai no-show. Tim kami akan menindaklanjuti.`
      };
    case 'booking.confirmed':
      return {
        audience: 'both',
        title: 'DP diterima',
        body: `Pembayaran DP ${code} diterima dan jadwal sudah dikunci.`
      };
    case 'booking.fully_paid':
      return {
        audience: 'both',
        title: 'Pelunasan diterima',
        body: `${code} sudah lunas.`
      };
    case 'booking.completed':
      return {
        audience: 'both',
        title: 'Acara selesai',
        body: `${code} selesai. Dana diteruskan ke vendor setelah jendela sengketa.`
      };
    case 'booking.expired':
      return {
        audience: 'both',
        title: 'Pesanan kedaluwarsa',
        body: `${code} kedaluwarsa karena batas waktu terlewat.`
      };
    default:
      return null;
  }
}
