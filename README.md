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
| `apps/mobile` — Flutter pelanggan | 27 widget test lulus, `flutter analyze` bersih | `cd apps/mobile && flutter test` |
| `apps/mobile` — portal vendor | 6 layar, kelola profil/paket/kalender + upload media | login akun `vendor_owner` |
| Ledger double-entry | 737 test backend lulus (3 skip) | `npm test` |
| Skema DB | migrasi `001`–`012` | `npm run migrate` |

## Stack

- Node.js ≥ 20, TypeScript, npm workspaces
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
| `apps/worker` | Job: `expire-unpaid`, `expire-holds`, `auto-complete`, `auto-release`, `outbox`, `cleanup-auth` |
| `libs/modules/*` | Domain: `auth`, `booking`, `payment`, `ledger`, `catalog`, `calendar`, `admin`, `vendor-portal` |
| `libs/platform/*` | Fondasi: db, config, auth (JWT + `jti`), error, uang, idempotensi |
| `db/migrations` | Skema PostgreSQL `001`–`012` |
| `scripts/` | Migrasi, seed, smoke test, webhook PJP, probe browser |
| `opendesain/` | Ekspor HTML acuan desain pelanggan & vendor (bukan aplikasi) — lihat [docs/DESIGN-REFERENCES.md](docs/DESIGN-REFERENCES.md) |
| `docs/` | PRD, tech design, UX flow, brief legal, SOP, arsitektur, API |

## Prasyarat

- Node.js 20+, npm 10+
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

# 3. konfigurasi
cp .env.example .env        # sesuaikan bila perlu

# 4. skema + seed
npm run migrate
node scripts/seed-admin.mjs

# 5. layanan
npm run build:api && npm run start:api     # :3001
npm run dev:admin                          # :3002
npm run start:worker                       # terminal terpisah
```

Cek cepat:

```bash
curl http://localhost:3001/v1/health
```

## Layanan & kredensial dev

| Layanan | URL | Kredensial |
|---|---|---|
| API | `http://localhost:3001/v1` | JWT via `POST /v1/auth/login` |
| Panel admin | `http://localhost:3002/login` | `admin@tarlink.id` / `Tarlink#2026` |
| Mobile (web) — pelanggan | `http://localhost:8080` | `qa.b2.520274@tarlink.id` / `Tarlink#2026!` |
| Mobile (web) — vendor | `http://localhost:8080` | `vendor@tarlink.id` / `Tarlink#2026!` |
| PostgreSQL | `localhost:5432`, db `tarlink` | `postgres` / `tarlink` |

> Kredensial ini untuk **lokal saja**. Jangan pernah dipakai di produksi.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run migrate` | Terapkan `db/migrations` (ada `migrate:dry` untuk cek) |
| `npm run verify:db` | Verifikasi invarian DB |
| `npm test` | Seluruh test backend (Vitest) |
| `npm run typecheck` | Typecheck API |
| `npm run typecheck:admin` | Typecheck panel |
| `npm run build:api` / `start:api` | Bangun / jalankan API (`dist/`) |
| `npm run build:worker` / `start:worker` | Bangun / jalankan worker |
| `npm run dev:admin` | Panel dev (`:3002`) |
| `npm run smoke:booking` / `smoke:admin` / `smoke:catalog` / `smoke:settle` | Smoke test alur nyata |
| `cd apps/mobile && flutter analyze` | Analisis statis mobile |
| `cd apps/mobile && flutter test` | 27 widget test mobile |
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

Screenshot 390×844 (DPR 2) tersimpan di `apps/mobile/e2e_shots/` dengan nama
`ui-00-login` … `ui-06-profil`. API harus hidup dan origin `:8080` ada di
`CORS_ORIGINS`, karena login dilakukan terhadap API sungguhan.

Viewport dipaksa 390×844 lewat CDP `Emulation.setDeviceMetricsOverride` di
`test_driver/integration_test.dart` (Chrome desktop menolak lebar window < ~534 px).

## Troubleshooting

| Gejala | Sebab | Solusi |
|---|---|---|
| `Bind for 0.0.0.0:5432 failed` | Port dipakai container lain | `docker ps`, hentikan container itu, atau ubah port Tarlink |
| API mati setelah restart mesin | Container DB belum jalan | `docker start tarlink-db`, lalu `npm run start:api` |
| Panel blank / error aneh | `.next` rusak | Hentikan dev server, hapus `apps/admin/.next`, jalankan ulang |
| Login mobile diblokir CORS | Origin `:8080` belum ada di allowlist API | Tambahkan ke `CORS_ORIGINS` di `.env` (`http://localhost:3002,http://localhost:8080`), lalu restart API |
| `flutter drive` screenshot desktop lebar | Viewport tidak diemulasi | Pastikan driver memanggil `Emulation.setDeviceMetricsOverride` |
| `pumpAndSettle` timeout | Skeleton animasi infinite + polling | Pakai `pump` berbatas (lihat `integration_test/e2e_support.dart`) |

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [AGENTS.md](AGENTS.md) | Aturan kerja untuk kolaborator manusia **dan** agen AI |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arsitektur, ledger, auth, worker, mobile |
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

Yang masih terbuka:

- Tidak ada emulator/HP fisik di lingkungan pengembangan ini.
- Gateway PJP nyata, provider WhatsApp/SMS, review/rating, picker peta lokasi acara,
  dan `checkin_location` belum ada.

## Lisensi

Internal / belum dipublikasikan.
