import type { Metadata } from 'next';
import { BookingDetailPage } from '@/components/bookings/booking-detail-page';

export const metadata: Metadata = {
  title: 'Detail booking'
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BookingDetailPage bookingId={id} />;
}
