import type { AlertTone } from '@/components/ui';

/** Pesan singkat yang ditampilkan lewat Toast di halaman detail vendor. */
export interface VendorNotice {
  tone: AlertTone;
  title: string;
  description?: string;
}
