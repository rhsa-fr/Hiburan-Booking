# AGENTS.md — aturan kerja di repositori Tarlink

Dokumen ini untuk **manusia dan agen AI** (Claude Code, Codex, Cursor, opencode, dll).
Baca ini sebelum mengubah kode. Isinya bukan saran gaya, melainkan kontrak yang sudah
dibayar mahal lewat bug.

## 1. Urutan baca

1. `README.md` — cara menjalankan.
2. `docs/ARCHITECTURE.md` — aliran data, ledger, auth.
3. `docs/API.md` — bentuk request/response.
4. `apps/mobile/DESIGN.md` — hanya kalau menyentuh UI pelanggan.
5. `docs/PRD-v1.1.md` — hanya kalau menyentuh aturan bisnis.
6. Vault `20-Decisions/` — ADR 0001–0018: tema, ledger, auth/2FA, payout/refund,
   chat/OTP, CSP, sengketa, rekonsiliasi, moderasi UGC, notifikasi email. Fitur yang
   menyentuh uang/auth/status tidak dianggap selesai sebelum ADR-nya ada.

## 2. Aturan yang tidak boleh dilanggar

### Durasi paket (ADR 0042)
- Form paket vendor memakai pilihan **Setengah hari (360) / 1 hari (600) /
  Full day (720) / Lainnya**, nilai tetap disimpan sebagai `duration_minutes`.
- Jangan menampilkan durasi paket dengan cara sendiri di fitur baru; pakai
  `packageDurationLabel()` di `lib/core/format.dart`.
- Paket lama yang durasinya bukan salah satu preset **tidak dibulatkan**; tampil
  literal ("3 jam"). Pembulatan hanya lewat migrasi yang disetujui pemilik.

### Uang
- Semua nilai uang = **integer rupiah** (`BIGINT`), tidak pernah float.
- Jurnal ledger **append-only**. Tidak ada `UPDATE`/`DELETE` pada `journal_entries`
  maupun `journal_lines`; koreksi dilakukan dengan jurnal balik.
- Debit dan kredit setiap jurnal harus seimbang. Test akan gagal kalau tidak.
- Pelepasan dana hanya boleh untuk booking `fully_paid` atau `partially_refunded`
  dan setelah jendela sengketa lewat.

### Status
Sumber kebenaran adalah enum PostgreSQL di `db/migrations/001_core.sql`.

- Siklus hidup: `requested → accepted → confirmed → in_progress → completed`,
  plus `countered`, `cancelled`, `rejected`, `expired`, `no_show`.
- Pembayaran booking: `unpaid → dp_paid → fully_paid`, plus `partially_refunded`,
  `refunded`.
- Settlement booking: `not_eligible`, `held`, `disputed`, `released`, `clawed_back`.
- Status baris `payments` (tagihan) terpisah dari status booking: `pending`, `paid`,
  `failed`, `expired`.
- Jangan menambah nilai status baru tanpa migrasi + pemetaan label di
  `apps/mobile/lib/core/widgets.dart` dan `apps/mobile/lib/features/booking/booking_support.dart`.

### Identitas & sesi
- Token akses membawa `jti`. Refresh **merotasi** sesi: token lama harus 401.
- Logout mencabut sesi berdasarkan `jti`, bukan sekadar menghapus token di klien.
- Jangan menambahkan login yang tidak didukung backend. Jalur yang **ada**:
  `POST /auth/login` (email + password), `POST /auth/otp/request` →
  `POST /auth/otp/verify` (**kode dikirim ke email**, ADR 0011), dan Login Google
  (ADR 0022). Nomor WhatsApp hanya data profil, bukan kanal OTP. Akun Google **baru**
  tidak langsung masuk: ia harus memverifikasi kode email lewat
  `POST /auth/register/verify` (ADR 0037).

### Data pelanggan
- Jangan merender data yang tidak ada di API (ulasan, jumlah respons fiktif,
  "terverifikasi"). Nilai yang null **dihilangkan**, bukan diisi angka contoh.
- Foto/avatar/banner vendor hanya dari `avatar_url`, `banner_url`, `photo_urls`, dan
  `video_url` yang dikirim API. Jangan menambahkan gambar stok di UI.
- Jangan menampilkan `Rp0`. Harga kosong → teks "Harga belum diisi".
- Kalender vendor bisa `stale`; tampilkan peringatan, jangan sembunyikan.

### Kontrol mati
Dilarang menambah tombol/tab yang tidak punya API: peta interaktif, voucher.
Favorit (`/v1/favorites`), notifikasi in-app (`/v1/notifications`), dan chat
(`/v1/bookings/:id/chat/messages` + `WS /v1/chat/ws`) sudah punya endpoint, jadi
boleh dipakai. Chat bersifat teks; foto/lokasi belum ada.
Filter kategori **boleh** karena `GET /categories` + query `category` sudah ada.
Komunikasi vendor = chat real-time in-app (ADR 0011); WhatsApp deep link hanya cadangan.

## 3. Batas kepemilikan file (penting untuk kerja paralel)

Bila beberapa agen bekerja bersamaan, **satu file satu penulis per gelombang**.

| Area | Pemilik |
|---|---|
| `package.json`, lockfile, `tsconfig*`, `vitest.config.ts` | Lead / manusia |
| `Dockerfile`, `docker-compose*.yml`, `.github/**`, `.dockerignore`, `.env*.example`, `scripts/preflight.mjs` | Lead / manusia |
| `db/migrations/**` | Lead / manusia |
| `libs/platform/**`, `libs/modules/**` (termasuk `vendor-portal`) | Manusia (perubahan menyentuh uang, status, media) |
| `apps/mobile/lib/app/theme.dart`, `lib/core/ui.dart` | **Beku** — perubahan harus lewat lead |
| `apps/mobile/lib/core/**` (selain `ui.dart`) | Lead |
| `apps/mobile/test/**`, `integration_test/**` | Lead |
| `apps/mobile/lib/features/**` | Boleh per fitur, satu agen per fitur |

Aturan tambahan:
- File bersama (`routes.dart`, `app.dart`) jangan diedit dua agen sekaligus.
- Kalau butuh helper baru, taruh di `lib/core/ui.dart` **lewat lead**, jangan bikin
  duplikat di dalam fitur.

## 4. Verifikasi wajib sebelum menyatakan selesai

Backend:

```bash
npm run typecheck          # 0 error
npm test                   # seluruh suite hijau (kecuali skip yang terdokumentasi)
npm run verify:db          # invarian DB
```

Panel:

```bash
npm run typecheck:admin      # 0 error (kode produksi)
npm run typecheck:admin:test # 0 error (file test; juga dijalankan test:admin)
npm run test:admin           # unit test panel (vitest)
npm run verify:admin         # header CSP + hidrasi /login (panel harus berjalan)
npm run build:admin          # build produksi
```

Mobile:

```bash
cd apps/mobile
flutter analyze            # "No issues found!"
flutter test               # 47 test
```

UI yang berubah wajib dilihat, bukan hanya lulus test. Cara termurah:

```bash
cd apps/mobile
flutter run -d web-server --web-port 8080 \
  --dart-define=API_BASE_URL=http://localhost:3001
# buka http://localhost:8080 di Chrome biasa (CORS diatur lewat CORS_ORIGINS)
```

Atau ambil screenshot otomatis 390×844 lewat `integration_test/screens_test.dart`.

**Larangan:** melaporkan "selesai" tanpa menjalankan perintah di atas, atau mengarang
output. "Tidak dijalankan" adalah jawaban yang sah; klaim palsu tidak.

Deploy (hanya bila menyentuh `Dockerfile`, `docker-compose.prod.yml`, `.github/**`,
atau `scripts/preflight.mjs`):

```bash
npm run verify:prod -- --env-file .env.prod --db   # 0 FAIL
docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet
docker build --target api .
docker build --target worker .
docker build --target admin .
```

Node dipatok **24** di dev, CI, dan image (`node:24-bookworm-slim`): `package-lock.json`
dibuat oleh npm 11, dan `node:22` membawa npm 10 yang menolak lock ini.

## 5. Konvensi kode

- TypeScript strict; tidak ada `any` baru tanpa alasan.
- Bahasa komentar: Inggris untuk kode, Indonesia untuk teks produk.
- Nama file: `kebab-case.ts`, `snake_case.dart`.
- API selalu di bawah prefix `/v1`; envelope error `{ error: { code, message } }`.
- Sebagian besar endpoint menulis payload di `{ data: ... }`. Pengecualian yang sudah
  beku: `GET /health`, katalog publik (`/vendors`, `/categories`, `/policies`), dan
  daftar berpaginasi (`GET /bookings`) yang mengembalikan objek halaman langsung.
- Pagination: query `page` (mulai 1), `page_size` (maks 100), respons
  `{ items, total, page, page_size }`.
- Format rupiah: `Rp1.500.000` (rapat) untuk kartu dan angka besar; `rupiah()` di
  `lib/core/format.dart` mengembalikan versi berspasi, `rupiahTight()` versi rapat.
- Jangan menambah dependency tanpa persetujuan. Mobile hanya: `http`,
  `flutter_secure_storage`, `qr_flutter`, `url_launcher`, plus `image_picker`
  (pengecualian ADR 0007 untuk upload media vendor).

## 6. Alur menambah fitur

**Endpoint baru**
1. DTO + validasi di `libs/modules/<domain>/src/dto.ts`.
2. Service memegang aturan bisnis; controller hanya memetakan HTTP.
3. Tulis test service (Vitest). Jalankan `npm test`.
4. Perbarui `docs/API.md`.

**Layar mobile baru**
1. Cek datanya ada di `docs/API.md`.
2. Pakai komponen `lib/core/ui.dart` (StageHeader, VendorCard, MoneyBlock,
   StickyActionBar, StatusPill, SegmentBar, InfoStrip).
3. Semua state: loading (skeleton), kosong, error + retry, dan stale bila relevan.
4. `flutter analyze` + `flutter test`, lalu screenshot 390×844.

**Migrasi DB**
1. Nomor urut berikutnya di `db/migrations` (terakhir `035_vendor_earnings_index.sql`, berikutnya `036`).
2. Idempoten bila memungkinkan; sediakan jalur koreksi ke depan, bukan `DROP` data.
3. Jalankan `npm run migrate:dry` sebelum `npm run migrate`.

## 7. Batasan yang diketahui

Sudah diperbaiki (jangan dikembalikan tanpa keputusan tertulis):

- `POST /bookings` **idempoten** (`Idempotency-Key` + `client_generated_id`).
- `policy_version_id` divalidasi dan dibekukan ke `booking_terms_snapshot`.
- Lokasi acara tidak lagi memakai koordinat vendor; `venue_location` opsional.
- Rate limit login/OTP per **IP** (selain per email).
- Pencarian vendor memakai index trigram (`pg_trgm`).
- `dev_code` OTP butuh `OTP_DEV_MODE=true` dan `NODE_ENV != production`.
- Refresh token panjang (30 hari) + rotasi + deteksi reuse; job `cleanup-auth`
  memangkas `sessions`, `otp_requests`, `login_attempts`, dan
  `admin_2fa_challenges` kedaluwarsa (retensi 7–30 hari).
- Rate limit pembuatan laporan: 10 laporan/jam/user (`SlidingWindowLimiter`
  in-memory di `libs/platform/rate-limit`; limiter refresh juga memakai modul ini).
  Percobaan berlebih dijawab `429 RATE_LIMITED`. Bukan pengganti otorisasi.
- Kesiapan layanan dipisah: `GET /v1/health` = liveness (selalu 200),
  `GET /v1/health/ready` = readiness (`SELECT 1`; 503 saat DB mati). `HEALTHCHECK`
  image API memakai yang readiness.
- Panel admin mengirim CSP enforced per request (nonce di `middleware.ts`, tanpa
  `'unsafe-inline'` di `script-src`, seluruh rute `force-dynamic`) +
  `X-Frame-Options: DENY`; `/auth/refresh`
  membatasi kegagalan per IP (in-memory per proses) dan cookie `tarlink_rt` yang
  rusak dihapus pada refresh/logout.
- E-wallet ditolak eksplisit (400), bukan menghasilkan VA palsu.
- Ganti metode pembayaran (`POST /payments/abandon`) mengakhiri charge di provider
  (`POST /v2/{order_id}/expire` untuk Midtrans) **sebelum** baris lokal jadi `failed`.
  Bila provider tidak bisa memastikan tagihan berakhir, tagihan tetap `pending`
  supaya tidak ada dua tagihan yang sama-sama bisa dibayar. Pembayaran telat untuk
  tagihan yang sudah dilepas tetap diterima bila tahap itu belum dibayar dan tidak
  ada pembayaran lain yang `paid`; tagihan pending lain untuk tahap yang sama
  ditandai `failed` (`SUPERSEDED_BY_LATE_PAYMENT`). `POST /payments/sync` juga
  menerapkan status `expired`/`failed` dari provider, bukan hanya `paid`.
- Payout vendor: `payouts`/`payout_items`, rekening terenkripsi AES-256-GCM, maker-checker
  dua endpoint, jurnal `payout_requested`/`payout_settled` + reversal saat provider gagal,
  dan worker `payout_reconcile`.
- Pelunasan online sisa 70% (`POST /v1/payments/settlement`, `GET /v1/payments/settlement/by-booking/:id`)
  lewat Midtrans QRIS/VA, terintegrasi ke status booking dan ledger.
- Ulasan & rating booking pelanggan (`POST /v1/bookings/:id/review`, `GET /v1/vendors/:id/reviews`, migrasi `014_reviews.sql`).
- Notifikasi in-app (migrasi `018`): worker `outbox` menulis `notifications`, mobile mem-poll
  `/v1/notifications` dan menampilkan popup. Menggantikan stub WA/push.
- Notifikasi keluar via email (FR-051, migrasi `028`): relay `outbox` menjalankan
  `NotificationSink` + `EmailNotificationSink` lewat `CompositeMessageSink`. Setiap
  perubahan status booking yang punya copy in-app juga dikirim ke email pelanggan/vendor
  (`planEmailNotification` di `libs/modules/notifications`), memakai transport bersama
  `libs/platform/email` (`EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`; tanpa URL di
  production transport gagal tertutup). `notification_deliveries` menyimpan klaim per
  `(channel, outbox_message_id, user_id)` sehingga retry relay tidak pernah mengirim email
  kedua; kegagalan provider menandai baris `failed` + pesan `outbox` di-retry, dan klaim
  `sending` yang lebih tua dari 10 menit boleh diambil alih. Gagal email **tidak**
  menggagalkan baris notifikasi in-app. Alamat email tidak pernah masuk log.
- Panel admin punya antrean pengajuan vendor (`/applications`) dan antrean refund
  (`/refunds`, `GET /v1/payments/refunds`); approve/reject tetap maker-checker.
- NIK vendor disimpan terenkripsi AES-256-GCM (`nik_ciphertext`, migrasi `019`), baris lama
  di-backfill saat dibaca. Access token kini dicek ke `sessions.jti` per request.
- Job `cleanup_media` menghapus file upload yatim (>24 jam, tanpa referensi) dan nota
  invoice mengirim header CSP `default-src 'none'`.
- Moderasi media vendor (FR-107/FR-140): unggahan masuk `vendor_media` berstatus `pending`,
  kolom publik hanya berubah setelah admin menyetujui (`GET/POST /admin/media/*`, migrasi `016`).
  Migrasi `015` mengosongkan seed foto stok Unsplash dan video contoh dari migrasi `009`.
- Refund maker-checker (FR-128/FR-133): refund > `REFUND_APPROVAL_THRESHOLD_IDR`
  berhenti di `requested`, disetujui admin lain, menolak self-approval, menyimpan
  `evidence_url`/`review_note`, dan statusnya dapat dibaca pelanggan.
- Refund manual (migrasi `036`) untuk pembayaran VA/Mandiri yang tidak bisa
  di-refund Midtrans: `POST /payments/:id/refund/manual` mewajibkan
  `transfer_ref`, menyimpan `is_manual`/`transferred_at`, memakai
  `fee_idr=0`/`fee_bearer='platform'`, dan memposting jurnal pengakuan +
  pencairan. Nominal di atas ambang tetap maker-checker; approve tidak memanggil
  provider. Panel `/payments` punya tombol **Refund manual**, dan `/ops`
  menampilkan webhook pembayaran gagal 24 jam.
- Hapus akun mandiri (FR-101): `DELETE /auth/me` menganonimkan PII, mencabut sesi +
  peran, mencatat `account_deletion_requests`, dan idempoten.
- Registrasi vendor mandiri (FR-002/FR-003): `vendor_applications`, upload KTP privat
  (`PRIVATE_UPLOAD_DIR`, bukan `/v1/media`), approval `admin_super` membuat vendor +
  peran `vendor_owner`; `GET /regions` untuk formulir (migrasi `017`).
- KTP dienkripsi AES-256-GCM sebelum ditulis (`KTP_ENCRYPTION_KEY`, wajib di
  production), permission 0600/0700, akses hanya `admin_super` dan dicatat di
  `audit_logs`; reject/hapus akun menghapus file dan referensinya.
- Consent ToS/Privasi (FR-103, migrasi `022`): `user_consents` append-only per versi;
  registrasi wajib mengirim versi aktif (`tos`/`privacy`) dan mobile menampilkan
  versinya. Version basi ditolak, bukan disimpan diam-diam.
- Toggle wilayah (FR-125): `GET/PATCH /admin/regions`, panel `/regions`; wilayah
  nonaktif hilang dari `GET /regions`, katalog, favorit, dan formulir vendor baru.
- Sengketa oleh pelanggan (FR-056): `POST/GET /v1/bookings/:id/disputes`; aktor ditentukan
  dari kepemilikan booking (`resolveDisputeActor`), bukan urutan peran. Jendela 7 hari
  pra-rilis (S-04) dan 30 hari pasca-rilis (S-08); jalur tulis hanya `customer` dan
  `vendor_owner` (owner), jalur baca juga anggota vendor aktif.
- Rekonsiliasi gateway ↔ ledger (FR-131) fase 1 **read-only**, migrasi `024`:
  matcher murni + repository batas hari WIB, run idempoten per
  `(provider, scope, report_date)`, endpoint `POST/GET /v1/admin/reconciliation/runs`,
  panel `/reconciliation`. **Tidak** memposting jurnal dan tidak mengubah
  `payments`/`payouts`. Fase 2 (migrasi `029`): setiap temuan mendapat `due_at`
  (run selesai + `recon_sla_hours`, default 24 jam) dan dapat diputuskan admin
  finance/super lewat `POST /v1/admin/reconciliation/diffs/:id/resolve`
  (`accepted`/`ignored`/`referred`/`corrected`, catatan wajib 5-1000 karakter,
  satu baris `audit_logs`). Keputusan bersifat final (resolve kedua `409`), baris
  `matched` tidak boleh diputuskan, dan modul tetap tidak menyentuh uang.
  Worker `reconcile_daily` (slot `lockKey 74110`) menjalankan kemarin WIB sekali
  per hari setelah `recon_hour_wib` selama `recon_enabled=true`; bila worker
  sempat mati, tick berikutnya mengejar tanggal yang terlewat (maksimal 7 hari,
  dibatasi agar satu tick tidak berubah menjadi backfill panjang). Provider
  diambil dari `payments`/`webhook_events`, idempoten lewat UNIQUE run, dan
  auditnya `reconciliation.run_daily` tanpa aktor. Kegagalan satu provider tidak
  menghentikan provider lain.
- Moderasi UGC (FR-123/FR-124/FR-142), migrasi `027`: tabel `content_reports`
  (target `vendor`/`review`/`chat_message`/`vendor_media`, SLA 24 jam atau 72 jam untuk
  `copyright`, keputusan wajib bercatatan dan masuk `audit_logs`) dan `user_blocks`.
  Endpoint pengguna `POST/GET /v1/reports` + `POST/DELETE/GET /v1/blocks`; antrean admin
  `GET /v1/admin/reports` + `POST /v1/admin/reports/:id/resolve` (support/super, finance
  hanya baca) dan panel `/reports`. Takedown **menyembunyikan**, tidak menghapus:
  `reviews.hidden_at`/`chat_messages.hidden_at`, media → `vendor_media.status='rejected'`
  + kolom publik dibersihkan. Rating vendor dikoreksi trigger saat ulasan
  disembunyikan/dipulihkan. Penangguhan vendor tetap lewat jalur `admin_super` yang ada,
  bukan aksi resolve. Pesan dari pengguna yang diblokir tidak muncul di riwayat **dan**
  tidak dikirim ke socket WebSocket. Pelapor menerima notifikasi in-app
  `content_report_resolved` saat laporan diputuskan (catatan moderator tetap internal),
  dan worker `escalate_reports` (migrasi `030`, slot `lockKey 74111`) menandai
  `escalated_at` + mengirim `content_report_sla_breach` ke semua admin support/super
  sekali per laporan saat SLA lewat. Eskalasi tidak mengubah status laporan.
- Banding takedown (FR-124, migrasi `031`): pemilik konten (ulasan/pesan chat/media)
  mengajukan `POST /v1/reports/:id/appeal` maksimal 30 hari setelah keputusan, satu
  banding per laporan, alasan 20-2000 karakter dan `evidence_url` opsional. Admin
  support/super memutuskan lewat `GET /v1/admin/report-appeals` +
  `POST /v1/admin/report-appeals/:id/resolve` (panel `/appeals`), catatan wajib
  10-1000 karakter, satu keputusan final, audit `content_report.appeal_*`, dan
  notifikasi in-app ke pemilik konten. Menerima banding memulihkan
  `reviews.hidden_at`/`chat_messages.hidden_at`; media kembali ke antrean
  `pending` karena kolom publiknya sudah dibersihkan saat takedown. Laporan asal
  **tidak** diubah. Layar mobile `Banding konten` (Profil → `Routes.appeals`) memakai
  `GET /v1/reports/against-me` + `POST /v1/reports/:id/appeal`. Bukti **berkas** juga
  sudah ada (migrasi `033`): `POST/GET /v1/reports/:id/appeal/evidence` untuk pemilik
  (hanya saat `pending`) dan `GET /v1/admin/report-appeals/:id/evidence` untuk admin,
  disimpan terenkripsi di `PRIVATE_UPLOAD_DIR`, tipe dari magic bytes, maks 5 MB, dan
  setiap pembacaan admin diaudit. Mobile punya tombol **Lampirkan bukti berkas**
  di layar `Banding konten` (Profil → `Routes.appeals`) untuk banding `pending`;
  panel sudah punya tombol "Lihat berkas bukti".
- Pengingat acara (FR-052, migrasi `032`): worker `booking_reminders` (`lockKey 74112`)
  memilih booking `confirmed`/`in_progress` yang `events.start_date`-nya sama dengan
  H-7, H-1, atau hari-H (tanggal WIB, bukan UTC) lalu menulis satu `outbox_messages`
  dengan dedupe `booking:<id>:reminder:<offset>`. Relay `outbox` yang sudah ada
  mengirim in-app **dan** email dengan copy yang sama (`booking.reminder_7d`,
  `booking.reminder_1d`, `booking.reminder_day`). Tidak ada tabel baru; tick ganda
  tidak pernah mengirim pengingat yang sama dua kali. Push FCM belum ada, jadi
  target PRD "push ≤60 detik" tetap belum terpenuhi.
- Ringkasan kesiapan operasional (`GET /v1/admin/ops/alerts`, panel `/ops` + banner
  dashboard): agregat read-only untuk laporan konten, sengketa, temuan/run rekonsiliasi,
  payout macet, outbox gagal, email gagal 24 jam, dan webhook pembayaran gagal 24 jam.
  Semua peran admin boleh membaca;
  tidak ada PII dan tidak ada mutasi. Ambang ada di SQL (`ops.repository.ts`), label di
  `ops.alerts.ts` (unit test murni); dead letter/outbox yang menetap tetap perlu
  investigasi manual.

Invarian baru (2026-11-23, jangan dikembalikan tanpa ADR):

- **Kunci tanggal saat request** (ADR 0043): `POST /bookings` memblokir slot
  selama 24 jam (`blocking: true`, `holdExpiresAt = respond_deadline`). Pelanggan
  lain menerima `409 SLOT_UNAVAILABLE`. Kunci lepas saat tolak/batal/kedaluwarsa
  atau hold lewat waktu. Jangan mengembalikan ke non-blocking.
- **Satu tanggal satu booking** (ADR 0044): hold/booking hidup di sesi mana pun
  (`day`/`night`/`full`) mengunci seluruh tanggal. `listAvailability` menurunkan
  status semua sesi; `reserve` memakai advisory lock per `(vendor, tanggal)` dan
  menolak booking lain di tanggal yang sama; filter tanggal katalog juga
  menyembunyikan tanggal yang sudah ditempati. Blokir vendor tetap per sesi
  kecuali blokir `full`.
- **Timeline booking kanonik 4 langkah**: Booking dibuat → Vendor menerima →
  Bayar DP/DP diterima → Acara. Judul "DP diterima" hanya boleh muncul saat
  `payment_status` sudah lunas DP; jangan hardcode. Label status dipusatkan di
  `booking_support.dart` (beranda, daftar, status memakai sumber yang sama).
- **Setelah DP masuk**: tampilkan panel "Pembayaran DP diterima" (nominal, kode,
  tanggal terkunci) yang harus ditutup pengguna; metode pelunasan **tidak pernah**
  terbuka otomatis dan baru dirender setelah "Bayar pelunasan" ditekan.
- **Pelunasan H-7** (ADR 0038): `GET /bookings/:id` mengirim
  `settlement_available_at` (00:00 WIB, tanggal acara − 7); `POST /payments/settlement`
  menolak `409` sebelum itu. Klien tidak menghitung H-7 sendiri; `null` = terbuka.
  `no_show` tidak boleh menampilkan kartu pelunasan.
- **Vendor dual role** (ADR 0039): setiap `vendor_owner`/`vendor_member` wajib punya
  peran `customer`; onboarding approval dan `POST /admin/vendors` menulis keduanya,
  migrasi `040` membackfill. Pemilik vendor tidak boleh mengulas vendornya sendiri.
- **Chat read receipt** (ADR 0040): `chat_messages.read_at` hanya boleh diisi sekali
  (trigger), endpoint `POST .../chat/messages/read`, notifikasi `read` dibatch 100 id,
  admin tidak menandai dibaca. Mobile: centang satu = terkirim, dua = dibaca.
- **Google sign-up** (ADR 0037): akun Google baru tidak langsung mendapat sesi; data
  diparkir di `otp_requests` dan sesi terbit setelah `POST /auth/register/verify`.
- **Update APK in-app** (ADR 0041): Android saja, manifest statis di Supabase Storage,
  verifikasi SHA-256 sebelum intent install, nol dependency baru. Rilis tetap lewat CI;
  `APP_UPDATE_MANIFEST_URL` kosong = fitur mati.
- **Kepadatan checkout**: judul seksi `dense` 15,5; field 42–64; baris metode 46;
  tombol aksi `dense` 46 (tap target 48). Jangan memakai skala hero di dalam form.

Masih terbuka:

- Tidak ada emulator Android/HP fisik; bukti APK hanya build sukses.
- Detail vendor sempat kosong pada screenshot E2E otomatis — assertion ukuran body
  sudah ditambahkan; cek manual screenshot sebelum menyatakan selesai.
- Rekonsiliasi fase 2: SLA + aksi resolve + **worker harian** sudah ada (migrasi
  `029`, job `reconcile_daily`). Yang belum: lane `payout`/`refund` dan run
  terhadap data gateway nyata (sumber masih `webhook_events`).
- Multi-vendor (FR-113) hanya kolom `events.parent_event_id` tanpa pemakaian TypeScript.
- Clawback pasca-pencairan (FR-122, migrasi `034`): klaim maksimal 30 hari setelah
  `released_at`, hanya bila payout sudah `paid`; pengajuan dan persetujuan wajib
  admin berbeda (`dispute_clawbacks`, `403` bila menyetujui sendiri). Menyetujui
  memposting `clawback_recognized` + `clawback_paid`, mengubah settlement ke
  `clawed_back`, menutup sengketa `resolution = 'clawback'`, dan meninggalkan
  `vendor_payable` negatif yang otomatis memotong payout berikutnya. Panel
  `/disputes` punya opsi ajukan + tombol Setujui/Tolak.
- Ekspor pendapatan vendor (FR-126, migrasi `035`): `GET /v1/vendor/earnings/export`
  mengirim CSV (default bulan berjalan WIB, maks 366 hari/5.000 baris) dengan kolom
  GMV, komisi, biaya layanan, pendapatan vendor, clawback, pencairan, dan baris
  `TOTAL`. Sel uang dibaca dari jurnal `release` (`2100`/`4100`/`4110`/`2120`) dan
  `clawback_recognized`, bukan dihitung ulang dari kolom booking, sehingga total
  cocok dengan ledger. `format=json` memberi pratinjau + CSV untuk mobile, yang
  menyalin isi CSV lewat papan klip (belum ada pemilih berkas di allowlist mobile).
- Moderasi UGC (FR-123/124/142) sudah ada, termasuk notifikasi pelapor, eskalasi
  SLA (migrasi `030`), banding takedown (migrasi `031`, panel `/appeals` + layar
  mobile `Banding konten`), dan bukti berkas privat (migrasi `033`, terenkripsi,
  endpoint pemilik + admin, baca admin diaudit, unggah dari mobile dan lihat dari
  panel). Pelapor belum bisa melihat laporan orang lain (memang disengaja), dan
  auto-suspend pelanggaran berulang tetap belum dibuat.
- 2FA admin sudah ada (FR-128, migrasi `025`+`026`): TOTP terenkripsi, backup code,
  reset `admin_super`. Panel memakai cookie `tarlink_rt` HttpOnly untuk refresh token;
  access token tetap 15 menit dan disegarkan otomatis. `TOTP_ENCRYPTION_KEY` wajib di
  production, tanpa itu 2FA gagal tertutup.
- Teks `tos`/`privacy` di `policy_versions` masih placeholder `{"status":"draft"}`;
  jangan mengarang pasal. Registrasi email **dan** sign-up Google pertama kali sudah
  mencatat consent; akun Google lama tidak diminta ulang.
- Provider WhatsApp/SMS tidak dipakai (diganti chat real-time in-app, ADR 0011).
  Notifikasi keluar saat ini **email** (FR-051, migrasi `028`) dan pengingat
  H-7/H-1/hari-H (FR-052, migrasi `032`, job `booking_reminders`) sudah dikirim lewat
  in-app + email. Yang belum: push FCM, jadi target PRD "push ≤60 detik" belum
  terpenuhi penuh — email berangkat dari tick worker (default 15 detik), bukan push
  instan.
  Notifikasi in-app tetap ada (worker `outbox` → tabel `notifications`, popup di mobile).
  Chat teks in-app sudah ada (migrasi `021`,
  `GET/POST /v1/bookings/:id/chat/messages`, `WS /v1/chat/ws`); foto/lokasi dan
  penyaringan kontak FR-135 belum ada. Picker peta dan UI check-in berbasis GPS
  belum ada. Charge/refund QRIS memakai Midtrans sandbox; endpoint check-in/no-show
  basic sudah ada.
- Integrasi Iris (`PAYOUT_PROVIDER=iris`) belum diuji live: butuh `IRIS_API_KEY` dan saldo
  merchant Iris sandbox. Jalur `PAYOUT_PROVIDER=local` sudah dipakai test dan worker.
  Tanpa `BANK_ACCOUNT_ENCRYPTION_KEY`, vendor tidak bisa menyimpan rekening.

## 8. Git

- Jangan commit/push tanpa diminta.
- Satu commit = satu perubahan bermakna; pesan bahasa Indonesia, ringkas.
- Jangan pernah `git reset --hard` atau `git checkout --` pada file yang bukan milikmu.
- `.env`, `dist/`, `.next`, `e2e_*.log`, dan screenshot tidak masuk repo.

## 9. Saat ragu

Berhenti dan tulis pertanyaan, jangan menebak pada hal yang menyentuh:
uang, status booking, autentikasi, migrasi DB, atau data pelanggan.
