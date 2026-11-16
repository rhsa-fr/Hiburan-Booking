# Deploy Tarlink ke produksi

Runbook untuk satu host Linux dengan Docker Compose. Untuk pengembangan lokal,
lihat `README.md`.

Isi: prasyarat → konfigurasi → deploy pertama → operasi harian → backup/restore →
rollback → batasan yang harus diketahui.

---

## 1. Bentuk runtime

```
internet → reverse proxy (nginx/Caddy, TLS) → 127.0.0.1:3001 (api)
                                            → 127.0.0.1:3002 (admin)
api ─┬─ db (PostGIS 15)  ← volume pgdata
     ├─ volume media      (foto/banner/galeri vendor)
     └─ volume private    (foto KTP, terenkripsi)
worker ── db + volume media (job cleanup_media)
migrate ── one-shot; api & worker menunggu sampai selesai sukses
```

- Port API dan panel **hanya** di-bind ke `127.0.0.1`. Tidak ada port database
  yang dipublikasikan.
- API dan worker tidak saling memanggil; keduanya hanya butuh PostgreSQL.
- Chat real-time memakai `LISTEN/NOTIFY` PostgreSQL, jadi fan-out tetap benar
  walau API dijalankan lebih dari satu replika.

## 2. Prasyarat

| Kebutuhan | Catatan |
|---|---|
| Docker Engine ≥ 24 + Compose v2 | `docker compose version` |
| Node.js 24 di host | hanya untuk `npm run verify:prod`, `migrate:dry`, dan skrip backup; image sudah membawa Node sendiri |
| RAM | ≥ 2 GB (PostGIS + API + panel) |
| Disk | ≥ 20 GB; backup + media tumbuh terus |
| Reverse proxy + TLS | nginx/Caddy; `TRUST_PROXY=true` wajib |
| Domain | mis. `api.tarlink.id`, `admin.tarlink.id` |
| Kredensial | Midtrans produksi, Iris, provider email (OTP + notifikasi booking) |

`postgis/postgis:15-3.4` dipakai karena migrasi `001` membuat ekstensi
`postgis`, `btree_gist`, `pgcrypto`, dan `012` menambah `pg_trgm`.

## 3. Konfigurasi

```bash
cp .env.prod.example .env.prod
# isi semua nilai; jangan commit file ini (.gitignore sudah menutup .env.*)
```

Nama file harus `.env.prod` karena `docker-compose.prod.yml` memakainya sebagai
`env_file` untuk isi container. Bila memakai nama lain, set juga `ENV_FILE`
(mis. `ENV_FILE=.env.staging`), karena `--env-file` hanya mengatur interpolasi,
bukan environment di dalam container.

Kunci enkripsi (masing-masing 32 byte acak, base64):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Jalankan preflight sebelum menyalakan apa pun:

```bash
npm run verify:prod              # periksa .env.prod
npm run verify:prod -- --db      # + pastikan database sudah dimigrasi
```

Preflight **gagal** (exit 1) pada hal-hal yang membuat produksi tidak layak,
antara lain:

- `NODE_ENV` bukan `production`, `OTP_DEV_MODE=true`
- `JWT_SECRET` < 32 karakter atau memakai nilai contoh
- `EMAIL_API_URL`/`EMAIL_API_KEY` kosong (tanpa itu OTP **dan** email notifikasi
  booking tidak terkirim; worker memakai variabel yang sama)
- `TOTP_ENCRYPTION_KEY`, `KTP_ENCRYPTION_KEY`, atau `BANK_ACCOUNT_ENCRYPTION_KEY`
  tidak ada / bukan base64 32 byte
- `CORS_ORIGINS` berisi `*` atau `http://`
- `MIDTRANS_IS_PRODUCTION=false` (masih sandbox) atau `IRIS_IS_PRODUCTION=false`
- `PAYOUT_PROVIDER=local` — menandai payout "selesai" tanpa transfer nyata.
  Untuk uji internal saja: `--allow-local-payout`.

Peringatan (tidak menggagalkan) antara lain `TRUST_PROXY=false`, `CORS_ORIGINS`
yang masih memuat `localhost`, dan `DATABASE_URL` ke `localhost`.

## 4. Deploy pertama

```bash
# 1. build semua image
docker compose -f docker-compose.prod.yml --env-file .env.prod build

# 2. migrasi dijalankan otomatis sebagai one-shot oleh `up`
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# 3. cek status + kesehatan
docker compose -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:3001/v1/health
```

Urutan yang dijamin compose: `db` sehat → `migrate` selesai sukses → `api` +
`worker` naik → `admin` naik setelah API sehat.

### Membuat admin pertama

Tidak ada akun admin default (tidak ditanam lewat migrasi). Buat eksplisit:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
  --entrypoint node migrate scripts/seed-admin.mjs \
  --email admin@tarlink.id --password 'SandiKuat-Unik-2026' --role admin_super
```

Login pertama akan memaksa enrollment TOTP (FR-128). Simpan 10 backup code yang
ditampilkan; tanpa `TOTP_ENCRYPTION_KEY` enrollment gagal tertutup.

### Setelah naik

1. `npm run verify:prod -- --db` → semua PASS.
2. Login panel, selesaikan enrollment 2FA, buat admin kedua sebagai cadangan.
3. Uji uang nyata dengan nominal kecil: booking → DP → webhook → refund →
   release → payout. Jangan menerima pesanan sungguhan sebelum ini lolos.
4. Pasang backup harian di cron (bagian 6).
5. Pasang healthcheck eksternal ke `https://api.tarlink.id/v1/health`.

## 5. Operasi harian

| Tugas | Perintah |
|---|---|
| Log API | `docker compose -f docker-compose.prod.yml logs -f api` |
| Log worker | `docker compose -f docker-compose.prod.yml logs -f --tail=200 worker` |
| Status | `docker compose -f docker-compose.prod.yml ps` |
| Restart satu layanan | `docker compose -f docker-compose.prod.yml restart api` |
| Jalankan migrasi manual | `docker compose ... run --rm migrate` |
| Cek migrasi tertinggal | `docker compose ... run --rm migrate --dry-run` |
| Antrean operasional | Panel `/ops` atau `GET /v1/admin/ops/alerts` — status `ok`/`attention`/`critical` |

Log sudah dibatasi `10m × 5` per container supaya disk tidak penuh.

### Update versi

```bash
git fetch && git checkout <tag/commit>
npm run verify:prod              # konfigurasi masih cocok?
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Compose akan menjalankan `migrate` lebih dulu; API/worker baru naik setelah
migrasi sukses, jadi skema dan kode tidak pernah berbeda versi.

Downtime: beberapa detik sampai puluhan detik (container diganti). Ini bukan
zero-downtime; untuk itu butuh dua replika API di belakang load balancer dan
migrasi yang kompatibel mundur.

## 6. Backup & pemulihan

```bash
# backup manual (custom format, tervalidasi pg_restore --list)
BACKUP_DIR=/var/backups/tarlink scripts/backup-db.sh

# cron harian 02:15
15 2 * * * cd /srv/tarlink && BACKUP_DIR=/var/backups/tarlink scripts/backup-db.sh >>/var/log/tarlink-backup.log 2>&1
```

Retensi default 14 hari (`RETENTION_DAYS`). **Simpan salinan di luar host** —
backup yang hanya ada di mesin yang sama tidak menolong saat disk mati.

Volume media ikut perlu dicadangkan:

```bash
docker run --rm -v tarlink_media:/data -v /var/backups/tarlink:/backup \
  alpine tar czf /backup/media-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /data .
```

Pemulihan:

```bash
scripts/restore-db.sh /var/backups/tarlink/tarlink-20261108T020000Z.dump --yes
# bila database memang sudah berisi data dan akan ditimpa: tambahkan --force
```

Setelah restore **wajib**: `npm run migrate:dry`, `npm run verify:db`,
`npm run verify:prod -- --db`. Uji restore ke database kosong minimal sekali
sebelum go-live — backup yang belum pernah dites bukan backup. Jalur ini sudah
diuji 2026-11-08 pada salinan database dev: dump 287 KB, hasil restore punya
54 tabel/30 migrasi (skema saat uji itu) dan jumlah baris tabel utama yang sama,
`migrate:dry` tanpa pending, `verify:db` 20/20. `restore-db.sh` juga terbukti menolak
database non-kosong tanpa `--force`. Retensi `RETENTION_DAYS` diuji menghapus dump lama.
Skema kini `001`-`035`; jalankan ulang uji restore setelah menambah migrasi baru.

## 7. Rollback

- **Kode**: `git checkout <commit-lama>` lalu `build` + `up -d`. Image lama tetap
  ada di cache lokal.
- **Skema**: migrasi bersifat maju (tidak ada `DOWN`). Rollback kode ke versi
  yang belum mengenal kolom baru aman selama migrasi hanya menambah; kalau
  migrasi mengubah/menghapus, pulihkan dari backup.
- **Data**: hanya lewat `restore-db.sh`, dan itu menghilangkan transaksi setelah
  backup terakhir. Catat di runbook insiden sebelum melakukannya.

## 8. Batasan yang harus diketahui sebelum skala naik

1. **Volume media lokal.** `media` dan `private` adalah volume host. Menjalankan
   API di dua host berbeda berarti unggahan tidak terlihat oleh host lain —
   pindahkan ke object storage (atau NFS) lebih dulu.
2. **Rate limit in-memory.** Limiter login/OTP/refresh berjalan per proses.
   Dengan N replika, batas efektif menjadi N × nilai env.
3. **Metrics/alerting eksternal belum ada.** Yang tersedia hanya `/v1/health`
   (liveness), `/v1/health/ready` (readiness; 503 saat DB mati), log JSON-line, dan
   ringkasan antrean internal `/ops` (`GET /v1/admin/ops/alerts`) yang membaca DB
   hanya saat halaman dibuka — tidak mengirim alarm saat tidak ada yang membukanya.
   `HEALTHCHECK` image API memakai readiness. Pasang healthcheck eksternal ke
   `/v1/health/ready` dan, bila perlu, `pg_stat_activity` untuk query lambat.
4. **Worker tunggal.** Semua job dijaga `pg_try_advisory_lock`, jadi dua worker
   tidak menggandakan pekerjaan — tetapi juga tidak mempercepat; worker kedua
   hanya menambah ketersediaan.
5. **Rekonsiliasi harian berjalan di worker.** Job `reconcile_daily` menjalankan
   kemarin (WIB) untuk tiap provider setelah `recon_hour_wib` (default 07:00),
   hanya bila `recon_enabled=true` di `platform_settings`. Bila worker sempat
   mati, tick berikutnya mengejar maksimal 7 hari ke belakang. Cek hasilnya di
   panel `/reconciliation`; tick tanpa run baru normal (idempoten, `skipped`).
   Bila run pagi tidak muncul: pastikan setting, jam WIB server, dan provider
   punya `payments`/`webhook_events`.
6. **Notifikasi keluar = email, belum push.** Worker mengirim email booking tiap
   tick (default 15 detik), lalu nasib akhirnya di provider. Untuk memantau:
   `notification_deliveries.status='failed'` dan `last_error` di
   `outbox_messages`, plus log `email_failed`. Target PRD "push ≤60 detik" belum
   terpenuhi penuh sampai FCM ada.

## 9. Troubleshooting

| Gejala | Penyebab yang paling sering |
|---|---|
| API restart terus, log `Invalid environment: …` | ada variabel wajib yang kosong/salah tipe; jalankan `verify:prod` |
| Container API `unhealthy` padahal proses hidup | `/v1/health/ready` 503 = DB tidak bisa dihubungi; cek `DATABASE_URL`, container `db`, dan `pg_isready`. `/v1/health` sengaja tetap 200 (liveness) |
| OTP tidak sampai, log memakai `UnconfiguredMailer` | `EMAIL_API_URL`/`EMAIL_API_KEY` kosong |
| Email status booking tidak masuk | cek `notification_deliveries` (`status`, `last_error`); kosong = event tidak user-facing atau user tanpa email; `failed` = provider menolak, pesan outbox akan di-retry |
| Run rekonsiliasi harian tidak muncul | `recon_enabled=false`/belum 07:00 WIB, atau provider belum punya `payments`/`webhook_events`; cek log `job=reconcile_daily` dan `reconcile_daily_failed` |
| Admin tidak dapat notifikasi SLA laporan | pastikan worker jalan dan ada user aktif berperan `admin_support`/`admin_super`; cek `content_reports.escalated_at` dan `notifications` tipe `content_report_sla_breach` |
| Admin tidak bisa login setelah password benar | `TOTP_ENCRYPTION_KEY` kosong → enrollment gagal tertutup |
| Vendor tidak bisa simpan rekening | `BANK_ACCOUNT_ENCRYPTION_KEY` kosong |
| `migrate` gagal "checksum mismatch" | file migrasi lama diubah; kembalikan isinya, jangan edit migrasi yang sudah diterapkan |
| Semua klien kena rate limit bersamaan | `TRUST_PROXY=false` padahal di belakang proxy |
| Panel menampilkan CSP error ke Google | origin Google belum diizinkan atau build panel tanpa `NEXT_PUBLIC_*` |
| Payout "selesai" tapi uang tidak masuk | `PAYOUT_PROVIDER=local` — hanya stub |

## 10. Checklist go-live

- [ ] `npm run verify:prod -- --db` → 0 gagal
- [ ] `npm run verify:db` → 20/20
- [ ] `npm run migrate:dry` → tidak ada pending
- [ ] Dua admin dengan 2FA aktif + backup code disimpan
- [ ] Uji uang nyata nominal kecil (DP → refund → release → payout)
- [ ] Uji email notifikasi: ubah status booking → email masuk, baris
      `notification_deliveries` berstatus `sent`
- [ ] Backup harian terpasang **dan** restore sudah pernah dites
- [ ] Healthcheck eksternal ke `/v1/health/ready` + notifikasi down
- [ ] Panel `/ops` menunjukkan `ok` setelah antrean dibersihkan; banner kritis
      dashboard tidak muncul saat `ok`
- [ ] Teks `tos`/`privacy` final (bukan `{"status":"draft"}`)
- [ ] Rekonsiliasi harian aktif: `recon_enabled=true`, `recon_hour_wib` sesuai zona
      operasional, dan run pertama muncul di panel `/reconciliation`
- [ ] Eskalasi SLA laporan: buat satu laporan uji dengan SLA lewat → admin menerima
      notifikasi `content_report_sla_breach` dan panel menampilkan `escalated_at`
- [ ] Banding takedown: ajukan banding uji, putuskan dari `/appeals`, dan pastikan
      ulasan/pesan chat pulih atau media kembali ke antrean moderasi
