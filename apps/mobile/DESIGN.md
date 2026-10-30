# Tarlink — Design Document (Aplikasi Pelanggan)

> Dokumen ini adalah **kontrak desain** untuk aplikasi pelanggan Flutter.
> Nilai visual di sini adalah nilai yang **sudah ada** di `lib/app/theme.dart` dan
> `lib/core/ui.dart`; sumber acuan visualnya ekspor OpenDesign `Graphite · Lime`
> (`opendesain/Tampilan_Pelanggan.html`). Portal vendor punya kontrak sendiri di
> `lib/features/vendor/vendor_theme.dart` dan tidak mengubah theme pelanggan.
> Peta lengkap file ekspor ada di [docs/DESIGN-REFERENCES.md](../../docs/DESIGN-REFERENCES.md).

Versi: 2.0 · Platform: Android-first (Flutter), target viewport **390 × 844 dp**
· Bahasa produk: Indonesia · Basis teks: 14 px

---

## 1. Posisi & sudut pandang desain

Tarlink bukan aplikasi gaya hidup. Ini **panggung yang bisa dipesan**: orang Pantura
mau tarling, organ tunggal, wayang, MC, atau tenda — dan takut ditipu, takut
"DP hangus", takut vendor tak datang.

Karena itu karakter visualnya:

| Prinsip | Artinya di layar |
|---|---|
| **Panggung, bukan katalog** | Graphite panggung malam + aksen lime seperti papan acara. Beranda terasa seperti poster acara, bukan grid produk e-commerce. |
| **Uang selalu jelas** | Harga, DP, sisa, status pembayaran selalu berlabel kata ("Sisa yang harus dibayar"), bukan sekadar angka besar. |
| **Tenang, bukan ramai** | Satu aksi utama per layar. Tanpa banner promo bertumpuk, tanpa badge merah di mana-mana. |
| **Jujur soal data** | Rating kosong → baris rating tidak ditampilkan. Deskripsi kosong → tidak ada placeholder "Belum ada deskripsi". Kalender basi → banner "data lama", bukan disembunyikan. |
| **Sinyal lemah, tangan sibuk** | Target sentuh ≥ 48 dp, aksi utama selalu di bawah (jangkauan jempol), tanpa gestur tersembunyi. |

Nada copy: seperti panitia acara yang berpengalaman — sopan, singkat, tanpa istilah
finansial. "Dana DP kamu ditahan dulu oleh penyedia pembayaran berizin, baru diteruskan
ke vendor setelah acara selesai." Bukan "escrow".

---

## 2. Token warna

Sumber kebenaran: ekspor OpenDesign **Graphite · Lime**, disalin apa adanya ke
`AppColors` (`lib/app/theme.dart`). Jangan menambah warna baru di luar tabel ini.

| Token | Hex | Pemakaian |
|---|---|---|
| `primary` | `#0B1220` | Aksi utama, teks bold, header |
| `primaryContainer` / `primaryDeep` | `#182540` | Gradien header, hover/pressed |
| `primarySoft` / `limeSoft` | `#F2FBD3` | Highlight lembut, latar chip |
| `lime` | `#D9FB4F` | CTA utama, penanda aktif |
| `limeDark` | `#BDDB2C` | Fokus input, progress |
| `onPrimary` | `#FFFFFF` | Teks di atas ink |
| `secondary` | `#606870` | Aksi sekunder, ikon netral |
| `secondarySoft` / `neutralSoft` | `#EFEFEA` | Latar chip netral |
| `tertiary` / `warning` | `#9A4208` | Menunggu, ditahan, data lama |
| `tertiarySoft` / `warningSoft` | `#FBEEDF` | Latar chip menunggu |
| `surface` | `#EEEEE9` | Kanvas aplikasi (hangat) |
| `card` | `#FAFAF7` | Kartu, input, bottom bar |
| `surfaceSoft` | `#F4F4EF` | Field pencarian, latar lembut |
| `surfaceTint` | `#F2FBD3` | Area info, kotak consent |
| `surfaceHigh` | `#E7E7E1` | Lapisan di atas kanvas |
| `line` | `#DDDDD7` | Garis 1 px divider |
| `lineStrong` | `#CFD1CB` | Garis tombol outline |
| `ink` | `#0B1220` | Teks utama |
| `inkMuted` | `#606870` | Teks sekunder, label, hint |
| `muted2` | `#88929C` | Label tab non-aktif |
| `accent` | `#076C48` | Uang masuk / lunas / tersedia |
| `accentSoft` | `#E4F1EA` | Latar chip sukses |
| `danger` | `#A22A22` | Gagal, batal, kedaluwarsa |
| `dangerSoft` | `#F8E7E4` | Latar chip/error |
| `skeleton` | `#E7E7E1` | Blok loading |

Aturan:
- **Lime hanya untuk aksi utama dan penanda aktif.** Jangan memakai lime untuk teks
  body atau kesuksesan.
- **Hijau hanya untuk uang/kesuksesan.** Jangan pakai hijau untuk tombol navigasi.
- **Merah hanya untuk kegagalan/keputusan merusak.** Tombol "Batalkan booking" memakai
  gaya outline merah, bukan tombol merah penuh — batal bukan aksi utama.
- Kanvas **terang hangat** (`surface`); header layar **gelap** dengan gradien
  `primaryDeep → primary` dan garis bawah lime 2 px (`StageHeader`).
- Tidak ada glassmorphism, tidak ada blur. Kartu memakai border 1 px `line` plus
  bayangan sangat tipis `0x060F172A` (blur 8, offset 0/2).
- Gradien dipakai di header dan poster pengganti foto (`PosterTile`).

### 2.1 Distribusi warna

| Porsi | Warna | Peran |
|---|---|---|
| ~60% | `surface` / `card` | kanvas, area baca |
| ~20% | `ink` | teks dan header |
| ~10% | `lime` / `primaryContainer` | CTA, penanda aktif, header |
| ≤5% | `secondary`, `accent`, `warning`, `danger` | status & uang |

Aturannya:

1. **CTA utama** selalu `lime` penuh dengan teks `ink`, tinggi 50, radius 8.
2. **Navigasi bawah:** bar kustom tinggi 58, latar `card`, hairline atas `line`,
   penanda aktif berupa garis lime 22 px; ikon+label aktif `ink`, non-aktif `muted2`.
3. **Judul seksi** memakai `titleMedium` 18/700 `ink`, bukan eyebrow kapital.
4. **Angka uang** memakai `primary`/`ink`; hanya "Lunas" yang hijau `accent`.
5. **CTA sekunder** outline `lineStrong` dengan teks `ink`.
6. Jangan mewarnai body text dengan `lime`; kontras dan kelelahan mata.

---

## 3. Tipografi

Font: **Plus Jakarta Sans** untuk semua gaya (display, headline, title, body, label).
Bundle ada di `assets/fonts/` — jangan bergantung pada font sistem atau unduhan
runtime. **Roboto Flex** tetap dibundel hanya untuk menjaga test bobot font
(`font_weights_test.dart`); theme tidak memakainya.

| Gaya | Ukuran / tinggi | Bobot | Pemakaian |
|---|---|---|---|
| Display | 28 / 1.28 | 700 | Angka uang besar, judul hero |
| Headline | 24 / 1.33 | 700 | Judul layar, judul status |
| Title L | 20 / 1.40 | 600 | Judul top bar, nama vendor |
| Title M | 18 / 1.33 | 600 | Nama paket, judul seksi |
| Body L | 16 / 1.50 | 400 | Paragraf |
| Body M | 14 / 1.50 | 400 | Isi kartu, isi form (basis) |
| Body S | 12 / 1.33 | 400 | Meta: wilayah, tanggal, catatan hukum |
| Label L | 14 / 1.43 | 700 | Teks tombol |
| Label M | 12 / 1.33 | 600 | Tab, chip, tautan |
| Label S | 11 / 1.27 | 600 | Badge status, caption |

Aturan:
- **Maksimal 2 ukuran teks per kartu.** Kalau butuh 4 ukuran, kartunya terlalu ramai.
- Angka uang memakai `fontFeatures: tabularFigures` supaya kolom rupiah rata.
- Teks panjang dibatasi 2 baris + elipsis, kecuali body paragraf.
- Harus tetap terbaca pada **textScale 1.3** tanpa overflow (lihat §11).

---

## 4. Spasi, radius, elevasi

- Skala spasi: **4 / 8 / 12 / 16 / 24 / 32**. Tidak ada nilai lain.
- Padding layar: **16** kiri-kanan (login 20). Jarak antar-seksi: **24**. Dalam kartu: **16**.
- Radius: `sm` **6** (input, tombol kecil), `lg` **8** (tombol, kartu), `xl` **12**
  (sheet), `pill` **999**.
- Tinggi tombol utama: **50**. Field login: **52**. Target sentuh minimum: **48 × 48**.
- Elevasi: kartu memakai border 1 px `line` + bayangan `0x060F172A` (blur 8, offset 0/2);
  bottom bar memakai garis atas `line`. Tidak ada border ganda.
- Bottom nav: bar kustom tinggi **58** + safe area, latar `card`, garis atas `line`,
  penanda aktif garis lime; item aktif `ink`, non-aktif `muted2`.

Grid vertikal mengikuti kelipatan 4; hindari "kartu di dalam kartu".

---

## 5. Arsitektur informasi (4 tab)

Bottom navigation **4 item**, semuanya punya fungsi nyata di backend. Tidak ada tab
"Chat" atau "Notifikasi" karena tidak ada API-nya — komunikasi lewat WhatsApp.

| Tab | Isi | Data nyata |
|---|---|---|
| **Beranda** | Sapaan + tanggal, pencarian, booking aktif (kalau ada), "Sedang tampil" (vendor pilihan), pita jaminan dana | `GET /bookings`, `GET /vendors` |
| **Jelajah** | Daftar semua vendor + pencarian + chip kategori (`category`) + pemilih tanggal (`date`) + urutkan Termurah / Nama A-Z; chip wilayah difilter di klien dari hasil yang sudah dimuat | `GET /vendors`, `GET /categories` |
| **Booking** | Daftar booking + segmen Semua / Aktif / Selesai | `GET /bookings` |
| **Profil** | Nama + nomor WA, keamanan sesi, kebijakan, bantuan WhatsApp, keluar | `GET /auth/me`, `GET /policies/:code` |

**Yang sengaja TIDAK ada** (karena backend belum mendukung, dan kontrol mati dilarang):
favorit/hati, chat in-app, notifikasi in-app, form ulasan baru, peta interaktif,
promo/voucher. Rating yang sudah ada di API boleh ditampilkan; jangan mengarang
ulasan atau angka saat `rating` null.

Navigasi pendalaman (bukan tab): Detail vendor → Jadwal → Buat booking → Status booking
→ Pembayaran. Alur ini linear, satu tombol "Lanjut" per langkah.

---

## 6. Komponen

### 6.1 Kartu vendor (dipakai di Beranda & Jelajah)
- Radius 8, latar `card`, border 1 px `line`, bayangan tipis, padding 12.
- Atas: `PosterTile` rasio 16:10. Bila API mengirim `avatar_url`/`banner_url`, foto itu
  yang dipakai; bila kosong, gradien graphite/lime deterministik dari nama vendor plus
  inisial. Badge kategori/wilayah.
- Bawah: nama (Title M 18/700, 2 baris), `kategori · wilayah · N paket` (Body S,
  `inkMuted`), baris "Mulai dari" + harga besar 24/700 `primary`, chip DP.
- Seluruh kartu adalah target sentuh (InkWell); tidak ada tombol CTA terpisah di kartu.
- Baris rating `★ 4.8 (12)` dan `Respons 92%` hanya muncul bila API mengirim
  `rating`/`response_rate_bp`; nilai null dihilangkan, bukan diisi `0`.
- Jarak dan "terverifikasi" **tidak dirender** karena tidak ada di API halaman kartu.
- Harga kosong → "Harga belum diisi", bukan `Rp0`.

### 6.2 Header layar (`StageHeader`)
- Latar gradien `primaryDeep → primary` (graphite), judul putih, garis bawah lime 2 px.
- Header selalu melebar penuh. Di dalam `Column`, set
  `crossAxisAlignment: CrossAxisAlignment.stretch`; tanpa itu header mengecil dan
  judulnya tampak di tengah (bug lama di layar Profil).
- Beranda: brand lockup (emblem `assets/images/logo_mark.png`) + pencarian di bagian
  bawah header.
- Layar detail: `StageHeader.back()` dengan tombol kembali kotak 38×38 berlatar putih
  transparan, judul 20/600, aksi kanan opsional (mis. WhatsApp).
- Status bar memakai ikon terang (`SystemUiOverlayStyle.light`) karena header gelap;
  layar tanpa header tetap memakai ikon gelap di atas kanvas terang.

### 6.3 Fishbone status (StatusChip)
Sudah ada di `widgets.dart`. Aturan pemakaian:
- Selalu **teks kata**, bukan titik warna saja (buta warna).
- Maksimal **2 chip** per kartu: satu siklus hidup, satu pembayaran.
- Chip "Ditahan" (uang di PJP) memakai nada `warning` + ikon gembok kecil.

### 6.4 Kartu uang (money block)
Dipakai di Status booking dan konfirmasi:
```
Total acara            Rp5.050.000     (Body M / inkMuted)
Sudah dibayar (DP)    −Rp1.500.000     (Body M)
────────────────────────────────────
Sisa yang harus dibayar Rp3.550.000    (Display / ink) ← satu-satunya angka besar
```
- `fully_paid` → baris sisa diganti "Lunas" + chip hijau, angka besar = total.
- `refunded` → "Dana dikembalikan" + chip netral, tanpa angka sisa.
- Format: `Rp1.500.000` (titik ribuan, tanpa desimal, tanpa spasi setelah Rp).

### 6.5 Bottom action bar
- Menempel di bawah, latar `card`, garis atas, padding 16 + safe area.
- Satu tombol `PrimaryButton` tinggi 52 selebar layar.
- Bila ada info harga, taruh ringkas di kiri (Title M) dan tombol di kanan selebar 60%.
- Selalu muncul saat ada aksi; tidak pernah menutupi konten (konten diberi padding bawah 96).

### 6.6 Jadwal 45 hari
- Strip horizontal per minggu; 7 kolom, tiap sel 44×56 radius 12.
- State: `available` (`accentSoft` + garis `accent` 35%, teks hijau tua),
  `held`/`unconfirmed` (`warningSoft` + titik), `booked`/`blocked`
  (`neutralSoft`, teks `inkMuted`, tidak bisa dipilih), `terpilih`
  (`primary` penuh, teks putih).
- Legenda 1 baris: "Tersedia · Menunggu konfirmasi · Terisi".
- Bila `stale == true`: banner `warningSoft` di atas strip — "Jadwal terakhir diperbarui
  N hari lalu. Konfirmasi ke vendor lewat WhatsApp." dengan tautan WA.

### 6.7 Empty state
- Ikon garis 56 di lingkaran `neutralSoft`, satu kalimat, satu aksi.
- Booking kosong: "Belum ada booking. Mulai dari melihat vendor yang sedang tampil."
  Aksi: `Jelajah vendor`.
- Pencarian kosong: "Tidak ada vendor yang cocok dengan 'wayang'." Aksi: `Hapus pencarian`.

### 6.8 Error & offline
- Error jaringan: kartu `dangerSoft` inline (bukan halaman penuh) + tombol `Coba lagi`
  selama data lama masih bisa ditampilkan (stale-while-error).
- Tanpa data sama sekali: `AppError` penuh dengan pesan spesifik
  ("Server tidak menjawab. Periksa sinyal, lalu coba lagi.") — bukan "Terjadi kesalahan".
- Offline: banner tipis di bawah AppBar, bukan snackbar yang hilang sendiri.

### 6.9 Skeleton
- Bentuk mengikuti kartu asli (bukan spinner). 3 baris; animasi opacity 0.45→1, 900 ms.
- Hormati `MediaQuery.disableAnimations` (sudah diimplementasikan).

---

## 7. Spesifikasi layar

### 7.1 Beranda
1. Header gelap `StageHeader` dengan brand lockup (emblem + "Tarlink") dan field
   pencarian 52 px di bagian bawah header.
2. Booking aktif (kalau ada) tampil paling atas setelah header.
3. "Kategori Panggung": 4 ubin (Tarling Dangdut, Organ Tunggal, Seni Tradisi,
   Pendukung Acara). Satu ubin ditonjolkan (`ink` + ikon lime), sisanya `card` dengan
   tint lembut. Ubin membuka Jelajah dengan filter kategori, bukan filter palsu.
4. Seksi "Vendor Siap Tanggap" + tautan "Semua", lalu kartu vendor.
5. Kartu jaminan PJP (`InfoStrip` bernada `primary`) di area daftar.
6. Tanpa banner promo, tanpa carousel auto-play, tanpa notifikasi in-app.

### 7.2 Jelajah
- Header gelap: emblem, "Jelajah Vendor", subjudul jumlah vendor, lalu field
  pencarian 52 px. Tanpa ikon notifikasi/favorit (tidak ada API-nya).
- Kartu jaminan `InfoStrip` di atas filter: DP ditahan PJP sampai acara selesai.
- Baris chip kategori dari `GET /categories` (chip pertama "Semua kategori").
- Tombol outline pemilih tanggal acara; bila aktif menampilkan tanggal dan tombol
  hapus. Tanggal mengirim query `date`.
- Baris chip wilayah (dari `regionName` unik yang sudah dimuat, difilter di klien).
- `SegmentBar` urutan: **Termurah** (`price_asc`) dan **Nama A-Z** (`name_asc`).
- Daftar kartu vendor, jarak 8, padding bawah 96.
- Halaman pertama 20 vendor. Selama `total > termuat`, tampilkan tombol outline
  `Muat vendor lainnya (+N)`; tidak ada spinner penuh layar.

### 7.3 Detail vendor
1. Header gelap `StageHeader.back()`: judul **"Detail Grup Hiburan"**, subjudul nama
   vendor, aksi kanan WhatsApp (bila `whatsapp` ada).
2. `PosterTile` hero 16:9 memakai `banner_url`/`avatar_url`; badge kategori, wilayah,
   dan "▶ Cuplikan Video" bila `video_url` ada.
3. Avatar (bila ada), nama (Headline 24/700), baris wilayah · kategori, rating hanya
   bila tidak null, lalu "Mulai dari" + harga + chip DP.
4. Deskripsi (maks 4 baris + "Baca selengkapnya") — **hanya bila ada**.
5. Galeri **photo_urls** (bila ada) dan kartu cuplikan video (dibuka in-app).
6. Seksi **Paket** — kartu: nama, durasi (`3 jam`), jumlah personel, harga, `DP 30%`,
   serta daftar **Fasilitas** dari `inclusions` bila tidak kosong.
7. Seksi **Jadwal** — strip 45 hari (§6.6) + legenda; banner peringatan bila `stale`.
8. Seksi **Lokasi & transport** — alamat (`baseAddress`) bila ada; teks biaya
   transport. Tanpa peta bila koordinat tidak ada.
9. Bottom bar: harga mulai + tombol `Pilih jadwal` (berubah menjadi `Lanjut · <tanggal>`
   setelah tanggal dipilih).

### 7.4 Buat booking
Satu halaman scroll, tiga blok bernomor (bukan stepper dengan tombol mati):
1. **Acara** — nama acara, jenis (dropdown dari pilihan tetap), tanggal & sesi
   (dari jadwal terpilih), perkiraan tamu, alamat lokasi, catatan.
2. **Paket & tambahan** — paket terpilih (ringkas, bisa ganti), add-on dengan stepper
   jumlah, harga mengikuti.
3. **Ringkasan uang** — kartu uang (§6.4) dengan DP dan sisa; teks aturan DP
   ("DP berlaku 24 jam; untuk nilai ≥ Rp10 juta, 48 jam").
Bottom bar: `Lanjut bayar DP Rp1.500.000`. Validasi inline per field, pesan di bawah
field, bukan dialog.

### 7.5 Status booking
1. Header: kode booking (mono/`Label M`, bisa disalin) + chip siklus hidup + chip bayar.
2. **Kartu uang** (§6.4) — elemen terbesar.
3. Instruksi pembayaran (bila `unpaid`): QRIS (kode + tombol `Simpan`), VA (nomor +
   tombol `Salin`), hitung mundur kedaluwarsa, teks "Selesaikan sebelum 23.59".
4. Timeline vertikal: Booking dibuat → DP diterima → Dikonfirmasi vendor → Acara →
   Dana diteruskan. Titik aktif = `primary`, selesai = `accent`, belum = `line`.
5. Detail acara & vendor (alamat, jadwal, paket).
6. Aksi sekunder: `Hubungi vendor (WhatsApp)`, `Batalkan booking` (outline merah,
   konfirmasi bottom sheet dengan konsekuensi DP ditulis jelas).
7. Polling 15 detik hanya selama `unpaid`; saat berpindah ke `dp_paid` tampilkan
   perubahan status dengan animasi halus, bukan snackbar.

### 7.6 Booking saya
- Segmen: Semua / Aktif (`unpaid`, `dp_paid`, `confirmed`) / Selesai (`completed`,
  `cancelled`, `expired`).
- Kartu: kode + chip, nama vendor, tanggal acara, sisa tagihan (atau "Lunas").
- Kosong (§6.7). Tarik-untuk-refresh.

### 7.7 Akun
- Blok identitas: inisial 56, nama, nomor WA (`+62 812-…`).
- Baris: `Kebijakan pembatalan`, `Kebijakan privasi`, `Bantuan via WhatsApp`,
  `Keluar`.
- Kebijakan dibuka di sheet dengan teks dari `GET /policies/:code`; tanpa teks hukum
  palsu.
- `Keluar` memakai konfirmasi sheet, bukan dialog sistem.

### 7.8 Welcome / Login / Daftar
- **Welcome** (sekali sebelum login): layar gelap `ink`, foto
  `assets/images/welcome_stage.jpg` dengan overlay gradien, brand lockup terang,
  judul "Hiburan panggung untuk acaramu.", tiga poin jaminan (DP ditahan, jadwal &
  paket jelas, langsung ke vendor via WhatsApp), CTA lime "Mulai cari hiburan", dan
  tautan "Sudah punya akun?".
- Login/daftar: satu kolom, padding 20, latar `surface`. Brand lockup (emblem 40 dari
  `assets/images/logo_mark.png` + wordmark **"Tarlink"** + caption "TANGGAP HIBURAN")
  dan pil `secondarySoft` "Gerbang Hiburan Pantura". Wordmark aplikasi tetap **Tarlink**.
- Judul "Masuk atau Daftar" (Headline 26/700) + satu kalimat penjelas.
- Dua tab: **Akun Email** (email + kata sandi, `POST /auth/login`) dan
  **WhatsApp / SMS** (`POST /auth/otp/request` → `POST /auth/otp/verify`). Tab aktif
  `card` di atas wadah `surfaceTint` radius 6.
- Field 52 px `card` radius 6, label 12/600 + "Wajib diisi" 11/400 `inkMuted`.
- Kotak consent `surfaceTint`: checkbox lime **tidak tercentang** secara default
  (opt-in, bukan opt-out); tautan Syarat & Ketentuan dan Kebijakan Privasi diberi
  garis bawah (belum ada halaman kebijakan → tanpa aksi).
- CTA lime penuh tinggi 50, teks `ink` 14/700 + panah. Di bawahnya tautan "Daftar Sekarang".
- Footer: pil `surfaceTint` dengan ikon perisai, teks "Koneksi ke server dienkripsi
  HTTPS" — jangan mengklaim "standar perbankan".
- **Tidak ada** login Google dan "Lupa Kata Sandi?" karena backend belum menyediakannya.
- Error kredensial: kartu inline di atas CTA, bukan snackbar.
- Daftar: nama, nomor WA, email, kata sandi. Nomor WA dinormalisasi ke `62…` dan
  ditampilkan sebagai bantuan kecil di bawah field.

---

## 8. Gerak (motion)

| Kejadian | Durasi | Kurva |
|---|---|---|
| Transisi halaman | 220 ms | easeOutCubic |
| Bottom sheet | 260 ms | easeOutCubic |
| Perubahan status chip | 180 ms cross-fade | easeInOut |
| Skeleton | 900 ms bolak-balik | easeInOut |
| Tombol ditekan | 90 ms skala 0.98 | easeOut |

- Tidak ada animasi masuk beruntun (stagger) pada daftar panjang — bikin terasa lambat
  di HP kelas menengah.
- Hormati "kurangi animasi" sistem; semua animasi dekoratif jadi instan.

---

## 9. Aksesibilitas

- Kontras teks minimum 4.5:1; `inkMuted` di `surface` = 5.4:1 (lolos).
- Ukuran teks mengikuti skala sistem sampai 1.3; semua baris `Flexible`/`Expanded`.
- Setiap ikon aksi punya `tooltip`/`Semantics` berbahasa Indonesia.
- Status tidak pernah disampaikan hanya lewat warna.
- Urutan fokus keyboard/reader: header → konten utama → bottom bar.
- Target sentuh ≥ 48 dp, jarak antar-target ≥ 8 dp.

---

## 10. Aturan copy (Indonesia)

1. Kata kerja di tombol: `Lanjut bayar DP`, `Pilih jadwal`, `Hubungi vendor`.
2. Sebut angka konkret: "Sisa Rp3.550.000", bukan "sisa pembayaran".
3. Jangan pakai istilah teknis: escrow → "ditahan penyedia pembayaran berizin";
   settlement → "dana diteruskan ke vendor"; stale → "data lama".
4. Tanggal: `Rabu, 22 Oktober 2026`. Jam: `20.00–23.00`. Uang: `Rp1.500.000`.
5. Kalimat maksimal 2 baris di kartu; pesan error menyebut penyebab + langkah.
6. Tidak ada tanda seru, tidak ada "Yuk!", tidak ada huruf kapital semua.

---

## 11. Batasan teknis yang membentuk desain

- Data seed: `rating`, `description`, `baseAddress` bisa **null**; `addons` bisa kosong;
  kalender bisa berstatus `stale`. Desain harus tetap utuh tanpa field itu.
- Media vendor berasal dari kolom API (`avatar_url`, `banner_url`, `photo_urls`,
  `video_url`). Bila kosong, `PosterTile` memakai blok inisial + gradien; jangan pakai
  gambar stok baru di UI.
- Tidak ada API chat/notifikasi → WhatsApp deep link, bukan tab.
- Kategori **ada** (`GET /categories`, query `category`); filter wilayah masih di klien
  karena API memfilter dengan kode, bukan nama.
- E-wallet belum berfungsi → UI hanya menawarkan QRIS dan VA.
- Sesi bisa habis saat cold start → layar login harus terasa wajar, bukan error.
- APK target ≥ Android 8, RAM 2 GB, sinyal 3G: hindari blur, parallax, gambar besar.
- Portal vendor memakai theme lokal `features/vendor/vendor_theme.dart`, bukan
  `app/theme.dart`; jangan mencampur token pelanggan dan vendor dalam satu layar.

---

## 12. Larangan (anti-pattern)

- Tab/menu tanpa fungsi backend.
- Tombol mati, tautan `#`, kontrol "segera hadir".
- Data mock atau angka contoh di UI produksi.
- Carousel auto-play, pop-up promo saat buka aplikasi.
- Kartu bertumpuk di dalam kartu; garis ganda.
- Warna hijau untuk navigasi; merah untuk aksi non-destruktif.
- Angka uang tanpa label kata.
- Emoji di UI.

---

## 13. Ringkasan acuan desain

Sumber acuan: ekspor OpenDesign `Graphite · Lime` di `opendesain/Tampilan_Pelanggan.html`
(pelanggan) dan `opendesain/Tampilan_Vendor_grup.html` (vendor). Saat membuat layar baru,
gunakan token §2–§4, patuhi IA §5, dan jangan menambahkan kontrol yang tidak ada di §7.
Layar pelanggan berurutan: Welcome → Login → Beranda → Jelajah → Detail vendor →
Buat booking → Status booking → Booking saya → Akun. Portal vendor: Beranda → Kalender →
Saldo → Profil, plus Semua Pesanan, Detail Pesanan, Kelola Profil, Kelola Paket.
