# Deploy Tarlink ke Railway

Runbook alternatif dari `docs/DEPLOYMENT.md` (satu host + Docker Compose).
Railway menjalankan **tiga service dari satu image**:

```
internet ──► api     (NestJS /v1, WebSocket chat, port 3001)
         └─► admin   (panel Next.js, port 3002)

worker   (poller PostgreSQL, tanpa port)
             │
             ▼
       PostgreSQL (Supabase atau Railway)   +   volume /app/storage (api)
```

Railway **tidak memilih target stage Docker**. Karena itu `Dockerfile` punya
stage terakhir `railway`: satu image berisi API, worker, panel, dan runner
migrasi. Tiap service memakai start command berbeda dari image yang sama.

---

## 1. Keputusan sebelum mulai

| Hal | Yang dipakai di runbook ini | Alternatif |
|---|---|---|
| Database | **Supabase yang sekarang** (sudah termigrasi 001–035) | Railway + image `postgis/postgis:15-3.4` |
| Media | Volume Railway di service `api`, mount `/app/storage` | Object storage (butuh perubahan kode) |
| Panel | Domain Railway / custom domain | — |
| Mobile | APK/web dibangun terpisah, hanya menunjuk ke API | — |

Database Railway standar **tidak cukup**: migrasi `001` meminta ekstensi
`postgis`, `btree_gist`, `pgcrypto`, dan `012` menambah `pg_trgm`. Kalau tetap
mau satu platform, deploy PostgreSQL sebagai service image
`postgis/postgis:15-3.4` + volume, bukan plugin Postgres biasa.

> **Penting untuk Supabase:** pakai koneksi **session pooler port 5432** (URL
> yang sekarang dipakai di `.env`). Jangan port `6543` (transaction pooler):
> chat memakai `LISTEN/NOTIFY` dan migrasi memakai advisory lock, keduanya tidak
> jalan di mode transaksi.

---

## 2. Prasyarat

- Repo sudah di GitHub (Railway membangun dari GitHub, bukan dari laptop).
- Akun Railway + plan yang mengizinkan volume (Hobby ke atas untuk 5 GB).
- `DATABASE_URL` Supabase (session pooler).
- Kunci enkripsi dan `JWT_SECRET` (lihat §4).
- Provider email (OTP login **dan** notifikasi booking). Tanpa ini login OTP mati.
- Kredensial Midtrans (dan Iris bila payout nyata). Untuk demo internal, payout
  `local` boleh, tapi **tidak** boleh dipakai menerima uang sungguhan.

---

## 3. Buat project dan tiga service

1. Railway → **New Project → Deploy from GitHub repo** → pilih repo Tarlink.
   Region: **Asia Southeast (Singapore)** bila tersedia.
2. Service pertama otomatis dibuat. Ganti namanya menjadi **api**.
3. **New → GitHub Repo** (repo yang sama) dua kali lagi, beri nama **worker**
   dan **admin**.
4. Untuk ketiga service: **Settings → Build → Builder = Dockerfile**, path
   `Dockerfile` (default). Railway otomatis memakai stage terakhir (`railway`).
5. Jangan aktifkan **Watch Paths** dulu; semua service dibangun saat push.

Urutan yang menghindari build sia-sia:

1. Buat service **api** → isi variabel shared + `PORT` → deploy → generate
   domain (target port 3001).
2. Isi `NEXT_PUBLIC_API_BASE_URL` dan `MEDIA_PUBLIC_BASE_URL` dengan domain API
   → deploy ulang api.
3. Buat **admin** → isi variabel panel bila belum → deploy → generate domain
   (target port 3002) atau pasang custom domain lebih dulu.
4. Set `CORS_ORIGINS` ke domain panel → deploy ulang api.
5. Buat **worker** → start command → deploy.

Build pertama tiap service memakan waktu (npm ci + Next build + tsc), jadi
perkirakan 5–8 menit per service pada deploy pertama. Deploy berikutnya
memakai cache layer.


---

## 4. Variabel

Di Railway ada dua lapis: **Shared Variables** (project) dan variabel per
service. Nilai rahasia hanya diisi di dashboard Railway; jangan commit.

Buat nilai acak:

```bash
# JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# TOTP_ENCRYPTION_KEY, KTP_ENCRYPTION_KEY, BANK_ACCOUNT_ENCRYPTION_KEY
# (jalankan tiga kali, jangan pakai nilai yang sama)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 4.1 Shared Variables

| Variabel | Nilai | Catatan |
|---|---|---|
| `DATABASE_URL` | `postgresql://...pooler.supabase.com:5432/postgres?sslmode=require` | session pooler, bukan 6543 |
| `NODE_ENV` | `production` | wajib |
| `JWT_SECRET` | base64 48 byte | unik per environment |
| `JWT_TTL_SECONDS` | `900` | access token 15 menit |
| `REFRESH_TTL_DAYS` | `30` | |
| `OTP_DEV_MODE` | `false` | `true` hanya di lokal |
| `TRUST_PROXY` | `true` | Railway = reverse proxy |
| `CORS_ORIGINS` | `https://<admin-domain>` | isi setelah domain panel ada; tanpa spasi |
| `EMAIL_API_URL` | URL provider | OTP + notifikasi |
| `EMAIL_API_KEY` | kunci provider | |
| `EMAIL_FROM` | `Tarlink <no-reply@domain>` | |
| `TOTP_ENCRYPTION_KEY` | base64 32 byte | tanpa ini enrollment 2FA admin gagal |
| `KTP_ENCRYPTION_KEY` | base64 32 byte | wajib untuk pengajuan vendor |
| `BANK_ACCOUNT_ENCRYPTION_KEY` | base64 32 byte | wajib untuk rekening vendor |
| `BANK_ACCOUNT_KEY_ID` | `v1` | |
| `UPLOAD_DIR` | `storage/uploads` | relatif ke `/app` |
| `PRIVATE_UPLOAD_DIR` | `storage/private` | jangan sama dengan upload publik |
| `MEDIA_PUBLIC_BASE_URL` | `https://<api-domain>` | di-inline saat build panel |
| `NEXT_PUBLIC_API_BASE_URL` | `https://<api-domain>` | di-inline saat build panel |
| `NEXT_PUBLIC_USE_MOCK` | `false` | |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | client id web | boleh kosong: tombol Google disembunyikan |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | kredensial backend | untuk `POST /v1/auth/google` |
| `PJP_PROVIDER` | `midtrans` | `local` hanya untuk uji |
| `MIDTRANS_SERVER_KEY` / `MIDTRANS_CLIENT_KEY` | kunci Midtrans | |
| `MIDTRANS_IS_PRODUCTION` | `true` untuk uang nyata | |
| `REFUND_APPROVAL_THRESHOLD_IDR` | `1000000` | refund di atas ini butuh admin kedua |
| `PAYOUT_PROVIDER` | `iris` (nyata) / `local` (demo) | `local` tidak memindahkan uang |
| `IRIS_API_KEY`, `IRIS_IS_PRODUCTION` | bila `iris` | |
| `LOGIN_IP_RATE_LIMIT_MAX` | `30` | limiter per proses |
| `OTP_IP_RATE_LIMIT_MAX` | `10` | |
| `WORKER_TICK_MS` | `15000` | |
| `WORKER_BATCH` | `50` | |
| `WORKER_MAX_TICKS` | `0` | 0 = jalan terus |

> `CORS_ORIGINS`, `MEDIA_PUBLIC_BASE_URL`, dan `NEXT_PUBLIC_API_BASE_URL`
> diisi setelah domain dibuat (§5). Urutannya: buat domain API → isi → deploy
> API → buat domain admin → isi `CORS_ORIGINS` → deploy ulang API.

### 4.2 Variabel per service

**api**

| Variabel | Nilai |
|---|---|
| `PORT` | `3001` |
| `RAILWAY_RUN_UID` | `0` (lihat volume di §6) |

**worker** — tidak ada tambahan. Worker hanya butuh `DATABASE_URL` + email.

**admin** — tidak ada tambahan; memakai shared `NEXT_PUBLIC_*` dan
`MEDIA_PUBLIC_BASE_URL` sebagai build arg.

---

## 5. Start command, healthcheck, dan domain

### api

- **Start command**: kosongkan. Image sudah punya
  `node -r ./scripts/alias-hook.js dist/api/apps/api/src/main.js`.
- **Pre-deploy command**: `node dist/api/scripts/migrate-cli.js`
  (timeout 600 detik).
- **Healthcheck path**: `/v1/health/ready`, timeout `300`.
- **Networking → Generate Domain**: target port **3001**.
- Restart policy: `ON_FAILURE`, maksimal 10.

Migrasi berjalan sebelum API baru naik. Runner memakai advisory lock, jadi aman
bila ada lebih dari satu container yang menjalankannya.

### worker

- **Start command**: `node dist/worker/apps/worker/src/main.js`
- Tanpa domain, tanpa healthcheck (service ini tidak membuka port).
- Restart policy: `ALWAYS` (kalau worker mati, job berhenti).
- Tambahkan variabel `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60` supaya tick yang
  sedang berjalan diberi waktu selesai saat redeploy.
- Opsional: pre-deploy `node dist/api/scripts/migrate-cli.js` dengan timeout 600
  agar worker tidak pernah jalan di atas skema lama. Aman karena advisory lock.

### admin

- **Start command**:
  ```text
  node /app/node_modules/next/dist/bin/next start /app/apps/admin -p 3002 -H 0.0.0.0
  ```
- **Healthcheck path**: `/login`, timeout `300`.
- **Networking → Generate Domain**: target port **3002**.
- Variabel `NEXT_PUBLIC_API_BASE_URL`, `MEDIA_PUBLIC_BASE_URL`,
  `NEXT_PUBLIC_USE_MOCK`, dan `NEXT_PUBLIC_GOOGLE_CLIENT_ID` **harus sudah ada
  sebelum build**. Next meng-inline nilainya; mengubahnya setelah build tidak
  berpengaruh sampai service dibangun ulang (redeploy, bukan restart).

---

## 6. Volume media (service api)

1. Service **api** → **Settings → Volumes → Add Volume**.
2. Mount path: `/app/storage`. Ukuran awal 5 GB (naikkan bila perlu).
3. Set `RAILWAY_RUN_UID=0` di service api. Image berjalan sebagai user `node`;
   volume baru dimiliki root, jadi tanpa ini unggahan gagal dengan `EACCES`.

Yang perlu diketahui:

- **Satu volume hanya bisa dipasang ke satu service.** Worker tidak bisa melihat
  file yang sama. Job `cleanup_media` di worker akan *skip* karena direktori
  kosong/tidak ada — aman, tapi file yatim tidak dibersihkan. Ini batasan
  Railway, bukan bug. Solusi jangka panjang: object storage (perubahan kode).
- Volume membuat service tidak bisa punya replica, dan redeploy menimbulkan
  downtime singkat (Railway tidak menjalankan dua deployment sekaligus saat
  volume terpasang).
- Aktifkan **volume backup** di Railway. Foto vendor dan KTP terenkripsi ada di
  sana; backup database saja tidak cukup.

---

## 7. Setelah service hijau

### 7.1 Health check

```bash
curl -fsS https://<api-domain>/v1/health
curl -fsS https://<api-domain>/v1/health/ready     # {"checks":{"db":"ok"}}
curl -fsSI https://<admin-domain>/login | findstr /I "content-security-policy"
```

`/v1/health` selalu 200 (liveness). `/v1/health/ready` 503 bila DB tidak bisa
dihubungi.

### 7.2 Admin pertama

Tidak ada akun admin default. Jalankan sekali:

```bash
railway login
railway link
railway service          # pilih "api"
railway ssh              # shell di container API
node scripts/seed-admin.mjs --email admin@domain --role admin_super --force
```

Atau dari laptop (memakai env service yang di-link):

```bash
railway run node scripts/seed-admin.mjs --email admin@domain --role admin_super --force
```

`--force` wajib karena `NODE_ENV=production`. Password acak dicetak sekali;
salin. Login pertama memaksa enrollment TOTP — simpan 10 backup code.

### 7.3 Preflight

Setelah variabel dan domain final:

```bash
railway service          # pilih "api"
railway run npm run verify:prod -- --db
```

Target: **0 FAIL**. Untuk demo internal dengan Midtrans sandbox dan payout lokal,
angka itu tidak mungkin tercapai — yang wajib PASS adalah `DATABASE_URL`,
`JWT_SECRET`, tiga kunci enkripsi, email, CORS, dan migrasi. Jangan pakai
konfigurasi demo untuk menerima uang sungguhan.

### 7.4 CORS dan cookie panel

`CORS_ORIGINS` harus berisi origin panel **tanpa** trailing slash, mis.
`https://admin-production-xxxx.up.railway.app`. Setelah mengubahnya, deploy
ulang API.

**Gunakan custom domain untuk panel dan API** (`admin.domain.id` dan
`api.domain.id`). Ini bukan opsional untuk panel:

- `up.railway.app` terdaftar di Public Suffix List, sehingga
  `admin-xxx.up.railway.app` dan `api-yyy.up.railway.app` dianggap **dua site
  berbeda** oleh browser.
- Cookie refresh panel memakai `SameSite=Strict`; cookie itu tidak dikirim pada
  request cross-site, dan browser modern juga bisa memblokir cookie pihak
  ketiga sepenuhnya. Akibatnya login bisa berhasil tetapi refresh 15 menit
  kemudian gagal (atau sesi tidak terbentuk sama sekali).
- Dengan satu parent domain (`tarlink.id`), kedua host adalah **same-site**
  walau beda origin. Cookie terkirim, CORS tetap dicek lewat `CORS_ORIGINS`.

Custom domain Railway butuh record `CNAME` **dan** `TXT` dari dashboard; SSL
diterbitkan otomatis. Setelah domain jadi, perbarui `CORS_ORIGINS`,
`MEDIA_PUBLIC_BASE_URL`, dan `NEXT_PUBLIC_API_BASE_URL` — panel harus
**dibangun ulang** karena `NEXT_PUBLIC_*` di-inline saat build.

Bila memang harus memakai domain `*.up.railway.app` untuk demo, panel tetap bisa
dipakai dengan login ulang setiap access token kedaluwarsa (15 menit). Jangan
pakai mode itu untuk operasional.

Bila memakai Google login di panel, tambahkan juga origin panel ke
**Authorized JavaScript origins** di Google Cloud Console.

---

## 8. Mobile

API Railway hanya perlu URL publik. Bangun ulang aplikasi dengan URL itu:

```bash
cd apps/mobile
flutter build apk --release \
  --dart-define=API_BASE_URL=https://<api-domain>

# web (opsional)
flutter build web --release \
  --dart-define=API_BASE_URL=https://<api-domain>
```

- Untuk web, tambahkan origin web ke `CORS_ORIGINS` (dan ke Google authorized
  origins bila login Google dipakai di web).
- `GOOGLE_CLIENT_ID` backend harus client ID yang sama dengan yang dipakai app.
- APK tidak memakai cookie panel; refresh token tetap di body, jadi tidak
  terpengaruh `SameSite`.
- Flutter web **tidak** dibangun oleh image Railway ini. Hosting statis
  (Firebase/Netlify/nginx) lebih murah dan cepat.

---

## 9. Update dan rollback

- **Update**: `git push` ke branch yang terhubung. Ketiga service dibangun;
  migrasi berjalan di pre-deploy API sebelum API baru menerima trafik.
- **Rollback kode**: Railway → service → **Deployments** → pilih deployment lama
  → **Redeploy**. Image lama masih tersimpan.
- **Rollback skema**: tidak ada migrasi `DOWN`. Pulihkan database dari backup
  Supabase, lalu deploy kode yang sesuai.
- **Downtime**: API tanpa volume bisa overlap; service dengan volume (api)
  berganti container dengan jeda singkat.

---

## 10. Batasan yang harus diketahui

1. **Rate limit in-memory** (login/OTP/refresh) dihitung per proses. Satu
   replica aman; menambah replica melipatgandakan batas efektif.
2. **Worker tunggal** secara logika: semua job dijaga `pg_try_advisory_lock`.
   Menambah replica worker hanya menambah ketersediaan, bukan kecepatan.
3. **Media satu service** (§6). Jangan menambah replica API selama volume
   terpasang.
4. **Tidak ada Redis** di stack ini; worker memakai poll PostgreSQL. Tidak perlu
   menambah Redis di Railway.
5. **Email tetap wajib** untuk OTP dan notifikasi. Tanpa provider, login OTP
   tidak bisa dipakai (login password pelanggan juga tidak ada — pelanggan
   memakai OTP).
6. **`PAYOUT_PROVIDER=local` tidak memindahkan uang.** Hanya untuk demo.
7. **Panel dan API harus satu parent domain** untuk cookie refresh (§7.4).
   `*.up.railway.app` bukan satu site menurut Public Suffix List.

---

## 11. Troubleshooting

| Gejala | Penyebab paling sering |
|---|---|
| Build admin gagal / panel memanggil `localhost:3001` | `NEXT_PUBLIC_API_BASE_URL` belum diisi saat build. Isi variabel, lalu redeploy (bukan restart) |
| API restart, log `Invalid environment` | `DATABASE_URL` atau `JWT_SECRET` kosong/salah |
| API `unhealthy`, `/v1/health/ready` 503 | URL DB salah, Supabase pause, atau memakai port 6543 |
| Pre-deploy gagal "Folder migrasi tidak ditemukan" | image bukan stage `railway` (stage ini menyalin `db/`) |
| Upload foto gagal `EACCES` | volume belum ter-mount, atau `RAILWAY_RUN_UID` bukan `0` |
| Foto hilang setelah redeploy | tidak ada volume di `/app/storage` |
| Admin ter-logout tiap ~15 menit | cookie `SameSite=Strict` tidak terkirim antar domain Railway — wajib custom domain satu parent (§7.4) |
| OTP tidak masuk | `EMAIL_API_URL`/`EMAIL_API_KEY` kosong; cek log `UnconfiguredMailer` |
| Web memanggil API tapi diblokir CORS | origin belum ada di `CORS_ORIGINS` (tanpa trailing slash) |
| Chat tidak terhubung | `CORS_ORIGINS` salah, atau DB memakai transaction pooler (6543) |
| Worker diam | start command salah, atau `DATABASE_URL` tidak di-share ke worker |
| Payout "selesai" tapi uang tidak masuk | `PAYOUT_PROVIDER=local` |

---

## 12. Checklist go-live

- [ ] Tiga service hijau; API `/v1/health/ready` 200
- [ ] Pre-deploy migrasi sukses (log `migrasi selesai: applied=… pending=0`)
- [ ] `npm run verify:prod -- --db` → 0 FAIL
- [ ] Volume `/app/storage` terpasang + backup volume aktif
- [ ] Admin pertama dibuat, 2FA aktif, backup code disimpan
- [ ] `CORS_ORIGINS` hanya origin HTTPS panel/mobile web
- [ ] Custom domain API + panel (satu parent domain, wajib untuk cookie panel)
- [ ] Uji OTP email sampai masuk
- [ ] Uji alur uang nominal kecil: DP → webhook → refund → release → payout
- [ ] Panel `/ops` menunjukkan `ok`
- [ ] Backup database terjadwal (Supabase) dan pernah dites restore
- [ ] APK/web dibangun dengan `API_BASE_URL` produksi
