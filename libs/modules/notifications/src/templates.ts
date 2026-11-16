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

export interface EmailNotificationPlan {
  audience: NotificationAudience;
  subject: string;
  text: string;
}

function bookingCode(payload: Record<string, unknown>): string {
  const code = payload.code;
  return typeof code === 'string' && code.length > 0 ? code : 'Pesanan';
}

const MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember'
] as const;

/**
 * FR-052: reminders carry `event_date` as a plain `YYYY-MM-DD` (already the
 * event's local date), so no timezone conversion happens here — a reminder must
 * never print "besok" for a date that already shifted.
 */
export function formatEventDate(value: unknown): string {
  if (typeof value !== 'string') return 'tanggal yang dijadwalkan';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return 'tanggal yang dijadwalkan';
  const [, year, month, day] = match;
  const name = MONTHS_ID[Number(month) - 1];
  if (!name) return 'tanggal yang dijadwalkan';
  return `${Number(day)} ${name} ${year}`;
}

function eventDate(payload: Record<string, unknown>): string {
  return formatEventDate(payload.event_date);
}

/**
 * The admin decision is the only part of a resolved dispute the parties need:
 * whether money goes back to the customer, to the vendor, or nowhere.
 */
function disputeResolutionBody(code: string, payload: Record<string, unknown>): string {
  switch (payload.resolution) {
    case 'refund_full':
    case 'refund_partial':
      return `${code}: refund diputuskan. Dana dikembalikan sesuai keputusan admin.`;
    case 'release_to_vendor':
      return `${code}: dana diteruskan ke vendor.`;
    case 'clawback':
      return `${code}: clawback diputuskan. Dana ditarik kembali dari vendor dan dikembalikan ke pelanggan.`;
    case 'reject':
    case 'no_action':
      return `${code}: sengketa ditolak.`;
    default:
      return `${code}: sengketa sudah diputuskan.`;
  }
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
    case 'booking.dispute_opened':
      return {
        audience: 'both',
        title: 'Sengketa dibuka',
        body: `${code}: dana ditahan sampai admin memutuskan.`
      };
    case 'booking.dispute_resolved':
      return {
        audience: 'both',
        title: 'Sengketa diputuskan',
        body: disputeResolutionBody(code, payload)
      };
    case 'booking.reminder_7d':
      return {
        audience: 'both',
        title: 'Acara 7 hari lagi',
        body: `${code} dijadwalkan ${eventDate(payload)}. Pastikan pelunasan dan detail acara sudah siap.`
      };
    case 'booking.reminder_1d':
      return {
        audience: 'both',
        title: 'Acara besok',
        body: `${code} berlangsung besok, ${eventDate(payload)}. Konfirmasi waktu dan lokasi dengan vendor.`
      };
    case 'booking.reminder_day':
      return {
        audience: 'both',
        title: 'Acara hari ini',
        body: `${code} berlangsung hari ini. Simpan kontak vendor untuk koordinasi di lokasi.`
      };
    default:
      return null;
  }
}

/**
 * FR-051: outbound copy for booking events.
 *
 * The email reuses the in-app plan so both channels can never disagree about
 * what happened; only the wrapping differs (subject line + how to continue).
 * Events without an in-app plan stay internal and produce no email.
 */
const EMAIL_FOOTER = [
  '',
  'Buka aplikasi Tarlink untuk melihat detail pesanan.',
  'Email ini dikirim otomatis oleh Tarlink, mohon jangan dibalas.'
].join('\n');

export function planEmailNotification(
  eventType: string,
  payload: Record<string, unknown>
): EmailNotificationPlan | null {
  const plan = planNotification(eventType, payload);
  if (!plan) return null;

  return {
    audience: plan.audience,
    subject: `${plan.title} — ${bookingCode(payload)}`,
    text: `${plan.body}\n${EMAIL_FOOTER}`
  };
}

/* ------------------------------------------------------------------ */
/* Fr-123/FR-124: notifikasi laporan konten                            */
/* ------------------------------------------------------------------ */

export interface ReportNotice {
  title: string;
  body: string;
}

const REPORT_TARGET_LABEL: Readonly<Record<string, string>> = {
  vendor: 'vendor',
  review: 'ulasan',
  chat_message: 'pesan chat',
  vendor_media: 'media vendor'
};

function reportTargetLabel(targetType: string): string {
  return REPORT_TARGET_LABEL[targetType] ?? 'konten';
}

/** Copy for the reporter when a moderator decides their report. */
export function planReportResolvedNotification(
  action: string,
  targetType: string
): ReportNotice {
  const label = reportTargetLabel(targetType);
  switch (action) {
    case 'content_removed':
      return {
        title: `Laporan ${label} diturunkan`,
        body: `Konten ${label} yang kamu laporkan sudah diturunkan setelah ditinjau.`
      };
    case 'content_restored':
      return {
        title: `Laporan ${label} dipulihkan`,
        body: `Konten ${label} yang kamu laporkan dipulihkan kembali setelah ditinjau.`
      };
    case 'user_warned':
      return {
        title: 'Peringatan diberikan',
        body: `Pengguna di balik ${label} yang kamu laporkan sudah diberi peringatan.`
      };
    case 'user_suspended':
      return {
        title: 'Akun ditindaklanjuti',
        body: `Akun di balik ${label} yang kamu laporkan sudah ditindaklanjuti.`
      };
    case 'no_action':
      return {
        title: `Laporan ${label} ditinjau`,
        body: 'Setelah ditinjau, tidak ada pelanggaran yang ditemukan pada laporanmu.'
      };
    default:
      return {
        title: `Laporan ${label} ditinjau`,
        body: 'Laporanmu sudah diputuskan oleh moderator.'
      };
  }
}

/** Copy for admins when an open report passes its SLA. */
export function planReportSlaNotification(input: {
  reportId: string;
  targetType: string;
  dueAt: string;
}): ReportNotice {
  const due = input.dueAt.slice(0, 16).replace('T', ' ');
  return {
    title: 'Laporan lewat SLA',
    body: `Laporan ${reportTargetLabel(input.targetType)} ${input.reportId.slice(0, 8)} melewati SLA (batas ${due} UTC). Buka panel /reports untuk memutuskan.`
  };
}

/** One resolution notice per report, even if a retry re-runs the transaction. */
export function reportResolvedDedupeKey(reportId: string): string {
  return `content_report:${reportId}:resolved`;
}

/** One SLA notice per report per admin. */
export function reportSlaDedupeKey(reportId: string, userId: string): string {
  return `content_report:${reportId}:sla:${userId}`;
}

/**
 * Copy for the content owner when an appeal is decided. The appellant is the
 * owner, so the body may explain what happened to their own content without
 * exposing the reporter.
 */
export function planAppealDecisionNotification(
  status: 'accepted' | 'rejected',
  targetType: string
): ReportNotice {
  const label = reportTargetLabel(targetType);
  if (status === 'accepted') {
    if (targetType === 'vendor_media') {
      return {
        title: 'Banding diterima',
        body: `Bandingmu atas ${label} diterima. Media masuk antrean moderasi ulang sebelum tayang kembali.`
      };
    }
    return {
      title: 'Banding diterima',
      body: `Bandingmu atas ${label} diterima. Konten sudah dipulihkan dan tayang kembali.`
    };
  }
  return {
    title: 'Banding ditolak',
    body: `Bandingmu atas ${label} ditolak. Keputusan takedown dipertahankan; catatan keputusan tersedia di detail banding.`
  };
}

/** One decision notice per appeal, even if a retry re-runs the transaction. */
export function reportAppealDecisionDedupeKey(appealId: string): string {
  return `content_report_appeal:${appealId}:decided`;
}

/** Copy for the content owner when a moderator hides their content. */
export function planTakedownNotification(targetType: string): ReportNotice {
  const label = reportTargetLabel(targetType);
  return {
    title: 'Konten kamu diturunkan',
    body: `Konten ${label} kamu diturunkan setelah ditinjau. Kamu bisa mengajukan banding dalam 30 hari lewat Profil > Banding konten.`
  };
}

/** One takedown notice per report, even if a retry re-runs the transaction. */
export function reportTakedownDedupeKey(reportId: string): string {
  return `content_report:${reportId}:takedown`;
}
