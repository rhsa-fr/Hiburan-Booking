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

## 2. Aturan yang tidak boleh dilanggar

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
- Jangan menambahkan login yang tidak didukung backend. Dua jalur yang **ada**:
  `POST /auth/login` (email + password) dan `POST /auth/otp/request` →
  `POST /auth/otp/verify` (**kode dikirim ke email**, ADR 0011). Nomor WhatsApp hanya
  data profil, bukan kanal OTP. Login Google **tidak** ditampilkan di mobile.

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
flutter test               # 27 test
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
1. Nomor urut berikutnya di `db/migrations` (terakhir `023`, berikutnya `024`).
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
- Refresh token panjang (30 hari) + rotasi + deteksi reuse; job `cleanup-auth`.
- Panel admin mengirim CSP enforced + `X-Frame-Options: DENY`; `/auth/refresh`
  membatasi kegagalan per IP (in-memory per proses) dan cookie `tarlink_rt` yang
  rusak dihapus pada refresh/logout.
- E-wallet ditolak eksplisit (400), bukan menghasilkan VA palsu.
- Payout vendor: `payouts`/`payout_items`, rekening terenkripsi AES-256-GCM, maker-checker
  dua endpoint, jurnal `payout_requested`/`payout_settled` + reversal saat provider gagal,
  dan worker `payout_reconcile`.
- Pelunasan online sisa 70% (`POST /v1/payments/settlement`, `GET /v1/payments/settlement/by-booking/:id`)
  lewat Midtrans QRIS/VA, terintegrasi ke status booking dan ledger.
- Ulasan & rating booking pelanggan (`POST /v1/bookings/:id/review`, `GET /v1/vendors/:id/reviews`, migrasi `014_reviews.sql`).
- Notifikasi in-app (migrasi `018`): worker `outbox` menulis `notifications`, mobile mem-poll
  `/v1/notifications` dan menampilkan popup. Menggantikan stub WA/push.
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

Masih terbuka:

- Tidak ada emulator Android/HP fisik; bukti APK hanya build sukses.
- Detail vendor sempat kosong pada screenshot E2E otomatis — assertion ukuran body
  sudah ditambahkan; cek manual screenshot sebelum menyatakan selesai.
- 2FA admin sudah ada (FR-128, migrasi `025`+`026`): TOTP terenkripsi, backup code,
  reset `admin_super`. Panel memakai cookie `tarlink_rt` HttpOnly untuk refresh token;
  access token tetap 15 menit dan disegarkan otomatis. `TOTP_ENCRYPTION_KEY` wajib di
  production, tanpa itu 2FA gagal tertutup.
- Teks `tos`/`privacy` di `policy_versions` masih placeholder `{"status":"draft"}`;
  jangan mengarang pasal. Registrasi email **dan** sign-up Google pertama kali sudah
  mencatat consent; akun Google lama tidak diminta ulang.
- Provider WhatsApp/SMS tidak dipakai (diganti chat real-time in-app, ADR 0011);
  push notification belum ada: notifikasi saat ini in-app (worker `outbox` → tabel
  `notifications`, popup di mobile). Chat teks in-app sudah ada (migrasi `021`,
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
