import { computeCommission } from './commission';
import { ApiError } from './errors';
import { formatDayLabelID, formatIDR, statusLabel } from './format';
import type {
  Account,
  ActionQueueItem,
  AuditLog,
  Booking,
  BookingFilters,
  BookingStatusHistoryEntry,
  DailyBookingPoint,
  DashboardSummary,
  Dispute,
  DisputeOverview,
  DisputeRecord,
  JournalEntry,
  JournalLine,
  LedgerData,
  Operator,
  Paginated,
  Payment,
  PaymentKindSummary,
  PaymentMixSlice,
  PaymentStatus,
  PaymentsOverview,
  PlatformSettings,
  ReleaseCandidate,
  ReleaseInput,
  ReleaseJournal,
  ReleasePreview,
  ReleaseQueue,
  ReleaseResult,
  SettlementStatus,
  StatusAxis,
  Vendor,
  VendorDetail,
  VendorFilters
} from './types';

/**
 * Deterministic mock world. The clock is frozen at 21 Oct 2026 09:15 WIB so
 * server render and client render always agree. Nothing here uses Math.random
 * or Date.now; mutations only happen after an explicit user action.
 */
export const MOCK_NOW = '2026-10-21T09:15:00+07:00';
export const DEMO_OTP = '246810';
export const MAX_RELEASE_BATCH = 5;

const OPERATORS: Operator[] = [
  { id: 'op-sari', name: 'Sari Wulandari', role: 'admin_finance' },
  { id: 'op-bagus', name: 'Bagus Hermawan', role: 'admin_super' },
  { id: 'op-nia', name: 'Nia Kartika', role: 'admin_support' }
];

export const ACCOUNTS: Account[] = [
  { code: '1100', name: 'Gateway clearing', type: 'asset', normal_balance: 'debit' },
  { code: '1110', name: 'Vendor payout clearing', type: 'asset', normal_balance: 'debit' },
  { code: '2100', name: 'Escrow liability vendor', type: 'liability', normal_balance: 'credit' },
  { code: '2110', name: 'Refund payable', type: 'liability', normal_balance: 'credit' },
  { code: '2120', name: 'Vendor payable', type: 'liability', normal_balance: 'credit' },
  { code: '2140', name: 'Dispute reserve', type: 'liability', normal_balance: 'credit' },
  { code: '4100', name: 'Platform revenue commission', type: 'revenue', normal_balance: 'credit' },
  { code: '4110', name: 'Platform revenue service fee', type: 'revenue', normal_balance: 'credit' },
  { code: '5100', name: 'Gateway fee expense', type: 'expense', normal_balance: 'debit' }
];

const ACCOUNT_NAMES: Record<string, string> = {
  '1100': 'Gateway clearing',
  '1110': 'Vendor payout clearing',
  '2100': 'Escrow liability vendor',
  '2110': 'Refund payable',
  '2120': 'Vendor payable',
  '2140': 'Dispute reserve',
  '4100': 'Platform revenue commission',
  '4110': 'Platform revenue service fee',
  '5100': 'Gateway fee expense'
};

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function buildHistory(
  bookingId: string,
  seeds: Array<[StatusAxis, string, string, string, string, string?]>
): BookingStatusHistoryEntry[] {
  return seeds.map((seed, index) => ({
    id: `${bookingId}-h${index + 1}`,
    axis: seed[0],
    from_status: seed[1],
    to_status: seed[2],
    actor: seed[3],
    at: seed[4],
    note: seed[5] ?? null
  }));
}

function buildVendor(input: {
  id: string;
  name: string;
  city: string;
  category: string;
  owner_name: string;
  phone: string;
  verification_status: Vendor['verification_status'];
  verified_at: string | null;
  calendar_updated_at: string;
  response_rate_bp: number;
  rating_x10: number;
  completed_bookings: number;
  bank_name: string;
  account_number_masked: string;
  account_holder: string;
  bank_status: Vendor['bank_account']['status'];
  cooling_until: string | null;
  bank_verified_at: string | null;
  rejection_reason: string | null;
}): Vendor {
  return {
    id: input.id,
    name: input.name,
    city: input.city,
    category: input.category,
    owner_name: input.owner_name,
    phone: input.phone,
    verification_status: input.verification_status,
    verified_at: input.verified_at,
    calendar_updated_at: input.calendar_updated_at,
    response_rate_bp: input.response_rate_bp,
    rating_x10: input.rating_x10,
    completed_bookings: input.completed_bookings,
    is_active: input.verification_status !== 'rejected',
    bank_account: {
      id: `bank-${input.id}`,
      bank_name: input.bank_name,
      account_number_masked: input.account_number_masked,
      account_holder: input.account_holder,
      status: input.bank_status,
      cooling_until: input.cooling_until,
      verified_at: input.bank_verified_at,
      rejection_reason: input.rejection_reason
    }
  };
}

const VENDORS: Vendor[] = [
  buildVendor({
    id: 'v-01',
    name: 'Sanggar Tarling Sinar Pantura',
    city: 'Indramayu',
    category: 'Tarling',
    owner_name: 'H. Ahmad Subandi',
    phone: '081322145670',
    verification_status: 'verified',
    verified_at: '2025-11-04T10:00:00+07:00',
    calendar_updated_at: '2026-10-20T16:20:00+07:00',
    response_rate_bp: 9800,
    rating_x10: 48,
    completed_bookings: 64,
    bank_name: 'BCA',
    account_number_masked: '**** **** 4471',
    account_holder: 'Ahmad Subandi',
    bank_status: 'verified',
    cooling_until: '2025-11-05T10:00:00+07:00',
    bank_verified_at: '2025-11-05T11:00:00+07:00',
    rejection_reason: null
  }),
  buildVendor({
    id: 'v-02',
    name: 'Organ Tunggal Melodi Cirebon',
    city: 'Cirebon',
    category: 'Organ tunggal',
    owner_name: 'Rudi Hartono',
    phone: '081245678901',
    verification_status: 'verified',
    verified_at: '2025-12-12T09:30:00+07:00',
    calendar_updated_at: '2026-10-18T09:15:00+07:00',
    response_rate_bp: 9400,
    rating_x10: 47,
    completed_bookings: 52,
    bank_name: 'BRI',
    account_number_masked: '**** **** 8820',
    account_holder: 'Rudi Hartono',
    bank_status: 'verified',
    cooling_until: '2025-12-13T09:30:00+07:00',
    bank_verified_at: '2025-12-13T10:10:00+07:00',
    rejection_reason: null
  }),
  buildVendor({
    id: 'v-03',
    name: 'Grup Seni Tradisi Sekar Arum',
    city: 'Indramayu',
    category: 'Seni tradisi',
    owner_name: 'Sri Wuryani',
    phone: '085712340098',
    verification_status: 'verified',
    verified_at: '2026-01-19T14:00:00+07:00',
    calendar_updated_at: '2026-10-02T11:40:00+07:00',
    response_rate_bp: 8800,
    rating_x10: 45,
    completed_bookings: 37,
    bank_name: 'BNI',
    account_number_masked: '**** **** 1194',
    account_holder: 'Sri Wuryani',
    bank_status: 'verified',
    cooling_until: '2026-01-20T14:00:00+07:00',
    bank_verified_at: '2026-01-20T15:20:00+07:00',
    rejection_reason: null
  }),
  buildVendor({
    id: 'v-04',
    name: 'Tarling Bagus Anom',
    city: 'Cirebon',
    category: 'Tarling',
    owner_name: 'Maman Suryadi',
    phone: '081901234455',
    verification_status: 'pending',
    verified_at: null,
    calendar_updated_at: '2026-10-19T20:30:00+07:00',
    response_rate_bp: 7600,
    rating_x10: 42,
    completed_bookings: 12,
    bank_name: 'Mandiri',
    account_number_masked: '**** **** 7731',
    account_holder: 'Maman Suryadi',
    bank_status: 'pending',
    cooling_until: '2026-10-22T08:00:00+07:00',
    bank_verified_at: null,
    rejection_reason: null
  }),
  buildVendor({
    id: 'v-05',
    name: 'Organ Tunggal Nada Bahari',
    city: 'Cirebon',
    category: 'Organ tunggal',
    owner_name: 'Iis Aisyah',
    phone: '082134560087',
    verification_status: 'verified',
    verified_at: '2026-02-08T10:45:00+07:00',
    calendar_updated_at: '2026-10-21T07:10:00+07:00',
    response_rate_bp: 9100,
    rating_x10: 46,
    completed_bookings: 29,
    bank_name: 'BCA',
    account_number_masked: '**** **** 3390',
    account_holder: 'Iis Aisyah',
    bank_status: 'verified',
    cooling_until: '2026-02-09T10:45:00+07:00',
    bank_verified_at: '2026-02-09T09:30:00+07:00',
    rejection_reason: null
  }),
  buildVendor({
    id: 'v-06',
    name: 'Wayang Golek Pusaka Dermayu',
    city: 'Indramayu',
    category: 'Seni tradisi',
    owner_name: 'Darto Wikarta',
    phone: '081389076512',
    verification_status: 'verified',
    verified_at: '2025-10-22T13:15:00+07:00',
    calendar_updated_at: '2026-09-28T15:00:00+07:00',
    response_rate_bp: 8200,
    rating_x10: 44,
    completed_bookings: 21,
    bank_name: 'BNI',
    account_number_masked: '**** **** 6653',
    account_holder: 'Darto Wikarta',
    bank_status: 'pending',
    cooling_until: '2026-10-22T11:00:00+07:00',
    bank_verified_at: null,
    rejection_reason: null
  }),
  buildVendor({
    id: 'v-07',
    name: 'Elektone Remaja Pantura',
    city: 'Cirebon',
    category: 'Organ tunggal',
    owner_name: 'Deni Setiadi',
    phone: '089612340078',
    verification_status: 'rejected',
    verified_at: null,
    calendar_updated_at: '2026-10-11T19:00:00+07:00',
    response_rate_bp: 6300,
    rating_x10: 39,
    completed_bookings: 8,
    bank_name: 'BRI',
    account_number_masked: '**** **** 2018',
    account_holder: 'Deni Setiadi',
    bank_status: 'rejected',
    cooling_until: null,
    bank_verified_at: null,
    rejection_reason: 'Nama pemilik rekening tidak sama dengan dokumen vendor.'
  }),
  buildVendor({
    id: 'v-08',
    name: 'Sanggar Tari Topeng Mulya',
    city: 'Cirebon',
    category: 'Seni tradisi',
    owner_name: 'Rukmini Dewi',
    phone: '081377889900',
    verification_status: 'verified',
    verified_at: '2026-03-14T08:20:00+07:00',
    calendar_updated_at: '2026-10-17T12:00:00+07:00',
    response_rate_bp: 9000,
    rating_x10: 47,
    completed_bookings: 33,
    bank_name: 'Mandiri',
    account_number_masked: '**** **** 5527',
    account_holder: 'Rukmini Dewi',
    bank_status: 'verified',
    cooling_until: '2026-03-15T08:20:00+07:00',
    bank_verified_at: '2026-03-15T09:00:00+07:00',
    rejection_reason: null
  })
];

const VENDOR_BY_ID = new Map(VENDORS.map((vendor) => [vendor.id, vendor]));

const INITIAL_SETTINGS: PlatformSettings = {
  bp1: 1000,
  threshold_idr: 10_000_000,
  bp2: 500,
  min_idr: 25_000,
  cap_idr: 7_500_000,
  service_fee_bp: 100,
  dp_min_bp: 3000,
  payment_deadline_hours: 24,
  payment_deadline_hours_high_value: 48,
  payment_high_value_threshold_idr: 10_000_000,
  dispute_window_days: 7,
  bank_cooling_hours: 24,
  payout_min_idr: 10_000,
  approval_threshold_idr: 1_000_000
};

interface BookingSeed {
  id: string;
  code: string;
  vendor_id: string;
  customer_name: string;
  customer_phone: string;
  city: string;
  event_start_at: string;
  created_at: string;
  lifecycle: Booking['lifecycle_status'];
  payment: Booking['payment_status'];
  settlement: SettlementStatus;
  price_package_idr: number;
  respond_deadline: string | null;
  payment_deadline: string | null;
  dispute_window_ends_at: string | null;
  released_at: string | null;
  history: Array<[StatusAxis, string, string, string, string, string?]>;
}

const BOOKING_SEEDS: BookingSeed[] = [
  {
    id: 'bk-2610-001',
    code: 'TL-2610-001',
    vendor_id: 'v-08',
    customer_name: 'Rina Kusumawati',
    customer_phone: '081234500011',
    city: 'Indramayu',
    event_start_at: '2026-11-14T20:00:00+07:00',
    created_at: '2026-10-21T07:40:00+07:00',
    lifecycle: 'requested',
    payment: 'unpaid',
    settlement: 'not_eligible',
    price_package_idr: 3_500_000,
    respond_deadline: '2026-10-22T07:40:00+07:00',
    payment_deadline: null,
    dispute_window_ends_at: null,
    released_at: null,
    history: [
      ['lifecycle', '-', 'requested', 'Rina Kusumawati', '2026-10-21T07:40:00+07:00', 'Permintaan masuk dari pelanggan.']
    ]
  },
  {
    id: 'bk-2610-002',
    code: 'TL-2610-002',
    vendor_id: 'v-02',
    customer_name: 'Dedi Setiawan',
    customer_phone: '081234500012',
    city: 'Cirebon',
    event_start_at: '2026-11-21T20:00:00+07:00',
    created_at: '2026-10-21T08:55:00+07:00',
    lifecycle: 'countered',
    payment: 'unpaid',
    settlement: 'not_eligible',
    price_package_idr: 6_500_000,
    respond_deadline: '2026-10-22T09:20:00+07:00',
    payment_deadline: null,
    dispute_window_ends_at: null,
    released_at: null,
    history: [
      ['lifecycle', '-', 'requested', 'Dedi Setiawan', '2026-10-21T08:55:00+07:00', 'Permintaan masuk dari pelanggan.'],
      ['lifecycle', 'requested', 'countered', 'Organ Tunggal Melodi Cirebon', '2026-10-21T09:20:00+07:00', 'Harga ditawar dari Rp 5.500.000 menjadi Rp 6.500.000.']
    ]
  },
  {
    id: 'bk-2610-003',
    code: 'TL-2610-003',
    vendor_id: 'v-03',
    customer_name: 'Siti Nurjanah',
    customer_phone: '081234500013',
    city: 'Indramayu',
    event_start_at: '2026-11-07T20:00:00+07:00',
    created_at: '2026-10-21T09:10:00+07:00',
    lifecycle: 'accepted',
    payment: 'unpaid',
    settlement: 'not_eligible',
    price_package_idr: 12_000_000,
    respond_deadline: '2026-10-21T15:10:00+07:00',
    payment_deadline: '2026-10-23T09:12:00+07:00',
    dispute_window_ends_at: null,
    released_at: null,
    history: [
      ['lifecycle', '-', 'requested', 'Siti Nurjanah', '2026-10-21T09:10:00+07:00', 'Permintaan masuk dari pelanggan.'],
      ['lifecycle', 'requested', 'accepted', 'Grup Seni Tradisi Sekar Arum', '2026-10-21T09:12:00+07:00', 'Vendor menerima. Slot ditahan sampai batas bayar DP.']
    ]
  },
  {
    id: 'bk-2610-004',
    code: 'TL-2610-004',
    vendor_id: 'v-01',
    customer_name: 'Ahmad Fauzi',
    customer_phone: '081234500014',
    city: 'Cirebon',
    event_start_at: '2026-12-05T21:00:00+07:00',
    created_at: '2026-10-19T14:00:00+07:00',
    lifecycle: 'accepted',
    payment: 'unpaid',
    settlement: 'not_eligible',
    price_package_idr: 8_000_000,
    respond_deadline: '2026-10-20T14:00:00+07:00',
    payment_deadline: '2026-10-20T14:20:00+07:00',
    dispute_window_ends_at: null,
    released_at: null,
    history: [
      ['lifecycle', '-', 'requested', 'Ahmad Fauzi', '2026-10-19T14:00:00+07:00', 'Permintaan masuk dari pelanggan.'],
      ['lifecycle', 'requested', 'accepted', 'Sanggar Tarling Sinar Pantura', '2026-10-19T14:20:00+07:00', 'Vendor menerima. Slot ditahan 24 jam.']
    ]
  },
  {
    id: 'bk-2610-005',
    code: 'TL-2610-005',
    vendor_id: 'v-05',
    customer_name: 'Yuni Astuti',
    customer_phone: '081234500015',
    city: 'Indramayu',
    event_start_at: '2026-10-24T20:00:00+07:00',
    created_at: '2026-10-12T10:05:00+07:00',
    lifecycle: 'confirmed',
    payment: 'dp_paid',
    settlement: 'held',
    price_package_idr: 4_500_000,
    respond_deadline: '2026-10-13T10:05:00+07:00',
    payment_deadline: '2026-10-13T10:20:00+07:00',
    dispute_window_ends_at: null,
    released_at: null,
    history: [
      ['lifecycle', '-', 'requested', 'Yuni Astuti', '2026-10-12T10:05:00+07:00', 'Permintaan masuk dari pelanggan.'],
      ['lifecycle', 'requested', 'accepted', 'Organ Tunggal Nada Bahari', '2026-10-12T10:20:00+07:00', 'Vendor menerima. Slot ditahan 24 jam.'],
      ['payment', 'unpaid', 'dp_paid', 'Sistem (webhook PJP)', '2026-10-12T11:02:00+07:00', 'DP Rp 1.350.000 diterima.'],
      ['lifecycle', 'accepted', 'confirmed', 'Sistem (webhook PJP)', '2026-10-12T11:02:00+07:00', 'Booking terkonfirmasi setelah DP.'],
      ['settlement', 'not_eligible', 'held', 'Sistem (webhook PJP)', '2026-10-12T11:02:00+07:00', 'Dana ditahan sampai acara selesai + 7 hari.']
    ]
  },
  {
    id: 'bk-2610-006',
    code: 'TL-2610-006',
    vendor_id: 'v-02',
    customer_name: 'Hendra Gunawan',
    customer_phone: '081234500016',
    city: 'Cirebon',
    event_start_at: '2026-10-12T20:00:00+07:00',
    created_at: '2026-10-02T13:30:00+07:00',
    lifecycle: 'completed',
    payment: 'partially_refunded',
    settlement: 'disputed',
    price_package_idr: 5_000_000,
    respond_deadline: '2026-10-03T13:30:00+07:00',
    payment_deadline: '2026-10-03T13:45:00+07:00',
    dispute_window_ends_at: '2026-10-19T23:00:00+07:00',
    released_at: null,
    history: [
      ['lifecycle', '-', 'requested', 'Hendra Gunawan', '2026-10-02T13:30:00+07:00', 'Permintaan masuk dari pelanggan.'],
      ['lifecycle', 'requested', 'accepted', 'Organ Tunggal Melodi Cirebon', '2026-10-02T13:45:00+07:00', 'Vendor menerima. Slot ditahan.'],
      ['payment', 'unpaid', 'dp_paid', 'Sistem (webhook PJP)', '2026-10-02T15:10:00+07:00', 'DP Rp 1.500.000 diterima.'],
      ['lifecycle', 'accepted', 'confirmed', 'Sistem (webhook PJP)', '2026-10-02T15:10:00+07:00', 'Booking terkonfirmasi.'],
      ['payment', 'dp_paid', 'fully_paid', 'Sistem (webhook PJP)', '2026-10-09T09:40:00+07:00', 'Pelunasan diterima.'],
      ['lifecycle', 'confirmed', 'completed', 'Hendra Gunawan', '2026-10-13T08:10:00+07:00', 'Pelanggan menandai acara selesai.'],
      ['settlement', 'held', 'disputed', 'Hendra Gunawan', '2026-10-15T10:20:00+07:00', 'Sengketa dibuka: durasi penampilan kurang 1 jam.'],
      ['payment', 'fully_paid', 'partially_refunded', 'Sistem (refund PJP)', '2026-10-18T11:00:00+07:00', 'Refund sebagian Rp 750.000.']
    ]
  },
  {
    id: 'bk-2610-007',
    code: 'TL-2610-007',
    vendor_id: 'v-06',
    customer_name: 'Maya Puspita',
    customer_phone: '081234500017',
    city: 'Indramayu',
    event_start_at: '2026-10-21T08:00:00+07:00',
    created_at: '2026-10-01T09:00:00+07:00',
    lifecycle: 'in_progress',
    payment: 'fully_paid',
    settlement: 'held',
    price_package_idr: 9_000_000,
    respond_deadline: '2026-10-02T09:00:00+07:00',
    payment_deadline: '2026-10-02T09:30:00+07:00',
    dispute_window_ends_at: '2026-10-28T11:00:00+07:00',
    released_at: null,
    history: [
      ['lifecycle', '-', 'requested', 'Maya Puspita', '2026-10-01T09:00:00+07:00', 'Permintaan masuk dari pelanggan.'],
      ['lifecycle', 'requested', 'accepted', 'Wayang Golek Pusaka Dermayu', '2026-10-01T09:30:00+07:00', 'Vendor menerima.'],
      ['payment', 'unpaid', 'dp_paid', 'Sistem (webhook PJP)', '2026-10-01T10:15:00+07:00', 'DP Rp 2.700.000 diterima.'],
      ['payment', 'dp_paid', 'fully_paid', 'Sistem (webhook PJP)', '2026-10-05T14:00:00+07:00', 'Pelunasan diterima.'],
      ['lifecycle', 'accepted', 'confirmed', 'Sistem (webhook PJP)', '2026-10-05T14:00:00+07:00', 'Booking terkonfirmasi.'],
      ['lifecycle', 'confirmed', 'in_progress', 'Darto Wikarta', '2026-10-21T07:52:00+07:00', 'Check-in vendor di lokasi acara.']
    ]
  },
  {
    id: 'bk-2610-008',
    code: 'TL-2610-008',
    vendor_id: 'v-01',
    customer_name: 'Iwan Suryana',
    customer_phone: '081234500018',
    city: 'Cirebon',
    event_start_at: '2026-10-11T20:00:00+07:00',
    created_at: '2026-09-25T15:20:00+07:00',
    lifecycle: 'completed',
    payment: 'fully_paid',
    settlement: 'held',
    price_package_idr: 7_500_000,
    respond_deadline: '2026-09-26T15:20:00+07:00',
    payment_deadline: '2026-09-26T15:35:00+07:00',
    dispute_window_ends_at: '2026-10-18T23:00:00+07:00',
    released_at: null,
    history: [
      ['lifecycle', '-', 'requested', 'Iwan Suryana', '2026-09-25T15:20:00+07:00', 'Permintaan masuk dari pelanggan.'],
      ['lifecycle', 'requested', 'accepted', 'Sanggar Tarling Sinar Pantura', '2026-09-25T15:35:00+07:00', 'Vendor menerima.'],
      ['payment', 'unpaid', 'dp_paid', 'Sistem (webhook PJP)', '2026-09-25T16:10:00+07:00', 'DP Rp 2.250.000 diterima.'],
      ['payment', 'dp_paid', 'fully_paid', 'Sistem (webhook PJP)', '2026-10-02T10:00:00+07:00', 'Pelunasan diterima.'],
      ['lifecycle', 'confirmed', 'completed', 'Sistem (auto-complete)', '2026-10-15T20:00:00+07:00', 'Selesai otomatis 3 hari setelah acara.'],
      ['settlement', 'held', 'held', 'Sistem (job)', '2026-10-15T20:00:00+07:00', 'Jendela sengketa berakhir 18 Okt, menunggu release.']
    ]
  },
  {
    id: 'bk-2610-009',
    code: 'TL-2610-009',
    vendor_id: 'v-03',
    customer_name: 'Fitri Handayani',
    customer_phone: '081234500019',
    city: 'Indramayu',
    event_start_at: '2026-10-12T19:00:00+07:00',
    created_at: '2026-09-20T11:15:00+07:00',
    lifecycle: 'completed',
    payment: 'fully_paid',
    settlement: 'held',
    price_package_idr: 22_000_000,
    respond_deadline: '2026-09-21T11:15:00+07:00',
    payment_deadline: '2026-09-21T11:30:00+07:00',
    dispute_window_ends_at: '2026-10-19T23:00:00+07:00',
    released_at: null,
    history: [
      ['lifecycle', '-', 'requested', 'Fitri Handayani', '2026-09-20T11:15:00+07:00', 'Permintaan masuk dari pelanggan.'],
      ['lifecycle', 'requested', 'accepted', 'Grup Seni Tradisi Sekar Arum', '2026-09-20T11:30:00+07:00', 'Vendor menerima.'],
      ['payment', 'unpaid', 'dp_paid', 'Sistem (webhook PJP)', '2026-09-20T13:05:00+07:00', 'DP Rp 6.600.000 diterima (48 jam).'],
      ['payment', 'dp_paid', 'fully_paid', 'Sistem (webhook PJP)', '2026-09-28T09:00:00+07:00', 'Pelunasan diterima.'],
      ['lifecycle', 'confirmed', 'completed', 'Sistem (auto-complete)', '2026-10-16T19:00:00+07:00', 'Selesai otomatis 3 hari setelah acara.'],
      ['settlement', 'held', 'held', 'Sistem (job)', '2026-10-16T19:00:00+07:00', 'Jendela sengketa berakhir 19 Okt, menunggu release.']
    ]
  },
  {
    id: 'bk-2610-010',
    code: 'TL-2610-010',
    vendor_id: 'v-05',
    customer_name: 'Agus Salim',
    customer_phone: '081234500020',
    city: 'Cirebon',
    event_start_at: '2026-10-05T20:00:00+07:00',
    created_at: '2026-09-15T10:00:00+07:00',
    lifecycle: 'completed',
    payment: 'fully_paid',
    settlement: 'released',
    price_package_idr: 4_000_000,
    respond_deadline: '2026-09-16T10:00:00+07:00',
    payment_deadline: '2026-09-16T10:15:00+07:00',
    dispute_window_ends_at: '2026-10-12T23:00:00+07:00',
    released_at: '2026-10-13T10:00:00+07:00',
    history: [
      ['lifecycle', '-', 'requested', 'Agus Salim', '2026-09-15T10:00:00+07:00', 'Permintaan masuk dari pelanggan.'],
      ['lifecycle', 'requested', 'accepted', 'Organ Tunggal Nada Bahari', '2026-09-15T10:15:00+07:00', 'Vendor menerima.'],
      ['payment', 'unpaid', 'dp_paid', 'Sistem (webhook PJP)', '2026-09-15T11:00:00+07:00', 'DP Rp 1.200.000 diterima.'],
      ['payment', 'dp_paid', 'fully_paid', 'Sistem (webhook PJP)', '2026-10-01T11:00:00+07:00', 'Pelunasan diterima.'],
      ['lifecycle', 'confirmed', 'completed', 'Sistem (auto-complete)', '2026-10-08T20:00:00+07:00', 'Selesai otomatis 3 hari setelah acara.'],
      ['settlement', 'held', 'released', 'Bagus Hermawan (checker)', '2026-10-13T10:00:00+07:00', 'Release manual disetujui; jurnal release diposting.']
    ]
  },
  {
    id: 'bk-2610-011',
    code: 'TL-2610-011',
    vendor_id: 'v-06',
    customer_name: 'Lestari Wulandari',
    customer_phone: '081234500021',
    city: 'Indramayu',
    event_start_at: '2026-10-30T20:00:00+07:00',
    created_at: '2026-10-08T08:30:00+07:00',
    lifecycle: 'cancelled',
    payment: 'refunded',
    settlement: 'not_eligible',
    price_package_idr: 3_500_000,
    respond_deadline: '2026-10-09T08:30:00+07:00',
    payment_deadline: '2026-10-09T08:45:00+07:00',
    dispute_window_ends_at: null,
    released_at: null,
    history: [
      ['lifecycle', '-', 'requested', 'Lestari Wulandari', '2026-10-08T08:30:00+07:00', 'Permintaan masuk dari pelanggan.'],
      ['lifecycle', 'requested', 'accepted', 'Wayang Golek Pusaka Dermayu', '2026-10-08T08:45:00+07:00', 'Vendor menerima.'],
      ['payment', 'unpaid', 'dp_paid', 'Sistem (webhook PJP)', '2026-10-08T09:20:00+07:00', 'DP Rp 1.050.000 diterima.'],
      ['lifecycle', 'accepted', 'cancelled', 'Lestari Wulandari', '2026-10-16T09:00:00+07:00', 'Dibatalkan pelanggan lebih dari 14 hari sebelum acara.'],
      ['payment', 'dp_paid', 'refunded', 'Sistem (refund PJP)', '2026-10-16T10:30:00+07:00', 'Refund penuh Rp 1.050.000.'],
      ['settlement', 'not_eligible', 'not_eligible', 'Sistem', '2026-10-16T10:30:00+07:00', 'Kewajiban vendor ditutup.']
    ]
  },
  {
    id: 'bk-2610-012',
    code: 'TL-2610-012',
    vendor_id: 'v-08',
    customer_name: 'Bayu Prakoso',
    customer_phone: '081234500022',
    city: 'Cirebon',
    event_start_at: '2026-10-14T20:00:00+07:00',
    created_at: '2026-09-12T16:40:00+07:00',
    lifecycle: 'no_show',
    payment: 'fully_paid',
    settlement: 'clawed_back',
    price_package_idr: 6_000_000,
    respond_deadline: '2026-09-13T16:40:00+07:00',
    payment_deadline: '2026-09-13T16:55:00+07:00',
    dispute_window_ends_at: '2026-10-21T23:00:00+07:00',
    released_at: '2026-10-16T09:00:00+07:00',
    history: [
      ['lifecycle', '-', 'requested', 'Bayu Prakoso', '2026-09-12T16:40:00+07:00', 'Permintaan masuk dari pelanggan.'],
      ['lifecycle', 'requested', 'accepted', 'Sanggar Tari Topeng Mulya', '2026-09-12T16:55:00+07:00', 'Vendor menerima.'],
      ['payment', 'unpaid', 'dp_paid', 'Sistem (webhook PJP)', '2026-09-12T17:30:00+07:00', 'DP Rp 1.800.000 diterima.'],
      ['payment', 'dp_paid', 'fully_paid', 'Sistem (webhook PJP)', '2026-09-30T10:00:00+07:00', 'Pelunasan diterima.'],
      ['lifecycle', 'confirmed', 'no_show', 'Rukmini Dewi', '2026-10-15T09:30:00+07:00', 'Vendor melaporkan pelanggan tidak hadir; klaim dibuka.'],
      ['settlement', 'held', 'released', 'Bagus Hermawan (checker)', '2026-10-16T09:00:00+07:00', 'Release manual sebelum sengketa diputuskan.'],
      ['settlement', 'released', 'clawed_back', 'Sari Wulandari (maker)', '2026-10-18T14:00:00+07:00', 'Putusan sengketa: clawback Rp 1.600.000 ke vendor.']
    ]
  }
];

const BOOKINGS: Booking[] = BOOKING_SEEDS.map((seed) => {
  const vendor = VENDOR_BY_ID.get(seed.vendor_id);
  if (!vendor) {
    throw new Error(`Mock vendor ${seed.vendor_id} tidak ditemukan.`);
  }
  const commission = computeCommission(seed.price_package_idr, INITIAL_SETTINGS);
  const serviceFee = Math.floor((seed.price_package_idr * INITIAL_SETTINGS.service_fee_bp) / 10000);
  const total = seed.price_package_idr + serviceFee;
  const dp = Math.floor((seed.price_package_idr * INITIAL_SETTINGS.dp_min_bp) / 10000);
  return {
    id: seed.id,
    code: seed.code,
    vendor_id: vendor.id,
    vendor_name: vendor.name,
    vendor_city: vendor.city,
    customer_name: seed.customer_name,
    customer_phone: seed.customer_phone,
    city: seed.city,
    event_date: seed.event_start_at.slice(0, 10),
    event_start_at: seed.event_start_at,
    created_at: seed.created_at,
    lifecycle_status: seed.lifecycle,
    payment_status: seed.payment,
    settlement_status: seed.settlement,
    price_package_idr: seed.price_package_idr,
    service_fee_bp: INITIAL_SETTINGS.service_fee_bp,
    service_fee_idr: serviceFee,
    total_customer_idr: total,
    dp_amount_idr: dp,
    dp_min_bp: INITIAL_SETTINGS.dp_min_bp,
    remaining_idr: total - dp,
    commission_bp: INITIAL_SETTINGS.bp1,
    commission_threshold_idr: INITIAL_SETTINGS.threshold_idr,
    commission_bp_tier2: INITIAL_SETTINGS.bp2,
    commission_min_idr: INITIAL_SETTINGS.min_idr,
    commission_cap_idr: INITIAL_SETTINGS.cap_idr,
    commission_tier1_idr: commission.tier1_idr,
    commission_tier2_idr: commission.tier2_idr,
    commission_idr: commission.commission_idr,
    vendor_entitlement_idr: seed.price_package_idr - commission.commission_idr,
    respond_deadline: seed.respond_deadline,
    payment_deadline: seed.payment_deadline,
    dispute_window_ends_at: seed.dispute_window_ends_at,
    released_at: seed.released_at,
    status_history: buildHistory(seed.id, seed.history)
  };
});

const INITIAL_DISPUTES: Dispute[] = [
  {
    id: 'dsp-001',
    booking_id: 'bk-2610-006',
    booking_code: 'TL-2610-006',
    status: 'open',
    reason: 'Penampilan tidak sesuai deskripsi paket: durasi kurang 1 jam.',
    opened_at: '2026-10-15T10:20:00+07:00',
    sla_due_at: '2026-10-19T10:20:00+07:00',
    resolved_at: null,
    resolution_note: null,
    customer_share_idr: 0,
    vendor_share_idr: 0
  },
  {
    id: 'dsp-002',
    booking_id: 'bk-2610-012',
    booking_code: 'TL-2610-012',
    status: 'resolved_clawback',
    reason: 'Vendor tidak hadir pada hari acara.',
    opened_at: '2026-10-15T09:30:00+07:00',
    sla_due_at: '2026-10-19T09:30:00+07:00',
    resolved_at: '2026-10-18T14:00:00+07:00',
    resolution_note: 'Sebagian dana dikembalikan ke pelanggan, sisanya dicairkan ke vendor.',
    customer_share_idr: 1_600_000,
    vendor_share_idr: 4_400_000
  }
];

function buildPayments(): Payment[] {
  const payments: Payment[] = [];
  for (const booking of BOOKINGS) {
    if (booking.payment_status === 'unpaid') continue;
    const dpPaidAt = addHours(booking.created_at, 2);
    payments.push({
      id: `pay-${booking.id}-dp`,
      booking_id: booking.id,
      booking_code: booking.code,
      kind: 'dp',
      status: 'paid',
      amount_idr: booking.dp_amount_idr,
      method: 'QRIS',
      gateway_ref: `QR-${booking.code}-DP`,
      paid_at: dpPaidAt
    });
    if (
      booking.payment_status === 'fully_paid' ||
      booking.payment_status === 'partially_refunded' ||
      booking.payment_status === 'refunded'
    ) {
      payments.push({
        id: `pay-${booking.id}-stl`,
        booking_id: booking.id,
        booking_code: booking.code,
        kind: 'settlement',
        status: 'paid',
        amount_idr: booking.total_customer_idr - booking.dp_amount_idr,
        method: 'QRIS',
        gateway_ref: `QR-${booking.code}-STL`,
        paid_at: addHours(booking.created_at, 30)
      });
    }
    if (booking.payment_status === 'partially_refunded') {
      payments.push({
        id: `pay-${booking.id}-rf`,
        booking_id: booking.id,
        booking_code: booking.code,
        kind: 'refund',
        status: 'paid',
        amount_idr: 750_000,
        method: 'QRIS',
        gateway_ref: `RF-${booking.code}-01`,
        paid_at: '2026-10-18T11:00:00+07:00'
      });
    }
    if (booking.payment_status === 'refunded') {
      payments.push({
        id: `pay-${booking.id}-rf`,
        booking_id: booking.id,
        booking_code: booking.code,
        kind: 'refund',
        status: 'paid',
        amount_idr: booking.dp_amount_idr,
        method: 'QRIS',
        gateway_ref: `RF-${booking.code}-01`,
        paid_at: '2026-10-16T10:30:00+07:00'
      });
    }
  }
  return payments;
}

let journalSequence = 7;

function journalLine(
  entryId: string,
  index: number,
  accountCode: string,
  side: JournalLine['side'],
  amount: number,
  memo: string
): JournalLine {
  return {
    id: `${entryId}-l${index}`,
    account_code: accountCode,
    account_name: ACCOUNT_NAMES[accountCode] ?? accountCode,
    side,
    amount_idr: amount,
    memo
  };
}

const INITIAL_ENTRIES: JournalEntry[] = [
  {
    id: 'je-001',
    code: 'JE-2026-10-001',
    posted_at: '2026-09-15T11:00:00+07:00',
    description: 'DP diterima — TL-2610-010',
    source_type: 'payment',
    source_ref: 'TL-2610-010',
    created_by: 'Sistem (webhook PJP)',
    lines: [
      journalLine('je-001', 1, '1100', 'debit', 1_200_000, 'DP masuk custody PJP'),
      journalLine('je-001', 2, '5100', 'debit', 8_400, 'Fee gateway QRIS 0,7%'),
      journalLine('je-001', 3, '2100', 'credit', 1_200_000, 'Kewajiban ke vendor'),
      journalLine('je-001', 4, '1100', 'credit', 8_400, 'Fee dipotong dari clearing')
    ]
  },
  {
    id: 'je-002',
    code: 'JE-2026-10-002',
    posted_at: '2026-10-01T11:00:00+07:00',
    description: 'Pelunasan diterima — TL-2610-010',
    source_type: 'settlement',
    source_ref: 'TL-2610-010',
    created_by: 'Sistem (webhook PJP)',
    lines: [
      journalLine('je-002', 1, '1100', 'debit', 2_840_000, 'Pelunasan masuk custody PJP'),
      journalLine('je-002', 2, '5100', 'debit', 19_880, 'Fee gateway QRIS 0,7%'),
      journalLine('je-002', 3, '2100', 'credit', 2_840_000, 'Kewajiban ke vendor bertambah'),
      journalLine('je-002', 4, '1100', 'credit', 19_880, 'Fee dipotong dari clearing')
    ]
  },
  {
    id: 'je-003',
    code: 'JE-2026-10-003',
    posted_at: '2026-09-12T17:30:00+07:00',
    description: 'DP diterima — TL-2610-012',
    source_type: 'payment',
    source_ref: 'TL-2610-012',
    created_by: 'Sistem (webhook PJP)',
    lines: [
      journalLine('je-003', 1, '1100', 'debit', 1_800_000, 'DP masuk custody PJP'),
      journalLine('je-003', 2, '5100', 'debit', 12_600, 'Fee gateway QRIS 0,7%'),
      journalLine('je-003', 3, '2100', 'credit', 1_800_000, 'Kewajiban ke vendor'),
      journalLine('je-003', 4, '1100', 'credit', 12_600, 'Fee dipotong dari clearing')
    ]
  },
  {
    id: 'je-004',
    code: 'JE-2026-10-004',
    posted_at: '2026-10-13T10:00:00+07:00',
    description: 'Release ke vendor — TL-2610-010',
    source_type: 'release',
    source_ref: 'TL-2610-010',
    created_by: 'Bagus Hermawan',
    lines: [
      journalLine('je-004', 1, '2100', 'debit', 4_040_000, 'Tutup kewajiban escrow'),
      journalLine('je-004', 2, '4100', 'credit', 400_000, 'Komisi D-17'),
      journalLine('je-004', 3, '4110', 'credit', 40_000, 'Biaya layanan pelanggan 1%'),
      journalLine('je-004', 4, '2120', 'credit', 3_600_000, 'Hak vendor')
    ]
  },
  {
    id: 'je-005',
    code: 'JE-2026-10-005',
    posted_at: '2026-10-14T09:30:00+07:00',
    description: 'Payout diminta — TL-2610-010',
    source_type: 'payout',
    source_ref: 'TL-2610-010',
    created_by: 'Sari Wulandari',
    lines: [
      journalLine('je-005', 1, '2120', 'debit', 3_600_000, 'Payout ke rekening vendor'),
      journalLine('je-005', 2, '1110', 'credit', 3_600_000, 'Menunggu disbursement PJP')
    ]
  },
  {
    id: 'je-006',
    code: 'JE-2026-10-006',
    posted_at: '2026-10-18T14:00:00+07:00',
    description: 'Clawback pasca-sengketa — TL-2610-012',
    source_type: 'clawback',
    source_ref: 'TL-2610-012',
    created_by: 'Sari Wulandari',
    lines: [
      journalLine('je-006', 1, '2120', 'debit', 1_600_000, 'Tarik kembali hak vendor'),
      journalLine('je-006', 2, '2140', 'credit', 1_600_000, 'Cadangan sengketa')
    ]
  }
];

const state = {
  settings: INITIAL_SETTINGS,
  bookings: BOOKINGS,
  vendors: VENDORS,
  payments: buildPayments(),
  entries: INITIAL_ENTRIES,
  disputes: INITIAL_DISPUTES,
  latestReleaseJournalCodes: [] as string[]
};

function sameWibDay(aIso: string, bIso: string): boolean {
  const a = new Date(new Date(aIso).getTime() + 7 * 3_600_000);
  const b = new Date(new Date(bIso).getTime() + 7 * 3_600_000);
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Kunci hari WIB dalam format YYYY-MM-DD. */
function wibDayKey(iso: string): string {
  const date = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

const PAYMENT_MIX_ORDER: PaymentStatus[] = [
  'unpaid',
  'dp_paid',
  'fully_paid',
  'partially_refunded',
  'refunded'
];

/** Deret booking masuk per hari, dihitung dari tanggal dibuat. */
function dailyBookingSeries(days: number): DailyBookingPoint[] {
  const now = new Date(MOCK_NOW).getTime();
  const counts = new Map<string, number>();

  for (const booking of state.bookings) {
    const key = wibDayKey(booking.created_at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const points: DailyBookingPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now - offset * 86_400_000);
    const key = wibDayKey(day.toISOString());
    points.push({
      date: key,
      label: formatDayLabelID(day.toISOString()),
      count: counts.get(key) ?? 0
    });
  }
  return points;
}

function paymentMix(): PaymentMixSlice[] {
  return PAYMENT_MIX_ORDER.map((status) => ({
    status,
    label: statusLabel('payment', status),
    count: state.bookings.filter((booking) => booking.payment_status === status).length
  }));
}

function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < new Date(MOCK_NOW).getTime();
}

function openDisputeFor(bookingId: string): Dispute | null {
  return (
    state.disputes.find(
      (dispute) => dispute.booking_id === bookingId && dispute.status === 'open'
    ) ?? null
  );
}

export function releaseEligibility(booking: Booking): { eligible: boolean; reason: string | null } {
  if (booking.lifecycle_status !== 'completed') {
    return { eligible: false, reason: 'Acara belum selesai — release menunggu lifecycle completed.' };
  }
  if (booking.payment_status !== 'fully_paid') {
    return { eligible: false, reason: 'Tagihan belum lunas sepenuhnya.' };
  }
  if (booking.settlement_status !== 'held') {
    return { eligible: false, reason: 'Dana tidak berada di status held.' };
  }
  if (openDisputeFor(booking.id)) {
    return { eligible: false, reason: 'Ada sengketa terbuka — payout dibekukan.' };
  }
  if (booking.dispute_window_ends_at && !isOverdue(booking.dispute_window_ends_at)) {
    return { eligible: false, reason: 'Jendela sengketa belum berakhir.' };
  }
  return { eligible: true, reason: null };
}

function buildQueue(): ActionQueueItem[] {
  const items: ActionQueueItem[] = [];

  for (const booking of state.bookings) {
    if (
      booking.lifecycle_status === 'requested' &&
      booking.respond_deadline &&
      !isOverdue(booking.respond_deadline)
    ) {
      items.push({
        id: `q-${booking.id}-response`,
        booking_id: booking.id,
        code: booking.code,
        kind: 'response',
        title: 'Vendor belum menjawab permintaan',
        detail: `${booking.vendor_name} · ${booking.city}`,
        due_at: booking.respond_deadline,
        severity: 'attention',
        action_label: 'Lihat booking',
        href: `/bookings?code=${booking.code}`
      });
    }
    if (booking.lifecycle_status === 'countered' && booking.respond_deadline) {
      items.push({
        id: `q-${booking.id}-counter`,
        booking_id: booking.id,
        code: booking.code,
        kind: 'counter',
        title: 'Menunggu jawaban pelanggan atas counter',
        detail: `${booking.customer_name} · ${booking.vendor_name}`,
        due_at: booking.respond_deadline,
        severity: isOverdue(booking.respond_deadline) ? 'danger' : 'attention',
        action_label: 'Lihat booking',
        href: `/bookings?code=${booking.code}`
      });
    }
    if (booking.lifecycle_status === 'accepted' && booking.payment_status === 'unpaid') {
      items.push({
        id: `q-${booking.id}-dp`,
        booking_id: booking.id,
        code: booking.code,
        kind: 'dp',
        title: 'Menunggu pembayaran DP',
        detail: `${booking.vendor_name} · DP ${formatIDR(booking.dp_amount_idr)}`,
        due_at: booking.payment_deadline ?? booking.created_at,
        severity: isOverdue(booking.payment_deadline) ? 'danger' : 'attention',
        action_label: 'Lihat booking',
        href: `/bookings?code=${booking.code}`
      });
    }
    const eligibility = releaseEligibility(booking);
    if (eligibility.eligible) {
      items.push({
        id: `q-${booking.id}-release`,
        booking_id: booking.id,
        code: booking.code,
        kind: 'release',
        title: 'Siap dicairkan',
        detail: `${booking.vendor_name} · hak vendor ${formatIDR(booking.vendor_entitlement_idr)}`,
        due_at: booking.dispute_window_ends_at ?? MOCK_NOW,
        severity: 'attention',
        action_label: 'Tinjau pencairan',
        href: `/bookings?code=${booking.code}`
      });
    }
  }

  for (const dispute of state.disputes) {
    if (dispute.status !== 'open') continue;
    const booking = state.bookings.find((item) => item.id === dispute.booking_id);
    if (!booking) continue;
    items.push({
      id: `q-${dispute.id}`,
      booking_id: booking.id,
      code: booking.code,
      kind: 'dispute',
      title: 'Sengketa terbuka perlu keputusan',
      detail: truncate(dispute.reason, 64),
      due_at: dispute.sla_due_at,
      severity: 'danger',
      action_label: 'Buka sengketa',
      href: `/bookings?code=${booking.code}`
    });
  }

  return items.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
}

export function mockGetDashboard(): DashboardSummary {
  const bookingsToday = state.bookings.filter((booking) =>
    sameWibDay(booking.created_at, MOCK_NOW)
  );
  const awaitingDp = state.bookings.filter(
    (booking) => booking.lifecycle_status === 'accepted' && booking.payment_status === 'unpaid'
  );
  const releaseReady = state.bookings.filter((booking) => releaseEligibility(booking).eligible);
  const openDisputes = state.disputes.filter((dispute) => dispute.status === 'open');
  const activeVendors = state.vendors.filter((vendor) => vendor.is_active);
  const responseAvg =
    activeVendors.length === 0
      ? 0
      : Math.round(
          activeVendors.reduce((sum, vendor) => sum + vendor.response_rate_bp, 0) /
            activeVendors.length
        );
  const paidPopulation = state.bookings.filter((booking) =>
    ['accepted', 'confirmed', 'in_progress', 'completed', 'no_show'].includes(
      booking.lifecycle_status
    )
  );
  const paidCount = paidPopulation.filter(
    (booking) => booking.payment_status !== 'unpaid'
  ).length;
  const dpConversion =
    paidPopulation.length === 0 ? 0 : Math.round((paidCount * 10000) / paidPopulation.length);

  return {
    as_of: MOCK_NOW,
    kpis: {
      bookings_today: bookingsToday.length,
      bookings_today_needs_response: bookingsToday.filter(
        (booking) => booking.lifecycle_status === 'requested'
      ).length,
      awaiting_dp: awaitingDp.length,
      awaiting_dp_overdue: awaitingDp.filter((booking) => isOverdue(booking.payment_deadline))
        .length,
      ready_to_release: releaseReady.length,
      ready_to_release_idr: releaseReady.reduce(
        (sum, booking) => sum + booking.vendor_entitlement_idr,
        0
      ),
      open_disputes: openDisputes.length,
      oldest_dispute_due_at: openDisputes.length
        ? openDisputes.map((dispute) => dispute.sla_due_at).sort()[0]
        : null
    },
    queue: buildQueue().slice(0, 5),
    health: {
      response_rate_bp: responseAvg,
      response_target_bp: 9000,
      dp_conversion_bp: dpConversion,
      dp_target_bp: 5000,
      double_bookings: 0,
      median_response_minutes: 142
    },
    daily_bookings_7d: dailyBookingSeries(7),
    daily_bookings_30d: dailyBookingSeries(30),
    payment_mix: paymentMix()
  };
}

function inRange(createdAt: string, range: BookingFilters['range']): boolean {
  if (range === 'all') return true;
  const created = new Date(createdAt).getTime();
  const now = new Date(MOCK_NOW).getTime();
  if (range === '7d') return created >= now - 7 * 86_400_000 && created <= now;
  if (range === '30d') return created >= now - 30 * 86_400_000 && created <= now;
  return sameWibDay(createdAt, MOCK_NOW) || sameMonth(createdAt, MOCK_NOW);
}

function sameMonth(aIso: string, bIso: string): boolean {
  const a = new Date(new Date(aIso).getTime() + 7 * 3_600_000);
  const b = new Date(new Date(bIso).getTime() + 7 * 3_600_000);
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

export function mockGetBookings(filters: BookingFilters): Paginated<Booking> {
  const query = filters.q.trim().toLowerCase();
  let items = state.bookings.filter((booking) => {
    if (filters.status) {
      const [axis, value] = filters.status.split(':');
      if (axis === 'lifecycle' && booking.lifecycle_status !== value) return false;
      if (axis === 'payment' && booking.payment_status !== value) return false;
      if (axis === 'settlement' && booking.settlement_status !== value) return false;
    }
    if (filters.city && booking.city !== filters.city) return false;
    if (!inRange(booking.created_at, filters.range)) return false;
    if (query) {
      const haystack = `${booking.code} ${booking.vendor_name} ${booking.customer_name}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  items = [...items].sort((a, b) => {
    if (filters.sort === 'event_asc') {
      return new Date(a.event_start_at).getTime() - new Date(b.event_start_at).getTime();
    }
    if (filters.sort === 'event_desc') {
      return new Date(b.event_start_at).getTime() - new Date(a.event_start_at).getTime();
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const total = items.length;
  const start = (filters.page - 1) * filters.page_size;
  return {
    items: items.slice(start, start + filters.page_size),
    total,
    page: filters.page,
    page_size: filters.page_size
  };
}

export function mockGetBooking(id: string): {
  booking: Booking;
  payments: Payment[];
  dispute: Dispute | null;
} {
  const booking =
    state.bookings.find((item) => item.id === id || item.code === id) ?? null;
  if (!booking) {
    throw new ApiError('Booking tidak ditemukan. Tautan mungkin sudah kedaluwarsa.', 404);
  }
  return {
    booking,
    payments: state.payments.filter((payment) => payment.booking_id === booking.id),
    dispute:
      state.disputes.find((dispute) => dispute.booking_id === booking.id) ?? null
  };
}

export function mockGetVendors(filters: VendorFilters): Paginated<Vendor> {
  const query = filters.q.trim().toLowerCase();
  const items = state.vendors.filter((vendor) => {
    if (filters.city && vendor.city !== filters.city) return false;
    if (filters.verification && vendor.verification_status !== filters.verification) return false;
    if (query) {
      const haystack = `${vendor.name} ${vendor.owner_name} ${vendor.category}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  return { items, total: items.length, page: 1, page_size: items.length };
}

export function mockGetVendor(id: string): VendorDetail {
  const vendor = state.vendors.find((item) => item.id === id);
  if (!vendor) {
    throw new ApiError('Vendor tidak ditemukan.', 404);
  }
  const recent = state.bookings
    .filter((booking) => booking.vendor_id === id)
    .sort((a, b) => new Date(b.event_start_at).getTime() - new Date(a.event_start_at).getTime())
    .slice(0, 3);
  return { vendor, recent_bookings: recent };
}

export function mockGetReleaseQueue(): ReleaseQueue {
  const candidates: ReleaseCandidate[] = state.bookings
    .filter(
      (booking) =>
        booking.settlement_status === 'held' && booking.lifecycle_status === 'completed'
    )
    .map((booking) => {
      const eligibility = releaseEligibility(booking);
      return {
        booking,
        eligible: eligibility.eligible,
        blocked_reason: eligibility.reason,
        window_ends_at: booking.dispute_window_ends_at
      };
    });
  return { max_batch: MAX_RELEASE_BATCH, candidates };
}

function releaseLinesFor(booking: Booking): JournalLine[] {
  return [
    {
      id: `preview-${booking.id}-1`,
      account_code: '2100',
      account_name: ACCOUNT_NAMES['2100'],
      side: 'debit',
      amount_idr: booking.total_customer_idr,
      memo: `Tutup escrow ${booking.code}`
    },
    {
      id: `preview-${booking.id}-2`,
      account_code: '4100',
      account_name: ACCOUNT_NAMES['4100'],
      side: 'credit',
      amount_idr: booking.commission_idr,
      memo: `Komisi D-17 ${booking.code}`
    },
    {
      id: `preview-${booking.id}-3`,
      account_code: '4110',
      account_name: ACCOUNT_NAMES['4110'],
      side: 'credit',
      amount_idr: booking.service_fee_idr,
      memo: `Biaya layanan ${booking.code}`
    },
    {
      id: `preview-${booking.id}-4`,
      account_code: '2120',
      account_name: ACCOUNT_NAMES['2120'],
      side: 'credit',
      amount_idr: booking.vendor_entitlement_idr,
      memo: `Hak vendor ${booking.code}`
    }
  ];
}

function buildReleaseJournal(booking: Booking): ReleaseJournal {
  const lines = releaseLinesFor(booking);
  return {
    booking_id: booking.id,
    booking_code: booking.code,
    lines,
    debit_total_idr: lines
      .filter((line) => line.side === 'debit')
      .reduce((sum, line) => sum + line.amount_idr, 0),
    credit_total_idr: lines
      .filter((line) => line.side === 'credit')
      .reduce((sum, line) => sum + line.amount_idr, 0)
  };
}

export function mockPreviewRelease(input: ReleaseInput): ReleasePreview {
  const bookings = input.booking_ids.map((id) => {
    const booking = state.bookings.find((item) => item.id === id);
    if (!booking) {
      throw new ApiError('Salah satu booking tidak ditemukan. Muat ulang antrean.', 404);
    }
    return booking;
  });
  const journals = bookings.map(buildReleaseJournal);
  return {
    journals,
    total_entitlement_idr: bookings.reduce(
      (sum, booking) => sum + booking.vendor_entitlement_idr,
      0
    ),
    total_debit_idr: journals.reduce((sum, journal) => sum + journal.debit_total_idr, 0),
    total_credit_idr: journals.reduce((sum, journal) => sum + journal.credit_total_idr, 0),
    maker: input.maker,
    checker: input.checker
  };
}

export function mockSubmitRelease(input: ReleaseInput): ReleaseResult {
  if (input.booking_ids.length === 0) {
    throw new ApiError('Pilih minimal satu booking untuk dicairkan.', 400);
  }
  if (input.booking_ids.length > MAX_RELEASE_BATCH) {
    throw new ApiError(`Maksimal ${MAX_RELEASE_BATCH} booking per batch.`, 400);
  }
  if (input.reason.trim().length < 10) {
    throw new ApiError('Alasan pencairan wajib diisi minimal 10 karakter.', 400);
  }
  if (!input.maker || !input.checker) {
    throw new ApiError('Maker dan checker wajib dipilih.', 400);
  }
  if (input.maker === input.checker) {
    throw new ApiError('Checker harus operator yang berbeda dari maker.', 400);
  }

  const bookings = input.booking_ids.map((id) => {
    const booking = state.bookings.find((item) => item.id === id);
    if (!booking) {
      throw new ApiError('Salah satu booking tidak ditemukan. Muat ulang antrean.', 404);
    }
    const eligibility = releaseEligibility(booking);
    if (!eligibility.eligible) {
      throw new ApiError(
        `${booking.code} tidak bisa dicairkan: ${eligibility.reason ?? 'tidak memenuhi syarat'}.`,
        409
      );
    }
    return booking;
  });

  const journalCodes: string[] = [];
  for (const booking of bookings) {
    const sequence = journalSequence++;
    const entryId = `je-${sequence.toString().padStart(3, '0')}`;
    const code = `JE-2026-10-${sequence.toString().padStart(3, '0')}`;
    const preview = buildReleaseJournal(booking);
    const entry: JournalEntry = {
      id: entryId,
      code,
      posted_at: MOCK_NOW,
      description: `Release ke vendor — ${booking.code}`,
      source_type: 'release',
      source_ref: booking.code,
      created_by: `${input.maker} → ${input.checker}`,
      lines: preview.lines.map((line, index) => ({
        ...line,
        id: `${entryId}-l${index + 1}`
      }))
    };
    state.entries = [entry, ...state.entries];
    journalCodes.push(code);
    booking.settlement_status = 'released';
    booking.released_at = MOCK_NOW;
    booking.status_history = [
      ...booking.status_history,
      {
        id: `${booking.id}-h${booking.status_history.length + 1}`,
        axis: 'settlement',
        from_status: 'held',
        to_status: 'released',
        actor: `${input.maker} (maker) → ${input.checker} (checker)`,
        at: MOCK_NOW,
        note: input.reason.trim()
      }
    ];
  }

  state.latestReleaseJournalCodes = journalCodes;

  return {
    released_booking_codes: bookings.map((booking) => booking.code),
    journal_codes: journalCodes,
    released_at: MOCK_NOW,
    checker: input.checker,
    reason: input.reason.trim()
  };
}

export function mockGetLedger(): LedgerData {
  return {
    entries: [...state.entries].sort(
      (a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime()
    ),
    accounts: ACCOUNTS
  };
}

const PAYMENT_KIND_LABELS: Record<Payment['kind'], string> = {
  dp: 'DP',
  settlement: 'Pelunasan',
  refund: 'Refund'
};

export function mockGetPayments(): PaymentsOverview {
  const items = [...state.payments].sort(
    (a, b) => new Date(b.paid_at ?? 0).getTime() - new Date(a.paid_at ?? 0).getTime()
  );
  const kinds: Payment['kind'][] = ['dp', 'settlement', 'refund'];
  const by_kind: PaymentKindSummary[] = kinds.map((kind) => {
    const rows = items.filter((payment) => payment.kind === kind);
    return {
      kind,
      label: PAYMENT_KIND_LABELS[kind],
      count: rows.length,
      amount_idr: rows.reduce((sum, payment) => sum + payment.amount_idr, 0)
    };
  });
  return {
    items,
    total_idr: items.reduce((sum, payment) => sum + payment.amount_idr, 0),
    by_kind
  };
}

export function mockGetDisputes(): DisputeOverview {
  const items: DisputeRecord[] = state.disputes
    .map((dispute) => {
      const booking = state.bookings.find((item) => item.id === dispute.booking_id);
      return {
        ...dispute,
        vendor_name: booking?.vendor_name ?? 'Vendor tidak ditemukan',
        city: booking?.city ?? '-',
        customer_name: booking?.customer_name ?? '-'
      };
    })
    .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime());

  return {
    items,
    open_count: items.filter((dispute) => dispute.status === 'open').length,
    total_idr: items.reduce(
      (sum, dispute) => sum + dispute.customer_share_idr + dispute.vendor_share_idr,
      0
    )
  };
}

export function mockGetAuditLog(): AuditLog {
  const events = state.bookings
    .flatMap((booking) =>
      booking.status_history.map((entry) => ({
        id: entry.id,
        booking_id: booking.id,
        booking_code: booking.code,
        axis: entry.axis,
        from_status: entry.from_status,
        to_status: entry.to_status,
        actor: entry.actor,
        at: entry.at,
        note: entry.note
      }))
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return { events, total: events.length };
}

export function mockGetSettings(): PlatformSettings {
  return { ...state.settings };
}

export function mockSaveSettings(next: PlatformSettings): PlatformSettings {
  const integerFields: Array<keyof PlatformSettings> = [
    'bp1',
    'threshold_idr',
    'bp2',
    'min_idr',
    'cap_idr',
    'service_fee_bp',
    'dp_min_bp',
    'payment_deadline_hours',
    'payment_deadline_hours_high_value',
    'payment_high_value_threshold_idr',
    'dispute_window_days',
    'bank_cooling_hours',
    'payout_min_idr',
    'approval_threshold_idr'
  ];
  for (const field of integerFields) {
    const value = next[field];
    if (!Number.isInteger(value) || value < 0) {
      throw new ApiError(`Nilai ${field} harus bilangan bulat ≥ 0.`, 400);
    }
  }
  if (next.bp1 > 10000 || next.bp2 > 5000) {
    throw new ApiError('Basis point komisi melebihi batas yang diizinkan.', 400);
  }
  if (next.min_idr > next.cap_idr) {
    throw new ApiError('Lantai komisi tidak boleh lebih besar dari batas komisi.', 400);
  }
  if (next.payment_deadline_hours_high_value < next.payment_deadline_hours) {
    throw new ApiError('Batas DP nilai tinggi tidak boleh lebih pendek dari batas normal.', 400);
  }
  state.settings = { ...next };
  return { ...state.settings };
}

export function mockRequestOtp(phone: string): { ok: boolean; demo_code: string } {
  const digits = phone.replace(/\D/g, '');
  if (!/^08\d{8,12}$/.test(digits)) {
    throw new ApiError('Nomor tidak valid. Gunakan format 08xxxxxxxxxx (10–14 digit).', 400);
  }
  return { ok: true, demo_code: DEMO_OTP };
}

export function mockVerifyOtp(phone: string, code: string): { operator_name: string; role: string } {
  const digits = phone.replace(/\D/g, '');
  if (!/^08\d{8,12}$/.test(digits)) {
    throw new ApiError('Nomor tidak valid. Kembali ke langkah pertama.', 400);
  }
  if (code.replace(/\D/g, '') !== DEMO_OTP) {
    throw new ApiError('Kode OTP salah. Periksa 6 digit terakhir yang dikirim.', 401);
  }
  return { operator_name: 'Sari Wulandari', role: 'admin_finance' };
}

export function mockGetOperators(): Operator[] {
  return [...OPERATORS];
}

export { ACCOUNT_NAMES as MOCK_ACCOUNT_NAMES };
