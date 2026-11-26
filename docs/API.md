# Referensi API

Base URL: `http://localhost:3001/v1` (dev). Semua respons JSON.

## Konvensi

**Autentikasi**

```http
Authorization: Bearer <access_token>
```

Access token berlaku 15 menit. `POST /auth/refresh` menerima `refresh_token`
(opaque, berlaku `REFRESH_TTL_DAYS`, default 30 hari) dan **merotasi** sesi:
refresh token lama menjadi 401. Memakai ulang token yang sudah dirotasi mencabut
seluruh family sesi tersebut.

**Mode cookie (panel admin).** Hanya endpoint ini yang menerima `cookie: true` di body:
`POST /auth/login`, `POST /auth/google`, `POST /auth/2fa/verify`, `POST /auth/2fa/backup-code`,
dan `POST /auth/2fa/enroll/verify` (bukan `/auth/register` atau `/auth/otp/verify`).
Dengan flag itu server mengirim `Set-Cookie:
tarlink_rt=<refresh_token>; Path=/v1/auth; HttpOnly; SameSite=Strict`
(`Secure` bila `NODE_ENV=production`) dan **menghilangkan** `refresh_token` dari body,
sehingga JavaScript panel tidak pernah bisa membacanya. `POST /auth/refresh` tanpa
body lalu memakai cookie tersebut dan merotasinya; bila kredensialnya **ditolak**
(`UNAUTHENTICATED`), cookie ikut dihapus. Kegagalan `429` (throttle) atau `5xx`
tidak menghapus cookie karena kredensialnya belum tentu salah. `POST /auth/logout`
selalu menghapus cookie **dan** mencabut sesi yang diwakilinya, termasuk saat access
token sudah kedaluwarsa. Klien Flutter tidak memakai flag ini: `refresh_token` tetap
dikembalikan di body seperti sebelumnya.

Kegagalan `POST /auth/refresh` dihitung per IP: setelah 30 kegagalan dalam 5 menit,
percobaan berikutnya dari IP yang sama dijawab `429 RATE_LIMITED`. Hitungan ini
in-memory per proses API (bukan tabel), jadi beberapa instance memegang hitungan
terpisah. Cookie `tarlink_rt` yang hadir tetapi tidak bisa didekode tetap dihapus
lewat `Set-Cookie` pada `/auth/refresh` dan `/auth/logout`, sehingga browser tidak
mengirim sampah yang sama terus-menerus.

Mode cookie mengandsikan panel dan API **same-site** (beda port/subdomain masih
same-site). Memindahkan panel ke domain lain mematikan `SameSite=Strict`, sehingga
silent refresh tidak jalan dan operator harus login tiap 15 menit.

**Bentuk respons**

Sebagian besar endpoint menulis payload di dalam `data`:

```json
{ "data": { "…": "…" } }
```

Pengecualian yang sudah beku: `GET /health`, katalog publik (`GET /vendors`,
`GET /categories`, `GET /policies/:code`), dan `GET /bookings` yang mengembalikan objek
halaman `{ items, total, page, page_size }` langsung. Klien Flutter membuka `data`
otomatis bila ada.

**Error**

```json
{ "error": { "code": "BOOKING_NOT_FOUND", "message": "Booking tidak ditemukan" } }
```

Kode status yang dipakai: `400` validasi, `401` sesi tidak sah, `403` peran kurang,
`404` tidak ada, `409` konflik status/jadwal, `422` aturan bisnis, `429` percobaan
berlebih, `500` server.

**Pagination**

Query: `page` (mulai 1, default 1), `page_size` (default 20, maks 100).

```json
{ "items": [], "total": 0, "page": 1, "page_size": 20 }
```

**Uang** — selalu integer rupiah (`1500000`), tidak pernah string atau desimal.
Format tampilan dilakukan klien.

**Idempotensi** — `POST /bookings`, `POST /payments/dp`, `POST /payments/settlement`,
`POST /admin/bookings/:id/settle`, `POST /admin/release`, `POST /admin/payouts`, dan
`POST /admin/payouts/:id/approve` mewajibkan header `Idempotency-Key` (16–80 karakter).
Request dengan key dan payload sama mengembalikan hasil yang sama; replay ditandai
header `Idempotency-Replayed: true`. Key yang sama dengan payload berbeda dijawab
`409 IDEMPOTENCY_MISMATCH` **setelah permintaan pertama berhasil** — selama permintaan
pertama gagal, klaimnya ditandai `failed` dan key itu boleh dicoba ulang dengan payload
yang sama. `POST /bookings` juga menerima `client_generated_id` (UUID) sebagai fallback
dan sebagai guard unik per pelanggan.

---

## Health

| Method | Path | Keterangan |
|---|---|---|
| GET | `/health` | Liveness: `200` selama proses menjawab; tidak menyentuh DB |
| GET | `/health/ready` | Readiness: `200 { status: "ok", checks: { db: "ok" } }` bila `SELECT 1` berhasil; `503 { status: "degraded", checks: { db: "error" } }` bila DB tidak bisa dihubungi |

`/health/ready` dipakai `HEALTHCHECK` image API; jangan menggantinya dengan
`/health` karena liveness akan tetap 200 walau DB mati.

---

## Auth

| Method | Path | Body | Keterangan |
|---|---|---|---|
| POST | `/auth/register` | `{ full_name, email, phone, password, consent: { tos_version_id, privacy_version_id } }` | **Tidak** membuat akun. Menyimpan pendaftaran sementara (password sudah di-hash) di `otp_requests.metadata` lalu mengirim kode 6 digit ke email. Balasan `{ verification_required, email, expires_in, dev_code? }` |
| POST | `/auth/register/verify` | `{ email, code }` | Membuat akun pelanggan + consent + role `customer`, menandai `email_verified_at`, lalu memberi sesi |
| POST | `/auth/register/resend` | `{ email }` | Kirim ulang kode pendaftaran (pending maksimal 24 jam, kode terbaru yang berlaku) |
| POST | `/auth/password/forgot` | `{ email }` | Selalu `{ sent: true }`. Hanya akun berpassword (bukan Google) yang dikirimi kode `password_reset` |
| POST | `/auth/password/verify` | `{ email, code }` | Menukar kode reset dengan `reset_token` sekali pakai (10 menit, disimpan sebagai hash) |
| POST | `/auth/password/reset` | `{ reset_token, password }` | Mengganti password, mencabut **semua** sesi, menandai email terverifikasi |
| POST | `/auth/login` | `{ email, password }` | **Email**, bukan nomor WA; akun `admin_*` menerima challenge 2FA, bukan sesi. Akun berpassword yang belum verifikasi ditolak `403 EMAIL_NOT_VERIFIED` |
| POST | `/auth/otp/request` | `{ email }` | Kirim OTP ke email (dev mengembalikan `dev_code` hanya bila `NODE_ENV !== production` **dan** `OTP_DEV_MODE=true`) |
| POST | `/auth/otp/verify` | `{ email, code }` | Verifikasi OTP; akun `admin_*` juga melewati gerbang 2FA |
| POST | `/auth/google` | `{ id_token, consent?: { tos_version_id, privacy_version_id } }` | Login Google (dipakai mobile). Akun **baru** tidak langsung mendapat sesi: data diparkir di `otp_requests` (`purpose='register'`, `provider='google'`, tanpa hash sandi), kode dikirim ke email, balasan `{ verification_required: true, email, expires_in, provider: 'google', dev_code? }` (ADR 0037). Sesi diterbitkan oleh `POST /auth/register/verify`. Akun lama tetap langsung login; `consent` **wajib** untuk akun baru (FR-103) dan diabaikan untuk akun lama; akun `admin_*` juga melewati gerbang 2FA |
| POST | `/auth/2fa/verify` | `{ challenge_token, code }` | Langkah 2 login admin: tukar ticket + TOTP 6 digit jadi sesi |
| POST | `/auth/2fa/backup-code` | `{ challenge_token, code }` | Sama, memakai satu backup code (`XXXX-XXXX`, sekali pakai) |
| POST | `/auth/2fa/enroll` | `{ enroll_token }` | Langkah 1 enrollment: `secret` + `otpauth_uri` (entri manual, tanpa QR) |
| POST | `/auth/2fa/enroll/verify` | `{ enroll_token, code }` | Langkah 2 enrollment: aktifkan TOTP, sesi + `backup_codes` (tampil sekali) |
| POST | `/auth/2fa/reset` | `{ user_id }` | `admin_super` menghapus 2FA admin lain dan mencabut semua sesinya |
| POST | `/auth/refresh` | `{ refresh_token?, cookie? }` | Rotasi sesi; tanpa body memakai cookie `tarlink_rt` (panel) atau Bearer lama (legacy) |
| POST | `/auth/logout` | `{ refresh_token? }` | Mencabut sesi dari refresh token body, cookie `tarlink_rt`, atau `jti`; selalu menghapus cookie |
| GET | `/auth/me` | — | Profil + peran pengguna |
| DELETE | `/auth/me` | `{ confirm: "HAPUS AKUN", reason? }` | Hapus akun mandiri (anonimisasi, FR-101) |
| GET | `/auth/account-deletion` | — | Status permintaan hapus akun terbaru |

Respons login (dibungkus `data`) bisa berbentuk **sesi** atau **challenge 2FA**.
Pelanggan dan vendor menerima sesi seperti sebelumnya:

```json
{
  "data": {
    "access_token": "…",
    "refresh_token": "…",
    "token_type": "Bearer",
    "expires_in": 900,
    "user": { "id": "uuid", "phone": "+62…", "roles": ["customer"], "email": "…" }
  }
}
```

`user.email` hanya ada pada login password/Google dan penyelesaian 2FA. `user` tidak
memuat `full_name`; profil lengkap ada di `GET /auth/me`.

Akun dengan peran `admin_*` **tidak pernah** menerima sesi langsung dari login. Gerbang
2FA berlaku untuk semua jalur login (password, OTP, Google), sehingga `admin_*` menerima
salah satu dari dua bentuk berikut:

```json
{ "data": { "mfa_required": true, "challenge_token": "…", "expires_in": 600 } }
```

```json
{ "data": { "mfa_setup_required": true, "enroll_token": "…", "expires_in": 600 } }
```

`mfa_required` berarti TOTP sudah aktif dan login menunggu kode; `mfa_setup_required`
berarti admin belum enrollment dan harus menyelesaikannya lebih dulu. Ticket `verify`
dan `enroll` sama-sama berlaku 10 menit dan hanya sekali pakai; token yang salah jenis
(mis. `enroll_token` dikirim ke `/auth/2fa/verify`) dijawab `401` seperti token tidak
dikenal.

**Alur 2FA admin (FR-128).** `POST /auth/2fa/verify` menukar `challenge_token` + kode
TOTP 6 digit menjadi sesi dengan bentuk yang sama seperti login biasa (termasuk
`refresh_token`). `401 UNAUTHENTICATED` untuk ticket tidak sah/kedaluwarsa/sudah dipakai
atau kode salah; `429 RATE_LIMITED` setelah 6 tebakan salah pada satu ticket, atau bila
budget 10 kegagalan dalam 15 menit untuk email/IP yang sama sudah habis.
`POST /auth/2fa/backup-code` memakai kode cadangan `XXXX-XXXX` (dash dan huruf
besar/kecil dinormalisasi server); setiap kode hanya berlaku sekali.

`POST /auth/2fa/enroll` adalah langkah 1 dan hanya butuh `enroll_token` — tanpa bearer,
karena ticket itu sendiri kredensialnya. Respons:

```json
{ "data": { "secret": "…", "otpauth_uri": "otpauth://totp/…", "expires_in": 600 } }
```

Server tidak mengirim QR: klien menampilkan `secret` untuk entri manual atau merender
`otpauth_uri` sendiri. `expires_in` adalah sisa umur ticket, bukan TTL baru. Bila 2FA
sudah aktif, endpoint ini menjawab `409 CONFLICT`.

`POST /auth/2fa/enroll/verify` adalah langkah 2: mengaktifkan TOTP, menerbitkan sesi, dan
mengembalikan `backup_codes` (10 kode sekali pakai) **hanya pada respons ini**. Kode
salah → `401`, batas tebakan habis → `429`, 2FA sudah aktif → `409`.

`POST /auth/2fa/reset` hanya untuk `admin_super`; peran admin lain `403 FORBIDDEN`.
Body `{ user_id }`, respons `{ "user_id": "uuid", "revoked_sessions": 2 }`. TOTP, backup
code, dan ticket target dihapus, semua sesi target dicabut, dan tindakan dicatat di
`audit_logs` dengan aksi `auth.2fa.reset` (header `x-request-id` ikut disimpan bila
dikirim). Target yang bukan admin aktif dijawab `404 NOT_FOUND`.

Enrollment dan verifikasi TOTP membutuhkan `TOTP_ENCRYPTION_KEY` (base64 dari 32 byte;
`TOTP_ENCRYPTION_KEY_PREVIOUS` untuk rotasi). Tanpa kunci itu server gagal tertutup:
`500 INTERNAL_ERROR` dan tidak ada secret yang tersimpan.

`GET /auth/me` mengembalikan `{ "data": { "user": { id, phone, email, full_name,
roles, created_at } } }`. Peran diambil dari database, bukan dari isi token.

Registrasi wajib menyertakan `consent` (FR-103) berisi `id` versi kebijakan yang
sedang aktif dari `GET /policies/tos` dan `GET /policies/privacy`. API menolak
`400 VALIDATION_ERROR` bila salah satu versi bukan versi aktif (mis. tab lama),
lalu menulis dua baris `user_consents` dalam transaksi yang sama dengan pembuatan
user. Consent tidak diminta ulang saat login.

`DELETE /auth/me` adalah hapus akun mandiri (FR-101). Body wajib berisi
`confirm: "HAPUS AKUN"`; tanpa itu `400 VALIDATION_ERROR`. Data pribadi dianonimkan
di tempat (`phone`, `email`, `name`, `password_hash`, `google_sub`), semua sesi dan
peran dicabut, lalu permintaan dicatat di `account_deletion_requests`. Baris `users`
tetap ada agar booking/pembayaran/payout tidak kehilangan relasi. Respons:

```json
{ "data": { "id": "uuid", "status": "completed", "reason": "…", "requested_at": "…", "completed_at": "…" } }
```

Panggilan kedua mengembalikan catatan yang sama (idempoten).
`GET /auth/account-deletion` mengembalikan `{ "data": null }` bila akun masih utuh.

---

## Katalog publik

### `GET /vendors`

Query: `q` (cari nama/alamat, maks 80), `region` (kode wilayah, mis. `32`),
`category` (slug dari `/categories`), `date` (`YYYY-MM-DD`), `session`
(`day` | `night` | `full`), `sort` (`rating` default, `price_asc`, `name_asc`),
`page`, `page_size` (maks 50).

`date` hanya mengembalikan vendor yang punya slot `available` eksplisit pada
tanggal itu; kalender yang belum diisi tidak dianggap tersedia. `session` hanya
berlaku bila `date` diisi.

```json
{
  "items": [
    {
      "id": "uuid",
      "slug": "tarling-sinar-malam",
      "display_name": "Tarling Sinar Malam",
      "region_code": "3212",
      "region_name": "Kabupaten Indramayu",
      "base_address": null,
      "description": null,
      "avatar_url": "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=400&q=80",
      "banner_url": "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=1200&q=80",
      "photo_urls": [
        "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80"
      ],
      "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "rating": null,
      "rating_count": 0,
      "response_rate_bp": null,
      "category_slug": "tarling",
      "category_name": "Tarling & Dangdut",
      "min_dp_bp": 3000,
      "starting_price_idr": 5000000,
      "package_count": 1
    }
  ],
  "total": 18,
  "page": 1,
  "page_size": 20
}
```

`rating` bernilai `null` (bukan `0`) bila belum ada ulasan; `response_rate_bp`
adalah basis poin (`9200` = 92%). `category_slug`/`category_name` hanya berisi
kategori primer; `null` bila admin belum mengisi kategori.
`starting_price_idr` bisa `null` → tampilkan "Harga belum diisi", jangan `Rp0`.

### `GET /categories`

Kategori aktif, urut `sort_order`. Dipakai untuk chip filter katalog.

```json
{
  "items": [
    { "slug": "tarling", "name": "Tarling & Dangdut", "sort_order": 1 },
    { "slug": "organ-tunggal", "name": "Organ Tunggal", "sort_order": 2 }
  ]
}
```

### `GET /vendors/:idOrSlug`

Menerima UUID atau slug. Menambahkan `legal_name`, `avatar_url`, `banner_url`, `photo_urls`, `video_url`, `location {lat,lng}`,
`service_radius_km`, `transport_fee_per_km_idr`, `rating`, `rating_count`,
`response_rate_bp`, `category_slug`, `category_name`, `whatsapp`, `packages[]`
(`id`, `name`, `description`, `photo_url`, `duration_minutes`, `personnel_count`,
`inclusions[]`, `base_price_idr`, `addons[]`).

### `GET /vendors/:vendorId/availability?from=YYYY-MM-DD&to=YYYY-MM-DD`

```json
{
  "vendor_id": "uuid",
  "from": "2026-10-22",
  "to": "2026-12-05",
  "calendar_updated_at": "2026-10-01T00:00:00.000Z",
  "stale": true,
  "stale_threshold_days": 7,
  "days": [{ "date": "2026-10-22", "session": "night", "state": "available" }]
}
```

`state`: `available`, `held`, `unconfirmed`, `booked`, `blocked`.
Sesi: `day`, `night`, `full`. Bila `stale` benar, UI **wajib** menampilkan peringatan.

### `GET /policies/:code`

```json
{ "id": "uuid", "code": "cancellation", "version": "1.0", "body_hash": "…",
  "effective_from": "2026-01-01", "body": { "…": "…" } }
```

Seed berisi `cancellation`, `tos`, dan `privacy` (versi 1). Body `tos`/`privacy`
saat ini masih **placeholder** `{"status":"draft",...}` sampai teks hukum final
disetujui; jangan mengarang pasal. Kode lain bisa 404.

### `GET /favorites`

Daftar vendor favorit pelanggan. Wajib bearer token (peran `customer`).
Query: `page` (default 1), `page_size` (default 20, maks 100).
Mengembalikan `{ items, total, page, page_size }` berisi ringkasan vendor.

### `POST /favorites/:vendorId`

Menambahkan vendor ke daftar favorit pelanggan. Wajib bearer token.
Status: `204 No Content`. Idempoten jika sudah difavoritkan.

### `DELETE /favorites/:vendorId`

Menghapus vendor dari daftar favorit pelanggan. Wajib bearer token.
Status: `204 No Content`. Idempoten jika belum difavoritkan.

### `GET /vendors/:vendorId/reviews`

Daftar ulasan publik untuk vendor.
Query: `page` (default 1), `page_size` (default 20, maks 100).
Mengembalikan `{ items, total, page, page_size }` dengan item `{ id, booking_id, customer_name, rating, comment, created_at }`.

---

## Booking

### `POST /bookings`

Header wajib: `Idempotency-Key: <16–80 char>` (atau isi `client_generated_id`).

```json
{
  "vendor_id": "uuid",
  "package_id": "uuid",
  "client_generated_id": "uuid",
  "event": {
    "title": "Tarling hajatan",
    "event_type": "tarling",
    "region_code": "3212",
    "venue_name": "Rumah Pak Kades",
    "venue_address": "Jl. Raya Indramayu No. 12",
    "venue_location": { "lat": -6.3, "lng": 108.3 },
    "start_date": "2026-10-22",
    "end_date": "2026-10-22",
    "guest_estimate": 50,
    "notes": "Gerbang belakang"
  },
  "slots": [{ "date": "2026-10-22", "session": "night" }],
  "addons": [{ "addon_id": "uuid", "qty": 1 }],
  "policy_version_id": "uuid"
}
```

`venue_location` adalah koordinat **acara**, bukan lokasi vendor; opsional selama
picker peta belum tersedia. `policy_version_id` harus ada, aktif, dan berlaku
saat booking dibuat; versi kebijakan dibekukan ke `booking_terms_snapshot`.

Respons berisi booking lengkap. Replay dengan key + payload sama mengembalikan
booking yang sama (tidak membuat baris baru) dan menandai
`Idempotency-Replayed: true`.

Sejak 2026-11-26 (ADR 0043), pembuatan booking **mengunci slot selama 24 jam**
(batas `respond_deadline`). Sejak ADR 0044, **satu tanggal hanya untuk satu
booking**: hold/booking hidup di sesi mana pun (`day`/`night`/`full`) mengunci
seluruh tanggal. Pelanggan lain yang mencoba tanggal yang sama — walau berbeda
sesi — menerima `409 SLOT_UNAVAILABLE`. Kunci dilepas saat vendor menolak, booking
dibatalkan/kedaluwarsa, atau hold-nya lewat waktu — hold yang kedaluwarsa terbaca
sebagai `unconfirmed` sehingga tanggal kembali bisa dipesan. Blokir vendor tetap
per sesi, kecuali blokir `full` yang berlaku sehari penuh.

### `GET /bookings`

Query: `page`, `page_size`, `status` (opsional).

### `GET /bookings/:id`

```json
{
  "id": "uuid",
  "code": "BK-261021-34E0",
  "lifecycle_status": "confirmed",
  "payment_status": "dp_paid",
  "settlement_status": "held",
  "vendor": { "id": "…", "slug": "…", "display_name": "…", "whatsapp": "…" },
  "package": { "id": "…", "name": "…" },
  "event": { "title": "…", "region_code": "…", "venue_name": "…",
             "venue_address": "…", "location": { "lat": -6.3, "lng": 108.3 },
             "start_date": "…", "end_date": "…", "guest_estimate": 50, "notes": null },
  "slots": [{ "date": "2026-10-21", "session": "night" }],
  "pricing": { "total_customer_idr": 5050000, "dp_amount_idr": 1500000 },
  "total_customer_idr": 5050000,
  "dp_amount_idr": 1500000,
  "outstanding_idr": 3550000,
  "settlement_available_at": "2026-10-13T17:00:00.000Z",
  "created_at": "…",
  "updated_at": "…"
}
```

`outstanding_idr` mengikuti status pembayaran:
`unpaid` → total, `dp_paid` → total − DP, `fully_paid`/`refunded` → 0.

`settlement_available_at` (ADR 0038) adalah instan ISO-8601 UTC saat tagihan
pelunasan boleh dibuat: **pukul 00:00 WIB pada tanggal acara dikurangi 7 hari**.
Contoh pada respons di atas (`2026-10-13T17:00:00.000Z`) berarti **14 Okt 2026
00:00 WIB** untuk acara 21 Okt 2026 — bukan tengah malam UTC.
Nilainya `null` bila booking tidak punya baris event. Klien **tidak** menghitung
H-7 sendiri; bila nilainya `null` (mis. saat rolling deploy) pelunasan dianggap
terbuka seperti sebelumnya.

### Transisi

| Method | Path | Keterangan |
|---|---|---|
| POST | `/bookings/:id/accept` | Vendor menerima (peran vendor) |
| POST | `/bookings/:id/decline` | Vendor menolak, `{ reason_code, reason_note? }` |
| POST | `/bookings/:id/cancel` | Pelanggan membatalkan, `{ reason_code, reason_note? }` |
| POST | `/bookings/:id/checkin` | Vendor check-in; `{ lat?, lng?, note? }` → `in_progress` |
| POST | `/bookings/:id/no-show` | Pelanggan/admin menandai vendor tidak hadir; `{ reason }` |

`checkin` hanya sah pada booking `confirmed` di jendela check-in (3 jam sebelum
sampai 2 jam setelah jam mulai). GPS opsional; tanpa GPS check-in tetap tercatat.
`no-show` hanya sah setelah jendela no-show (2 jam setelah jam mulai), mengubah
lifecycle ke `no_show` dan settlement ke `disputed`, serta membuka baris `disputes`
agar dana tidak bisa dirilis.

Konflik status → `409`.

### `POST /bookings/:id/disputes`

FR-056: pelanggan atau vendor membuka sengketa sendiri. Ada dua jendela, ditentukan
oleh status settlement booking:

| Kondisi | Jendela | Aktor (state machine) |
|---|---|---|
| settlement `held` (sebelum rilis) | `dispute_window_ends_at` = `scheduled_end_at` + **7 hari** | `customer`, `vendor_owner`, `admin_support` (S-04) |
| settlement `released` (setelah rilis) | `released_at` + **30 hari** (klaim clawback) | `customer`, `admin_support` (S-08) |

Jendela pra-rilis dihitung dari **akhir acara**, bukan dari `completed_at`. Jendela
pasca-rilis dihitung dari waktu dana dirilis (`released_at`), bukan dari tanggal acara;
setelah 30 hari lewat, klaim ditolak `409 CONFLICT`.

Endpoint ini menerima peran `customer` dan `vendor_owner`. Pada booking yang sudah
`released` hanya `customer` yang bisa membuka sengketa, karena S-08 tidak memuat
`vendor_owner` sehingga vendor dijawab `409`. `admin_support` adalah aktor sah pada S-04
dan S-08 di state machine, tetapi belum ada endpoint HTTP untuknya — admin menangani
sengketa yang sudah ada lewat antrean `/admin/disputes`.

```json
{
  "reason_code": "quality",
  "description": "Fotografer tidak datang sesuai paket yang disepakati."
}
```

- `reason_code` wajib salah satu dari: `not_as_described`, `late_arrival`, `fraud`,
  `quality`, `cancellation_abuse`, `other`. `no_show` tidak dapat dipilih di sini —
  jalur itu hanya lewat `POST /bookings/:id/no-show`.
- `description` wajib 10–1000 karakter.

Status `201 Created`. Respons:

```json
{
  "data": {
    "dispute_id": "uuid",
    "booking_id": "uuid",
    "status": "open",
    "reason_code": "quality",
    "description": "…",
    "opened_at": "2026-11-07T10:00:00.000Z",
    "sla_due_at": "2026-11-10T10:00:00.000Z"
  }
}
```

Efeknya, dalam satu transaksi: settlement `held` → `disputed`
(`dispute.open`) atau settlement `released` → `disputed`
(`dispute.open_post_release`, hanya pelanggan), satu baris `disputes` baru,
satu baris riwayat, dan outbox `booking.dispute_opened`. Baris sengketa memakai
SLA admin **72 jam** (`sla_due_at = opened_at + 72 jam`).

`409 CONFLICT` bila: jendela yang berlaku sudah lewat (7 hari pra-rilis atau 30 hari
pasca-rilis), settlement bukan `held`/`released`, atau sudah ada sengketa aktif untuk
booking tersebut. `403 FORBIDDEN` bila pemanggil bukan peserta booking.

### `GET /bookings/:id/disputes`

Daftar sengketa booking, urut `opened_at` terbaru. Boleh diakses pelanggan pemilik
booking, vendor terkait (`vendor_owner` atau anggota `vendor_members` aktif — tanpa
syarat `can_respond`, sama dengan akses `GET /bookings/:id`), dan admin
(`admin_support` / `admin_finance` / `admin_super`).
Pemanggil lain → `404 NOT_FOUND`, sama seperti `GET /bookings/:id`, agar keberadaan
booking tidak bocor. Jalur tulis (`POST /bookings/:id/disputes`) tetap lebih sempit:
hanya pelanggan pemilik booking atau `vendor_owner`, dan `403 FORBIDDEN` untuk pihak lain.

```json
{
  "data": [
    {
      "id": "uuid",
      "status": "open",
      "reason_code": "quality",
      "description": "…",
      "opened_at": "2026-11-07T10:00:00.000Z",
      "sla_due_at": "2026-11-10T10:00:00.000Z",
      "resolved_at": null,
      "resolution": null,
      "resolution_note": null
    }
  ]
}
```

### `POST /bookings/:bookingId/review`

Mengirim ulasan dan rating untuk booking yang sudah `completed`. Wajib bearer token pemilik booking.
Status: `201 Created`.

```json
{
  "rating": 5,
  "comment": "Pelayanan sangat memuaskan, suara jernih dan tepat waktu."
}
```

`rating` wajib integer `1` sampai `5`. `comment` opsional (maks 500 karakter).
Hanya satu ulasan per booking (`409` bila booking sudah diulas).

### `GET /bookings/:id/invoice`

Mengambil faktur/nota resmi untuk booking. Wajib bearer token pemilik booking (`customer`), vendor terkait (`vendor_owner` / `vendor_member`), atau admin (`admin_support` / `admin_finance` / `admin_super`). Mengembalikan `404 Not Found` bila booking tidak ada atau pemanggil tidak berwenang (anti-enumerasi IDOR).

Query:
- `format` (opsional): bila bernilai `json`, mengembalikan representasi JSON `{ data: invoice }` berisi rincian booking, customer, vendor, event, pricing, addons, dan payments. Default / selain `json` mengembalikan dokumen HTML siap cetak (`text/html; charset=utf-8`).

---

## Pembayaran

Provider pembayaran dipilih lewat `PJP_PROVIDER`:

- `midtrans` — Midtrans Core API, sandbox secara default (`MIDTRANS_IS_PRODUCTION=false`).
- `local` — gateway deterministik tanpa jaringan, dipakai test/dev tanpa kredensial.

Untuk Midtrans, isi `MIDTRANS_SERVER_KEY` dan `MIDTRANS_CLIENT_KEY` dari dashboard
sandbox. Nilai `order_id` Midtrans adalah `payments.id` (UUID), sehingga notifikasi
dan refund bisa mencari baris pembayaran yang sama.

### `POST /payments/dp`

Header wajib: `Idempotency-Key: <16–80 char>`.

```json
{ "booking_id": "uuid", "method": "qris" }
```

`method`: `qris`, `va_bca`, `va_bni`, `va_bri`, `va_mandiri`.
E-wallet (`gopay`, `ovo`, `dana`, `shopeepay`) **ditolak `400 VALIDATION_ERROR`**
sampai gateway menyediakan instruksi deeplink; jangan ditawarkan di UI.

```json
{
  "id": "uuid", "booking_id": "uuid", "kind": "dp", "status": "pending",
  "amount_idr": 1500000, "currency": "IDR", "method": "va_bca",
  "provider": "midtrans", "provider_ref": "uuid", "expires_at": "…",
  "payment_instruction": {
    "type": "va", "bank": "BCA", "va_number": "8808…", "expires_at": "…"
  }
}
```

Bentuk `instruction` per rail:

- QRIS Midtrans: `{ "type": "qris", "qr_url": "https://…/qr-code", "qr_string": "<payload EMV>", "expires_at": "…" }`.
  `qr_string` hanya ada bila Midtrans mengirimkannya; klien **mendahulukan**
  `qr_string` (render QR lokal) dan memakai `qr_url` sebagai cadangan karena
  gambar `merchants-app.*.midtrans.com` tidak mengirim header CORS.
- QRIS gateway lokal: `{ "type": "qris", "qr_string": "…", "expires_at": "…" }`.
- VA BCA/BNI/BRI: `{ "type": "va", "bank": "BCA", "va_number": "…", "expires_at": "…" }`.
- Mandiri Bill: `{ "type": "va", "bank": "MANDIRI", "va_number": "<bill_key>",
  "biller_code": "70012", "expires_at": "…" }`.

### `GET /payments/by-booking/:bookingId`

Mengembalikan pembayaran terakhir + instruksi. `404` bila belum ada tagihan.
Mendukung filter jenis via query parameter: `?kind=dp` (default) atau `?kind=settlement`.

### `POST /payments/settlement`

Pelunasan online (sisa 70% booking). Header wajib: `Idempotency-Key: <16–80 char>`, `Authorization: Bearer <token>`.

```json
{ "booking_id": "uuid", "method": "qris" }
```

`method`: `qris`, `va_bca`, `va_bni`, `va_bri`, `va_mandiri`.
E-wallet (`gopay`, `ovo`, `dana`, `shopeepay`) ditolak `400 VALIDATION_ERROR`.

Aturan status:
- `lifecycle_status` tidak boleh ditutup (`cancelled`, `rejected`, `expired`, `no_show`).
- `payment_status` harus `dp_paid` (`unpaid` → `409` DP must be paid before settlement, `fully_paid` → `409` booking is already fully paid).
- Pelunasan hanya dibuka **H-7** (ADR 0038): bila `now < settlement_available_at`
  endpoint menjawab `409 CONFLICT` dengan pesan
  `Pelunasan dibuka 20 Nov 2026 (7 hari sebelum acara).` Batas dihitung server
  dari tanggal acara WIB; mematikan tombol di klien saja tidak cukup.
- Sisa tagihan dihitung otomatis di server (`total_customer_idr - dp_amount_idr`).

Bentuk respons sama dengan DP (`payment` + `payment_instruction`).

### `GET /payments/settlement/by-booking/:bookingId`

Mengembalikan tagihan pelunasan terakhir untuk booking. `404` bila belum ada tagihan pelunasan.
Wajib bearer token dan divalidasi kepemilikan booking.

### `POST /payments/abandon`

Melepas tagihan `pending` milik pelanggan supaya ia bisa memilih metode lain.

```json
{ "booking_id": "uuid", "kind": "dp" }
```

`kind`: `dp` atau `settlement`. Respons: `{ "data": { "cancelled": true, "payment_id": "uuid" } }`
atau `{ "data": { "cancelled": false, "payment_id": null } }` bila tidak ada tagihan aktif.

Urutan server:

1. tagihan diakhiri di provider (`POST /v2/{order_id}/expire` untuk Midtrans)
   **sebelum** baris lokal diubah menjadi `failed` (`failure_code=METHOD_SWITCHED`);
2. bila provider tidak bisa memastikan tagihan berakhir, respons error dan tagihan
   tetap `pending` — jangan pernah meninggalkan dua tagihan yang sama-sama bisa dibayar;
3. tagihan yang sudah dibayar dijawab `409 CONFLICT` (perubahan metode setelah
   pembayaran berarti refund, bukan switch);
4. bila pembayaran masuk saat proses berjalan, server menolak pelepasan.

Pembayaran yang telat masuk untuk tagihan yang sudah dilepas tetap diterima
sebagai pembayaran sah **bila** tahap itu belum dibayar dan tidak ada pembayaran
lain yang sudah `paid`; tagihan pending lain untuk tahap yang sama ditandai
`failed` (`SUPERSEDED_BY_LATE_PAYMENT`). Bila sudah ada pembayaran lain, webhook
dicatat `failed` untuk ditindaklanjuti manual (jangan diam-diam diabaikan).

### `POST /payments/sync`

Menarik status terakhir ke provider dan menerapkannya lewat jalur yang sama
dengan webhook. Dipakai klien saat webhook tidak bisa menjangkau server
(mis. `localhost`); di produksi webhook tetap jalur utama.

```json
{ "booking_id": "uuid", "kind": "dp" }
```

Respons: `{ "data": { "status": "paid|pending|expired|failed|none", "updated": true } }`.
Status `expired`/`failed` dari provider menandai tagihan lokal dengan status yang
sama sehingga instruksi lama tidak lagi tampil sebagai tagihan aktif. Hanya
pemilik booking yang boleh memanggil; booking orang lain dijawab `403`.

### `POST /payments/:id/refund`

Peran `admin_finance` / `admin_super`. Body: `{ amount_idr, reason, evidence_url? }`.
`evidence_url` adalah tautan bukti (maks 500 karakter).

**Maker-checker (FR-128):** refund dengan nominal **> `REFUND_APPROVAL_THRESHOLD_IDR`**
(default Rp1.000.000) tidak langsung dieksekusi. Respons `201` berisi refund
berstatus `requested` dengan `requires_approval: true` dan belum ada jurnal.
Refund pada atau di bawah ambang dieksekusi langsung seperti sebelumnya.

Untuk Midtrans, refund QRIS dipanggil ke `POST /v2/{order_id}/refund` dengan
`refund_key` = id refund, lalu status refund langsung difinalkan (`succeeded`) dan
jurnal `refund_disbursed` diposting. **Refund VA/Mandiri tidak didukung gateway**;
gunakan `POST /payments/:id/refund/manual` di bawah.

Refund yang `succeeded` selalu ikut memindahkan status pembayaran booking:

- Booking yang masih berjalan (`confirmed`/`in_progress`) menjadi
  `partially_refunded`, meskipun seluruh DP dikembalikan; booking belum selesai,
  jadi tidak boleh tampil `refunded`.
- Booking yang sudah selesai/dibatalkan dan seluruh uangnya dikembalikan sebelum
  dana dilepas menjadi `refunded` + settlement `not_eligible` (transisi P-04/P-09).
- Booking yang dananya sudah `released` tetap `partially_refunded`; penarikan
  dana setelah pencairan adalah jalur clawback, bukan refund.
- Status ditulis dalam transaksi yang sama dengan jurnal, jadi refund gagal
  (mis. provider menolak) tidak pernah mengubah booking.

### `POST /payments/:id/refund/manual`

Peran `admin_finance` / `admin_super`. Untuk pembayaran yang tidak bisa di-refund
provider (VA/Mandiri), admin mencatat transfer bank:

```json
{
  "amount_idr": 1500000,
  "reason": "Pembatalan acara, transfer balik via BCA",
  "transfer_ref": "TRF-20261117-001",
  "transferred_at": "2026-11-17T10:30:00.000Z",
  "evidence_url": "https://…"
}
```

Aturan:
- `payment` harus `paid`; nominal tidak boleh melebihi sisa yang belum di-refund.
- `fee_idr` selalu `0` dan `fee_bearer='platform'`: biaya gateway tidak
  dipotong dari uang pelanggan.
- Nominal **> `REFUND_APPROVAL_THRESHOLD_IDR`** berhenti di `requested` tanpa
  jurnal; admin lain menyetujui lewat `POST /payments/refunds/:id/approve`.
  Approver wajib berbeda dari pencatat transfer.
- Nominal di bawah ambang langsung `succeeded` dan memposting jurnal
  `refund_full_recognized`/`refund_partial_recognized` + `refund_disbursed`
  dalam satu transaksi.
- `transfer_ref` wajib; `transferred_at` default waktu server.
- Respons refund menyertakan `is_manual`, `transfer_ref`, dan `transferred_at`.
  `POST /payments/refunds/:id/approve` tidak memanggil provider untuk refund
  manual; ia memfinalkan jurnal dan status.

### `GET /payments/refunds`

Antrean admin (`admin_finance` / `admin_super`). Query: `status` opsional
(`requested|approved|processing|succeeded|failed|rejected`), `limit` 1–100
(default 50). Respons `{ data: { items } }`; setiap item berisi field refund plus
`booking_code`, `customer_name`, dan `created_at` (waktu pengajuan).

### `POST /payments/refunds/:id/approve`

Peran `admin_finance` / `admin_super`. Approver **wajib berbeda** dari pembuat
permintaan (four-eyes; `409 CONFLICT` bila sama). Setelah disetujui, provider
dipanggil, jurnal pengakuan + `refund_disbursed` diposting, status menjadi
`succeeded` (atau `failed` bila provider menolak).

### `POST /payments/refunds/:id/reject`

Peran `admin_finance` / `admin_super`. Body: `{ note }` minimal 5 karakter. Hanya
refund berstatus `requested` yang bisa ditolak; tidak ada pergerakan uang.

### `GET /payments/refunds/by-booking/:bookingId`

Pelanggan pemilik booking atau admin. Mengembalikan refund terbaru
(`{ "data": { "refund": … } }`) atau `{ "data": null }`. Pelanggan lain mendapat
`404 NOT_FOUND` (FR-133: status refund terlihat pelanggan).

---

## Notifikasi in-app

Pengganti kanal WhatsApp: worker `outbox` menulis satu baris
`notifications` per penerima (unik per `outbox:<message_id>:<user_id>`), lalu
mobile mem-poll endpoint ini dan menampilkan popup saat aplikasi terbuka.
Tidak ada endpoint kirim manual — isi dibuat dari event `booking.*`.

Sejak migrasi `028`, relay yang sama juga mengirim **email transaksional**
(FR-051) ke alamat `users.email` pelanggan/vendor untuk setiap event yang punya
copy in-app. Email tidak menambah endpoint: status kirim hanya tercatat di
`notification_deliveries` (ops/DB) dan tidak diekspos ke klien. Kegagalan email
tidak menghapus baris notifikasi in-app; pesan outbox di-retry dengan backoff.

Sejak migrasi `032`, worker `booking_reminders` menulis event
`booking.reminder_7d` / `booking.reminder_1d` / `booking.reminder_day` untuk booking
`confirmed`/`in_progress` pada H-7, H-1, dan hari-H (tanggal WIB). Dedupe-nya
`booking:<booking_id>:reminder:<offset>` di `outbox_messages`, jadi satu pengingat
per booking per jendela; copy-nya sama untuk in-app dan email.

Sejak migrasi `038`, relay yang sama juga mengirim **push FCM** (kanal ketiga,
`notification_deliveries.channel='push'`) ke token perangkat yang terdaftar lewat
`POST /v1/devices`. Push bersifat best-effort: tanpa `FCM_SERVICE_ACCOUNT_JSON`
di worker, push dilewati dan in-app + email tetap berjalan. Token yang dilaporkan
permanen tidak valid oleh Firebase dihapus dari `device_tokens`; kegagalan
sementara membuat pesan outbox di-retry.

### `GET /notifications`

Query: `unread_only=true|false` (default semua), `page` (mulai 1), `page_size`
(maks 100, default 20). Selalu terbatas pada akun pemanggil.

Respons: `{ data: { items, total, page, page_size } }`; item berisi
`{ id, type, title, body, payload, read_at, created_at }`. Mobile memakai
`payload.booking_id` untuk tombol "Lihat".

### `GET /notifications/unread-count`

Respons: `{ data: { unread } }`.

### `POST /notifications/:id/read`

Menandai satu notifikasi milik akun pemanggil. `404 NOT_FOUND` bila bukan miliknya.

### `POST /notifications/read-all`

Respons: `{ data: { updated } }` — jumlah baris yang baru ditandai.

### `POST /devices`

Body `{ token, platform: "android" | "ios" | "web" }`. Mendaftarkan token FCM
perangkat untuk akun pemanggil. `token` unik global: mendaftarkan ulang token yang
sama memindahkan kepemilikannya ke akun pemanggil. Respons `{ data: { registered: true } }`.

### `DELETE /devices/:token`

Menghapus token hanya bila baris itu milik akun pemanggil. Token milik akun lain
menghapus 0 baris dan dijawab `{ data: { removed: false } }` (bukan oracle
keberadaan token).

## Chat booking (FR-050)

Satu percakapan per booking. Peserta ditentukan dari **relasi booking**, bukan dari
peran di token: pelanggan pemilik booking → `customer`; pemilik atau anggota aktif
vendor → `vendor`; admin (`admin_support`, `admin_finance`, `admin_super`) → `admin`.
Akun lain mendapat `403 FORBIDDEN`. Pesan append-only, 1–2000 karakter setelah trim.

### `GET /bookings/:bookingId/chat/messages`

Query: `limit` (1–100, default 50), `before` (cursor `next_before` halaman sebelumnya).
Respons: `{ data: { items, next_before } }`, `items` urut lama → baru. Cursor hanya
berlaku untuk thread booking yang sama. Setiap item membawa `read_at` (ISO-8601 UTC
atau `null`); `null` berarti penerima belum membuka pesan itu (migrasi `039`).

### `POST /bookings/:bookingId/chat/messages`

Body: `{ "body": "…" }`. Respons `201`:

```json
{ "data": { "id": "…", "booking_id": "…", "sender_id": "…", "sender_role": "customer", "body": "…", "created_at": "…", "read_at": null } }
```

### `POST /bookings/:bookingId/chat/messages/read`

Body kosong. Menandai semua pesan pada booking tersebut yang **bukan** dikirim
pemanggil dan belum dibaca (`read_at IS NULL`). Idempoten: pemanggilan kedua
mengembalikan `read_ids` kosong.

```json
{ "data": { "read_ids": ["…"], "read_at": "2026-11-22T21:40:00.000Z" } }
```

Setiap UPDATE mengirim satu atau beberapa `NOTIFY tarlink_chat` bertipe `read`
(batch maksimal 100 id per notifikasi agar payload di bawah batas 8000 byte),
lalu diteruskan ke socket thread sebagai frame `read`.

Setiap insert memicu `NOTIFY tarlink_chat`; API yang sedang `LISTEN` meneruskannya ke
socket pelanggan thread tersebut.

### `WS /v1/chat/ws?token=<access_token>`

WebSocket memakai query `token` karena browser tidak bisa mengirim header
`Authorization` saat handshake. Origin dicek terhadap `CORS_ORIGINS`.

Frame klien:

```json
{ "type": "subscribe", "booking_id": "…" }
{ "type": "unsubscribe", "booking_id": "…" }
{ "type": "message", "booking_id": "…", "body": "…" }
{ "type": "ping" }
```

Frame server: `ready`, `subscribed` (berisi `role`), `unsubscribed`, `sent`
(berisi `message`), `message` (siaran ke semua socket thread), `read`, `pong`, dan
`error { code, message }`. Pengiriman lewat REST juga tersiar ke socket. Frame `read`
berbentuk `{ "type": "read", "booking_id": "…", "reader_id": "…",
"message_ids": ["…"], "read_at": "…" }` dan dipakai untuk mengubah centang satu
menjadi centang dua. Setelah
reconnect, klien memuat ulang riwayat lewat REST. Chat hanya teks; foto/lokasi dan
penyaringan kontak (FR-135) belum ada.

## Webhook Midtrans

```
POST /webhooks/midtrans
Content-Type: application/json
```

Body adalah notifikasi standar Midtrans. Autentikasi memakai `signature_key` di body:

```
SHA512(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)
```

Tidak ada header tanda tangan. Handler membalas `200` dan idempoten berdasarkan
`transaction_id:transaction_status`. Status `settlement`/`capture` (fraud `accept`)
menandai pembayaran `paid`; `expire` menandai `expired`; `deny`/`cancel`/`failure`
menandai `failed`; `pending` hanya dicatat.

URL notifikasi diset di Midtrans Sandbox Dashboard → Settings → Configuration →
Payment Notification URL, mis. `https://<host>/v1/webhooks/midtrans`. Midtrans tidak
bisa mengirim ke `localhost`; gunakan tunnel (ngrok/cloudflared) untuk dev.

## Webhook PJP (gateway lokal)

```
POST /webhooks/pjp
x-pjp-signature: <hex>
x-pjp-timestamp: <unix seconds>
```

Tanda tangan: `HMAC_SHA256(timestamp + "." + rawBody, PJP_WEBHOOK_SECRET)`,
toleransi 300 detik. Event yang diproses: `payment.paid` (idempoten berdasarkan
`payment_id` + `event_id`).

---

## Registrasi vendor (FR-002 / FR-003)

Pelanggan mengajukan diri sebagai vendor, lalu `admin_super` memutuskan. Akun tetap
`customer` sampai disetujui; persetujuan membuat baris `vendors`, memberi peran
`vendor_owner`, dan menyalin objek KTP privat ke `vendors.ktp_object_key`.

| Method | Path | Peran | Fungsi |
|---|---|---|---|
| GET | `/regions` | publik | Daftar kabupaten/kota untuk formulir |
| POST | `/vendor-applications/ktp` | `customer` | Upload foto KTP (multipart `file`, maks 5 MB) → `{ ktp_object_key }` |
| POST | `/vendor-applications` | `customer` | Kirim pengajuan |
| GET | `/vendor-applications/me` | `customer` | Status pengajuan terbaru (`null` bila belum ada) |
| GET | `/admin/vendor-applications` | `admin_support`, `admin_super` | Antrean (`status`, `page`, `page_size`) |
| GET | `/admin/vendor-applications/:id/ktp` | `admin_super` | Stream foto KTP privat |
| POST | `/admin/vendor-applications/:id/approve` | `admin_super` | Setujui |
| POST | `/admin/vendor-applications/:id/reject` | `admin_super` | Tolak (`{ note? }`) |

Body pengajuan:

```json
{
  "display_name": "Tarling Dian Malam",
  "legal_name": "CV Tarling Dian Malam",
  "nik": "3212010101010001",
  "region_code": "3212",
  "base_address": "Jl. Pantura No. 1, Indramayu",
  "ktp_object_key": "ktp/<userId>/<uuid>.jpg"
}
```

- `ktp_object_key` wajib berawalan `ktp/<userId pengaju>/`; kunci milik akun lain
  ditolak `400`. File disimpan di `PRIVATE_UPLOAD_DIR`, **dienkripsi AES-256-GCM**
  sebelum ditulis, dan **tidak** diserve lewat `/v1/media`.
- Akses file KTP hanya untuk `admin_super`; setiap unduhan dicatat sebagai
  `vendor.application.ktp_access` di `audit_logs`.
- NIK penuh hanya dikembalikan ke `admin_super`; `admin_support` dan pemilik
  melihat NIK tersamar (`************0001`).
- Saat pengajuan ditolak atau akun dihapus, referensi KTP dikosongkan dan file
  terenkripsinya dihapus (data minimisation).
- Satu akun hanya boleh punya satu pengajuan terbuka (`submitted`). Setelah
  ditolak, pengajuan baru diperbolehkan.
- Syarat menyetujui: peserta belum punya vendor, wilayah valid, dan file KTP ada.

---

## Portal vendor

Semua route di bawah butuh bearer token dengan peran `vendor_owner`. Vendor
diselesaikan dari `owner_user_id` di token; **tidak ada** parameter `vendor_id`
dari klien, sehingga satu vendor tidak bisa mengubah vendor lain.

| Method | Path | Keterangan |
|---|---|---|
| GET | `/vendor/me` | Profil lengkap + media + WhatsApp pemilik |
| PATCH | `/vendor/me` | Ubah profil/media milik sendiri |
| GET | `/vendor/dashboard` | Profil + ringkasan angka |
| GET | `/vendor/bookings` | Daftar booking vendor (`page`, `page_size`, `status`) |
| GET | `/vendor/bookings/:id` | Detail booking milik vendor |
| GET | `/vendor/earnings` | Saldo tertahan + riwayat pencairan |
| GET | `/vendor/earnings/export` | CSV pendapatan bulanan (FR-126) |
| GET | `/vendor/packages` | Semua paket sendiri (termasuk nonaktif) |
| POST | `/vendor/packages` | Buat paket |
| PATCH | `/vendor/packages/:id` | Ubah paket milik sendiri |
| DELETE | `/vendor/packages/:id` | Nonaktifkan paket (soft delete) |
| GET | `/vendor/packages/:packageId/price-rules` | Daftar aturan harga musiman paket |
| POST | `/vendor/packages/:packageId/price-rules` | Tambah aturan harga musiman paket |
| PUT | `/vendor/packages/:packageId/price-rules/:ruleId` | Ubah aturan harga musiman paket |
| DELETE | `/vendor/packages/:packageId/price-rules/:ruleId` | Hapus aturan harga musiman paket |
| PUT | `/vendor/calendar` | Set `available`/`blocked` untuk rentang tanggal |
| POST | `/vendor/media` | Upload gambar (multipart: `file`, `kind`, `package_id?`, `license_statement`) → status `pending` |
| POST | `/vendor/media/link` | Ajukan media berupa tautan (JSON: `url`, `kind`, `package_id?`, `license_statement`) → `pending` |
| GET | `/vendor/media` | Semua media milik vendor beserta status moderasinya |
| DELETE | `/vendor/media/:id` | Batalkan media yang masih `pending` |
| GET | `/media/:filename` | Sajikan gambar upload (publik) |
| GET | `/vendor/bank-accounts` | Daftar rekening pencairan (masked, tanpa yang superseded) |
| POST | `/vendor/bank-accounts` | Daftarkan rekening tujuan payout |
| DELETE | `/vendor/bank-accounts/:id` | Batalkan rekening berstatus `pending` |
| GET | `/vendor/payouts` | Riwayat payout vendor (`page`, `page_size`) |

`GET /vendor/dashboard` mengembalikan profil vendor (termasuk `whatsapp`) dan
`summary`:

```json
{
  "data": {
    "vendor": { "id": "uuid", "display_name": "…", "verification_status": "approved", "…": "…" },
    "summary": {
      "total_bookings": 12,
      "pending_count": 2,
      "this_month_count": 4,
      "this_month_idr": "18500000"
    }
  }
}
```

`GET /vendor/earnings` mengembalikan `held_idr` (juga `held_balance_idr`), saldo yang
sudah Released tetapi belum ditransfer, dan halaman pencairan `settled`:

```json
{
  "data": {
    "held_idr": "3000000",
    "held_balance_idr": "3000000",
    "available_idr": "4500000",
    "pending_payout_idr": "0",
    "bank_account": {
      "bank_code": "bca",
      "bank_name": "BCA",
      "account_number_masked": "****7890",
      "account_holder_name": "CV Putra Dermayu",
      "status": "verified"
    },
    "settled": { "items": [], "total": 0, "page": 1, "page_size": 20 }
  }
}
```

`available_idr` dihitung dari saldo akun ledger `vendor_payable` (2120), bukan angka
berjalan yang disimpan. `pending_payout_idr` adalah jumlah payout berstatus
`requested`/`approved`/`processing`. `bank_account` bernilai `null` bila belum ada
rekening terverifikasi.

### `GET /vendor/earnings/export` (FR-126)

Query `from` dan `to` berformat `YYYY-MM-DD` dan ditafsirkan sebagai tanggal WIB.
Default: awal bulan berjalan sampai hari ini. Rentang maksimal 366 hari dan
5.000 baris; lebih dari itu dijawab `400 VALIDATION_ERROR`.

Tanpa `format=json`, respons berupa unduhan:

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="pendapatan-vendor-2026-11-01_2026-11-30.csv"
```

Kolom CSV: `tanggal_lepas`, `kode_booking`, `judul_acara`, `tanggal_acara`,
`gmv_idr`, `komisi_idr`, `biaya_layanan_idr`, `pendapatan_vendor_idr`,
`clawback_idr`, `pendapatan_bersih_idr`, `pencairan_idr`, `status_pencairan`,
`tanggal_pencairan`, diakhiri baris `TOTAL`. Hanya booking dengan `released_at`
di rentang tersebut yang muncul.

Nilai uang diambil dari jurnal booking, bukan dihitung ulang dari kolom booking:
GMV = debit `2100`, komisi = kredit `4100`, biaya layanan = kredit `4110`,
pendapatan vendor = kredit `2120` (jurnal `release`), dan clawback = debit `2120`
pada jurnal `clawback_recognized`. Baris `TOTAL` menjumlahkan sel yang sama,
sehingga total laporan cocok dengan ledger (selisih Rp0). CSV memakai BOM UTF-8
dan CRLF agar terbuka rapi di Excel.

Dengan `format=json` respons berisi pratinjau untuk mobile:

```json
{
  "data": {
    "filename": "pendapatan-vendor-2026-11-01_2026-11-30.csv",
    "period": { "from": "2026-11-01", "to": "2026-11-30" },
    "row_count": 12,
    "source": "release_journal",
    "totals": {
      "gmv_idr": 150000000,
      "commission_idr": 7500000,
      "service_fee_idr": 3000000,
      "vendor_entitlement_idr": 139500000,
      "clawback_idr": 500000,
      "net_vendor_idr": 139000000,
      "payout_idr": 93000000
    },
    "csv": "\uFEFFtanggal_lepas,kode_booking,..."
  }
}
```

`GET /vendor/bookings` mengembalikan objek halaman langsung (`items`, `total`, `page`,
`page_size`). Setiap item memuat `code`, tiga status, `total_customer_idr`,
`dp_amount_idr`, `vendor_entitlement_idr`, `respond_deadline`, data acara, dan kontak
pelanggan. `GET /vendor/bookings/:id` menambahkan rincian harga, timestamp siklus
hidup, dan data paket, dibungkus `data`.

### `PATCH /vendor/me`

```json
{
  "display_name": "Putra Dermayu Tarling Group",
  "legal_name": "CV Putra Dermayu",
  "description": "Grup tarling ...",
  "base_address": "Jatibarang, Indramayu",
  "service_radius_km": 25,
  "free_radius_km": 5,
  "transport_fee_per_km_idr": 15000,
  "min_dp_bp": 3000,
  "avatar_url": "https://.../v1/media/....jpg",
  "banner_url": "https://.../v1/media/....jpg",
  "photo_urls": ["https://.../v1/media/....jpg"],
  "video_url": "https://youtube.com/..."
}
```

Field admin-only ditolak `400`: `verification_status`, `region_code`,
`is_active`, `slug`, `rating`. `photo_urls` maks 8 URL `http/https`;
string kosong mengosongkan kolom nullable.

### Paket

```json
{
  "name": "Paket Hajatan Lengkap",
  "duration_minutes": 480,
  "personnel_count": 15,
  "base_price_idr": 40000000,
  "description": "Siang-malam ...",
  "inclusions": ["Sound System 5.000 Watt", "Genset 10 kVA"],
  "photo_url": "https://.../v1/media/....jpg",
  "is_active": true
}
```

`duration_minutes` 30–1440, `personnel_count` 0–200, `base_price_idr` > 0,
`inclusions` maks 30 item. `DELETE` hanya menonaktifkan (`is_active=false`).

### `PUT /vendor/calendar`

```json
{ "from": "2026-11-01", "to": "2026-11-07",
  "status": "available", "sessions": ["day", "night"] }
```

Hanya `available`/`blocked`. Slot `held`/`booked` tidak ditimpa. `source`
disimpan sebagai `vendor`.

### Media (moderasi wajib)

Setiap media vendor melewati moderasi (FR-107). Unggahan **tidak** langsung tampil
di katalog publik: ia tersimpan di tabel `vendor_media` berstatus `pending` dan baru
masuk ke kolom publik (`vendors.avatar_url`, `banner_url`, `photo_urls`, `video_url`,
`packages.photo_url`) setelah admin menyetujui.

`POST /vendor/media` menerima `multipart/form-data`:

| Field | Wajib | Isi |
|---|---|---|
| `file` | ya | JPEG/PNG/WebP asli (dicek dari magic bytes), maksimal 5 MB |
| `kind` | tidak | `avatar`, `banner`, `gallery`, `package_photo`, `video` (default `gallery`) |
| `package_id` | hanya `package_photo` | UUID paket milik vendor itu |
| `license_statement` | ya | Pernyataan hak/lisensi, minimal 10 karakter |

Respons `201`:

```json
{
  "data": {
    "media": {
      "id": "uuid",
      "vendor_id": "uuid",
      "package_id": null,
      "kind": "gallery",
      "url": "http://host/v1/media/<uuid>.jpg",
      "status": "pending",
      "license_statement": "Saya pemilik media ini",
      "review_note": null,
      "reviewed_at": null,
      "created_at": "2026-11-04T13:00:00.000Z"
    }
  }
}
```

`POST /vendor/media/link` memakai body JSON yang sama tanpa `file`, untuk video atau
media yang sudah dihosting di tempat lain.

`PATCH /vendor/me` menolak URL media yang belum disetujui:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Media belum disetujui: https://…",
    "details": { "reason": "MEDIA_NOT_APPROVED" }
  }
}
```

Mengosongkan media (`null` atau `""`) tetap diizinkan.

Aturan yang sama berlaku untuk `photo_url` pada `POST/PATCH /vendor/packages`: nilainya
harus URL media yang sudah `approved` milik vendor itu, kalau tidak responsnya
`VALIDATION_ERROR` dengan `details.reason = "MEDIA_NOT_APPROVED"`. Untuk paket baru,
unggah foto setelah paket tersimpan (foto paket butuh `package_id`).

`GET /media/:filename` publik, cache immutable, hanya nama file yang dibuat
server (aman dari path traversal).

### Aturan Harga Musiman (`/vendor/packages/:packageId/price-rules`)

Pengaturan penyesuaian harga paket dinamis (FR-109) berbasis tanggal dan hari dalam seminggu (`dow_mask`). Wajib bearer token peran `vendor_owner` dan pemilik paket.

- **`GET /vendor/packages/:packageId/price-rules`**: daftar seluruh aturan untuk paket (`{ data: PriceRuleRecord[] }`).
- **`POST /vendor/packages/:packageId/price-rules`**: membuat aturan baru (status `201 Created`, respons `{ data: PriceRuleRecord }`). Body:
  - `label`: string (1–80 karakter)
  - `rule_type`: `"multiplier"` | `"fixed"`
  - `date_from`: `YYYY-MM-DD` | null (opsional)
  - `date_to`: `YYYY-MM-DD` | null (opsional)
  - `dow_mask`: integer 1–127 (opsional, default 127 = setiap hari)
  - `multiplier_bp`: integer 5000–30000 basis points (50%–300%, wajib jika `multiplier`, terlarang jika `fixed`)
  - `fixed_price_idr`: integer rupiah (wajib jika `fixed`, terlarang jika `multiplier`)
  - `priority`: integer (opsional, default 100; angka lebih kecil = prioritas lebih tinggi)
  - `is_active`: boolean (opsional, default true)
- **`PUT /vendor/packages/:packageId/price-rules/:ruleId`**: memperbarui aturan harga yang ada (field parsial sama seperti create, respons `{ data: PriceRuleRecord }`).
- **`DELETE /vendor/packages/:packageId/price-rules/:ruleId`**: menghapus aturan harga (`{ data: { deleted: true } }`).

---

## Admin

Semua butuh peran `admin`/`operator`.

| Method | Path | Keterangan |
|---|---|---|
| GET | `/admin/dashboard` | Ringkasan angka |
| GET | `/admin/bookings` | Daftar booking + filter |
| GET | `/admin/bookings/:id` | Detail |
| POST | `/admin/bookings/:id/settle` | Pelunasan manual |
| GET | `/admin/vendors` | Daftar vendor |
| GET | `/admin/vendors/:id` | Detail vendor |
| GET | `/admin/media` | Antrean moderasi media (`status`, `page`, `page_size`) |
| POST | `/admin/media/:id/approve` | Setujui media → tayang di kolom publik |
| POST | `/admin/media/:id/reject` | Tolak media (body `{ note }`, minimal 5 karakter) |
| GET | `/admin/release/queue` | Antrean pelepasan dana |
| POST | `/admin/release/preview` | Pratinjau jurnal pelepasan |
| POST | `/admin/release` | Eksekusi pelepasan |
| GET | `/admin/ledger` | Jurnal + saldo akun |
| GET | `/admin/payments` | Daftar pembayaran |
| GET | `/admin/disputes` | Sengketa |
| POST | `/admin/disputes/:id/resolve` | Putusan sengketa (lihat di bawah) |
| POST | `/admin/disputes/:id/clawback` | Ajukan clawback pasca-pencairan (FR-122) |
| POST | `/admin/disputes/:id/clawback/approve` | Setujui clawback (admin lain) |
| POST | `/admin/disputes/:id/clawback/reject` | Tolak pengajuan clawback |
| GET | `/admin/audit` | Audit log |
| GET | `/admin/operators` | Akun operator |
| GET | `/admin/regions` | Daftar wilayah + jumlah vendor aktif (FR-125) |
| PATCH | `/admin/regions/:code` | Aktif/nonaktif wilayah (`admin_super`, body `{ is_active }`) |
| GET/PUT | `/admin/settings` | Pengaturan platform |
| POST | `/admin/vendors` | Buat vendor |
| PATCH | `/admin/vendors/:id` | Ubah vendor |
| GET/PUT | `/admin/vendors/:id/categories` | Baca/ganti kategori vendor |
| POST | `/admin/vendors/:id/verify` | Verifikasi vendor |
| POST | `/admin/vendors/:id/suspend` | Tangguhkan vendor (`admin_super`, FR-132) |
| POST | `/admin/vendors/:id/unsuspend` | Cabut penangguhan vendor (`admin_super`, FR-132) |
| GET/POST | `/admin/vendors/:id/packages` | Daftar/buat paket |
| PATCH/DELETE | `/admin/vendors/:id/packages/:packageId` | Ubah/hapus paket |
| GET/PUT | `/admin/vendors/:id/calendar` | Baca/tulis kalender |
| GET | `/admin/payouts` | Daftar payout (`status`, `vendor_id`, `page`, `page_size`) |
| GET | `/admin/payouts/eligible` | Booking released yang bisa dicairkan + saldo ledger |
| GET | `/admin/payouts/:id` | Detail payout + item + jurnal |
| POST | `/admin/payouts` | Buat payout (maker) |
| POST | `/admin/payouts/:id/approve` | Setujui & kirim ke provider (checker) |
| POST | `/admin/payouts/:id/reject` | Tolak payout `requested` |
| POST | `/admin/payouts/:id/cancel` | Batalkan payout `requested` (pembuat) |
| GET | `/admin/vendors/:vendorId/bank-accounts` | Rekening pencairan vendor |
| POST | `/admin/vendors/:vendorId/bank-accounts/:id/verify` | Verifikasi rekening (`admin_super`) |
| POST | `/admin/vendors/:vendorId/bank-accounts/:id/reject` | Tolak rekening (`admin_super`) |
| POST | `/admin/reconciliation/runs` | Jalankan rekonsiliasi lane payment (body `{ provider, report_date }`) |
| GET | `/admin/reconciliation/runs` | Daftar run (`page`, `page_size` maks 100) |
| GET | `/admin/reconciliation/runs/:id` | Detail run + daftar diff |
| POST | `/admin/reconciliation/diffs/:id/resolve` | Putuskan satu temuan (body `{ resolution, note }`) |
| GET | `/admin/ops/alerts` | Ringkasan antrean operasional (semua peran admin, read-only) |
| GET | `/admin/report-appeals` | Antrean banding takedown (`status`, `page`, `page_size`) |
| POST | `/admin/report-appeals/:id/resolve` | Putuskan banding (`accepted`/`rejected`, support/super) |

`PATCH /admin/vendors/:id` juga menerima `avatar_url`, `banner_url`,
`photo_urls`, `video_url`. `POST/PATCH .../packages` menerima
`personnel_count`, `inclusions[]`, dan `photo_url` (sama seperti portal vendor).

### Rekonsiliasi harian (FR-131)

Fase 1 bersifat **read-only**: membandingkan sisi gateway dengan ledger dan
menyimpan temuan. Tidak ada jurnal yang diposting dan tidak ada baris
`payments`/`payouts`/`refunds` yang diubah. Fase 2 menambahkan SLA per temuan dan
keputusan admin (`resolution`) di atas data yang sama; modul tetap tidak
memposting jurnal. Peran: `admin_finance`/`admin_super`.

Selain lewat endpoint di bawah, worker menjalankan `reconcile_daily` sekali per
hari WIB (setelah `recon_hour_wib`, default 07:00) untuk **kemarin**, bila
`platform_settings.recon_enabled=true`. Run worker memakai `trigger_source=worker`,
`triggered_by=null`, dan audit `reconciliation.run_daily`. Panggilan manual pada
tanggal yang sudah dijalankan worker mengembalikan run yang sama (idempoten).

`POST /admin/reconciliation/runs` menerima `{ "provider": "midtrans" | "pjp",
"report_date": "YYYY-MM-DD" }` (tanggal kalender WIB). Sisi gateway dibaca dari
`webhook_events` (`signature_valid = true`, event `payment.paid`) pada
`received_at`; sisi ledger dari `payments` berstatus `paid` pada `paid_at`.
Batas hari setengah-terbuka: `>= 00:00 WIB` dan `< 00:00 WIB hari berikutnya`.
`Idempotency-Key` opsional pada fase ini karena `UNIQUE (provider, scope,
report_date)` sudah membuat operasi idempoten: panggilan kedua mengembalikan run
yang sama tanpa menulis diff/audit baru.

Status run: `balanced` bila tidak ada temuan, `discrepancy` bila ada minimal
satu diff selain `matched`. Respons:

```json
{
  "run_id": "uuid",
  "provider": "midtrans",
  "report_date": "2026-11-06",
  "status": "discrepancy",
  "report_source": "webhook_events",
  "trigger_source": "admin",
  "checked_count": 12,
  "matched_count": 11,
  "diff_count": 1,
  "gateway_total_idr": 2400000,
  "ledger_total_idr": 1200000,
  "diff_idr": 1200000,
  "started_at": "2026-11-07T00:00:00.000Z",
  "finished_at": "2026-11-07T00:00:00.000Z"
}
```

`GET /admin/reconciliation/runs/:id` menambahkan `diffs[]` berisi
`classification` (`matched`, `duplicate`, `missing_in_ledger`,
`missing_at_gateway`, `amount_mismatch`), `severity`, `external_id`,
`gateway_amount_idr`, `ledger_amount_idr`, `delta_idr` (`gateway - ledger`),
`due_at` (SLA: waktu run selesai + `recon_sla_hours`, default 24 jam),
`resolution`, `resolution_note`, dan `resolved_at`, plus `open_diff_count`
(jumlah temuan yang belum diputuskan). Temuan `duplicate` tidak menambah total
karena total memakai satu nilai per `external_id` unik.

`POST /admin/reconciliation/diffs/:id/resolve` menerima
`{ "resolution": "accepted" | "ignored" | "referred" | "corrected",
"note": "5-1000 karakter" }`. Keputusan disimpan bersama pelaku dan satu baris
`audit_logs` (`reconciliation.diff_resolve`). Temuan yang sudah selesai tidak
bisa diubah: panggilan kedua dijawab `409 CONFLICT`, sehingga catatan peninjau
pertama tidak tertimpa. Endpoint ini tidak mengubah `payments` maupun ledger —
koreksi uang tetap aksi manual di luar modul rekonsiliasi.

### Wilayah (FR-125)

`GET /admin/regions` mengembalikan array
`{ code, name, level, parent_code, is_active, vendor_count }`; `vendor_count`
hanya menghitung vendor aktif. `PATCH /admin/regions/:code` menerima
`{ "is_active": false }` (peran `admin_super`) dan menulis `audit_logs`
(`region.deactivate` / `region.activate`).

Wilayah nonaktif hilang dari `GET /regions`, vendor di wilayah itu hilang dari
katalog publik dan favorit, dan wilayahnya tidak bisa dipilih pada pendaftaran
vendor baru. Booking lama dan vendor yang sudah ada tidak diubah.

### Moderasi media

Antrean moderasi dipakai peran `admin_support`/`admin_super`.

`GET /admin/media?status=pending&page=1&page_size=20` mengembalikan media milik
vendor beserta konteksnya:

```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "vendor_id": "uuid",
        "vendor_name": "Putra Dermayu Tarling Group",
        "vendor_region_code": "IDM",
        "package_id": null,
        "package_name": null,
        "kind": "gallery",
        "url": "http://host/v1/media/<uuid>.jpg",
        "status": "pending",
        "license_statement": "Saya pemilik media ini",
        "review_note": null,
        "reviewed_at": null,
        "created_at": "2026-11-04T13:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "page_size": 20
  }
}
```

`POST /admin/media/:id/approve` menerapkan media ke kolom publik dalam satu
transaksi: `avatar`/`banner`/`video` menimpa kolomnya, `gallery` menambah ke
`photo_urls` (maksimum 8, selebihnya `VALIDATION_ERROR` dengan
`details.reason = "GALLERY_FULL"`), dan `package_photo` menimpa `packages.photo_url`
hanya bila paket itu milik vendor yang sama.

`POST /admin/media/:id/reject` wajib menyertakan `note` (minimal 5 karakter).
Media yang sudah diproses tidak bisa diproses ulang (`CONFLICT`).

### `POST /admin/bookings/:id/settle`

Pelunasan manual (transfer bank atau tunai) untuk booking `dp_paid`. Peran
`admin_finance`/`admin_super`; header `Idempotency-Key` (16–80 karakter)
**wajib** — tanpa header itu permintaan ditolak `400 VALIDATION_ERROR` sebelum
menyentuh data.

```json
{
  "amount_idr": 3550000,
  "method": "transfer_manual",
  "reference": "BCA 21/10/2026",
  "note": "Transfer telat"
}
```

`amount_idr` harus persis sisa tagihan (`total_customer_idr - dp_amount_idr`)
versi server; selisih sekecil apa pun dijawab `409`. Respons:

```json
{
  "booking_id": "uuid",
  "payment_id": "uuid",
  "journal_entry_id": "uuid",
  "payment_status": "fully_paid",
  "outstanding_before_idr": 3550000,
  "already_settled": false
}
```

Retry aman: key yang sama dengan payload yang sama mengembalikan respons
pertama (tidak ada jurnal atau perubahan booking kedua), sedangkan key yang
sama dengan payload berbeda dijawab `409 IDEMPOTENCY_MISMATCH` **setelah
permintaan pertama berhasil**. Klaim key disimpan di luar transaksi uang dan
sudah ter-commit sebelum langkah bisnis mulai; bila proses mati setelah uang
ter-commit tetapi sebelum klaim ditandai selesai, retry menjalankan ulang
langkah bisnis dan tidak menggandakan efek karena booking dikunci `FOR UPDATE`,
status `fully_paid` dicek ulang, dan jurnal memakai `source_event_key`. Key baru
diperlukan bila operator memang ingin mencatat pelunasan lain.

### Payout vendor

Payout bersifat **admin-initiated**: vendor hanya mengelola rekening tujuan. Nominal
dihitung server dari booking `released` yang belum masuk payout lain, lalu dicek
terhadap saldo ledger `vendor_payable` (2120).

`GET /admin/payouts/eligible?vendor_id=...` mengembalikan dua angka yang berbeda:

- `amount_idr` — total hak vendor dari seluruh booking released yang belum dicairkan;
- `payable_idr` — bagian yang benar-benar bisa dicairkan, yaitu booking tertua
  (urut `released_at`) yang **seluruhnya** tertutup saldo ledger. Payout beroperasi
  per booking utuh, jadi booking yang nominalnya melebihi saldo dilewati, bukan
  dibayar sebagian.

Bila saldo 2120 negatif karena clawback, `payable_idr` bisa 0 dan `eligible: false`
dengan alasan `Hak vendor Rp… belum bisa dicairkan: saldo 2120 Rp… (tertahan
clawback/sengketa)`. Saldo positif dari release berikutnya otomatis dipakai, jadi
utang clawback memotong payout berikutnya, bukan membekukannya selamanya.

`POST /admin/payouts` (peran `admin_finance`/`admin_super`, header `Idempotency-Key`):

```json
{ "vendor_id": "uuid", "booking_ids": ["uuid", "uuid"] }
```

`booking_ids` opsional; bila dihilangkan, server mengambil subset booking released
yang tertutup saldo ledger (sama dengan `payable_idr`). Subset eksplisit yang
nominalnya melebihi saldo dijawab `409`. Respons berisi `code`, `amount_idr`,
`status: "requested"`, `bank`, `items`.

`POST /admin/payouts/:id/approve` (checker berbeda dari pembuat, header
`Idempotency-Key`): memposting jurnal `payout_requested` lalu memanggil provider.
Nominal ≥ `approval_threshold_idr` wajib disetujui `admin_super`.

```json
{ "note": "Rekening sudah dicek dengan vendor." }
```

Status payout: `requested → approved → processing → paid`, plus `failed`, `rejected`,
`cancelled`. Worker `payout_reconcile` menanyakan status ke provider; `completed`
memposting `payout_settled`, `failed` memposting jurnal balik (`reversal`) dan
mengembalikan booking ke daftar yang bisa dicairkan.

`POST /vendor/bank-accounts`:

```json
{
  "bank_code": "bca",
  "account_number": "1234567890",
  "account_holder_name": "CV Putra Dermayu"
}
```

Nomor rekening hanya disimpan terenkripsi (AES-256-GCM dengan
`BANK_ACCOUNT_ENCRYPTION_KEY`); API hanya mengembalikan `account_number_masked`.
Rekening baru berstatus `pending` dan punya masa tunggu `bank_cooling_hours` sebelum
bisa dipakai payout.

### `POST /admin/disputes/:id/resolve`

Peran `admin_finance` atau `admin_super`. Header `Idempotency-Key` dipakai saat
putusan memicu refund.

```json
{
  "resolution": "release_to_vendor",
  "note": "Bukti lengkap, dana diteruskan ke vendor."
}
```

`resolution`:

- `release_to_vendor` — hanya untuk booking `completed` + pembayaran lunas +
  settlement `disputed`. Memposting jurnal `release`, mengubah settlement ke
  `released`, dan menutup sengketa dalam satu transaksi.
- `reject` — mengembalikan settlement `disputed` ke `held`; sengketa ditutup
  sebagai `rejected`.
- `refund_full` — refund seluruh pembayaran DP yang sudah dibayar. Refund
  dieksekusi lebih dulu ke provider; bila provider menolak, sengketa tetap
  terbuka. Bila refund langsung final (nominal di bawah ambang persetujuan),
  modul payment sudah memindahkan booking ke `refunded`/`not_eligible`; penutupan
  sengketa kemudian hanya mencatat keputusan tanpa menulis ulang status itu,
  sehingga tidak ada respons `409` setelah uang keluar.
- `refund_partial` — wajib menyertakan `amount_idr` dan nilainya harus lebih
  kecil dari nilai pembayaran. Bila refund sudah final, hanya settlement yang
  ditutup (`disputed → not_eligible`) dan riwayat status pembayaran tidak
  ditulis dua kali.

Respons memuat `status`, `resolution`, `resolution_amount_idr`,
`customer_share_idr`, `vendor_share_idr`, dan `journal_entry_id`/`refund_id`
bila ada.

### Clawback pasca-pencairan (FR-122)

Hanya untuk booking yang payout-nya **sudah dicairkan** dan sengketa dibuka
maksimal 30 hari setelah `released_at`. Dua langkah, wajib admin berbeda:

1. `POST /admin/disputes/:id/clawback` — `admin_finance`/`admin_super` mengajukan.

   ```json
   { "amount_idr": 1600000, "note": "Bukti baru menunjukkan vendor tidak hadir." }
   ```

   `amount_idr` wajib bilangan bulat > 0 dan tidak boleh melebihi dana yang
   pernah dicairkan ke vendor (kredit `vendor_payable` pada jurnal `release`).
   Langkah ini **tidak** memindahkan uang.

2. `POST /admin/disputes/:id/clawback/approve` — admin **lain** menyetujui.

   ```json
   { "note": "Bukti valid; clawback penuh disetujui." }
   ```

   Dalam satu transaksi: jurnal `clawback_recognized` + `clawback_paid`
   (vendor_payable negatif, `dispute_reserve` netral, kas platform keluar),
   `bookings.settlement_status = 'clawed_back'`, `clawback_recovered_at`,
   riwayat `dispute.resolved_clawback`, sengketa `resolved` dengan
   `resolution = 'clawback'` + `approved_by`, audit, dan notifikasi.
   Penyetuju sama dengan pengaju dijawab `403 FORBIDDEN`.

3. `POST /admin/disputes/:id/clawback/reject` — menolak/menarik pengajuan;
   sengketa tetap terbuka untuk putusan lain.

`GET /admin/disputes` menyertakan objek `clawback` (`id`, `status`,
`amount_idr`, `request_note`, `requested_by_name`, `requested_at`) atau `null`.
Saldo `vendor_payable` yang negatif otomatis memotong payout berikutnya: nominal
payout dibatasi `payable_idr` (lihat bagian Payout vendor), sehingga utang clawback
harus tertutup dulu oleh release baru sebelum ada booking yang bisa dicairkan.
Booking released yang haknya habis terserap utang tetap tampil di daftar eligible
(`amount_idr`) tetapi tidak masuk `payable_idr` sampai saldo kembali positif.

### `GET/PUT /admin/vendors/:id/categories`

Mengganti **seluruh** set kategori vendor, bukan menambah satu per satu. Maksimal
10 kategori, slug harus unik. Tandai satu `is_primary: true`; bila tidak ada,
kategori pertama menjadi primer. Array kosong menghapus semua kategori.

```json
{
  "categories": [
    { "slug": "tarling", "is_primary": true },
    { "slug": "pendukung-acara" }
  ]
}
```

Respons (urutan: primer lebih dulu, lalu `sort_order`):

```json
{
  "vendor_id": "uuid",
  "items": [
    { "slug": "tarling", "name": "Tarling & Dangdut", "is_primary": true },
    { "slug": "pendukung-acara", "name": "Pendukung Acara", "is_primary": false }
  ]
}
```

Slug tidak dikenal atau kategori nonaktif → `400 VALIDATION_ERROR`; tidak ada
baris yang diubah. Hanya kategori primer yang aktif yang tampil di
`GET /vendors`, jadi tanpa assignment ini chip kategori di aplikasi kosong.

### Vendor: filter, detail, dan penangguhan (FR-132)

`GET /admin/vendors` mendukung query param `verification`:
- `verified` — vendor dengan `verification_status = 'approved'`
- `pending` — vendor dengan `verification_status = 'pending'`
- `rejected` — vendor dengan `verification_status = 'rejected'`
- `suspended` — vendor dengan `verification_status = 'suspended'`

Daftar vendor (`GET /admin/vendors`) dan detail vendor (`GET /admin/vendors/:id`) memuat status verifikasi dan field penangguhan:
- `verification_status`: `'verified' | 'pending' | 'rejected' | 'suspended'`
- `suspended_at`: ISO timestamp string saat penangguhan, atau `null` jika tidak ditangguhkan
- `suspended_by`: UUID pengguna admin penangguh, atau `null`
- `suspension_reason`: teks alasan penangguhan, atau `null`

#### `POST /v1/admin/vendors/:id/suspend`
Peran: `admin_super`. Menangguhkan vendor bermasalah (FR-132), menyembunyikan vendor dari katalog publik, dan membekukan pencairan baru. Vendor tetap aktif (`is_active = true`) agar pesanan berjalan dapat diselesaikan.

Body:
```json
{
  "reason": "Alasan penangguhan 10-500 karakter",
  "note": "Catatan internal opsional"
}
```

Respons (`200 OK`):
```json
{
  "id": "uuid",
  "verification_status": "suspended",
  "suspended_at": "2026-11-06T07:00:00.000Z",
  "suspension_reason": "Alasan penangguhan 10-500 karakter",
  "suspended_by": "uuid"
}
```

#### `POST /v1/admin/vendors/:id/unsuspend`
Peran: `admin_super`. Mencabut penangguhan dan memulihkan status verifikasi sebelumnya (`suspension_previous_status`).

Body: `{}`

Respons (`200 OK`):
```json
{
  "id": "uuid",
  "verification_status": "approved",
  "suspended_at": null,
  "suspension_reason": null,
  "suspended_by": null
}
```

### Ringkasan kesiapan operasional

`GET /v1/admin/ops/alerts` — satu panggilan read-only untuk dashboard `/ops`.
Semua peran admin (`admin_support`, `admin_finance`, `admin_super`) boleh membaca;
payload hanya agregat, tanpa data pelanggan, dan tidak mengubah status/uang.

Ambang dihitung di SQL (`ops.repository.ts`), bukan di panel:

| Kunci | Dihitung bila | Ambang |
|---|---|---|
| `content_reports` | laporan `open`/`reviewing` | `sla_due_at` lewat |
| `disputes` | sengketa `open`/`investigating`/`awaiting_evidence` | `sla_due_at` lewat |
| `reconciliation_diffs` | temuan belum diputuskan | `due_at` lewat |
| `reconciliation_runs` | run `failed` | 24 jam terakhir |
| `payouts` | payout `processing` / `approved` | >1 jam / >24 jam |
| `outbox` | pesan `failed`/`dead` | semua baris |
| `email` | delivery `email` `failed` | 24 jam terakhir |

Respons (`200 OK`):
```json
{
  "generated_at": "2026-11-08T04:24:18.805Z",
  "status": "critical",
  "alerts": [
    {
      "key": "content_reports",
      "severity": "critical",
      "title": "Laporan konten lewat SLA",
      "detail": "2 laporan · terlama lewat 30 jam",
      "hint": "Putuskan laporan di antrean moderasi. Takedown menyembunyikan konten, bukan menghapusnya.",
      "href": "/reports",
      "count": 2,
      "oldest_hours": 30
    }
  ],
  "metrics": {
    "content_reports": { "count": 2, "oldest_hours": 30 },
    "disputes": { "count": 0, "oldest_hours": null },
    "reconciliation_diffs": { "count": 0, "oldest_hours": null },
    "reconciliation_runs": { "count": 0, "oldest_hours": null },
    "payouts": { "count": 0, "oldest_hours": null },
    "outbox": { "count": 1, "oldest_hours": 3 },
    "email": { "count": 0, "oldest_hours": null },
    "webhooks": { "count": 0, "oldest_hours": null }
  }
}
```

`status` = `ok` (tidak ada alarm), `attention` (hanya `warning`), atau `critical`
(ada `critical`). `metrics` memuat **semua** kunci (termasuk nol) supaya antrean
kosong tetap terlihat. `oldest_hours` dibulatkan ke atas dan `null` saat
`count = 0`. Urutan `alerts`: kritis dulu, lalu jumlah terbesar. Panel memakai
endpoint ini di `/ops` (daftar lengkap) dan sebagai banner di dashboard.

---

## Moderasi UGC (FR-123 / FR-124 / FR-142)

Pelaporan konten oleh pengguna, keputusan moderator, dan blokir pengguna.
Semua rute butuh bearer token; identitas diambil dari token, bukan header.

Target yang sah: `vendor`, `review`, `chat_message`, `vendor_media`.
Alasan yang sah: `spam`, `harassment`, `fraud`, `illegal`, `copyright`,
`impersonation`, `other`.

Aturan yang berlaku di server:

- `detail` wajib 10–2000 karakter (alasan saja tidak cukup untuk ditindak).
- Satu pelapor hanya boleh punya **satu** laporan terbuka untuk target yang sama;
  laporan kedua dijawab `409 CONFLICT` sampai yang pertama diputuskan.
- Pesan chat hanya bisa dilaporkan peserta booking-nya (`403` bila bukan peserta,
  `404` bila pesannya tidak ada). Konten milik sendiri dijawab `400`.
- SLA tinjauan: 24 jam, atau 72 jam bila `reason = copyright`.

### `POST /reports`

```json
{
  "target_type": "vendor",
  "target_id": "0e5f…",
  "reason": "fraud",
  "detail": "Setelah DP dibayar vendor meminta transfer tambahan ke rekening pribadi.",
  "evidence_url": "https://contoh.id/bukti.png",
  "booking_id": "opsional, untuk konteks chat"
}
```

`201`:

```json
{ "data": {
  "id": "…", "reporter_id": "…", "target_type": "vendor", "target_id": "…",
  "booking_id": null, "reason": "fraud", "detail": "…", "evidence_url": "…",
  "status": "open", "resolution": null, "resolution_note": null,
  "resolved_by": null, "resolved_at": null,
  "sla_due_at": "2026-11-09T02:00:00.000Z", "overdue": false,
  "escalated_at": null, "escalated": false,
  "created_at": "2026-11-08T02:00:00.000Z", "updated_at": "2026-11-08T02:00:00.000Z"
} }
```

Maksimal **10 laporan per user per jam**. Percobaan ke-11 dijawab
`429 RATE_LIMITED` (`{ error: { code: "RATE_LIMITED", … } }`). Limiter berjalan
in-memory per proses seperti limiter login/refresh; dengan N replika batas
efektifnya N × 10. Ini hanya perlindungan anti-spam, bukan aturan bisnis.

### `GET /reports?page=1&page_size=20`

Laporan milik pemanggil, terbaru dulu: `{ data: { items, total, page, page_size } }`.
`overdue` bernilai `true` hanya selama laporan belum diputuskan tetapi `sla_due_at`
sudah lewat.

### `GET /reports/:id`

Status satu laporan milik pemanggil. Laporan orang lain → `404` (bukan `403`,
supaya keberadaannya tidak bocor).

### `POST /blocks`

```json
{ "user_id": "…", "reason": "opsional, 3–200 karakter" }
```

`201 { data: { user_id, name, reason, created_at } }`. Idempoten: memblokir ulang
tidak menambah baris.

Blokir hanya memengaruhi tampilan. Riwayat chat (`GET /bookings/:id/chat/messages`)
menyaring pesan dari pihak yang diblokir, dan gateway `WS /v1/chat/ws` tidak
mengirim pesan baru dari mereka ke socket itu.

### `DELETE /blocks/:userId` → `204`

Idempoten, termasuk bila blokirnya memang tidak ada.

### `GET /blocks` → `{ data: [ { user_id, name, reason, created_at } ] }`

### `GET /admin/reports`

Query: `status` (`pending` = open+reviewing, atau salah satu status), `reason`,
`target_type`, `overdue=true`, `page`, `page_size` (maks 100).
Respons adalah objek halaman apa adanya (tanpa envelope), seperti rute admin lain:

```json
{ "items": [ { "id": "…", "status": "open", "overdue": true, "…": "…" } ],
  "total": 1, "page": 1, "page_size": 20 }
```

Urutan: laporan terbuka yang lewat SLA lebih dulu, lalu `sla_due_at` terdekat.
Setiap item juga memuat `escalated_at` (null bila belum) dan `escalated`.

### `POST /admin/reports/:id/resolve`

Peran: `admin_support` atau `admin_super` (`admin_finance` hanya boleh membaca).

```json
{ "action": "content_removed", "note": "Bukti menunjukkan pemerasan; konten diturunkan." }
```

`action`:

| aksi | efek pada target |
|---|---|
| `no_action` | tidak ada perubahan konten (laporan tidak berdasar) |
| `user_warned` | tidak ada perubahan konten; peringatan tercatat di audit |
| `content_removed` | `review`/`chat_message` → `hidden_at` diisi; `vendor_media` → `rejected` + kolom publik dibersihkan |
| `content_restored` | hanya `review`/`chat_message`: `hidden_at` dikosongkan |

`note` wajib ≥10 karakter. Laporan yang sudah diputuskan dijawab `409 CONFLICT`.
`content_removed` untuk target `vendor` dijawab `400` — penangguhan vendor memakai
`POST /admin/vendors/:id/suspend` (`admin_super`). Setiap keputusan menulis satu baris
`audit_logs` (`content_report.<action>`) dan membuat satu notifikasi in-app
`content_report_resolved` untuk pelapor (dedupe `content_report:<id>:resolved`).
Catatan moderator tidak dikirim ke pelapor; hanya ringkasan keputusan.

### Eskalasi SLA

View laporan menyertakan `sla_due_at`, `overdue`, `escalated_at`, dan `escalated`.
Worker `escalate_reports` memindai laporan `open`/`reviewing` yang melewati
`sla_due_at`, menandai `escalated_at` sekali, lalu mengirim notifikasi in-app
`content_report_sla_breach` ke setiap admin support/super aktif (dedupe
`content_report:<id>:sla:<user>`). Eskalasi tidak mengubah status laporan dan tidak
menyembunyikan konten; keputusan tetap milik moderator.

### Banding takedown (FR-124)

Pemilik konten yang diturunkan boleh mengajukan banding. Berlaku untuk target
`review`, `chat_message`, dan `vendor_media`; target `vendor` memakai jalur
penangguhan. Satu laporan maksimal satu banding, dan batas pengajuan 30 hari
setelah `resolved_at`. Pemilik ditentukan dari kepemilikan target, bukan dari
pelapor; orang lain menerima `404`.

`GET /v1/reports/against-me` — daftar konten milik pemanggil yang diturunkan, dipakai
layar **Banding konten** di mobile. Query `page` dan `page_size` (maks 100). Respons
tidak memuat identitas pelapor maupun isi laporan asal:

```json
{
  "data": {
    "items": [
      {
        "report_id": "…",
        "target_type": "review",
        "target_id": "…",
        "reason": "copyright",
        "resolved_at": "2026-11-08T10:00:00.000Z",
        "appeal_deadline_at": "2026-12-08T10:00:00.000Z",
        "appeal_id": null,
        "appeal_status": null,
        "appeal_created_at": null,
        "appeal_decided_at": null,
        "appeal_decision_note": null,
        "appeal_has_evidence_file": false
      }
    ],
    "total": 1,
    "page": 1,
    "page_size": 20
  }
}
```

`POST /v1/reports/:id/appeal` — auth pengguna, envelope `{ data: … }`.

Body:
```json
{
  "reason": "Konten ini saya buat sendiri dan tidak melanggar hak cipta siapa pun.",
  "evidence_url": "https://contoh.id/bukti.pdf"
}
```

`reason` wajib 20-2000 karakter; `evidence_url` opsional (tautan). Untuk bukti
berupa gambar, gunakan endpoint berkas di bawah — jangan menaruh berkas privat di
`/v1/media` (direktori itu publik).

`GET /v1/reports/:id/appeal` — hanya pengaju yang bisa membaca; selain itu
`404`. Banding kedua untuk laporan yang sama dijawab `409 CONFLICT`.

#### Bukti banding berupa berkas (FR-124)

`POST /v1/reports/:id/appeal/evidence` — `multipart/form-data` dengan field
`file` (JPG/PNG/WebP, maks. 5 MB, tipe dideteksi dari magic bytes). Auth pengguna,
hanya pemilik banding, dan hanya selama banding berstatus `pending` (setelah
diputuskan → `409`). Mengunggah ulang **mengganti** berkas lama; berkas lama
dihapus. Respons `201` berisi objek banding dengan `has_evidence_file: true`.
Berkas disimpan terenkripsi AES-256-GCM di `PRIVATE_UPLOAD_DIR` (bukan
`/v1/media`); object key internal tidak pernah dikirim ke klien.

`GET /v1/reports/:id/appeal/evidence` — pengaju membaca berkasnya sendiri
(`image/*`, `Cache-Control: private, no-store`). Tanpa berkas atau bukan pemilik
→ `404`.

`GET /v1/admin/report-appeals/:id/evidence` — support/finance/super membaca
berkas (finance hanya baca, konsisten dengan antrean). Setiap pembacaan menulis
`audit_logs` (`content_report.appeal_evidence_viewed`) **sebelum** byte dikirim;
unggahan menulis `content_report.appeal_evidence_uploaded`. Field
`has_evidence_file` pada objek banding memberi tahu UI apakah tombol berkas perlu
ditampilkan; `evidence_url` tetap ada untuk banding lama.

Admin:

- `GET /v1/admin/report-appeals?status=pending&page=1&page_size=20` — semua peran
  admin boleh membaca (finance read-only).
- `POST /v1/admin/report-appeals/:id/resolve` — support/super.

Body:
```json
{
  "status": "accepted",
  "note": "Bukti kepemilikan valid; takedown keliru dan konten dipulihkan."
}
```

Catatan wajib 10-1000 karakter. Keputusan final: resolve kedua `409`. Menerima
banding memulihkan `reviews.hidden_at`/`chat_messages.hidden_at`; media kembali ke
`vendor_media.status='pending'` untuk ditinjau ulang karena kolom publiknya sudah
dibersihkan saat takedown. Laporan asal **tidak** diubah. Setiap keputusan menulis
`audit_logs` (`content_report.appeal_accepted`/`..._rejected`) dan mengirim
notifikasi in-app `content_report_appeal_decided` ke pengaju (dedupe
`content_report_appeal:<id>:decided`).

## Contoh cepat (curl)

```bash
# health
curl http://localhost:3001/v1/health

# login pelanggan demo
curl -s -X POST http://localhost:3001/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"qa.b2.520274@tarlink.id","password":"Tarlink#2026!"}'

# katalog
curl "http://localhost:3001/v1/vendors?q=tarling&page=1&page_size=20"

# detail booking (ganti token)
curl http://localhost:3001/v1/bookings/40f3017d-8141-4008-9f95-7829d0c46f26 \
  -H "authorization: Bearer $TOKEN"
```

Alat bantu di `scripts/`: `vendor-accept.ts` (menerima booking), `pay-webhook.ts`
(mengirim webhook PJP bertanda tangan), `smoke-*.ts` (alur end-to-end).
