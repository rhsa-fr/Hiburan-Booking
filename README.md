# Tarlink — Booking Hiburan Pantura

Marketplace booking hiburan panggung (tarling, organ tunggal, wayang, MC, tenda/sound)
untuk wilayah Pantura. Pelanggan memilih paket dan jadwal, membayar DP, vendor menerima
booking, dan dana diteruskan ke vendor setelah acara selesai + jendela sengketa tutup.

Repositori ini berisi **API**, **panel admin**, **worker**, **library domain**, dan
**aplikasi Flutter pelanggan + portal vendor**.

## Status

| Bagian | Status | Bukti |
|---|---|---|
| `apps/api` — NestJS `/v1` | Berjalan | `GET /v1/health` → 200 |
| `apps/admin` — Next.js | Berjalan | `http://localhost:3002/login` |
| `apps/worker` — poller PostgreSQL | Berjalan | log `tick=done` tiap interval |
| `apps/mobile` — Flutter pelanggan | 49 widget test lulus, `flutter analyze` bersih | `cd apps/mobile && flutter test` |
| `apps/mobile` — portal vendor | dashboard, kalender, saldo, profil, pesanan, paket, media, rekening | login akun `vendor_owner` |
| Payout vendor + rekening | `payouts`/`payout_items`, rekening terenkripsi, maker-checker, worker rekonsiliasi | `PAYOUT_PROVIDER=local` (default) |
| Chat booking (FR-050) | REST riwayat/kirim + WebSocket per booking, izin per relasi booking | `GET/POST /v1/bookings/:id/chat/messages`, `WS /v1/chat/ws` |
| Notifikasi keluar (FR-051) | Email transaksional untuk setiap perubahan status booking, dikirim relay `outbox`; idempoten per (pesan, penerima), retry otomatis dengan backoff | migrasi `028`; `EMAIL_API_URL`; `notification_deliveries` |
| Moderasi UGC (FR-123/124/142) | Lapor konten ≤2 ketukan, tiket otomatis + SLA 24 jam (72 jam untuk hak cipta), takedown menyembunyikan tanpa menghapus, blokir pengguna; pelapor diberi notifikasi saat laporan diputuskan; banding pemilik konten (maks. 30 hari) dengan antrean panel `/appeals`, termasuk **bukti berkas privat** (JPG/PNG/WebP ≤5 MB, terenkripsi, hanya pemilik + admin); worker `escalate_reports` memberi tahu admin bila SLA lewat | migrasi `027`+`030`+`031`+`033`; panel `/reports`, `/appeals`; `POST /v1/reports`, `POST /v1/reports/:id/appeal/evidence` |
| 2FA admin (FR-128) | TOTP terenkripsi + 10 backup code, challenge sekali pakai, gate di tiga jalur login | migrasi `025`+`026`; alur di `docs/API.md` |
| Sengketa oleh pelanggan (FR-056) | `POST/GET /v1/bookings/:id/disputes`, jendela 7 hari pra-rilis / 30 hari pasca-rilis | `libs/modules/booking`, migrasi tidak perlu (memakai transisi S-04/S-08) |
| Ekspor pendapatan vendor (FR-126) | CSV bulanan dari jurnal `release` + `clawback_recognized` (GMV, komisi, biaya layanan, pendapatan, clawback, pencairan) dengan baris TOTAL; default bulan berjalan WIB, maks 366 hari/5.000 baris; mobile menampilkan pratinjau + salin CSV | `GET /v1/vendor/earnings/export`; migrasi `035` |
| Rekonsiliasi (FR-131) | Fase 1 **read-only** gateway ↔ ledger; fase 2: SLA per temuan + keputusan admin (`accepted`/`ignored`/`referred`/`corrected`) dengan audit; **worker harian** `reconcile_daily` (setelah `recon_hour_wib`, default 07:00 WIB) dengan catch-up maksimal 7 hari | migrasi `024`+`029`; panel `/reconciliation` |
| Consent ToS + Privasi (FR-103) | `user_consents` append-only per versi; register wajib mengirim versi aktif | `POST /v1/auth/register`, `GET /v1/policies/:code` |
| Toggle wilayah (FR-125) | Wilayah nonaktif hilang dari katalog & formulir vendor; panel `/regions` | `GET/PATCH /v1/admin/regions` |
| Ledger double-entry | 1443 test lulus (1336 backend + 62 worker + 45 panel), 8 skip; mobile 49 | `npm test` |
| Skema DB | migrasi `001`-`035` diterapkan; berikutnya `036` | `npm run migrate` |
| Operasional | Liveness `/v1/health`, readiness `/v1/health/ready` (503 saat DB mati, dipakai HEALTHCHECK), rate limit 10 laporan/jam/user, cleanup challenge 2FA di worker | `GET /v1/health/ready`; job `cleanup_auth` |
| Kesiapan operasional | Panel `/ops` + banner dashboard merangkum tujuh antrean yang lewat SLA, gagal kirim, atau macet; read-only, agregat, semua peran admin | `GET /v1/admin/ops/alerts` |
| Deploy produksi | `Dockerfile` 4 target, `docker-compose.prod.yml`, preflight, backup/restore, CI GitHub Actions | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |

## Stack

- Node.js 24 (npm 11 — `package-lock.json` dibuat dengan npm 11, `npm ci` di npm 10
  gagal), TypeScript, npm workspaces
- NestJS 11 (API), Next.js 15 + Tailwind (panel), React 19
- Flutter 3.35 / Dart 3.9 (mobile), tanpa state-management framework
- PostgreSQL 15 + PostGIS (Docker), Redis **tidak** dipakai (worker polling DB)
- Vitest (backend), `flutter test` + `flutter drive` (mobile)

## Peta repositori

| Path | Isi |
|---|---|
| `apps/api` | Entrypoint HTTP NestJS, prefix `/v1` |
| `apps/admin` | Panel admin Next.js App Router (`(auth)`, `(panel)`) |
| `apps/mobile` | Aplikasi pelanggan Flutter + portal vendor (`lib/features/*`) |
| `apps/worker` | Job: `expire-unpaid`, `expire-unresponsive`, `expire-holds`, `auto-complete`, `auto-release`, `payout-reconcile`, `reconcile-daily`, `escalate-reports`, `booking-reminders`, `outbox`, `cleanup-auth`, `cleanup-media` |
| `libs/modules/*` | Domain: `auth`, `booking`, `chat`, `payment`, `payout`, `ledger`, `catalog`, `calendar`, `admin`, `moderation`, `notifications`, `vendor-onboarding`, `vendor-portal` |
| `libs/platform/*` | Fondasi: auth (JWT + `jti`), clock, crypto (AES-256-GCM), email (transport transaksional), idempotensi, outbox, pricing, rate-limit. DB/config/money ada di `apps/api/src/core/` |
| `db/migrations` | Skema PostgreSQL `001`-`035` diterapkan; berikutnya `036` |
| `scripts/` | Migrasi, seed, smoke test, webhook PJP, probe browser |
| `opendesain/` | Ekspor HTML acuan desain pelanggan & vendor (bukan aplikasi) — lihat [docs/DESIGN-REFERENCES.md](docs/DESIGN-REFERENCES.md) |
| `docs/` | PRD, tech design, UX flow, brief legal, SOP, arsitektur, API |

## Prasyarat

- Node.js 24+, npm 11+ (lockfile dibuat npm 11; `npm ci` di npm 10 gagal)
- Docker (PostgreSQL + PostGIS)
- Flutter 3.35+ dan Chrome (untuk mobile web / E2E)
- Port bebas: **5432** (DB), **3001** (API), **3002** (panel)

## Mulai cepat

```bash
# 1. dependensi
npm install

# 2. database
docker run -d --name tarlink-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=tarlink -e POSTGRES_DB=tarlink \
  postgis/postgis:15-3.6
#    Port 5432 sudah dipakai container lain? Pakai `-p 5433:5432` dan set
#    DATABASE_URL=postgres://postgres:tarlink@localhost:5433/tarlink di `.env`.
#    Jangan pakai PostgreSQL di dalam WSL: VM WSL bisa restart dan mengganti IP
#    sehingga API di Windows kehilangan koneksi (ECONNREFUSED / readiness 503).

# 3. konfigurasi
cp .env.example .env        # sesuaikan bila perlu
#    login admin butuh 2FA: isi TOTP_ENCRYPTION_KEY (base64 32 byte) atau
#    enrollment gagal tertutup. Tanpa PAYOUT_PROVIDER=local, API butuh IRIS_API_KEY.

# 4. skema + seed
npm run migrate
node scripts/seed-admin.mjs
node scripts/seed-demo.mjs   # opsional: 7 vendor demo + foto asli + booking untuk E2E mobile
#    Untuk HP, arahkan URL foto ke IP LAN PC:
#    SEED_MEDIA_BASE_URL=http://192.168.1.10:3001 node scripts/seed-demo.mjs

# 5. layanan
npm run build:api && npm run start:api     # :3001
npm run dev:admin                          # :3002
npm run start:worker                       # terminal terpisah
```

Cek cepat:

```bash
curl http://localhost:3001/v1/health
```

## Deploy produksi

Ringkasnya (runbook lengkap: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)):

```bash
cp .env.prod.example .env.prod      # isi nilai; jangan commit
npm run verify:prod                 # periksa konfigurasi (gagal = jangan deploy)
npm run verify:prod -- --db         # + pastikan migrasi sudah lengkap

docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Yang sudah disiapkan repo ini:

- `Dockerfile` dengan target `api`, `worker`, `admin`, dan `migrate` (satu artefak
  untuk migrasi, tanpa devDependencies).
- `docker-compose.prod.yml`: postgis + one-shot `migrate` + api + worker + panel,
  volume media/privat, healthcheck, batas ukuran log, port hanya di loopback.
- `npm run verify:prod`: memeriksa env produksi (kunci enkripsi, provider email,
  Midtrans/Iris produksi, CORS https, `TRUST_PROXY`, `PAYOUT_PROVIDER`) dan
  kelengkapan migrasi; tidak pernah mencetak nilai rahasia.
- `npm run migrate:prod`: menjalankan runner migrasi hasil build (dipakai image).
- `scripts/backup-db.sh` + `scripts/restore-db.sh` (validasi dump, retensi,
  penolakan restore ke database yang sudah berisi).
- `.github/workflows/ci.yml`: typecheck + test API/worker, migrasi + `verify:db`
  di PostGIS, panel (typecheck/test/build), Flutter (analyze/test), dan build
  ketiga image Docker.

## Layanan & kredensial dev

| Layanan | URL | Kredensial |
|---|---|---|
| API | `http://localhost:3001/v1` | JWT via `POST /v1/auth/login` |
| Panel admin | `http://localhost:3002/login` | `admin@tarlink.id` / `Tarlink#2026` — enrollment TOTP wajib saat login pertama (FR-128); butuh `TOTP_ENCRYPTION_KEY` di `.env` |
| Mobile (web) — pelanggan | `http://localhost:8080` | `qa.b2.520274@tarlink.id` / `Tarlink#2026!` |
| Mobile (web) — vendor | `http://localhost:8080` | `vendor@tarlink.id` / `Tarlink#2026!` |
| PostgreSQL | `localhost:5432`, db `tarlink` | `postgres` / `tarlink` |
| Midtrans Sandbox | Core API `https://api.sandbox.midtrans.com` | isi `MIDTRANS_SERVER_KEY` + `MIDTRANS_CLIENT_KEY` di `.env`; webhook ke `POST /v1/webhooks/midtrans` |
| Payout | `PAYOUT_PROVIDER=local` (default) atau `iris` | isi `IRIS_API_KEY` dan `BANK_ACCOUNT_ENCRYPTION_KEY` (base64 32 byte) untuk rekening vendor |

> Kredensial ini untuk **lokal saja**. Jangan pernah dipakai di produksi.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run migrate` | Terapkan `db/migrations` (ada `migrate:dry` untuk cek) |
| `npm run verify:db` | Verifikasi invarian DB |
| `npm test` | Seluruh test backend + worker + panel (Vitest) |
| `npm run typecheck` | Typecheck API |
| `npm run typecheck:admin` | Typecheck panel (kode produksi) |
| `npm run typecheck:admin:test` | Typecheck file test panel |
| `npm run verify:admin` | Cek header CSP + hidrasi `/login` (panel harus berjalan) |
| `npm run build:api` / `start:api` | Bangun / jalankan API (`dist/`) |
| `npm run build:worker` / `start:worker` | Bangun / jalankan worker |
| `npm run dev:admin` | Panel dev (`:3002`) |
| `npm run smoke:booking` / `smoke:admin` / `smoke:catalog` / `smoke:settle` | Smoke test alur nyata |
| `cd apps/mobile && flutter analyze` | Analisis statis mobile |
| `cd apps/mobile && flutter test` | 47 widget test mobile |
| `cd apps/mobile && flutter run -d web-server --web-port 8080 --dart-define=API_BASE_URL=http://localhost:3001` | Jalankan mobile web, buka `http://localhost:8080` di Chrome biasa |

## Pengujian mobile (E2E)

E2E memakai `flutter drive` + chromedriver dan **bukan** interaksi manual browser
(Flutter web merender canvas).

```bash
cd apps/mobile
start .\tools\chromedriver\chromedriver.exe --port=4444
$env:E2E_SHOTS_DIR = "$PWD\e2e_shots"
flutter drive --driver=test_driver/integration_test.dart \
  --target=integration_test/screens_test.dart -d chrome --driver-port=4444 \
  --web-port=8080 --dart-define=API_BASE_URL=http://localhost:3001
```

ChromeDriver **harus cocok versi mayor dengan Chrome** yang dipakai `flutter drive`.
Driver di `tools/chromedriver` bisa tertinggal (mis. 155 saat Chrome sudah 157) dan
gejalanya `session not created: This version of ChromeDriver only supports Chrome
version N`. Unduh yang sesuai dari
`https://storage.googleapis.com/chrome-for-testing-public/<versi-chrome>/win64/chromedriver-win64.zip`,
jalankan dari folder mana pun, lalu pakai `--driver-port` yang sama.

Screenshot 390×844 (DPR 2) tersimpan di `apps/mobile/e2e_shots/` dengan nama
`ui-00-login` … `ui-06-profil`, lalu `ui-07-banding` (layar Banding konten, FR-124)
dan `ui-07b-banding-form` bila akun itu punya konten yang diturunkan. API harus hidup
dan origin `:8080` ada di `CORS_ORIGINS`, karena login dilakukan terhadap API sungguhan.
Harness ini bisa keluar dengan kode 1 dan pesan "Multiple exceptions (N)" meski semua
screenshot tersimpan; `flutter drive` tidak mencetak exception satu per satu, jadi
periksa screenshot-nya sebelum menyimpulkan ada regresi UI.

Viewport dipaksa 390×844 lewat CDP `Emulation.setDeviceMetricsOverride` di
`test_driver/integration_test.dart` (Chrome desktop menolak lebar window < ~534 px).

### Verifikasi chat

Pass visual chat terpisah dan **read-only** (tidak mengirim pesan):

```bash
cd apps/mobile
flutter drive --driver=test_driver/integration_test.dart \
  --target=integration_test/chat_test.dart -d chrome --driver-port=4444 \
  --web-port=8080 --dart-define=API_BASE_URL=http://localhost:3001
# hasil: apps/mobile/e2e_shots/ui-05b-chat.png
```

Fan-out `LISTEN/NOTIFY` lintas instance diuji dengan dua API yang memakai
`DATABASE_URL` sama:

```bash
# terminal 1
PORT=3001 npm run start:api
# terminal 2
PORT=3003 CORS_ORIGINS=http://localhost:3002,http://localhost:8080 npm run start:api
# terminal 3
node scripts/probe-chat-fanout.mjs
```

Skrip memastikan pesan dari instance A diterima socket instance B dan sebaliknya,
lalu membandingkan riwayat REST kedua instance.

## Troubleshooting

| Gejala | Sebab | Solusi |
|---|---|---|
| `Bind for 0.0.0.0:5432 failed` | Port dipakai container lain | `docker ps`, hentikan container itu, atau jalankan DB di port lain (`-p 5433:5432`) lalu sesuaikan `DATABASE_URL` |
| API mati setelah restart mesin | Container DB belum jalan | `docker start tarlink-db` (atau `tarlink-db-dev`), lalu `npm run start:api` |
| `GET /v1/health/ready` 503 / `ECONNREFUSED …:5432` | DB tidak dijangkau proses API | `docker ps` + `docker start tarlink-db`; jangan pakai PostgreSQL di WSL — VM WSL bisa restart dan IP-nya berubah sehingga koneksi dari Windows putus |
| Panel blank / error aneh | `.next` rusak | Hentikan dev server, hapus `apps/admin/.next`, jalankan ulang |
| Login mobile diblokir CORS | Origin `:8080` belum ada di allowlist API | Tambahkan ke `CORS_ORIGINS` di `.env` (`http://localhost:3002,http://localhost:8080`), lalu restart API |
| `flutter drive` screenshot desktop lebar | Viewport tidak diemulasi | Pastikan driver memanggil `Emulation.setDeviceMetricsOverride` |
| `pumpAndSettle` timeout | Skeleton animasi infinite + polling | Pakai `pump` berbatas (lihat `integration_test/e2e_support.dart`) |

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [AGENTS.md](AGENTS.md) | Aturan kerja untuk kolaborator manusia **dan** agen AI |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arsitektur, ledger, auth, worker, mobile |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Runbook deploy produksi: compose, migrasi, backup/restore, rollback |
| [docs/API.md](docs/API.md) | Referensi endpoint, error, webhook |
| [apps/mobile/DESIGN.md](apps/mobile/DESIGN.md) | Kontrak desain UI pelanggan |
| [docs/DESIGN-REFERENCES.md](docs/DESIGN-REFERENCES.md) | Peta ekspor HTML di `opendesain/` dan aturan pemakaiannya |
| [docs/TECH-DESIGN-v1.0.md](docs/TECH-DESIGN-v1.0.md) | Desain teknis awal (historis) |
| [docs/PRD-v1.1.md](docs/PRD-v1.1.md) | PRD terkini |
| [docs/UX-FLOW-SPEC.md](docs/UX-FLOW-SPEC.md) | Alur UX |

## Batasan yang diketahui

Daftar lengkap ada di [AGENTS.md § Batasan](AGENTS.md#batasan-yang-diketahui).

Sudah diperbaiki: idempotensi `POST /bookings`, validasi `policy_version_id` +
snapshot, refresh token panjang (cold start tidak lagi memaksa login), rate limit per
IP, index trigram pencarian, guard `OTP_DEV_MODE`, dan e-wallet ditolak eksplisit.
Ditambahkan sejak 2026-11-07: 2FA TOTP admin (FR-128), cookie refresh `tarlink_rt`
HttpOnly untuk panel, CSP nonce per request, sengketa oleh pelanggan (FR-056),
rekonsiliasi gateway ↔ ledger fase 1 (FR-131, read-only), moderasi UGC
(FR-123/FR-124 lewat migrasi `027`: lapor konten, takedown, panel `/reports`),
blokir pengguna di chat (FR-142), dan notifikasi keluar via email (FR-051 lewat
migrasi `028`: relay `outbox` → `notification_deliveries`, idempoten, retry backoff).
Fase 2 rekonsiliasi (FR-131, migrasi `029`) menambahkan SLA temuan dan keputusan
admin dengan audit, tanpa memposting jurnal.

Yang masih terbuka:

- Tidak ada emulator/HP fisik di lingkungan pengembangan ini.
- Payout vendor + rekening tersedia (terenkripsi, maker-checker, adapter Iris di balik
  `PAYOUT_PROVIDER=iris`), tetapi pengujian live Iris belum dilakukan karena butuh
  kredensial dan saldo merchant sandbox.
- Provider WhatsApp/SMS tidak dipakai (diganti chat real-time in-app, ADR 0011).
  Notifikasi keluar saat ini **email** (FR-051, `EMAIL_API_URL`); **pengingat
  H-7/H-1/hari-H (FR-052) sudah ada** lewat worker `booking_reminders` → `outbox`
  (in-app + email, satu pengingat per booking per jendela). Push FCM belum ada, jadi
  klaim "push ≤60 detik" belum bisa dipenuhi penuh — email berangkat dari relay
  `outbox` (tick worker default 15 detik) dan nasib akhirnya bergantung provider.
  Notifikasi in-app tetap ada
  (`/v1/notifications` + popup di mobile). Chat teks in-app sudah ada
  (`/v1/bookings/:id/chat/messages` + WebSocket `WS /v1/chat/ws`, fan-out lewat
  PostgreSQL `LISTEN/NOTIFY`); foto/lokasi dan penyaringan kontak (FR-135) belum ada.
  Picker peta lokasi acara dan UI check-in berbasis GPS belum ada; endpoint
  check-in/no-show basic sudah ada.
- Rekonsiliasi (FR-131): fase 1 **read-only** + fase 2 (migrasi `029`) sudah ada —
  setiap temuan punya SLA (`due_at` = run selesai + `recon_sla_hours`, default 24 jam)
  dan keputusan final admin (`accepted`/`ignored`/`referred`/`corrected`) dengan
  catatan wajib + `audit_logs`. **Worker harian** `reconcile_daily` menjalankan
  kemarin (WIB) untuk setiap provider yang punya data, setelah `recon_hour_wib`
  (default 07:00) dan hanya bila `recon_enabled=true`; bila worker sempat mati,
  tick berikutnya mengejar maksimal 7 hari ke belakang. Yang belum: lane
  `payout`/`refund` dan run terhadap data gateway nyata (masih `webhook_events`).
- Lapor konten & takedown (FR-123/FR-124) sudah ada (migrasi `027`, panel `/reports`),
  ditambah notifikasi pelapor saat laporan diputuskan, eskalasi SLA otomatis ke
  admin (`030`), **banding pemilik konten** (migrasi `031`, panel `/appeals`), dan
  **bukti banding berupa berkas privat** (migrasi `033`: unggah/baca pemilik +
  baca admin ber-guard, terenkripsi AES-256-GCM, tipe dari magic bytes; tombol
  unggah tersedia di mobile `Banding konten` dan lihat di panel). Yang belum:
  auto-suspend untuk pelanggaran berulang.
  Multi-vendor (FR-113) hanya kolom `parent_event_id` tanpa pemakaian TypeScript.
- Clawback pasca-pencairan (FR-122, migrasi `034`) sudah aktif: klaim maksimal
  30 hari setelah release, hanya bila payout sudah dibayar, wajib dua admin
  berbeda. Jurnal `clawback_recognized` + `clawback_paid` meninggalkan saldo
  `vendor_payable` negatif yang memotong payout berikutnya; panel `/disputes`
  punya alur ajukan/setujui/tolak.
- Ekspor pendapatan vendor (FR-126) tersedia sebagai **CSV** dari jurnal ledger;
  PDF belum dibuat, dan mobile hanya bisa menyalin CSV ke papan klip karena
  allowlist dependency belum memuat pemilih/penyimpan berkas.
- `policy_versions` untuk `tos` dan `privacy` masih **placeholder** bertanda
  `"status":"draft"`; teks final harus diganti lewat migrasi baru. Consent dicatat pada
  registrasi email+password **dan** pembuatan akun baru lewat Google (`consent` wajib).
- Review/rating, favorit, moderasi media, invoice/nota, hapus akun mandiri, registrasi
  vendor mandiri, serta pengajuan/refund maker-checker sudah selesai.

## Lisensi

Internal / belum dipublikasikan.

