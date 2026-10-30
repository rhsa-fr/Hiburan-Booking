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
`404` tidak ada, `409` konflik status/jadwal, `422` aturan bisnis, `500` server.

**Pagination**

Query: `page` (mulai 1, default 1), `page_size` (default 20, maks 100).

```json
{ "items": [], "total": 0, "page": 1, "page_size": 20 }
```

**Uang** — selalu integer rupiah (`1500000`), tidak pernah string atau desimal.
Format tampilan dilakukan klien.

**Idempotensi** — `POST /bookings` dan `POST /payments/dp` mewajibkan header
`Idempotency-Key` (16–80 karakter). Request dengan key dan payload sama
mengembalikan hasil yang sama; replay ditandai header `Idempotency-Replayed: true`.
`POST /bookings` juga menerima `client_generated_id` (UUID) sebagai fallback dan
sebagai guard unik per pelanggan.

---

## Health

| Method | Path | Keterangan |
|---|---|---|
| GET | `/health` | `200` bila API dan DB siap |

---

## Auth

| Method | Path | Body | Keterangan |
|---|---|---|---|
| POST | `/auth/register` | `{ full_name, email, phone, password }` | Membuat akun pelanggan |
| POST | `/auth/login` | `{ email, password }` | **Email**, bukan nomor WA |
| POST | `/auth/otp/request` | `{ phone }` | Kirim OTP (dev mengembalikan `dev_code` hanya bila `NODE_ENV !== production` **dan** `OTP_DEV_MODE=true`) |
| POST | `/auth/otp/verify` | `{ phone, code }` | Verifikasi OTP |
| POST | `/auth/google` | `{ id_token }` | Login Google (opsional, tidak dipakai mobile) |
| POST | `/auth/refresh` | `{ refresh_token }` | Rotasi sesi; tanpa body memakai Bearer lama (legacy) |
| POST | `/auth/logout` | `{ refresh_token? }` | Mencabut sesi; tanpa body memakai Bearer |
| GET | `/auth/me` | — | Profil + peran pengguna |

Respons login (dibungkus `data`):

```json
{
  "data": {
    "access_token": "…",
    "refresh_token": "…",
    "expires_in": 900,
    "user": { "id": "uuid", "email": "…", "phone": "+62…", "full_name": "…", "roles": ["customer"] }
  }
}
```

`GET /auth/me` mengembalikan `{ "data": { "user": { id, phone, email, full_name,
roles, created_at } } }`. Peran diambil dari database, bukan dari isi token.

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

Seed hanya berisi `cancellation`; kode lain bisa 404 — jangan mengarang teks hukum.

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
  "created_at": "…",
  "updated_at": "…"
}
```

`outstanding_idr` mengikuti status pembayaran:
`unpaid` → total, `dp_paid` → total − DP, `fully_paid`/`refunded` → 0.

### Transisi

| Method | Path | Keterangan |
|---|---|---|
| POST | `/bookings/:id/accept` | Vendor menerima (peran vendor) |
| POST | `/bookings/:id/decline` | Vendor menolak, `{ reason_code, reason_note? }` |
| POST | `/bookings/:id/cancel` | Pelanggan membatalkan, `{ reason_code, reason_note? }` |

Konflik status → `409`.

---

## Pembayaran

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
  "payment": { "id": "uuid", "status": "pending", "amount_idr": 1500000,
               "method": "va_bca", "expires_at": "…", "paid_at": null },
  "instruction": { "type": "va", "bank": "BCA", "va_number": "8808…", "expires_at": "…" }
}
```

Untuk QRIS, `instruction` berisi `qr_string`.

### `GET /payments/by-booking/:bookingId`

Mengembalikan pembayaran terakhir + instruksi. `404` bila belum ada tagihan.

### `POST /payments/:id/refund`

Peran admin. Body: `{ amount_idr?, reason }`.

---

## Webhook PJP

```
POST /webhooks/pjp
x-pjp-signature: <hex>
x-pjp-timestamp: <unix seconds>
```

Tanda tangan: `HMAC_SHA256(timestamp + "." + rawBody, PJP_WEBHOOK_SECRET)`,
toleransi 300 detik. Event yang diproses: `payment.paid` (idempoten berdasarkan
`payment_id` + `event_id`).

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
| GET | `/vendor/packages` | Semua paket sendiri (termasuk nonaktif) |
| POST | `/vendor/packages` | Buat paket |
| PATCH | `/vendor/packages/:id` | Ubah paket milik sendiri |
| DELETE | `/vendor/packages/:id` | Nonaktifkan paket (soft delete) |
| PUT | `/vendor/calendar` | Set `available`/`blocked` untuk rentang tanggal |
| POST | `/vendor/media` | Upload satu gambar (multipart field `file`) |
| GET | `/media/:filename` | Sajikan gambar upload (publik) |

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

`GET /vendor/earnings` mengembalikan `held_idr` (juga `held_balance_idr`) dan halaman
pencairan `settled`:

```json
{
  "data": {
    "held_idr": "3000000",
    "held_balance_idr": "3000000",
    "settled": { "items": [], "total": 0, "page": 1, "page_size": 20 }
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

### Media

`POST /vendor/media` menerima `multipart/form-data` dengan field `file`.
Hanya JPEG/PNG/WebP asli (dicek dari magic bytes), maksimal 5 MB. Respons:

```json
{ "url": "http://host/v1/media/<uuid>.jpg", "filename": "<uuid>.jpg" }
```

`GET /media/:filename` publik, cache immutable, hanya nama file yang dibuat
server (aman dari path traversal).

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
| GET | `/admin/release/queue` | Antrean pelepasan dana |
| POST | `/admin/release/preview` | Pratinjau jurnal pelepasan |
| POST | `/admin/release` | Eksekusi pelepasan |
| GET | `/admin/ledger` | Jurnal + saldo akun |
| GET | `/admin/payments` | Daftar pembayaran |
| GET | `/admin/disputes` | Sengketa |
| GET | `/admin/audit` | Audit log |
| GET | `/admin/operators` | Akun operator |
| GET/PUT | `/admin/settings` | Pengaturan platform |
| POST | `/admin/vendors` | Buat vendor |
| PATCH | `/admin/vendors/:id` | Ubah vendor |
| GET/PUT | `/admin/vendors/:id/categories` | Baca/ganti kategori vendor |
| POST | `/admin/vendors/:id/verify` | Verifikasi vendor |
| GET/POST | `/admin/vendors/:id/packages` | Daftar/buat paket |
| PATCH/DELETE | `/admin/vendors/:id/packages/:packageId` | Ubah/hapus paket |
| GET/PUT | `/admin/vendors/:id/calendar` | Baca/tulis kalender |

`PATCH /admin/vendors/:id` juga menerima `avatar_url`, `banner_url`,
`photo_urls`, `video_url`. `POST/PATCH .../packages` menerima
`personnel_count`, `inclusions[]`, dan `photo_url` (sama seperti portal vendor).

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

---

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
