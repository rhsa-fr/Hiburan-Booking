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
| `notification_deliveries` | buku kirim notifikasi keluar per (kanal, pesan outbox, penerima) (`028`) |
| `chat_messages` | pesan chat per booking, append-only, memicu `NOTIFY tarlink_chat` (`021`) |
| `outbox_messages` | antrean event untuk worker |
| `audit_logs` | aksi admin/operator |
| `idempotency_keys` | hasil request idempoten (`POST /bookings`, `POST /payments/dp`, `POST /payments/settlement`) |

Settlement tidak punya tabel sendiri: statusnya hidup di `bookings.settlement_status`
(`not_eligible`, `held`, `disputed`, `released`, `clawed_back`) plus `released_at`.
Pelunasan manual maupun online (Midtrans) dicatat sebagai baris `payments` berjenis `settlement`; migrasi 007
menjaga hanya satu baris `pending`/`paid` per booking.

Migrasi: `db/migrations/001_core.sql` → `034_dispute_clawbacks.sql`. Migrasi 002 menambah
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
`suspension_reason`, `suspension_previous_status` + CHECK `vendors_suspension_consistent`),
024 rekonsiliasi (`reconciliation_runs`/`reconciliation_diffs` + seed `platform_settings`),
025 2FA admin (kolom TOTP di `users`, `admin_backup_codes`, `admin_2fa_challenges`),
026 satu tiket 2FA hidup per user (unique partial index), 027 moderasi UGC
(`content_reports`, `user_blocks`, `reviews.hidden_at`/`chat_messages.hidden_at` +
trigger agregat rating), 028 notifikasi keluar (`notification_deliveries`: klaim
per kanal/pesan/penerima untuk email FR-051), 029 tindak lanjut rekonsiliasi
(`reconciliation_diffs.resolution` + CHECK konsistensi resolved_at), 030 eskalasi
SLA laporan konten (`content_reports.escalated_at` + index), 031 banding takedown
(`content_report_appeals`), 032 index `events.start_date` untuk pengingat H-7/H-1/hari-H,
033 bukti berkas banding privat (`content_report_appeals.evidence_file_path`),
034 clawback pasca-pencairan (`dispute_clawbacks` + enum `dispute_resolution.clawback`).
Nomor berikutnya: `035`.

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
- Panel mengirim CSP enforced per request dari `apps/admin/middleware.ts`
  (string-nya satu sumber di `apps/admin/lib/csp.ts`): `default-src 'self'`,
  `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'
  https://accounts.google.com`; `style-src 'self' 'unsafe-inline'
  https://accounts.google.com` (stylesheet tombol Google Identity Services);
  `img-src` origin API + `MEDIA_PUBLIC_BASE_URL` +
  `https://*.googleusercontent.com`; `connect-src` origin API +
  `https://accounts.google.com`; `frame-src` Google; `frame-ancestors 'none'`;
  `base-uri`, `form-action`, dan `object-src` dikunci. Tidak ada
  `'unsafe-inline'` di `script-src`; nonce dibuat tiap request dan ikut di header
  request supaya Next menempelkannya ke `<script>` miliknya. `style-src` tetap
  `'unsafe-inline'` karena next/font menulis blok `@font-face` inline dan
  komponen grafik memakai atribut `style`. `'unsafe-eval'` dan `ws:` hanya ada di
  mode dev. `NEXT_PUBLIC_API_BASE_URL` dan `MEDIA_PUBLIC_BASE_URL` dibaca di Edge
  middleware, jadi keduanya **di-inline saat build** dan nilainya harus sama
  dengan yang dipakai API (termasuk bila media dilayani CDN); mengubahnya saat
  `next start` tidak mengubah CSP, panel harus di-build ulang. Header `x-nonce`
  ikut diteruskan untuk komponen server yang kelak membacanya. Dokumen error
  bawaan framework (di luar root layout) tidak mendapat nonce dan tetap
  fail-closed. Konsekuensinya root layout memaksa `dynamic = 'force-dynamic'`
  (nonce menuntut render per request), jadi panel tidak lagi punya rute
  prerender statis.

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

### 3.5 Moderasi UGC (FR-123 / FR-124 / FR-142)

```
pengguna lapor → content_reports (open, sla_due_at) → admin putuskan
                                  ↓
      no_action | user_warned | content_removed | content_restored
                                  ↓
   review/chat: hidden_at    media: status=rejected + kolom publik dibersihkan
                                  ↓
                    audit_logs (append-only, hash chain)

pemilik konten → content_report_appeals (pending) → admin support/super
                                  ↓
             accepted: review/chat dipulihkan; media → pending (tinjau ulang)
```

- Target yang bisa dilaporkan: `vendor`, `review`, `chat_message`, `vendor_media`.
  Pesan chat hanya boleh dilaporkan peserta booking-nya (anti-fishing); konten sendiri
  tidak bisa dilaporkan. Satu pelapor hanya boleh punya satu laporan terbuka per target
  (unique partial index `content_reports_open_per_target_uniq`), sehingga tombol lapor
  berulang tidak membanjiri antrean.
- SLA: `sla_due_at = created_at + 24 jam`, dan `+ 72 jam` bila `reason = copyright`
  (FR-124). Antrean admin menaruh laporan yang lewat SLA di atas.
- Keputusan wajib lengkap — `resolution`, `resolved_by`, `resolved_at`, catatan ≥10
  karakter — dijaga CHECK `content_reports_decision_consistent`, dan setiap keputusan
  menulis satu baris `audit_logs` (`content_report.<action>`).
- **Takedown tidak menghapus.** `reviews.hidden_at` / `chat_messages.hidden_at`
  menyembunyikan dari pembaca; media ditolak (`vendor_media.status='rejected'`) dan URL
  yang masih menempel di kolom publik vendor/paket dibersihkan. Trigger
  `trg_reviews_hidden_rating` menjaga `vendors.rating_sum`/`rating_count` tetap cocok
  saat ulasan disembunyikan atau dipulihkan.
- Penangguhan vendor **tidak** dilakukan dari antrean laporan: jalurnya tetap
  `POST /v1/admin/vendors/:id/suspend` (`admin_super`) supaya hanya ada satu tempat yang
  mengubah `verification_status` dan membekukan payout.
- `user_blocks` hanya memengaruhi tampilan. Riwayat chat menyaring pesan dari pihak yang
  diblokir di SQL (bukan di klien, agar paginasi tidak bolong), dan gateway WebSocket
  memeriksa blokir per pengiriman sehingga pesan baru pun tidak sampai.
- Peran: `admin_support` dan `admin_super` memutuskan, `admin_finance` hanya membaca.
  Pelapor selalu bisa membaca status laporannya sendiri (`GET /v1/reports/:id`); laporan
  orang lain dijawab 404 — bukan 403 — supaya keberadaannya tidak bocor.
- **Banding** (migrasi `031`, FR-124): pemilik konten mengajukan satu banding per laporan
  maksimal 30 hari setelah keputusan, dengan alasan 20-2000 karakter + `evidence_url`
  opsional. Antrean admin `/appeals` memutuskan `accepted`/`rejected` dengan catatan
  wajib; keputusan final, masuk `audit_logs` (`content_report.appeal_*`), dan pengaju
  menerima notifikasi in-app. Laporan asal tidak diubah. Menerima banding memulihkan
  ulasan/pesan chat; media dikembalikan ke `pending` karena URL publiknya sudah
  dibersihkan saat takedown, sehingga publikasi ulang tetap lewat moderasi media.
- **Bukti berkas banding** (migrasi `033`, FR-124 lanjutan): selain `evidence_url`,
  pengaju bisa mengunggah satu gambar (JPG/PNG/WebP ≤5 MB) lewat
  `POST /v1/reports/:id/appeal/evidence`. Byte-nya **tidak** masuk `/v1/media`:
  disimpan terenkripsi AES-256-GCM di `PRIVATE_UPLOAD_DIR` dengan kunci turunan
  `KTP_ENCRYPTION_KEY` (domain `appeal-evidence:`), izin 0600/0700, tipe dideteksi
  dari magic bytes. Hanya pemilik banding yang bisa mengunggah/membaca, dan hanya
  selama status `pending`; mengganti berkas menghapus yang lama. Admin
  support/finance/super membaca lewat endpoint ber-guard yang menulis
  `audit_logs` (`content_report.appeal_evidence_viewed`) sebelum byte dikirim.
  Object key internal tidak pernah dikirim ke klien (`has_evidence_file` saja).

## 4. Ledger (bagian paling sensitif)

### Akun
`platform_operating_cash`, `gateway_clearing`, `vendor_payout_clearing`,
`escrow_liability_vendor`, `refund_payable`, `vendor_payable`, `tax_payable`,
`dispute_reserve`, `platform_revenue_commission`, `platform_revenue_service_fee`,
`gateway_fee_expense`, `gateway_fee_absorbed`, `vendor_bad_debt_expense`.

Setiap akun punya tipe (`asset`, `liability`, `revenue`, `expense`, `equity`).
Seed SQL memuat 13 akun; kode saat ini hanya mem-posting 11 di antaranya.
`tax_payable` dan `vendor_bad_debt_expense` sengaja disediakan untuk PPh dan
piutang tak tertagih, tetapi belum dipakai oleh service mana pun — jangan
menganggapnya bagian dari alur aktif.

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
   memakainya lagi. Kegagalan refresh dihitung per IP di memori proses (sliding
   window 5 menit, maks 30); percobaan ke-31 dijawab `429`. Hitungan ini bukan
   pengganti rotasi dan tidak dibagi antar-instance. Cookie `tarlink_rt` yang tidak
   bisa didekode dihapus pada refresh/logout.
4. `POST /auth/logout` mencabut sesi berdasarkan refresh token (body atau cookie
   `tarlink_rt`) atau `jti`, lalu menghapus cookie.
5. Klien (`ApiClient` Flutter) menyimpan access + refresh token di
   `flutter_secure_storage`; cold start memakai refresh token walau access token
   sudah kedaluwarsa, lalu refresh-on-401 untuk request lain.
   Panel admin berbeda: refresh token hanya di cookie `tarlink_rt` (HttpOnly),
   access token di `localStorage` agar seluruh tab berbagi satu salinan. Refresh
   diserialisasi lintas tab dengan `navigator.locks`; origin tanpa Web Locks
   memakai lease `localStorage` (TTL 15 dtk, menunggu maks 10 dtk) sebagai
   fallback. Tab yang kalah cepat memakai
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
| `reconcile-daily` | FR-131: sekali per hari WIB (setelah `recon_hour_wib`) merekonsiliasi kemarin untuk tiap provider yang punya `payments`/`webhook_events`; catch-up maksimal 7 hari bila worker sempat mati; idempoten, audit `reconciliation.run_daily` |
| `escalate-reports` | FR-123/124: laporan terbuka yang melewati SLA ditandai `escalated_at` + notifikasi `content_report_sla_breach` ke admin support/super (sekali per laporan/admin) |
| `booking-reminders` | FR-052: pengingat H-7/H-1/hari-H untuk booking `confirmed`/`in_progress` (tanggal WIB) ditulis ke `outbox` dengan dedupe `booking:<id>:reminder:<offset>` |
| `outbox` | memetakan event `booking.*` menjadi baris `notifications` (in-app) dan email transaksional (FR-051) |
| `cleanup-auth` | memangkas `sessions`/`otp_requests`/`login_attempts` yang kedaluwarsa |
| `cleanup-media` | menghapus unggahan yatim (>24 jam, tidak dirujuk `vendor_media`/vendor/paket) |

Semua job idempoten dan mencatat `processed / skipped / failed` di log.

### Notifikasi

**In-app**

- Tabel `notifications` (migrasi `018`): `user_id`, `type`, `title`, `body`,
  `payload`, `dedupe_key` unik, `read_at`.
- `runOutbox` memakai `NotificationSink`, bukan `LoggingMessageSink`. Penerima
  ditentukan dari `bookings.customer_id` dan `vendors.owner_user_id`.
- Idempoten: `dedupe_key = outbox:<message_id>:<user_id>`; sink yang di-retry
  tidak membuat baris ganda.
- Mobile `NotificationPoller` (`lib/core/notifications.dart`) mem-poll
  `/v1/notifications` tiap 20 detik selama sesi aktif dan menampilkan popup.

**Email keluar (FR-051, migrasi `028`)**

- Relay yang sama menjalankan `CompositeMessageSink([NotificationSink,
  EmailNotificationSink])`: in-app dulu, email kedua. Kegagalan satu kanal tidak
  membatalkan kanal lain; gabungan kegagalan dilempar supaya pesan outbox di-retry.
- Copy email berasal dari `planEmailNotification(eventType, payload)` — pembungkus
  `planNotification` yang sama, jadi kedua kanal tidak mungkin berbeda cerita.
  Event internal (`payment.*`, `payout.*`, `booking.released`) tidak beremail.
- Transport: `libs/platform/email` (`EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`).
  Tanpa URL, development mencatat log (tanpa isi pesan), produksi gagal tertutup.
  OTP email memakai transport yang sama sejak refactor ini.
- `notification_deliveries` menyimpan satu baris per
  `(channel, outbox_message_id, user_id)`. Klaim `INSERT ... ON CONFLICT` hanya
  berhasil untuk baris `failed` atau klaim `sending` yang lebih tua dari 10 menit,
  jadi crash worker tidak menghilangkan email dan retry tidak menggandakannya.
- Email hanya dikirim bila `users.email` terisi; akun yang dihapus (`status =
  'deleted'`) dilewati. Push FCM belum ada; pengingat H-7/H-1/hari-H (FR-052) dikirim
  lewat job `booking_reminders` ke `outbox` (in-app + email), bukan push.

## 8. Panel admin

Next.js App Router dengan dua grup rute: `(auth)` untuk login (`/login`, `/login/2fa`,
`/login/2fa/enroll`; FR-128), `(panel)` untuk
operasional: dashboard, booking, vendor, pelepasan dana (`release`), ledger, pembayaran,
sengketa, audit, pengaturan, wilayah (`regions`, FR-125), pengajuan vendor
(`applications`), moderasi media (`moderation`), laporan konten (`reports`, FR-123/FR-124),
payout (`payouts`), refund
(`refunds`), rekonsiliasi (`reconciliation`, FR-131: read-only + SLA/resolve fase 2),
dan kesiapan operasional (`ops`: agregat antrean lewat SLA/gagal kirim/macet).

Aturan: panel tidak menghitung uang sendiri; semua angka dari `GET /admin/*`.

Tampilan panel punya bahasa visual sendiri, terpisah dari aplikasi pelanggan
(ADR 0012 di vault): kertas hangat `#ECEBE6`, kartu putih `#FFFFFF` bergaris rambut
`#ECECEB`, sidebar hampir hitam `#171816`, aksi utama gelap `#15171A`, aksen kapur
`#C8F751` yang hanya dipakai sebagai isian (teks di atas kapur memakai `#17210A`),
Inter lewat `next/font`, dan `lucide-react` stroke 1.6. Token tinggal di
`apps/admin/tailwind.config.ts` + `apps/admin/app/globals.css`; halaman memakai kelas
semantik, bukan hex. Aplikasi pelanggan tetap Graphite Lime (ADR 0008).

Lane verifikasi panel:

- `npm run typecheck:admin` — kode produksi saja; `apps/admin/tsconfig.json`
  mengecualikan `**/*.test.ts` dan `test/**` supaya build tidak pernah menarik
  import test.
- `npm run typecheck:admin:test` — lane terpisah (`apps/admin/tsconfig.test.json`)
  untuk file test; `npm run test:admin` menjalankannya sebelum Vitest.
- `npm run test:admin` — Vitest Node (tanpa jsdom) untuk `**/*.test.ts` dan
  `**/*.test.tsx` di panel; `npm -w apps/admin test` menjalankan Vitest yang sama
  dari workspace (mengandalkan `vitest` yang di-hoist dari root), sedangkan lane
  typecheck test hanya ada di `npm run test:admin`.
- `npm run verify:admin` — header CSP (nonce per request, tanpa
  `'unsafe-inline'`/`'unsafe-eval'` di `script-src`, nonce berbeda antar request)
  + header keamanan dan hidrasi `/login` lewat Chrome headless (CDP, tanpa
  dependency); panel harus berjalan lebih dulu. Alur login + 2FA, viewer KTP
  blob, refresh dan logout lintas tab diuji manual di Chrome headless pada
  2026-11-07.

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
    moderation/   report_sheet (lapor/blokir), appeals_page (Banding konten)
    profile/      account_page, vendor_apply_page
    vendor/       vendor_shell, dashboard, calendar, earnings, profile, bookings,
                  booking_detail, manage_packages, manage_profile, package_edit,
                  media_picker, bank_account, vendor_theme, vendor_ui
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
| — | Rekonsiliasi (FR-131) read-only: temuan dicatat, **tidak** memposting jurnal; keputusan admin hanya mengisi `resolution`, bukan mengubah uang |

## 12. Deploy & operasi

Produksi berjalan sebagai satu host Docker Compose (`docker-compose.prod.yml`),
rincian langkahnya di `docs/DEPLOYMENT.md`.

```
internet → reverse proxy (TLS) → 127.0.0.1:3001 api
                              → 127.0.0.1:3002 panel
db (postgis/postgis:15-3.4) ← volume pgdata
api ── volume media + volume private
worker ── db + volume media (job cleanup_media)
migrate ── one-shot; api & worker menunggu `service_completed_successfully`
```

- Satu `Dockerfile` dengan empat target (`api`, `worker`, `admin`, `migrate`).
  Dependency produksi dipasang sekali (`npm ci --omit=dev`), lalu `dist/api`
  dan `dist/worker` disalin ke image masing-masing.
- Migrasi **tidak** dijalankan oleh API saat boot. Runner dikompilasi bersama
  API (`dist/api/scripts/migrate-cli.js`) sehingga image `migrate` memakai
  artefak yang sama tanpa devDeps; compose menjalankannya sebelum API naik.
- Port API/panel hanya di-bind ke loopback. `TRUST_PROXY=true` wajib supaya
  `@Ip()` membaca `X-Forwarded-For` (tanpa itu limiter per-IP memblokir semua
  klien sekaligus).
- `HEALTHCHECK` image API memanggil `/v1/health/ready` (bukan `/health`): process
  hidup tanpa DB tidak boleh dianggap siap menerima trafik.
- `NEXT_PUBLIC_*` dan `MEDIA_PUBLIC_BASE_URL` di-inline saat `next build`, jadi
  panel adalah artefak per-lingkungan: ganti domain = build ulang image.
- `npm run verify:prod -- --db` memeriksa konfigurasi **dan** kelengkapan
  migrasi sebelum deploy; `npm run verify:db` memeriksa invarian uang/ledger.
- Keterbatasan yang perlu diingat saat menambah replika: volume media lokal,
  limiter rate-limit in-memory per proses, dan worker tetap satu karena semua job
  dijaga advisory lock. Ringkasan antrean internal (`/ops`) **bukan** metrics/alerting
  eksternal: ia hanya membaca database saat halaman dibuka, tidak mengirim alarm saat
  tidak ada yang membukanya.

## 13. Batasan yang tersisa

Sudah diselesaikan: idempotensi `POST /bookings`, validasi `policy_version_id` +
snapshot, rate limit per IP, index trigram pencarian, guard `dev_code`, refresh token
panjang, pemangkasan sesi, penolakan e-wallet yang eksplisit, notifikasi in-app
(migrasi `018`), enkripsi NIK (migrasi `019`), pengecekan `sessions.jti` per request,
antrean pengajuan vendor + antrean refund di panel admin, job `cleanup_media`, dan
header CSP pada nota invoice, serta chat booking (migrasi `021`: REST riwayat/kirim,
WebSocket per booking, fan-out `LISTEN/NOTIFY`). Ditambahkan 2026-11-07: 2FA TOTP admin
(FR-128, migrasi `025`/`026`), cookie refresh `tarlink_rt` HttpOnly + CSP nonce per
request di panel, sengketa oleh pelanggan (FR-056), dan rekonsiliasi gateway ↔ ledger
fase 1 read-only (FR-131, migrasi `024`). Ditambahkan 2026-11-08: moderasi UGC
(FR-123/124/142, migrasi `027`), notifikasi keluar via email (FR-051, migrasi `028`),
dan tindak lanjut rekonsiliasi — SLA + keputusan admin + worker harian
(FR-131 fase 2, migrasi `029`), ringkasan kesiapan operasional
(`GET /admin/ops/alerts` + panel `/ops`), banding takedown (FR-124,
migrasi `031` + panel `/appeals`), serta bukti berkas banding privat (migrasi `033`,
API + panel + tombol unggah di mobile; JPG/PNG/WebP maks 5 MB), dan clawback
pasca-pencairan (FR-122, migrasi `034`; maker-checker, jurnal
`clawback_recognized`/`clawback_paid`, settlement `clawed_back`).

Yang masih terbuka (lihat [AGENTS.md § Batasan](../AGENTS.md#batasan-yang-diketahui)):
push FCM (FR-052 — pengingat H-7/H-1/hari-H sendiri sudah dikirim lewat email/in-app),
chat foto/lokasi dan penyaringan kontak (FR-135),
picker peta lokasi acara, UI check-in berbasis GPS, multi-vendor (FR-113), serta sisa
FR-131 (lane
`payout`/`refund` dan run terhadap data gateway nyata). SLA `due_at`, aksi resolve,
dan **worker harian** sudah ada (migrasi `029`, job `reconcile_daily`), tanpa
memposting jurnal. Provider WhatsApp/SMS
tidak dipakai (ADR 0011). Integrasi
charge + notifikasi + refund QRIS memakai Midtrans sandbox; endpoint check-in/no-show
basic sudah ada. Payout vendor + rekening terenkripsi sudah ada; integrasi Iris
tersedia di balik `PAYOUT_PROVIDER=iris`, tetapi pengujian live bergantung pada
kredensial dan saldo merchant Iris sandbox. Review/rating dan favorit sudah selesai
(014), moderasi media sudah selesai (016).
