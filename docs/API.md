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
| GET | `/health` | `200` bila API dan DB siap |

---

## Auth

| Method | Path | Body | Keterangan |
|---|---|---|---|
| POST | `/auth/register` | `{ full_name, email, phone, password, consent: { tos_version_id, privacy_version_id } }` | Membuat akun pelanggan + mencatat consent |
| POST | `/auth/login` | `{ email, password }` | **Email**, bukan nomor WA |
| POST | `/auth/otp/request` | `{ email }` | Kirim OTP ke email (dev mengembalikan `dev_code` hanya bila `NODE_ENV !== production` **dan** `OTP_DEV_MODE=true`) |
| POST | `/auth/otp/verify` | `{ email, code }` | Verifikasi OTP |
| POST | `/auth/google` | `{ id_token }` | Login Google (opsional, tidak dipakai mobile) |
| POST | `/auth/refresh` | `{ refresh_token }` | Rotasi sesi; tanpa body memakai Bearer lama (legacy) |
| POST | `/auth/logout` | `{ refresh_token? }` | Mencabut sesi; tanpa body memakai Bearer |
| GET | `/auth/me` | — | Profil + peran pengguna |
| DELETE | `/auth/me` | `{ confirm: "HAPUS AKUN", reason? }` | Hapus akun mandiri (anonimisasi, FR-101) |
| GET | `/auth/account-deletion` | — | Status permintaan hapus akun terbaru |

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
| POST | `/bookings/:id/checkin` | Vendor check-in; `{ lat?, lng?, note? }` → `in_progress` |
| POST | `/bookings/:id/no-show` | Pelanggan/admin menandai vendor tidak hadir; `{ reason }` |

`checkin` hanya sah pada booking `confirmed` di jendela check-in (3 jam sebelum
sampai 2 jam setelah jam mulai). GPS opsional; tanpa GPS check-in tetap tercatat.
`no-show` hanya sah setelah jendela no-show (2 jam setelah jam mulai), mengubah
lifecycle ke `no_show` dan settlement ke `disputed`, serta membuka baris `disputes`
agar dana tidak bisa dirilis.

Konflik status → `409`.

### `POST /bookings/:id/disputes`

FR-056: pelanggan atau vendor membuka sengketa sendiri di dalam **7 hari setelah
acara** (`dispute_window_ends_at` = `scheduled_end_at` + 7 hari). Wajib bearer token
pemilik booking (`customer`) atau vendor yang berwenang (`vendor_owner`). Admin
**tidak** memakai endpoint ini; admin menangani antrean `/admin/disputes`.

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

`409 CONFLICT` bila: jendela 7 hari sudah lewat, settlement bukan `held`/`released`,
atau sudah ada sengketa aktif untuk booking tersebut. `403 FORBIDDEN` bila pemanggil
bukan peserta booking.

### `GET /bookings/:id/disputes`

Daftar sengketa booking, urut `opened_at` terbaru. Boleh diakses pelanggan pemilik
booking, vendor terkait (`vendor_owner` / `vendor_member` yang berwenang), dan admin
(`admin_support` / `admin_finance` / `admin_super`). Pemanggil lain → `403 FORBIDDEN`.

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
  "payment": { "id": "uuid", "status": "pending", "amount_idr": 1500000,
               "method": "va_bca", "expires_at": "…", "paid_at": null },
  "instruction": { "type": "va", "bank": "BCA", "va_number": "8808…", "expires_at": "…" }
}
```

Bentuk `instruction` per rail:

- QRIS Midtrans: `{ "type": "qris", "qr_url": "https://…/qr-code", "expires_at": "…" }`
  (`qr_url` adalah gambar PNG; klien merender dengan `Image.network`).
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
- Sisa tagihan dihitung otomatis di server (`total_customer_idr - dp_amount_idr`).

Bentuk respons sama dengan DP (`payment` + `payment_instruction`).

### `GET /payments/settlement/by-booking/:bookingId`

Mengembalikan tagihan pelunasan terakhir untuk booking. `404` bila belum ada tagihan pelunasan.
Wajib bearer token dan divalidasi kepemilikan booking.

### `POST /payments/:id/refund`

Peran `admin_finance` / `admin_super`. Body: `{ amount_idr, reason, evidence_url? }`.
`evidence_url` adalah tautan bukti (maks 500 karakter).

**Maker-checker (FR-128):** refund dengan nominal **> `REFUND_APPROVAL_THRESHOLD_IDR`**
(default Rp1.000.000) tidak langsung dieksekusi. Respons `201` berisi refund
berstatus `requested` dengan `requires_approval: true` dan belum ada jurnal.
Refund pada atau di bawah ambang dieksekusi langsung seperti sebelumnya.

Untuk Midtrans, refund QRIS dipanggil ke `POST /v2/{order_id}/refund` dengan
`refund_key` = id refund, lalu status refund langsung difinalkan (`succeeded`) dan
jurnal `refund_disbursed` diposting. **Refund VA/Mandiri ditolak** karena Midtrans
tidak mendukung refund bank transfer; catat transfer manual.

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

Pengganti kanal WhatsApp/push sementara: worker `outbox` menulis satu baris
`notifications` per penerima (unik per `outbox:<message_id>:<user_id>`), lalu
mobile mem-poll endpoint ini dan menampilkan popup saat aplikasi terbuka.
Tidak ada endpoint kirim manual — isi dibuat dari event `booking.*`.

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

## Chat booking (FR-050)

Satu percakapan per booking. Peserta ditentukan dari **relasi booking**, bukan dari
peran di token: pelanggan pemilik booking → `customer`; pemilik atau anggota aktif
vendor → `vendor`; admin (`admin_support`, `admin_finance`, `admin_super`) → `admin`.
Akun lain mendapat `403 FORBIDDEN`. Pesan append-only, 1–2000 karakter setelah trim.

### `GET /bookings/:bookingId/chat/messages`

Query: `limit` (1–100, default 50), `before` (cursor `next_before` halaman sebelumnya).
Respons: `{ data: { items, next_before } }`, `items` urut lama → baru. Cursor hanya
berlaku untuk thread booking yang sama.

### `POST /bookings/:bookingId/chat/messages`

Body: `{ "body": "…" }`. Respons `201`:

```json
{ "data": { "id": "…", "booking_id": "…", "sender_id": "…", "sender_role": "customer", "body": "…", "created_at": "…" } }
```

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
(berisi `message`), `message` (siaran ke semua socket thread), `pong`, dan
`error { code, message }`. Pengiriman lewat REST juga tersiar ke socket. Setelah
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

`PATCH /admin/vendors/:id` juga menerima `avatar_url`, `banner_url`,
`photo_urls`, `video_url`. `POST/PATCH .../packages` menerima
`personnel_count`, `inclusions[]`, dan `photo_url` (sama seperti portal vendor).

### Rekonsiliasi harian (FR-131)

Fase 1 bersifat **read-only**: membandingkan sisi gateway dengan ledger dan
menyimpan temuan. Tidak ada jurnal yang diposting dan tidak ada baris
`payments`/`payouts`/`refunds` yang diubah. Peran: `admin_finance`/`admin_super`.

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
`gateway_amount_idr`, `ledger_amount_idr`, `delta_idr` (`gateway - ledger`), dan
`detail`. Temuan `duplicate` tidak menambah total karena total memakai satu
nilai per `external_id` unik.

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

`POST /admin/payouts` (peran `admin_finance`/`admin_super`, header `Idempotency-Key`):

```json
{ "vendor_id": "uuid", "booking_ids": ["uuid", "uuid"] }
```

`booking_ids` opsional; bila dihilangkan, semua booking released yang belum dicairkan
diambil. Respons berisi `code`, `amount_idr`, `status: "requested"`, `bank`, `items`.

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
  terbuka.
- `refund_partial` — wajib menyertakan `amount_idr` dan nilainya harus lebih
  kecil dari nilai pembayaran.

Respons memuat `status`, `resolution`, `resolution_amount_idr`,
`customer_share_idr`, `vendor_share_idr`, dan `journal_entry_id`/`refund_id`
bila ada.

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
