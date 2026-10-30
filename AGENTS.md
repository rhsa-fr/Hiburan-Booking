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
  `POST /auth/otp/verify` (nomor WhatsApp). Nomor WhatsApp hanya dikumpulkan saat daftar.
  Login Google **tidak** ditampilkan di mobile.

### Data pelanggan
- Jangan merender data yang tidak ada di API (ulasan, jumlah respons fiktif,
  "terverifikasi"). Nilai yang null **dihilangkan**, bukan diisi angka contoh.
- Foto/avatar/banner vendor hanya dari `avatar_url`, `banner_url`, `photo_urls`, dan
  `video_url` yang dikirim API. Jangan menambahkan gambar stok di UI.
- Jangan menampilkan `Rp0`. Harga kosong → teks "Harga belum diisi".
- Kalender vendor bisa `stale`; tampilkan peringatan, jangan sembunyikan.

### Kontrol mati
Dilarang menambah tombol/tab yang tidak punya API: chat in-app, notifikasi in-app,
favorit (baru skema, belum ada endpoint), peta interaktif, voucher.
Filter kategori **boleh** karena `GET /categories` + query `category` sudah ada.
Komunikasi vendor = WhatsApp deep link.

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
1. Nomor urut berikutnya di `db/migrations` (terakhir `012`, berikutnya `013`).
2. Idempoten bila memungkinkan; sediakan jalur koreksi ke depan, bukan `DROP` data.
3. Jalankan `npm run migrate:dry` sebelum `npm run migrate`.

## 7. Batasan yang diketahui

Sudah diperbaiki (jangan dikembalikan tanpa keputusan tertulis):

- `POST /bookings` **idempoten** (`Idempotency-Key` + `client_generated_id`).
- `policy_version_id` divalidasi dan dibekukan ke `booking_terms_snapshot`.
- Lokasi acara tidak lagi memakai koordinat vendor; `venue_location` opsional.
- Rate limit login/OTP per **IP** (selain per email/phone).
- Pencarian vendor memakai index trigram (`pg_trgm`).
- `dev_code` OTP butuh `OTP_DEV_MODE=true` dan `NODE_ENV != production`.
- Refresh token panjang (30 hari) + rotasi + deteksi reuse; job `cleanup-auth`.
- E-wallet ditolak eksplisit (400), bukan menghasilkan VA palsu.

Masih terbuka:

- Tidak ada emulator Android/HP fisik; bukti APK hanya build sukses.
- Detail vendor sempat kosong pada screenshot E2E otomatis — assertion ukuran body
  sudah ditambahkan; cek manual screenshot sebelum menyatakan selesai.
- Gateway PJP nyata, provider WhatsApp/SMS, review/rating, picker peta, dan
  `checkin_location` belum ada.

## 8. Git

- Jangan commit/push tanpa diminta.
- Satu commit = satu perubahan bermakna; pesan bahasa Indonesia, ringkas.
- Jangan pernah `git reset --hard` atau `git checkout --` pada file yang bukan milikmu.
- `.env`, `dist/`, `.next`, `e2e_*.log`, dan screenshot tidak masuk repo.

## 9. Saat ragu

Berhenti dan tulis pertanyaan, jangan menebak pada hal yang menyentuh:
uang, status booking, autentikasi, migrasi DB, atau data pelanggan.
