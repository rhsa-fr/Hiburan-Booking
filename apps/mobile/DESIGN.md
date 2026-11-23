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
| `secondarySoft` | `#E7EEF3` | Latar chip netral (kategori Pendukung Acara) |
| `neutralSoft` | `#EFEFEA` | Latar netral di dalam kartu |
| `tertiary` / `warning` | `#9A4208` | Menunggu, ditahan, data lama |
| `tertiarySoft` / `warningSoft` | `#FBEEDF` | Latar chip menunggu |
| `surface` | `#FBF9F4` | Kanvas aplikasi (putih susu) |
| `card` | `#FFFFFF` | Kartu, input, bottom bar |
| `surfaceSoft` | `#F3F0E9` | Field pencarian, latar lembut |
| `surfaceTint` | `#F2FBD3` | Area info, kotak consent |
| `surfaceHigh` | `#EDE9E0` | Lapisan di atas kanvas |
| `line` | `#E6E1D6` | Garis 1 px divider |
| `lineStrong` | `#D5CFC2` | Garis tombol outline |
| `ink` | `#0B1220` | Teks utama |
| `inkMuted` | `#606870` | Teks sekunder, label, hint |
| `muted2` | `#88929C` | Label tab non-aktif |
| `accent` | `#076C48` | Uang masuk / lunas / tersedia |
| `accentSoft` | `#E4F1EA` | Latar chip sukses |
| `danger` | `#A22A22` | Gagal, batal, kedaluwarsa |
| `dangerSoft` | `#F8E7E4` | Latar chip/error |
| `skeleton` | `#EFEBE3` | Blok loading |

Aturan:
- **Lime hanya untuk aksi utama dan penanda aktif.** Jangan memakai lime untuk teks
  body atau kesuksesan.
- **Hijau hanya untuk uang/kesuksesan.** Jangan pakai hijau untuk tombol navigasi.
- **Merah hanya untuk kegagalan/keputusan merusak.** Tombol "Batalkan booking" memakai
  gaya outline merah, bukan tombol merah penuh — batal bukan aksi utama.
- Kanvas **putih susu** (`surface`); header layar **gelap** dengan gradien
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

### 2.2 Logo

- Aset dalam aplikasi: `assets/images/logo_mark.png` — emblem panggung (tirai,
  not, tiket, gelombang suara) di atas tile putih radius 25%, tampil 40 px di
  header lewat `BrandMark`/`BrandLockup`.
- Master sumber: `design/logo_tarlink_source.jpg`; tidak dibundel ke aplikasi.
- Ikon launcher Android: `mipmap-*/ic_launcher.png` (legacy) dan
  `mipmap-anydpi-v26/ic_launcher.xml` (adaptive, latar putih, foreground di
  dalam safe zone 52%).
- Ikon web: `web/icons/Icon-*.png`, `Icon-maskable-*.png` (safe zone 55%), dan
  `web/favicon.png`.
- Logo selalu diletakkan di atas tile putih. Di latar gelap tanpa tile, garis
  ink menyatu dengan latar dan bentuknya hilang.

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
- Radius: `sm` **8** (badge kecil), `lg` **16** (tombol, input, kartu isi), `xl` **20**
  (panel/sheet), `xxl` **26** (kartu besar, bottom bar), `pill` **999** (chip, filter).
- Tinggi tombol utama: **52**. Field: **52–56**. Target sentuh minimum: **48 × 48**.
- Elevasi: permukaan memakai border 1 px `line`/`lineSoft` + bayangan lembut
  (`0x0A–0x14 0B1220`, blur 14–24, offset 4–8). Tidak ada border ganda.
- Bottom nav pelanggan: bar mengambang **58** + margin 12, radius 18, pil lime untuk
  ikon aktif, label 10.5. Bottom nav vendor memakai pola yang sama (radius 22,
  tinggi 62, pil lime).
- Header layar memakai sudut bawah membulat **24**; garis lime 2 px digambar di dalam
  klip agar tidak menabrak radius.

Grid vertikal mengikuti kelipatan 4; hindari "kartu di dalam kartu".

---

## 5. Arsitektur informasi (4 tab)

Bottom navigation **4 item**, semuanya punya fungsi nyata di backend. Bar mengambang
(radius 18, margin 12, bayangan tipis) di atas kanvas, ikon aktif di dalam pil lime;
bukan bar penuh selebar layar dengan garis atas. Tidak ada tab
"Chat": percakapan dibuka dari detail booking (pelanggan) atau detail pesanan (vendor)
lewat tombol "Chat dengan vendor" / "Chat pelanggan" — API dan WebSocket-nya sudah ada. Notifikasi in-app tidak punya tab;
API `/v1/notifications` ditampilkan sebagai popup, bukan halaman.

| Tab | Isi | Data nyata |
|---|---|---|
| **Beranda** | Sapaan + tanggal, pencarian, booking aktif (kalau ada), "Sedang tampil" (vendor pilihan), pita jaminan dana | `GET /bookings`, `GET /vendors` |
| **Jelajah** | Daftar semua vendor + pencarian + chip kategori (`category`) + pemilih tanggal (`date`) + urutkan Termurah / Nama A-Z; chip wilayah difilter di klien dari hasil yang sudah dimuat | `GET /vendors`, `GET /categories` |
| **Booking** | Daftar booking + segmen Semua / Aktif / Selesai | `GET /bookings` |
| **Profil** | Nama + nomor WA, keamanan sesi, kebijakan, bantuan WhatsApp, keluar | `GET /auth/me`, `GET /policies/:code` |

**Yang sengaja TIDAK ada** (karena backend belum mendukung, dan kontrol mati dilarang):
peta interaktif, promo/voucher, chat foto/lokasi. Chat teks, favorit, form ulasan, dan
notifikasi in-app sudah punya API dan boleh dipakai. Rating yang sudah ada di API boleh
ditampilkan; jangan mengarang ulasan atau angka saat `rating` null.

Navigasi pendalaman (bukan tab): Detail vendor → Jadwal → Buat booking → Status booking
→ Pembayaran → Chat. Alur ini linear, satu tombol "Lanjut" per langkah. Chat juga bisa
dibuka kapan saja dari Status booking (pelanggan) dan Detail pesanan (vendor).

---

## 6. Komponen

### 6.1 Kartu vendor (dipakai di Beranda & Jelajah)
- Radius 22, latar `card`, border 1 px `line`, bayangan lembut (`0x12 0B1220`, blur 22,
  offset 8) supaya kartu terangkat dari kanvas tanpa terasa kotak.
- Atas: `PosterTile` tinggi 184 px, full-bleed sampai sudut kartu. Bila API mengirim
  `avatar_url`/`banner_url`, foto itu yang dipakai; bila kosong, gradien graphite/lime
  deterministik dari nama vendor plus inisial. Badge kategori + video.
- Bawah: nama (17/800, 2 baris), `kategori · wilayah · N paket` (Body S `inkMuted`),
  baris "Mulai dari" + harga 22/800 `ink`, chip DP, dan tombol panah bulat `ink` + ikon
  lime di kanan bawah.
- Seluruh kartu adalah target sentuh (InkWell); **tidak ada tombol CTA terpisah** di kartu.
- Baris rating `★ 4.8 (12)` dan `Respons 92%` hanya muncul bila API mengirim
  `rating`/`response_rate_bp`; nilai null dihilangkan, bukan diisi `0`.
- Jarak dan "terverifikasi" **tidak dirender** karena tidak ada di API halaman kartu.
- Harga kosong → "Harga belum diisi", bukan `Rp0`.
- Skeleton `VendorCardSkeleton` memakai tinggi poster yang sama agar tidak melompat.

### 6.2 Header layar (`StageHeader`)
- Latar gradien `primaryDeep → primary` (graphite), judul putih, sudut bawah membulat
  24, garis bawah lime 2 px di dalam klip.
- **StageBeams** (`ui.dart`): tiga berkas lampu lime statis dari kanan atas + sumber
  radial, digambar sekali. Dipakai di header Beranda (intensitas 0.85), seluruh
  `StageHeader` (0.55), kartu identitas Profil (0.7), dan tiket booking aktif (0.55).
  Tidak beranimasi, jadi tidak menambah biaya scroll.
- Header selalu melebar penuh. Di dalam `Column`, set
  `crossAxisAlignment: CrossAxisAlignment.stretch`; tanpa itu header mengecil dan
  judulnya tampak di tengah (bug lama di layar Profil).
- Beranda memakai header khusus (bukan `StageHeader`): brand lockup + avatar, tanggal
  kapital lime 9.5/800, sapaan 26/800, lokasi + pil jumlah grup, lalu pencarian 52 px
  radius 20.
- Layar detail: `StageHeader.back()` dengan tombol kembali 38×38 radius 16 berlatar
  putih transparan, judul 20/800, aksi kanan opsional (mis. WhatsApp).
- Status bar memakai ikon terang (`SystemUiOverlayStyle.light`) karena header gelap;
  layar tanpa header tetap memakai ikon gelap di atas kanvas terang.

### 6.3 Fishbone status (StatusChip)
Sudah ada di `widgets.dart`. Aturan pemakaian:
- Selalu **teks kata**, bukan titik warna saja (buta warna).
- Maksimal **2 chip** per kartu: satu siklus hidup, satu pembayaran.
- Chip "Ditahan" (uang di PJP) memakai nada `warning` + ikon gembok kecil.

### 6.4 Kartu uang (money block)
Kartu **gelap** (`ink`, radius 26) dengan garis lime 3 px di atas; label putih 64%,
nilai putih 94%, dan satu angka besar lime:
```
Total acara            Rp5.050.000     (Body M / putih 64%)
Sudah dibayar (DP)    −Rp1.500.000     (Body M / putih 94%)
────────────────────────────────────
Sisa yang harus dibayar Rp3.550.000    (Display / lime) ← satu-satunya angka besar
```
- `fully_paid` → baris sisa diganti "Lunas" + chip hijau, angka besar = total.
- `refunded` → "Dana dikembalikan" + chip netral, tanpa angka sisa.
- Format: `Rp1.500.000` (titik ribuan, tanpa desimal, tanpa spasi setelah Rp).

### 6.5 Bottom action bar
- Menempel di bawah, latar `card`, sudut atas membulat **26**, border 1 px `line`,
  bayangan ke atas, padding 16 + safe area.
- Satu tombol `PrimaryButton` tinggi 52 selebar layar; bila ada harga, ringkasan di
  kiri dan tombol 60% di kanan.
- Detail vendor memakai varian **gelap** (`ink`, sudut atas 26) dengan harga putih/lime
  dan tombol lime; ini satu-satunya bottom bar gelap di alur pelanggan.
- Selalu muncul saat ada aksi; tidak pernah menutupi konten (konten diberi padding
  bawah 96–110).

### 6.6 Jadwal 45 hari
- **Rail horizontal** 76 px, satu chip per tanggal (58×76, radius 16), bukan kisi
  mingguan. Chip berisi hari (9.5/700 kapital), tanggal (19/800), bulan (9.5), dan
  titik status 5 px.
- State: `available` (`card` + titik `limeDark`), `waiting`/`unconfirmed`
  (`warningSoft` + titik `warning`), `blocked` (`surfaceSoft`, teks `muted2`, tetap
  bisa dipilih dengan peringatan "Tanggal ini sudah terisi"), `terpilih` (`ink`
  penuh, tanggal putih, titik lime). Tombol "Kalender" di judul seksi membuka
  pemilih tanggal penuh sampai 10 tahun ke depan; hanya tanggal lampau yang ditolak.
  Tanggal di luar jendela kalender vendor ditandai "belum tercakup", bukan dilarang.
- Legenda 1 baris: "Tersedia · Belum pasti · Terisi".
- Bila `stale == true`: banner `warningSoft` di atas rail — "Jadwal terakhir diperbarui
  N hari lalu. Konfirmasi ke vendor lewat WhatsApp." dengan tautan WA.
- Header detail vendor memakai bar tetap: transparan di puncak hero, berubah menjadi
  `ink` solid setelah scroll 28 px supaya judul tidak bertabrakan dengan konten.

### 6.7 Empty state
- Tanda panggung 78×78 (gradien ink, `StageBeams`, ikon lime) + satu judul tebal +
  satu kalimat + satu aksi. Bukan sekadar ikon garis di lingkaran abu-abu.
- Booking kosong: "Belum ada booking. Mulai dari melihat vendor yang sedang tampil."
  Aksi: `Jelajah vendor`.
- Pencarian kosong: "Tidak ada vendor yang cocok dengan 'wayang'." Aksi: `Hapus pencarian`.
- Error memakai tanda panggung bernada merah (`#FF9A8F`) agar tetap terbaca sebagai
  kondisi gagal, bukan hiasan.

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
1. Header panggung gelap dengan `StageBeams`, brand lockup + avatar, tanggal kapital
   lime, sapaan 26/800, lokasi + pil jumlah grup, dan pencarian 52 px. Tidak ada
   tombol Jelajah di header: tab sudah ada di bawah.
2. **Booking aktif** (kalau ada) tampil sebagai **tiket gelap**: label kapital
   "BOOKING AKTIF" lime, pil status putih transparan, nama vendor 20/800 putih,
   kode + tanggal + chip H-N, nominal sisa 28/800 lime, panah di lingkaran lime,
   progress pembayaran lime, dan satu baris "Sudah dibayar … dari …". Tidak ada
   tombol "Lihat booking" terpisah — seluruh tiket bisa ditekan.
3. "Kategori": rel 4 **kartu pintasan** (Tarling & Dangdut, Organ Tunggal, Seni
   Tradisi, Pendukung Acara) setinggi 96 px, latar tint pastel per kategori,
   border 10% warna ikon, ikon 26 px, dan label 11.5/800 dua baris di dalam kartu.
   Setiap pintasan membuka Jelajah dengan filter kategori nyata.
4. Judul seksi memakai **garis lime 3 px** + judul 18/800 (bukan ikon kotak).
   Seksi "Vendor di Pantura" + tautan "Lihat semua", lalu kartu vendor.
5. Bila `total > 4`, tampilkan "Menampilkan 4 dari N vendor" di bawah daftar.
6. Panel jaminan PJP versi gelap (ikon lime, tiga pilar) sebagai penutup halaman.
7. Tanpa banner promo, tanpa carousel auto-play, tanpa pusat notifikasi in-app.

### 7.2 Jelajah
- Header gelap dengan `StageBeams`, emblem, "Jelajah Vendor", subjudul dinamis
  (kategori / wilayah / kata kunci, default "Temukan grup untuk acaramu"), lalu
  pencarian 52 px. Favorit dikelola dari detail vendor dan Profil.
- Baris **"Filter & urutan"** tanpa kartu pembungkus: ikon tune, jumlah filter aktif
  dalam pil ink, panah buka/tutup, dan jumlah vendor di kanan (atau "Reset" bila ada
  filter). Panel terbuka memakai kartu `card` radius 26 + bayangan tipis berisi chip
  kategori berbentuk pil (aktif = `ink` + teks lime), pemilih tanggal & wilayah
  berbentuk pil, dan `SegmentBar` Termurah / Nama A-Z dengan segmen aktif lime.
- Chip kategori dari `GET /categories` (chip pertama "Semua kategori").
- Tanggal mengirim query `date`; wilayah difilter di klien dari hasil yang sudah dimuat.
- Daftar kartu vendor memakai §6.1 (radius 16, bayangan lembut), jarak 12.
- Halaman pertama 20 vendor. Selama `total > termuat`, tampilkan tombol outline
  `Muat vendor lainnya (+N)`; tidak ada spinner penuh layar.
- Kosong: pesan spesifik per filter + satu aksi untuk melepas filter.

### 7.3 Detail vendor
1. **Hero imersif** setinggi 44% layar (320–400 px): `PosterTile` full-bleed memakai
   `banner_url`/`avatar_url`, scrim gradien ink, badge kategori lime + wilayah kaca,
   nama 27/800 putih, lalu baris rating · respons · jumlah paket (hanya field yang
   ada). Kontrol kembali/favorit/chat mengambang di atas foto dalam cakram kaca.
   Ikon chat membuka **thread in-app** bila pelanggan sudah punya booking dengan
   vendor itu (titik lime menandakan thread tersedia); bila belum, sheet menjelaskan
   bahwa chat terikat ke pesanan, dengan tombol "Lihat paket & tanggal" dan
   "WhatsApp (cadangan)" bila nomor vendor ada.
2. Bar atas **tetap**: gradien transparan di puncak hero, berubah menjadi `ink` solid
   setelah scroll 28 px; judul "Detail Grup Hiburan" selalu terbaca. Status bar ikon
   terang.
3. **Pita fakta** putih: durasi, personel, DP, jangkauan — dipisah garis rambut,
   angka 15/800 + label kapital 8.5, bukan baris pil.
4. **Tentang grup** (maks 4 baris + "Baca selengkapnya") hanya bila ada.
5. **Paket & fasilitas**: judul editorial bergaris lime + caption jumlah pilihan.
   Setiap paket satu kartu; yang dipilih berubah **gelap** (`ink`) dengan harga lime,
   chip "DIPILIH", dan cakram centang lime; yang tidak dipilih tetap `card`.
   Fasilitas/add-on hanya dari `inclusions`/`addons`.
6. **Jadwal**: rail 45 hari (§6.6) + legenda, tombol "Kalender" di judul seksi,
   banner `stale` bila data lama.
7. **Video** (bila `video_url`) dan **galeri** (`photo_urls`) memakai `SectionHeader`
   editorial + kartu radius 20.
8. **Aman & jelas**: tiga janji PJP pada panel `surfaceSoft` radius 20.
9. **Lokasi & transport** pada kartu `card`; tanpa peta bila koordinat tidak ada.
10. **Ulasan** hanya dari API; kosong = satu strip netral, bukan bintang palsu.
11. **Bottom bar gelap** radius atas 26: label "Harga mulai"/"Tanggal dipilih", nilai
    putih/lime, tombol lime `Pilih jadwal` → `Lanjut · <tanggal>`.
12. "Laporkan vendor" tetap di paling bawah, tenang, bukan tombol merah besar.

### 7.4 Buat booking
Satu halaman scroll, empat blok bernomor (bukan stepper dengan tombol mati):
1. **Acara** — nama acara, **jenis acara berupa chip pilihan** `Hajatan`,
   `Khitanan / Sunatan`, `Syukuran`, `Unjungan`, `Pesta Panen`, `Lainnya`
   (bukan dropdown; satu ketukan, semua pilihan terlihat). `Lainnya` membuka field
   "Sebutkan jenis acara" (maks 50) yang nilainya dikirim sebagai `event_type`.
   Lalu tanggal acara (dibawa dari jadwal yang sudah dipilih di detail vendor),
   perkiraan tamu, dan catatan. Tidak ada pemilih sesi: booking selalu sehari penuh.
2. **Lokasi acara** — nama tempat (`venue_name`, opsional), lalu pilihan
   **`Ketik alamat` / `Pakai GPS`** (hanya tampil bila perangkat mendukung lokasi).
   Mode ketik: textarea alamat & patokan (wajib, 10–1.000 karakter). Mode GPS:
   tombol "Gunakan lokasi saat ini", kartu pin gelap berisi koordinat + akurasi,
   tombol "Perbarui", dan "Patokan tambahan" opsional. Alamat yang dikirim =
   `patokan · lat, lng`, plus `venue_location` `{lat, lng}`. Izin/lokasi gagal
   dijelaskan dalam bahasa Indonesia, bukan pesan mentah browser.
3. **Paket & tambahan** — paket full-day terpilih (ringkas, bukan pilihan), add-on
   dengan stepper jumlah, harga mengikuti.
4. **Ringkasan uang** — kartu uang (§6.4) dengan DP dan sisa; teks aturan DP
   ("DP berlaku 24 jam; untuk nilai ≥ Rp10 juta, 48 jam") dan catatan bahwa
   pembayaran DP dibuka setelah vendor menerima booking.
Bottom bar: `Kirim permintaan booking`. Validasi inline per field, pesan di bawah
field, bukan dialog. Tombol bayar DP baru muncul di Status booking setelah vendor
menerima. Vendor melihat nama tempat + alamat dan tombol **Peta** di detail pesanan.

### 7.5 Status booking
1. Header: kode booking (mono/`Label M`, bisa disalin) + chip siklus hidup + chip bayar.
2. **Kartu uang** (§6.4) — elemen terbesar.
3. Instruksi pembayaran (bila `unpaid`): QRIS (kode + tombol `Simpan`), VA (nomor +
   tombol `Salin`), hitung mundur kedaluwarsa, teks "Selesaikan sebelum 23.59".
4. Timeline vertikal 4 langkah: **Booking dibuat → Vendor menerima → Bayar DP /
   DP diterima → Acara**. Judul langkah ketiga mengikuti `payment_status`:
   "Bayar DP" selama `unpaid`, "DP diterima" setelah DP masuk — jangan pernah
   hardcode "DP diterima". Titik aktif = `primary`, selesai = `accent`, belum = `line`.
5. Detail acara & vendor (alamat, jadwal, paket).
6. Aksi sekunder: `Hubungi vendor (WhatsApp)`, `Batalkan booking` (outline merah,
   konfirmasi bottom sheet dengan konsekuensi DP ditulis jelas).
7. Polling 15 detik hanya selama `unpaid`; saat berpindah ke `dp_paid` tampilkan
   panel konfirmasi eksplisit (bukan snackbar, bukan timer):
   **"Pembayaran DP diterima"** berisi nominal DP, kode booking, dan tanggal acara
   yang terkunci. Panel harus ditutup pengguna sebelum kartu pelunasan dipakai.
8. Pelunasan tidak pernah membuka metode pembayaran otomatis. Kartu ringkas
   ("Sisa tagihan" + tombol `Bayar pelunasan`) tampil lebih dulu; metode baru
   dirender setelah tombol ditekan. Sebelum `settlement_available_at` (H-7,
   ADR 0038) tombol nonaktif dan copy berbunyi "Pelunasan dibuka <tanggal>".
9. Kepadatan checkout (form Buat Booking dan panel pembayaran) mengikuti skala
   e-commerce, bukan skala hero: judul seksi `dense` **15,5**; field **42–64 px**
   (`isDense`, `contentPadding` 12/10, radius 12); jarak antar-field **8**; baris
   metode **46**; tombol aksi `dense` **46** (tap target 48). Angka uang utama
   18–19 di dalam form/panel; ukuran hero hanya untuk kartu ringkasan, bukan
   untuk setiap label.

### 7.6 Booking saya
- Segmen: Semua / Aktif (`unpaid`, `dp_paid`, `confirmed`) / Selesai (`completed`,
  `cancelled`, `expired`).
- Kartu berbentuk **tiket**: spine kiri 58 px berwarna `ink` berisi hari kapital lime,
  tanggal 25/800 putih, bulan kapital putih 55%; garis perforasi putus-putus 1 px
  memisahkan spine dari isi. Isi: kode + chip, nama vendor 17/800, sesi + tahun, lalu
  footer `surfaceSoft` berisi "DP …"/"Dibayar …" di kiri dan "Sisa Rp…"/"Lunas" 15/800
  di kanan + chevron. Tanggal kosong → spine "JADWAL — MENYUSUL".
- Radius 16 + bayangan lembut, bukan border.
- Kosong (§6.7) dengan aksi `Cari vendor` yang berpindah ke tab Jelajah.
  Tarik-untuk-refresh.

### 7.7 Akun
- Header "Profil" + subjudul "Akun dan pengaturan Tarlink", dengan `StageBeams`.
- Blok identitas **gelap**: monogram 60 di cakram lime, nama 20/800 putih, nomor WA
  dan email putih transparan, beam lime tipis di belakang.
- Kartu **lime** "Buka jasa hiburanmu" (ikon storefront di cakram ink, panah) sebagai
  pintu masuk formulir vendor — bukan baris kesembilan di daftar pengaturan.
- Tiga kelompok dengan judul bergaris lime: **Aktivitas** (Vendor favorit, Banding
  konten), **Bantuan & kebijakan** (pembatalan, privasi, WhatsApp), dan **Akun**
  (Hapus akun, Keluar). Tiap kelompok satu kartu radius 22 + bayangan lembut; ikon
  baris di kotak tint 32 px.
- Kebijakan dibuka di sheet dengan teks dari `GET /policies/:code`; tanpa teks hukum
  palsu.
- `Keluar` memakai konfirmasi sheet, bukan dialog sistem.

### 7.8 Welcome / Login / Daftar
- **Welcome** (sekali sebelum login): layar gelap `ink`, foto
  `assets/images/welcome_stage.jpg` dengan overlay gradien, brand lockup terang,
  judul "Hiburan panggung untuk acaramu.", tiga poin jaminan (DP ditahan, jadwal &
  paket jelas, langsung ke vendor lewat chat in-app), CTA lime "Mulai cari hiburan",
  dan tautan "Sudah punya akun?".
- Login/daftar memakai pola **stage + ticket**: seluruh layar gelap `ink` dengan
  beam lime statis di header (bukan flat gradient), brand lockup terang, garis lime
  34×3, judul 31/800 dan satu kalimat penjelas. Form duduk di **kartu tiket**
  `card` radius 26 dengan garis lime 3 px di sisi atas dan bayangan lembut; field
  tetap menjadi elemen yang paling menonjol. Komponennya `AuthStage`, `AuthBody`,
  `AuthCard` di `auth_support.dart`.
- Field memakai **garis bawah** (`authLineField`), bukan kotak putih: label
  kapital 10/800 `letterSpacing 1.15`, teks 15, garis fokus 2 px `ink`. Tinggi
  sentuh tetap ≥ 48.
- CTA lime tinggi 54, radius 16, label di kiri dan panah di disc `ink` 28 px di
  kanan (`AuthSubmitButton`), dipakai Masuk dan Daftar.
- Login: kartu berisi email + kata sandi + CTA; **di bawah kartu** ada consent
  (web), tombol Google, tautan "Daftar sekarang", lalu catatan HTTPS.
- Daftar: kartu berisi nama, email, kata sandi, konfirmasi + CTA; **di bawah
  kartu** ada consent (S&K/Privasi, opt-in), lalu tombol Google dan tautan
  "Masuk". Nomor WhatsApp bukan field pendaftaran.
- Tombol Google hanya dirender bila build diberi
  `--dart-define=GOOGLE_CLIENT_ID=...` (web) atau `GOOGLE_SERVER_CLIENT_ID`
  (Android). Di web tombol resmi GIS baru aktif setelah consent dicentang;
  sebelum itu tampil "Centang persetujuan dulu". Di Android tombol putih memakai
  aset resmi `assets/images/google_g.png`, bukan huruf "G" yang digambar.
- **Tidak ada** "Lupa Kata Sandi?" karena backend belum menyediakannya.
- Error kredensial: baris inline di atas CTA (atau di bawah kartu saat error
  menyangkut kebijakan), bukan snackbar.

### 7.9 Portal vendor (bahasa visual terpisah)
Portal vendor memakai `vendor_theme.dart` dan `vendor_ui.dart`, tetapi mengikuti
ritme yang sama dengan aplikasi pelanggan:
- **Header** gelap `#182540 → ink` dengan beam lime, mark inisial 38 px, kicker lime,
  judul 15.5/800, dan pita uang `Ditahan PJP` (angka 23/800 lime).
- **Kartu** `VendorCard`: `cardWhite`, radius 22, border `lineSoft`, bayangan
  `0x10 0B1220` blur 20. Judul seksi memakai garis lime 3×18 + label kapital 11.5.
- **Tombol** `VendorButton`: lime/putih/outline-on-dark, tinggi 46 (36 small),
  radius 16/10, teks 13.5/800. **Pil** status berbentuk pill dengan titik 5 px.
- **Bottom nav** mengambang radius 22, tinggi 62, pil lime untuk ikon aktif —
  sama seperti pelanggan, bukan bar penuh dengan garis atas.
- **Beranda vendor**: sapaan tanggal + "Perlu jawaban" 28/800, tiga kartu statistik
  (total, menunggu, bulan ini) dengan ikon berwarna, antrean/empty state beraksi,
  jadwal 7 hari dengan tombol "Atur ketersediaan", panel uang **gelap** dengan angka
  lime + "Lihat saldo", lalu kartu "Panduan cepat" tiga baris.
- **Profil vendor**: kartu identitas gelap (inisial, nama 17/800, pil verifikasi,
  tombol "Ubah"), tiga kartu statistik, grid 2×2 aksi (Profil & media, Paket & harga,
  Rekening, Ketersediaan), daftar akun, dan catatan admin.
- **Paket**: header ringkasan gelap (katalog aktif + harga mulai), kartu paket dengan
  foto 76 px, pil Aktif, harga 15/800, lalu kartu "Tips paket" tiga baris; bottom bar
  "Tambah paket" radius atas 22.
- **Form vendor**: `VendorTextField` label kapital 11/800, field putih radius 12,
  fokus lime; bottom bar simpan radius atas 22; error/empty memakai tanda panggung
  gelap 58 px.
- **Detail pesanan vendor**: header menyimpan pil status + tombol chat 34 px
  (selalu terlihat), kartu PELANGGAN punya tombol "Chat pelanggan"; keduanya
  membuka thread in-app yang sama. Detail pesanan juga punya tombol **Peta** di
  samping alamat.

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

1. Kata kerja di tombol: `Kirim permintaan booking`, `Pilih jadwal`, `Bayar DP`,
   `Hubungi vendor`.
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
  `video_url`). Bila kosong, `PosterTile` memakai blok inisial + artwork panggung
  (ground gelap + satu warna sorot dari hash nama + tekstur halftone + garis footlight);
  jangan pakai gambar stok baru di UI.
- Chat memakai `GET/POST /v1/bookings/:id/chat/messages` + `WS /v1/chat/ws`; teks saja,
  tanpa foto/lokasi. WhatsApp deep link hanya cadangan. Notifikasi in-app memakai popup,
  bukan tab.
- WebSocket di web memakai `dart:html`, di mobile/desktop memakai `dart:io`; tidak ada
  dependency baru. Bila koneksi putus, layar menampilkan "Menyambung ulang…" dan
  pengiriman tetap lewat REST.
- Kategori **ada** (`GET /categories`, query `category`); filter wilayah masih di klien
  karena API memfilter dengan kode, bukan nama.
- E-wallet belum berfungsi → UI hanya menawarkan QRIS dan VA.
- Sesi bisa habis saat cold start → layar login harus terasa wajar, bukan error.
- Consent (FR-103) hanya di layar **Daftar akun**: checkbox menampilkan versi
  `tos`/`privacy` dari `GET /policies/:code`, dan versi itu dikirim saat submit.
  Login tidak meminta consent lagi. Bila kebijakan gagal dimuat, tombol daftar
  dinonaktifkan dan sediakan "Muat ulang".
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
