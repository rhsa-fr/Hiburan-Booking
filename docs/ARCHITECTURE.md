# Arsitektur Tarlink

Dokumen ini menjelaskan bagaimana sistem bekerja, bukan sekadar daftar folder.
Dibaca bersama `README.md`, `docs/API.md`, dan `AGENTS.md`.

## 1. Bentuk sistem

```
Pelanggan (Flutter)  ─┐
Panel admin (Next.js) ─┼──► API NestJS  /v1  ──► PostgreSQL 15 + PostGIS
Vendor / agen (WA)   ─┘         │                    ▲
                                │                    │ polling
                          PJP (QRIS/VA)          Worker (jobs)
                                │                    │
                                └── webhook ─────────┘
```

- Tidak ada Redis. Worker melakukan polling PostgreSQL dan memproses antrean `outbox`.
- API bersifat stateless; sesi disimpan di DB (`sessions`) dan token membawa `jti`.
- Semua mutasi uang melewati ledger double-entry di dalam transaksi DB yang sama.

## 2. Lapisan kode

| Lapisan | Lokasi | Tanggung jawab |
|---|---|---|
| HTTP | `apps/api/src` | bootstrap, guard, filter error, prefix `/v1` |
| Domain | `libs/modules/<domain>/src/*.service.ts` | aturan bisnis, transaksi DB |
| Kontrak HTTP | `libs/modules/<domain>/src/*.controller.ts` | parsing request, status code |
| Platform | `libs/platform/*` | koneksi DB, config, JWT, tipe uang, error |
| Worker | `apps/worker/src/jobs/*` | job terjadwal, idempoten |
| Panel | `apps/admin/app/**` | UI operasional, tanpa logika uang sendiri |
| Mobile | `apps/mobile/lib/**` | UI pelanggan, tanpa logika uang sendiri |

Aturan: **controller tidak menyimpan aturan bisnis**, dan UI tidak menghitung uang.
Semua angka (DP, sisa, komisi) datang dari API.

Bentuk respons mengikuti satu konvensi: payload dibungkus `{ "data": … }` pada
sebagian besar endpoint (auth, booking detail, pembayaran, portal vendor, admin).
Pengecualian yang sudah beku dan sengaja tidak dibungkus: `GET /health`, katalog publik
(`GET /vendors`, `GET /categories`, `GET /policies/:code`), serta daftar berpaginasi
(`GET /bookings`) yang mengembalikan `{ items, total, page, page_size }` langsung.
Klien Flutter (`ApiClient`) membuka `data` otomatis bila ada.

## 3. Model data inti

| Tabel | Isi |
|---|---|
| `users` + `user_roles` | akun (pelanggan, vendor, operator, admin) dan perannya |
| `sessions` | sesi + `jti`, refresh token (hash), family rotasi, status pencabutan |
| `otp_requests` + `login_attempts` | OTP email (migrasi `020`) dan kuota login/OTP per email/IP |
| `regions` | referensi wilayah (kode, nama, level) |
| `vendors` + `vendor_members` | profil vendor, wilayah, harga mulai, `min_dp_bp`, media |
| `categories` + `vendor_categories` | kategori referensi; satu vendor multi-kategori, satu primer |
| `favorites` | favorit pelanggan (`GET /favorites`, `POST /favorites/:id`, `DELETE /favorites/:id`) |
| `reviews` | ulasan & rating booking pelanggan (`014_reviews.sql`) |
| `packages` + `package_addons` + `package_price_rules` | paket, add-on, aturan harga |
| `calendar_slots` | ketersediaan per tanggal + sesi, `updated_at` untuk deteksi `stale` |
| `events` | detail acara (judul, jenis, alamat, tanggal, tamu) |
| `bookings` | pesanan: kode `BK-YYMMDD-XXXX`, tiga sumbu status, snapshot harga/istilah |
| `booking_slots` + `booking_addons` | tanggal/sesi dan add-on yang dikunci booking |
| `booking_status_history` | jejak audit perubahan status |
| `payments` + `refunds` | tagihan DP/pelunasan, instruksi QRIS/VA, refund |
| `journal_entries` + `journal_lines` | ledger double-entry, **append-only** |
| `payouts` + `payout_items` | pencairan dana per vendor (status provider, rekening snapshot, booking yang dicakup) |
| `chart_of_accounts` | daftar akun ledger dan tipe normalnya |
| `disputes` | sengketa dan resolusinya |
| `policy_versions` | teks kebijakan berversi (`code`, `version`, `body`) |
| `user_consents` | persetujuan ToS/Privasi per versi (`022`), append-only per (user, versi) |
| `vendor_media` | unggahan media vendor + status moderasi (`016_vendor_media_moderation.sql`) |
| `vendor_applications` + `account_deletion_requests` | pengajuan vendor mandiri dan permintaan hapus akun (`017`) |
| `notifications` | notifikasi in-app per pengguna (`018`) |
| `chat_messages` | pesan chat per booking, append-only, memicu `NOTIFY tarlink_chat` (`021`) |
| `outbox_messages` | antrean event untuk worker |
| `audit_logs` | aksi admin/operator |
| `idempotency_keys` | hasil request idempoten (`POST /bookings`, `POST /payments/dp`, `POST /payments/settlement`) |

Settlement tidak punya tabel sendiri: statusnya hidup di `bookings.settlement_status`
(`not_eligible`, `held`, `disputed`, `released`, `clawed_back`) plus `released_at`.
Pelunasan manual maupun online (Midtrans) dicatat sebagai baris `payments` berjenis `settlement`; migrasi 007
menjaga hanya satu baris `pending`/`paid` per booking.

Migrasi: `db/migrations/001_core.sql` → `023_vendor_suspension.sql`. Migrasi 002 menambah
add-on dan snapshot istilah, 003 auth, 004 password admin + `login_attempts`, 005
Google, 006 metode pembayaran manual, 007 keunikan pelunasan, 008 kategori katalog +
tabel favorit, 009 kolom media vendor/paket, 010 guard idempotensi booking
(`client_generated_id`), 011 refresh token + index rate limit IP, 012 index trigram
pencarian vendor, 013 payout vendor maker-checker, 014 review booking pelanggan,
015 pembersihan media stok bawaan 009, 016 moderasi media vendor (`vendor_media`),
017 maker-checker refund + bukti, hapus akun mandiri, dan pengajuan vendor
(`vendor_applications`), 018 notifikasi in-app (`notifications`), 019 enkripsi NIK
vendor (`nik_ciphertext`), 020 OTP email (`otp_requests.email`), 021 chat booking
(`chat_messages` + trigger `NOTIFY tarlink_chat`), 022 consent (`user_consents` +
seed `tos`/`privacy` v1), 023 penangguhan vendor (`suspended_at`, `suspended_by`,
`suspension_reason`, `suspension_previous_status` + CHECK `vendors_suspension_consistent`).
Nomor berikutnya: `024`.

### 3.1 Moderasi media

Media vendor tidak lagi ditulis langsung ke kolom publik. Alurnya:

```
vendor unggah → vendor_media (status=pending) → admin approve → kolom publik berubah
                                             → admin reject  → hanya tercatat + alasan
```

- `vendors.avatar_url`, `banner_url`, `photo_urls`, `video_url`, dan
  `packages.photo_url` adalah **hasil** moderasi, bukan input vendor.
- `PATCH /vendor/me` menolak URL yang tidak punya baris `vendor_media` berstatus
  `approved` (`details.reason = MEDIA_NOT_APPROVED`).
- Galeri dibatasi 8 URL; approve ke-9 gagal dengan `GALLERY_FULL`.
- Backfill 016 menandai unggahan lama (`/v1/media/...`) sebagai `approved` dengan
  catatan `pra-moderasi`; seed stok Unsplash/YouTube dihapus oleh 015.

### 3.2 KTP vendor (dokumen identitas)

- File KTP disimpan di `PRIVATE_UPLOAD_DIR`, **tidak** di `UPLOAD_DIR` publik.
- Bytes dienkripsi AES-256-GCM (`IV || authTag || ciphertext`) sebelum ditulis;
  kunci `KTP_ENCRYPTION_KEY` (base64 32 byte) wajib di production. Dev/test memakai
  turunan `JWT_SECRET` supaya data lokal tetap tidak plaintext.
- Permission direktori `0700`, file `0600` (POSIX).
- Hanya `admin_super` yang bisa membuka file; setiap akses menulis
  `vendor.application.ktp_access` ke `audit_logs`. `admin_support` melihat NIK tersamar.
- Data minimisation: reject pengajuan dan hapus akun mengosongkan referensi KTP dan
  menghapus file terenkripsinya.
- Kolom `nik` di `users` dienkripsi AES-256-GCM (`nik_ciphertext`, migrasi `019`);
  baris lama di-backfill saat dibaca.
- Setiap request yang membawa `jti` dicek ke `sessions` (§6), jadi token dari sesi
  yang dicabut langsung ditolak. 2FA admin (FR-128) dan mode cookie HttpOnly untuk
  panel sudah ada: `refresh_token` panel hidup di cookie `tarlink_rt`
  (`HttpOnly`, `SameSite=Strict`, `Path=/v1/auth`), bukan di storage JavaScript.

### 3.3 Chat booking (FR-050)

- Satu thread per booking di `chat_messages`; tidak ada tabel percakapan terpisah.
- Peserta ditentukan dari relasi booking (`customer_id`, pemilik/anggota aktif vendor),
  dengan admin sebagai jalur baca/tulis untuk sengketa. Peran di token tidak dipakai
  untuk menentukan sisi percakapan.
- REST: `GET/POST /v1/bookings/:bookingId/chat/messages`; riwayat memakai cursor
  `(created_at, id)`, bukan offset.
- Real-time: `WS /v1/chat/ws?token=…`. Trigger `AFTER INSERT` mengirim baris lengkap
  lewat `pg_notify('tarlink_chat', …)`; setiap instance API memegang satu koneksi
  `LISTEN` dan meneruskan ke socket yang berlangganan booking tersebut. Tidak ada
  Redis/broker tambahan. Pengiriman lewat REST juga memicu siaran yang sama.
- Socket hanya boleh mengikuti maksimal 20 thread; reconnect klien diikuti muat ulang
  riwayat lewat REST.

### 3.4 Consent kebijakan (FR-103)

- `user_consents` menyimpan satu baris per (user, `policy_version_id`) dengan
  `accepted_at`, `ip`, dan `user_agent`. Tidak ada UPDATE; persetujuan versi baru
  adalah baris baru.
- Registrasi mengirim `id` versi `tos`/`privacy` yang ditampilkan klien; API
  membandingkannya dengan versi aktif dan menolak versi basi.
- body `tos`/`privacy` v1 masih placeholder bertanda `draft`; penggantian teks
  final harus lewat migrasi baru.
- Sign-up Google pertama kali kini wajib mengirim `consent` (`tos_version_id`,
  `privacy_version_id`) dan menulis dua baris `user_consents` yang sama seperti
  registrasi email. Akun Google yang sudah ada tidak diminta consent ulang.

## 4. Ledger (bagian paling sensitif)

### Akun
`platform_operating_cash`, `gateway_clearing`, `vendor_payout_clearing`,
`escrow_liability_vendor`, `refund_payable`, `vendor_payable`, `tax_payable`,
`dispute_reserve`, `platform_revenue_commission`, `platform_revenue_service_fee`,
`gateway_fee_expense`, `gateway_fee_absorbed`, `vendor_bad_debt_expense`.

Setiap akun punya tipe (`asset`, `liability`, `revenue`, `expense`, `equity`).

### Contoh: DP diterima (`dp_received`)
Pelanggan membayar DP Rp1.500.000. Dana masuk ke rekening PJP, **bukan** rekening
platform; karena itu dicatat sebagai kewajiban, bukan pendapatan.

```
debit   gateway_clearing            1.500.000
credit  escrow_liability_vendor     1.500.000
```

### Contoh: pelepasan dana (`release`)
Setelah acara selesai dan jendela sengketa tutup, kewajiban escrow berkurang,
komisi platform diakui, dan utang ke vendor muncul.

```
debit   escrow_liability_vendor     total
credit  platform_revenue_commission komisi
credit  vendor_payable              sisa
```

### Contoh: payout vendor (`payout_requested` → `payout_settled`)
Admin keuangan mencairkan saldo `vendor_payable` ke rekening vendor. Debit ke clearing
dulu, bukan langsung kas, karena transfer masih berjalan di provider.

```
# saat checker menyetujui
debit   vendor_payable              nominal   (vendor)
credit  vendor_payout_clearing      nominal   (vendor)

# saat provider melaporkan selesai
debit   vendor_payout_clearing      nominal   (vendor)
credit  gateway_clearing            nominal
```

Bila provider menolak, jurnal `payout_requested` **dibalik** (`reversal`), bukan dihapus;
booking yang tercakup dikembalikan ke antrean payout.

### Refund maker-checker (FR-128/FR-133)

Refund di atas `REFUND_APPROVAL_THRESHOLD_IDR` (default Rp1.000.000) berhenti di
status `requested` tanpa jurnal. Admin lain (`POST /v1/payments/refunds/:id/approve`)
wajib berbeda dari pembuat permintaan; setelah disetujui barulah provider dipanggil
dan jurnal pengakuan + `refund_disbursed` diposting. Penolakan menyimpan
`review_note` tanpa pergerakan uang. Pelanggan melihat status refund lewat
`GET /v1/payments/refunds/by-booking/:bookingId`.

### Aturan yang dijaga test
- Setiap jurnal seimbang (`assertBalanced`).
- Tidak ada update/delete pada tabel jurnal (dijaga trigger DB).
- Hanya satu baris `payments` berjenis `settlement` berstatus `pending`/`paid` per booking
  (migrasi 007).
- Pelepasan hanya untuk `fully_paid`/`partially_refunded` + jendela sengketa lewat.

## 5. Komisi

Komisi bertingkat (D-17):

| Dasar | Tarif |
|---|---|
| Lantai | Rp25.000 |
| ≤ Rp10.000.000 | 10% |
| > Rp10.000.000 | 5% untuk bagian di atasnya |
| Cap | Rp7.500.000 |

DP: 30% default (bisa diatur per vendor lewat `min_dp_bp`), jatuh tempo 24 jam;
untuk nilai ≥ Rp10 juta, 48 jam.

## 6. Autentikasi & sesi

1. `POST /auth/login` (email + password), `POST /auth/register`, atau OTP **email**
   (`POST /auth/otp/request` → `POST /auth/otp/verify`, ADR 0011). Email dikirim lewat
   port `Mailer` (`HttpMailer` bila `EMAIL_API_URL` diisi, `LoggingMailer` di dev).
   Mobile saat ini memakai email + password; Login Google tersedia di API tetapi tidak
   dipakai mobile.
2. Server membuat baris `sessions` dengan `jti` + refresh token opaque (disimpan
   sebagai `refresh_token_hash`). Respons login berisi `access_token` (15 menit) dan
   `refresh_token` (30 hari, `REFRESH_TTL_DAYS`).
3. `POST /auth/refresh` **merotasi**: baris lama dicabut (`rotated_at`), baris baru
   dibuat dalam `family_id` yang sama (`parent_id` menunjuk `sessions.id`, bukan `jti`).
   Refresh token lama → 401; memakainya lagi dianggap reuse dan mencabut seluruh family.
   Path Bearer lama masih diterima untuk kompatibilitas, tetapi panel admin tidak
   memakainya lagi.
4. `POST /auth/logout` mencabut sesi berdasarkan refresh token (body atau cookie
   `tarlink_rt`) atau `jti`, lalu menghapus cookie.
5. Klien (`ApiClient` Flutter) menyimpan access + refresh token di
   `flutter_secure_storage`; cold start memakai refresh token walau access token
   sudah kedaluwarsa, lalu refresh-on-401 untuk request lain.
   Panel admin berbeda: refresh token hanya di cookie `tarlink_rt` (HttpOnly),
   access token di `localStorage` agar seluruh tab berbagi satu salinan. Refresh
   diserialisasi lintas tab dengan `navigator.locks`; tab yang kalah cepat memakai
   token hasil tab lain tanpa memanggil `/auth/refresh` lagi, sehingga rotasi tidak
   saling membunuh sesi. Konsekuensi: panel dan API harus same-site.
6. Kuota login/OTP dicek per email **dan** per IP (`login_attempts`,
   `otp_requests.requester_ip`); `TRUST_PROXY=true` diperlukan di belakang proxy.
   OTP `dev_code` hanya keluar bila `NODE_ENV != production` dan `OTP_DEV_MODE=true`.
7. Hapus akun mandiri (FR-101): `DELETE /auth/me` menganonimkan kolom pribadi
   (`phone`, `email`, `name`, `password_hash`, `google_sub`), mencabut semua sesi dan
   peran, lalu mencatat `account_deletion_requests`. Baris `users` dipertahankan agar
   foreign key booking/payment/payout tetap utuh. Idempoten.

Setiap request yang membawa `jti` juga dicek ke `sessions` (`installSessionChecker`
di `apps/api/src/core/session-checker.ts`): token yang tanda tangannya sah tetap
ditolak bila sesinya sudah dicabut, sehingga logout/hapus akun berlaku seketika.

## 7. Worker

Poller PostgreSQL, interval pendek, tanpa broker.

| Job | Fungsi |
|---|---|
| `expire-holds` | melepas hold kalender yang kedaluwarsa |
| `expire-unpaid` | menandai booking `unpaid` yang lewat batas sebagai `expired` |
| `expire-unresponsive` | menandai booking `requested` yang tidak direspons vendor dalam batas waktu sebagai `expired` |
| `auto-complete` | menutup acara yang sudah lewat |
| `auto-release` | melepas dana ke vendor setelah jendela sengketa |
| `payout-reconcile` | mengirim ulang payout `approved` dan menanyakan status `processing` ke provider |
| `outbox` | memetakan event `booking.*` menjadi baris `notifications` (in-app) |
| `cleanup-auth` | memangkas `sessions`/`otp_requests`/`login_attempts` yang kedaluwarsa |
| `cleanup-media` | menghapus unggahan yatim (>24 jam, tidak dirujuk `vendor_media`/vendor/paket) |

Semua job idempoten dan mencatat `processed / skipped / failed` di log.

### Notifikasi in-app

- Tabel `notifications` (migrasi `018`): `user_id`, `type`, `title`, `body`,
  `payload`, `dedupe_key` unik, `read_at`.
- `runOutbox` memakai `NotificationSink`, bukan `LoggingMessageSink`. Penerima
  ditentukan dari `bookings.customer_id` dan `vendors.owner_user_id`.
- Idempoten: `dedupe_key = outbox:<message_id>:<user_id>`; sink yang di-retry
  tidak membuat baris ganda.
- Mobile `NotificationPoller` (`lib/core/notifications.dart`) mem-poll
  `/v1/notifications` tiap 20 detik selama sesi aktif dan menampilkan popup.
  Tidak ada provider WhatsApp/push pada rilis ini.

## 8. Panel admin

Next.js App Router dengan dua grup rute: `(auth)` untuk login, `(panel)` untuk
operasional: dashboard, booking, vendor, pelepasan dana (`release`), ledger, pembayaran,
sengketa, audit, pengaturan, wilayah (`regions`, FR-125), pengajuan vendor
(`applications`), moderasi media (`moderation`), payout (`payouts`), dan refund
(`refunds`).

Aturan: panel tidak menghitung uang sendiri; semua angka dari `GET /admin/*`.

## 9. Aplikasi Flutter (pelanggan + portal vendor)

```
apps/mobile/lib/
  app/            app.dart (shell pelanggan 4 tab), routes.dart, theme.dart
  core/           api_client.dart, api_exception.dart, session.dart, models.dart,
                  format.dart, notifications.dart (poller), chat.dart,
                  chat_socket*.dart (WebSocket per platform), ui.dart (komponen bersama),
                  widgets.dart (state UI)
  features/
    auth/         welcome_page, login_page, register_page, auth_support
    discovery/    home_page (Beranda), browse_page (Jelajah), vendor_page, favorites_page
    booking/      create_page, list_page, status_page, booking_support
    chat/         chat_page (riwayat REST + langganan WebSocket)
    profile/      account_page, vendor_apply_page
    vendor/       vendor_shell, dashboard, calendar, earnings, profile, bookings,
                  booking_detail, manage_packages, manage_profile, package_edit,
                  media_picker, vendor_theme, vendor_ui
```

- **Shell pelanggan**: bottom bar kustom 4 tab (Beranda, Jelajah, Booking, Profil)
  dengan `IndexedStack`; tab dibangun malas agar cold start tidak menembak semua API.
  Pengguna berperan `vendor_owner` langsung diarahkan ke `Routes.vendorHome`.
- **State**: `setState` + `ChangeNotifier` sederhana; tanpa provider/bloc/riverpod.
- **HTTP**: satu `ApiClient` dengan refresh-on-401; error dipetakan ke pesan Indonesia.
- **Desain**: acuan visual berupa ekspor HTML di `opendesain/` (peta file:
  [DESIGN-REFERENCES.md](DESIGN-REFERENCES.md)). Token di `theme.dart` mengikuti
  ekspor OpenDesign **Graphite · Lime**:
  ink `#0B1220`, kanvas hangat `#EEEEE9`, kartu `#FAFAF7`, aksi lime `#D9FB4F`,
  uang/sukses hijau `#076C48`, tahan/menunggu amber `#9A4208`. Satu keluarga font:
  Plus Jakarta Sans (Roboto Flex tetap dibundel dan diuji, tetapi tidak dipakai theme).
  Komponen bersama di `core/ui.dart` (StageHeader, PosterTile, VendorCard, MoneyBlock,
  StickyActionBar, SelectChip, SegmentBar, InfoStrip, StatusPill, BrandLockup).
  `StageHeader` memakai gradien `primaryDeep → primary` dengan garis bawah lime 2 px.
- **Media vendor**: `PosterTile` memakai `avatar_url`/`banner_url` bila API mengirimnya;
  jika kosong, gradien deterministik dari nama vendor. `photo_urls` tampil sebagai
  galeri dan `video_url` dibuka in-app.
- **Jelajah**: chip kategori dari `GET /categories`, pemilih `date`, dan `sort`
  (`price_asc`, `name_asc`). Chip wilayah difilter di klien dari hasil yang sudah dimuat.

### 9.1 Portal vendor

- Shell 4 tab (Beranda, Kalender, Saldo, Profil); semua pesanan dan detail pesanan
  adalah halaman pendalaman.
- Token desain vendor lokal di `features/vendor/vendor_theme.dart`; `app/theme.dart`
  dan `core/ui.dart` tidak diubah.
- Data dari `GET /vendor/dashboard`, `GET /vendor/bookings`,
  `GET /vendor/bookings/:id`, `GET /vendor/earnings`, `GET /vendor/me`,
  `GET/POST/PATCH/DELETE /vendor/packages`, `PUT /vendor/calendar`, dan
  `POST /vendor/media`. Semua memakai peran `vendor_owner`; vendor diselesaikan dari
  token, bukan dari parameter klien.

## 10. Alur booking (ringkas)

```
pilih vendor → pilih paket → pilih tanggal/sesi → isi detail acara
   → POST /bookings (status requested) → vendor accept
   → POST /payments/dp (QRIS/VA) → webhook PJP → dp_paid + jadwal dikunci
   → acara selesai → auto-complete → auto-release → dana ke vendor
```

Provider pembayaran dipilih lewat `PJP_PROVIDER`:

- `midtrans` — Midtrans Core API (sandbox default). Charge QRIS/VA/Mandiri dikirim
  ke `POST https://api.sandbox.midtrans.com/v2/charge`; notifikasi masuk ke
  `POST /webhooks/midtrans` dan diverifikasi dengan
  `SHA512(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)`.
  `order_id` Midtrans = `payments.id`.
- `local` — gateway deterministik tanpa jaringan untuk test/dev tanpa kredensial.

Webhook legacy `POST /webhooks/pjp` (HMAC-SHA256
`sha256(timestamp + "." + rawBody)`) tetap ada untuk gateway lokal. Refund QRIS
dipanggil ke Midtrans dan langsung difinalkan; refund VA/Mandiri ditolak karena
Midtrans tidak mendukung reverse bank transfer.

## 11. Keputusan arsitektur yang mengikat

| Kode | Keputusan |
|---|---|
| D-01 | Dana pelanggan ditahan PJP berizin, bukan rekening platform |
| D-17 | Komisi bertingkat dengan lantai dan cap (lihat §5) |
| D-18 | DP 24 jam; 48 jam untuk nilai ≥ Rp10 juta |
| — | Ledger append-only, uang integer rupiah |
| — | Settlement disimpan di `bookings.settlement_status`, bukan tabel terpisah |
| — | Worker polling DB, tanpa Redis |
| — | Chat real-time in-app via WebSocket (ADR 0011); WhatsApp deep link hanya cadangan |

## 12. Batasan yang tersisa

Sudah diselesaikan: idempotensi `POST /bookings`, validasi `policy_version_id` +
snapshot, rate limit per IP, index trigram pencarian, guard `dev_code`, refresh token
panjang, pemangkasan sesi, penolakan e-wallet yang eksplisit, notifikasi in-app
(migrasi `018`), enkripsi NIK (migrasi `019`), pengecekan `sessions.jti` per request,
antrean pengajuan vendor + antrean refund di panel admin, job `cleanup_media`, dan
header CSP pada nota invoice, serta chat booking (migrasi `021`: REST riwayat/kirim,
WebSocket per booking, fan-out `LISTEN/NOTIFY`).

Yang masih terbuka (lihat [AGENTS.md § Batasan](../AGENTS.md#batasan-yang-diketahui)):
push notification, chat foto/lokasi dan penyaringan kontak (FR-135), picker peta lokasi
acara, UI check-in berbasis GPS, token admin HttpOnly, dan 2FA admin. Provider WhatsApp/SMS
tidak dipakai (ADR 0011). Integrasi
charge + notifikasi + refund QRIS memakai Midtrans sandbox; endpoint check-in/no-show
basic sudah ada. Payout vendor + rekening terenkripsi sudah ada; integrasi Iris
tersedia di balik `PAYOUT_PROVIDER=iris`, tetapi pengujian live bergantung pada
kredensial dan saldo merchant Iris sandbox. Review/rating dan favorit sudah selesai
(014), moderasi media sudah selesai (016).
