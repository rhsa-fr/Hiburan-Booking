# Tarlink — Booking Hiburan Pantura

Marketplace booking hiburan (tarling/organ tunggal) untuk wilayah Pantura. Pelanggan memesan paket, membayar DP, vendor tampil di kalender, dan dana diteruskan ke vendor setelah jasa selesai + jendela sengketa tutup.

Repositori ini berisi **backend API**, **panel admin**, **worker**, dan **library domain**. Aplikasi mobile (Flutter) belum dikerjakan.

## Isi

| Path | Isi |
|---|---|
| `apps/api` | API NestJS (`/v1`), entrypoint HTTP |
| `apps/admin` | Panel admin Next.js (App Router) |
| `apps/mobile` | Aplikasi pelanggan Flutter (Android + web) |
| `apps/worker` | Worker poller PostgreSQL (tanpa Redis) |
| `libs/modules/*` | Domain: `auth`, `booking`, `payment`, `ledger`, `catalog`, `admin`, `calendar` |
| `libs/platform/*` | Fondasi: db, config, auth, error, uang |
| `db/migrations` | Skema PostgreSQL (`001`–`007`) |
| `docs/` | PRD, tech design, riset, brief legal, UX flow, SOP agen |
| `scripts/` | Migrasi, seed, smoke test, probe browser |

## Stack

- Node.js ≥ 20, TypeScript, npm workspaces
- NestJS 11 (API), Next.js 15 + Tailwind (panel), React 19
- Flutter 3.35 / Dart 3.9 (aplikasi pelanggan)
- PostgreSQL 15 + PostGIS (Docker)
- Vitest (unit + integrasi), Playwright/CDP untuk probe UI

## Mulai

```bash
npm install
cp .env.example .env          # isi kredensial lokal

docker run -d --name tarlink-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=tarlink -e POSTGRES_DB=tarlink postgis/postgis:15-3.4

npm run migrate               # terapkan db/migrations
node scripts/seed-admin.mjs   # buat akun admin awal
```

Jalankan tiga proses (terminal terpisah):

```bash
npm run dev:api       # http://localhost:3001/v1/health
npm run dev:admin     # http://localhost:3002
npm run start:worker  # poller: auto-complete, auto-release, outbox
```

Aplikasi pelanggan (Flutter, folder `apps/mobile`):

```bash
cd apps/mobile
flutter pub get
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3001
flutter build apk --debug        # APK untuk HP Android
```

Akun dev default (dari `seed-admin.mjs`): `admin@tarlink.id` / `Tarlink#2026` ganti sebelum dipakai di lingkungan nyata.

## Aturan uang

- Dana pelanggan **tidak** masuk rekening platform; ditahan penyedia jasa pembayaran berizin.
- Status booking punya tiga sumbu: lifecycle, payment, settlement.
- Ledger double-entry, rupiah `BIGINT`, jurnal append-only (tidak bisa dihapus/diubah).
- Release hanya untuk booking `fully_paid`/`partially_refunded` dan setelah jendela sengketa tutup.
- Pelunasan telat dicatat admin lewat `POST /v1/admin/bookings/:id/settle`: satu transaksi menulis jurnal kas **dan** menggerakkan booking ke `fully_paid`.
- Auto-complete mensyaratkan pembayaran lunas; booking yang cuma DP tidak dianggap selesai.

## Verifikasi

```bash
npm test                    # seluruh unit + integrasi (DB test opt-in)
npm run typecheck           # tsc API
npm run typecheck:admin     # tsc panel
npm run smoke:settle        # 5 kasus pelunasan manual
npm run smoke:catalog       # 12 endpoint katalog
```

Tes integrasi yang menyentuh DB hanya jalan bila `RUN_DB_TESTS=1`, karena jurnal append-only membuat baris uji tidak bisa dihapus.

Aplikasi pelanggan:

```bash
cd apps/mobile
flutter analyze
flutter test
```

## Build

```bash
npm run build:api
npm run build:admin
npm run build:worker
```

Matikan `dev:admin` sebelum `build:admin` — keduanya memakai `apps/admin/.next` yang sama.

## Dokumen

- [`docs/PRD-v1.1.md`](docs/PRD-v1.1.md) — kebutuhan produk
- [`docs/TECH-DESIGN-v1.0.md`](docs/TECH-DESIGN-v1.0.md) — arsitektur, skema, invarian
- [`docs/UX-FLOW-SPEC.md`](docs/UX-FLOW-SPEC.md) — alur layar
- [`docs/RISET-M0.md`](docs/RISET-M0.md) — riset lapangan
- [`docs/BRIEF-LEGAL-DANA-PAJAK.md`](docs/BRIEF-LEGAL-DANA-PAJAK.md) — dana & pajak
- [`docs/SOP-AGEN-LAPANGAN.md`](docs/SOP-AGEN-LAPANGAN.md) — operasional agen
