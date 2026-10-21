import type { Metadata } from 'next';
import { VendorDetailPage } from '@/components/vendors/vendor-detail-page';

export const metadata: Metadata = {
  title: 'Detail vendor'
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VendorDetailPage vendorId={id} />;
}
