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
| `otp_requests` + `login_attempts` | OTP WhatsApp dan kuota login/OTP per email/phone/IP |
| `regions` | referensi wilayah (kode, nama, level) |
| `vendors` + `vendor_members` | profil vendor, wilayah, harga mulai, `min_dp_bp`, media |
| `categories` + `vendor_categories` | kategori referensi; satu vendor multi-kategori, satu primer |
| `favorites` | favorit pelanggan (skema disiapkan; endpoint menyusul) |
| `packages` + `package_addons` + `package_price_rules` | paket, add-on, aturan harga |
| `calendar_slots` | ketersediaan per tanggal + sesi, `updated_at` untuk deteksi `stale` |
| `events` | detail acara (judul, jenis, alamat, tanggal, tamu) |
| `bookings` | pesanan: kode `BK-YYMMDD-XXXX`, tiga sumbu status, snapshot harga/istilah |
| `booking_slots` + `booking_addons` | tanggal/sesi dan add-on yang dikunci booking |
| `booking_status_history` | jejak audit perubahan status |
| `payments` + `refunds` | tagihan DP/pelunasan, instruksi QRIS/VA, refund |
| `journal_entries` + `journal_lines` | ledger double-entry, **append-only** |
| `chart_of_accounts` | daftar akun ledger dan tipe normalnya |
| `disputes` | sengketa dan resolusinya |
| `policy_versions` | teks kebijakan berversi (`code`, `version`, `body`) |
| `outbox_messages` | antrean event untuk worker |
| `audit_logs` | aksi admin/operator |
| `idempotency_keys` | hasil request idempoten (`POST /bookings`, `POST /payments/dp`) |

Settlement tidak punya tabel sendiri: statusnya hidup di `bookings.settlement_status`
(`not_eligible`, `held`, `disputed`, `released`, `clawed_back`) plus `released_at`.
Pelunasan manual dicatat sebagai baris `payments` berjenis `settlement`; migrasi 007
menjaga hanya satu baris `pending`/`paid` per booking.

Migrasi: `db/migrations/001_core.sql` … `012_catalog_trgm.sql`. Migrasi 002 menambah
add-on dan snapshot istilah, 003 auth, 004 password admin + `login_attempts`, 005
Google, 006 metode pembayaran manual, 007 keunikan pelunasan, 008 kategori katalog +
tabel favorit, 009 kolom media vendor/paket, 010 guard idempotensi booking
(`client_generated_id`), 011 refresh token + index rate limit IP, 012 index trigram
pencarian vendor. Nomor berikutnya: `013`.

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

1. `POST /auth/login` (email + password), `POST /auth/register`, atau OTP WhatsApp
   (`POST /auth/otp/request` → `POST /auth/otp/verify`). Mobile menampilkan dua tab:
   Akun Email dan WhatsApp / SMS. Login Google tersedia di API tetapi tidak dipakai mobile.
2. Server membuat baris `sessions` dengan `jti` + refresh token opaque (disimpan
   sebagai `refresh_token_hash`). Respons login berisi `access_token` (15 menit) dan
   `refresh_token` (30 hari, `REFRESH_TTL_DAYS`).
3. `POST /auth/refresh` **merotasi**: baris lama dicabut (`rotated_at`), baris baru
   dibuat dalam `family_id` yang sama. Refresh token lama → 401; memakainya lagi
   dianggap reuse dan mencabut seluruh family. Path Bearer lama tetap ada untuk admin.
4. `POST /auth/logout` mencabut sesi berdasarkan refresh token atau `jti`.
5. Klien (`ApiClient` Flutter) menyimpan access + refresh token di
   `flutter_secure_storage`; cold start memakai refresh token walau access token
   sudah kedaluwarsa, lalu refresh-on-401 untuk request lain.
6. Kuota login/OTP dicek per email/phone **dan** per IP (`login_attempts`,
   `otp_requests.requester_ip`); `TRUST_PROXY=true` diperlukan di belakang proxy.
   OTP `dev_code` hanya keluar bila `NODE_ENV != production` dan `OTP_DEV_MODE=true`.

## 7. Worker

Poller PostgreSQL, interval pendek, tanpa broker.

| Job | Fungsi |
|---|---|
| `expire-holds` | melepas hold kalender yang kedaluwarsa |
| `expire-unpaid` | menandai booking `unpaid` yang lewat batas sebagai `expired` |
| `auto-complete` | menutup acara yang sudah lewat |
| `auto-release` | melepas dana ke vendor setelah jendela sengketa |
| `outbox` | mengirim event `booking.*` keluar |
| `cleanup-auth` | memangkas `sessions`/`otp_requests`/`login_attempts` yang kedaluwarsa |

Semua job idempoten dan mencatat `processed / skipped / failed` di log.

## 8. Panel admin

Next.js App Router dengan dua grup rute: `(auth)` untuk login, `(panel)` untuk
operasional: dashboard, booking, vendor, antrean pelepasan dana, ledger, pembayaran,
sengketa, audit, operator, pengaturan.

Aturan: panel tidak menghitung uang sendiri; semua angka dari `GET /admin/*`.

## 9. Aplikasi Flutter (pelanggan + portal vendor)

```
apps/mobile/lib/
  app/            app.dart (shell pelanggan 4 tab), routes.dart, theme.dart
  core/           api_client.dart, api_exception.dart, session.dart, models.dart,
                  format.dart, ui.dart (komponen bersama), widgets.dart (state UI)
  features/
    auth/         welcome_page, login_page, register_page, auth_support
    discovery/    home_page (Beranda), browse_page (Jelajah), vendor_page
    booking/      create_page, list_page, status_page, booking_support
    profile/      account_page
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

Pembayaran diverifikasi lewat webhook `POST /webhooks/pjp` dengan HMAC-SHA256
`sha256(timestamp + "." + rawBody)`, header `x-pjp-signature` dan `x-pjp-timestamp`,
toleransi 300 detik. Event yang diproses: `payment.paid`.

## 11. Keputusan arsitektur yang mengikat

| Kode | Keputusan |
|---|---|
| D-01 | Dana pelanggan ditahan PJP berizin, bukan rekening platform |
| D-17 | Komisi bertingkat dengan lantai dan cap (lihat §5) |
| D-18 | DP 24 jam; 48 jam untuk nilai ≥ Rp10 juta |
| — | Ledger append-only, uang integer rupiah |
| — | Settlement disimpan di `bookings.settlement_status`, bukan tabel terpisah |
| — | Worker polling DB, tanpa Redis |
| — | Mobile tanpa dependency berat; WhatsApp deep link, bukan chat in-app |

## 12. Batasan yang tersisa

Sudah diselesaikan: idempotensi `POST /bookings`, validasi `policy_version_id` +
snapshot, rate limit per IP, index trigram pencarian, guard `dev_code`, refresh token
panjang, pemangkasan sesi, dan penolakan e-wallet yang eksplisit.

Yang masih terbuka (lihat [AGENTS.md § Batasan](../AGENTS.md#batasan-yang-diketahui)):
gateway PJP nyata, provider WhatsApp/SMS, review/rating, picker peta lokasi acara,
`checkin_location`, dan token admin HttpOnly.
