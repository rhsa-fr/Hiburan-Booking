import type { Metadata } from 'next';
import { BookingsView } from '@/components/bookings/bookings-view';

export const metadata: Metadata = {
  title: 'Booking'
};

/**
 * Halaman ini membaca `?code=`, `?q=`, `?status=`, `?payment_status=` lewat
 * `useSearchParams` di komponen klien. Dirender dinamis supaya Next tidak
 * membekukan hasilnya saat build; sebelumnya dibungkus Suspense di level
 * halaman dan boundary itu tidak pernah lepas saat hidrasi, sehingga tabel
 * berhenti di skeleton dan tidak pernah memanggil API.
 */
export const dynamic = 'force-dynamic';

export default function BookingsPage() {
  return <BookingsView />;
}
