# SOP AGEN LAPANGAN — Tarlink Pantura

**Versi:** 1.0 · **Berlaku:** pilot Indramayu & Cirebon · **Pemilik dokumen:** Ops Lead
**Rujukan utama:** `PRD-v1.1.md` §5.10, §5.12, §6.2, §9, §10, §11, §15.1 · **Rujukan keputusan:** D-01, D-02, D-15, D-17

> **Cara pakai:** dokumen ini dibawa saat kunjungan. Bagian 4 dan 5 dibaca apa adanya. Bagian 2 dipakai mengisi laporan sore. Bagian 12 dijalankan sebelum meninggalkan lokasi vendor.
>
> **Aturan tertinggi:** bila isi dokumen ini berbeda dengan `PRD-v1.1.md`, PRD yang berlaku. Bila agen ragu, jangan menjanjikan apa pun — catat pertanyaannya dan eskalasi (Bagian 9).

---

## 1. Tujuan dan Batas Peran Agen

### 1.1 Tujuan

1. Memastikan **40 vendor perintis** di 2 kabupaten tayang, terverifikasi, dan kalendernya terisi — bukan sekadar mendaftar (`PRD-v1.1.md` §15.1).
2. Menjaga **rasio 1 agen : 40 vendor aktif** (`PRD-v1.1.md` §10.4) sehingga setiap vendor punya pendamping yang tahu namanya.
3. Menjaga kualitas data: tanggal, harga, rekening, dan media yang benar sejak awal, agar pencarian tidak menampilkan vendor yang sebenarnya tidak tersedia.

### 1.2 Yang BOLEH dijanjikan

| Boleh dijanjikan | Angka/isi yang benar | Rujukan |
|---|---|---|
| Komisi bertingkat | 10% untuk bagian nilai transaksi sampai Rp 10 juta; 5% untuk bagian di atas Rp 10 juta; lantai Rp 25.000/booking; batas absolut Rp 7.500.000/booking | D-17, §5.12 |
| Biaya layanan pelanggan | 1%, dibayar pelanggan, ditampilkan terpisah sebelum pembayaran — tidak dipotong dari payout vendor | §5.10 |
| DP | 30% dari total, dibayar pelanggan lewat gateway | §5.2 |
| Dana ditahan di mana | Di gateway/PJP berizin, **bukan** di rekening platform | D-01 |
| Kapan dana dirilis | Setelah acara selesai dan jendela sengketa; target p95 ≤3 hari kerja | §9.1, §10.2 |
| Kalender | Vendor bisa menandai tanggal: tersedia / terpesan / diblokir; tanggal tanpa data berlabel "belum diisi" dan tidak dianggap tersedia | D-10, FR-108 |
| Insentif perintis | Komisi 0% selama 2 bulan untuk 40 vendor perintis, dibatasi anggaran Rp 40.000.000, diberikan sebagai **kredit**, berhenti otomatis saat kuota habis | §15.1 |
| Respons booking | Permintaan booking bisa diterima/ditolak lewat WhatsApp, tanpa wajib pasang aplikasi | D-15 |

### 1.3 Yang DILARANG dijanjikan

| Dilarang | Contoh kalimat yang tidak boleh diucapkan | Alasan |
|---|---|---|
| Menjamin jumlah order | "Dijamin sebulan dapat 5 order." | Tidak ada jaminan permintaan di PRD. |
| Menjanjikan komisi 0% di luar masa insentif | "Komisinya 0% terus, santai." | Insentif hanya 2 bulan, 40 vendor, kuota Rp 40 jt. |
| Memungut uang tunai | "Biar cepat, setor saja Rp 100 ribu ke saya." | **Tidak ada satu pun pembayaran tunai ke agen.** Semua lewat gateway. |
| Menjanjikan tanggal payout pasti | "Hari Selasa uangnya pasti masuk." | Yang berlaku target p95 ≤3 hari kerja, dieksekusi `admin_finance`. |
| Menjanjikan perubahan tarif | "Nanti saya carikan komisi lebih murah." | Tarif di luar range butuh persetujuan PO + Finance (§5.10). |
| Menjanjikan peringkat pencarian | "Vendor Bapak saya taruh paling atas." | Tidak ada fitur prioritas di Fase 1. |
| Menjanjikan hasil sengketa/refund | "Kalau batal, pasti uang kembali penuh." | Refund mengikuti kebijakan berjenjang dan snapshot booking. |
| Menjanjikan perubahan rekening instan | "Rekening baru langsung aktif." | Ganti rekening memicu cooling 7 hari (FR-105). |
| Menandai vendor sebagai "perintis" sendiri | "Sudah saya daftarkan sebagai perintis." | Status perintis ditetapkan Admin saat approve, bukan oleh agen. |

### 1.4 Batas kewenangan

- Agen **tidak** menyetujui vendor, tidak memoderasi media, tidak merilis dana, tidak memutuskan refund.
- Agen **tidak** mengubah tarif, DP, atau kebijakan pembatalan.
- Agen **tidak** menerima titipan uang, dokumen asli, atau password/OTP vendor.
- Agen **boleh** membantu mengisi form, mengunggah dokumen dengan izin vendor, dan melatih vendor mengisi kalender.

---

## 2. Target dan KPI

### 2.1 Angka dasar (dari PRD, jangan diubah)

| Angka | Nilai | Rujukan |
|---|---|---|
| Vendor perintis | 40 vendor tayang | §15.1 |
| Sebaran kabupaten | 2 kabupaten (Indramayu, Cirebon), ≥15 vendor per kabupaten | §6.2, §15.1 |
| Rasio pendampingan | 1 agen : 40 vendor aktif | §10.4 |
| Kategori | ≥3 vendor per kategori per kabupaten | §15.1 |
| Corong akuisisi | 120 calon → 80 kunjungan → 50 pendaftar → 40 tayang → 30 aktif | §15.1 |
| Konversi kunjungan → pendaftaran selesai | ≥60% | §15.1 |
| Vendor aktif ÷ vendor tayang | ≥75% (30 dari 40) | §15.1 |
| Response rate vendor ≤24 jam | ≥85% (ambang Gate 1 minimal 80%) | §9.1, §6.2 |
| Median waktu accept | ≤6 jam | §9.1 |
| Kesegaran kalender | ≤7 hari sejak pembaruan terakhir | §9.1 |
| Insentif perintis | 0% selama 2 bulan, anggaran Rp 40.000.000, kredit bukan tunai | §15.1 |

### 2.2 KPI harian

| KPI | Target harian | Cara hitung | Dasar |
|---|---|---|---|
| Kunjungan tatap muka — fase akuisisi | **5 vendor/hari** | Dihitung dari check-in lokasi, bukan dari janji temu | §15.1 |
| Kunjungan tatap muka — fase operasi (40 vendor sudah tayang) | **2 vendor/hari** | Siklus 40 vendor ÷ 20 hari kerja = 2/hari | Turunan §10.4 |
| Onboarding selesai penuh (7 langkah Bagian 6) | **2 vendor/hari** | Status "menunggu verifikasi" di admin | Turunan §15.1 |
| Pendaftaran dimulai | **3 vendor/hari** | 5 kunjungan × 60% | §15.1 |
| Follow-up WA | **15 percakapan/hari** | Pesan keluar yang dibalas | Operasional |
| Vendor kalender 30 hari ke depan diperbarui | **2 vendor/hari** | `calendar_updated_at` berubah | §9.1 |
| Laporan sore terkirim | **1/hari, 100%** | Pukul 17.00 | Bagian 10 |

### 2.3 KPI mingguan (Senin–Sabtu, 6 hari kerja)

| KPI | Target mingguan | Catatan |
|---|---|---|
| Kunjungan | 30 (akuisisi) / 12 (operasi) | 6 hari × target harian |
| Onboarding selesai | 12 | 40 vendor perintis tercapai dalam ±4 minggu |
| Vendor tayang baru | 10 | Termasuk waktu verifikasi admin ≤2 hari kerja |
| Vendor dengan kalender terisi ≥30 hari ke depan | ≥75% dari vendor tayang (30/40) | Definisi aktivasi §15.1 |
| Vendor aktif (kalender diperbarui ≤7 hari) | ≥75% dari vendor tayang (30/40) | Definisi §9.1; target PRD 60% dari seluruh vendor terverifikasi |
| Response rate vendor | ≥85% | Di bawah 80% = intervensi |
| Kasus belum dieskalasi >2 jam | 0 | Bagian 9 |

> **Aturan angka:** jangan menaikkan target di atas PRD untuk mengejar bonus. Bila target tidak tercapai, yang dilaporkan adalah angka sebenarnya + penghambatnya (Bagian 10), bukan angka yang dibulatkan.

---

## 3. Rutinitas Harian

Jam kerja agen: **09.00–17.00 WIB, Senin–Sabtu** (`PRD-v1.1.md` §10.1).

| Jam | Blok | Aktivitas | Keluaran |
|---|---|---|---|
| 09.00–09.15 | Persiapan | Buka daftar vendor hari ini (maks. 8 nama). Cek status verifikasi di admin. Tentukan rute. Siapkan 3 hal: kartu nama, kuota internet, daftar harga komisi D-17 | Rute + 8 nama + status tiap vendor |
| 09.15–09.45 | Perjalanan | Konfirmasi WA: "Pak/Bu, saya tiba sekitar jam X." Catat yang tidak membalas | 8 konfirmasi terkirim |
| 09.45–12.15 | Kunjungan blok 1 | 3 kunjungan. Skrip 5 menit (Bagian 4). Bila vendor setuju, lanjut onboarding di tempat (60 menit) | 3 catatan kunjungan |
| 12.15–13.15 | ISHOMA + follow-up WA | Balas WA vendor yang tertunda. Kirim ringkasan ke vendor yang baru ditemui. Maks. 15 percakapan | 15 percakapan tercatat |
| 13.15–15.45 | Kunjungan blok 2 | 2 kunjungan baru + 1 kunjungan ulang (vendor yang onboarding-nya menggantung) | 3 catatan kunjungan |
| 15.45–16.30 | Input data | Semua catatan masuk ke sistem. Unggah dokumen yang sudah diizinkan vendor. Jangan menunda ke besok | 0 catatan kertas tersisa |
| 16.30–16.45 | Tindak lanjut | Hubungi vendor yang belum melengkapi paket/kalender. Bila ada masalah payout, eskalasi (Bagian 9) | 0 vendor menggantung >24 jam |
| 16.45–17.00 | Laporan sore | Isi format 5 baris (Bagian 10). Kirim ke Ops Lead | Laporan terkirim |

**Aturan blok kunjungan:**
- Maksimal 20 menit menunggu vendor. Lewat itu, tinggalkan kartu dan jadwalkan ulang.
- 1 onboarding penuh = 60 menit. Bila dilakukan di blok kunjungan, kurangi target kunjungan blok itu 1.
- Vendor yang menolak tetap dicatat alasannya (Bagian 11.4) — penolakan adalah data, bukan kegagalan.

---

## 4. Skrip Kunjungan 5 Menit

> Dibaca apa adanya. Ganti "Bapak/Ibu" sesuai vendor. Jangan menambah janji di luar Bagian 1.2.

### 4.1 Pembuka (0:00–0:30)

> "Assalamualaikum, Pak. Saya [nama] dari Tarlink. Saya bukan mau jualan sound atau nyari jasa. Saya dari platform booking hiburan yang lagi jalan di Indramayu dan Cirebon.
>
> Kedatangan saya cuma 5 menit: saya mau tunjukkan cara orang yang mau hajatan bisa lihat jadwal Bapak yang kosong, dan kalau cocok, mereka bayar DP dulu lewat aplikasi. Bapak masih sempat kalau saya jelaskan sebentar?"

*Jika vendor sibuk:* "Kalau sekarang sedang ramai, saya balik jam [jam]. Boleh saya tinggalkan nomor?"

### 4.2 Tiga pertanyaan discovery (0:30–2:00)

**Pertanyaan 1 — jadwal:**
> "Bulan ini jadwal Bapak sudah terisi berapa tanggal? Yang kosong biasanya di tanggal berapa?"

**Pertanyaan 2 — sumber order:**
> "Kalau ada orang telepon tanya harga dan tanggal, Bapak biasanya jawab dari mana? Ada catatan jadwal atau diingat-ingat?"

**Pertanyaan 3 — kehilangan order:**
> "Pernah nggak, calon pelanggan akhirnya ambil grup lain karena Bapak baru bisa balas besoknya, atau ternyata tanggalnya sudah dipakai?"

*Dengar, jangan potong. Catat 2 hal: (a) berapa tanggal terisi bulan ini, (b) cara vendor mencatat jadwal.*

### 4.3 Demo 2 menit (2:00–4:00)

Buka aplikasi di ponsel vendor, bukan di ponsel agen. Urutan yang ditunjukkan hanya 4 layar:

1. **Cari berdasarkan tanggal.** "Ini kalau ada yang cari hiburan tanggal 12. Yang muncul cuma yang tanggalnya masih kosong."
2. **Harga "mulai dari".** "Harganya kelihatan dari awal, jadi yang telepon sudah tahu kelasnya. Bapak nggak perlu tawar-menawar lewat WA."
3. **Permintaan booking masuk ke WA.** "Kalau ada yang pesan, Bapak dapat pesan WA. Tinggal pencet Terima atau Tolak. Nggak perlu buka aplikasi."
4. **DP masuk lewat gateway.** "Pelanggan bayar DP 30% dulu. Uangnya ditahan di gateway berizin, bukan di rekening kami. Setelah acara selesai, baru dirilis ke rekening Bapak."

*Kalimat penutup demo:*
> "Jadi tiga masalah yang saya dengar tadi — jadwal bentrok, harga ditanya berulang, dan pelanggan kabur — itu yang dibereskan. Bapak nggak perlu pasang apa-apa untuk terima booking, cukup WA."

### 4.4 Penanganan keberatan (4:00–4:30)

Ambil **satu** keberatan yang paling terasa. Naskah lengkap ada di Bagian 5. Jangan berdebat; kalau keberatannya bukan yang ada di daftar, catat dan bilang: "Ini saya tanyakan dulu ke atasan saya, besok saya kabari."

### 4.5 Penutup (4:30–5:00)

> "Kalau Bapak setuju, yang saya kerjakan sekarang cuma dua: foto 5 portofolio dan isi tanggal yang sudah terisi sampai 30 hari ke depan. Sisanya — KTP, rekening, paket — kita kerjakan sambil ngopi, sekitar satu jam. Boleh saya mulai dari fotonya?"

*Kalau vendor belum siap:*
> "Tidak apa-apa. Saya tinggalkan nomor saya. Minggu depan saya mampir lagi, saya bawa contoh vendor dari [kategori] yang sudah jalan. Boleh saya catat nomor WA Bapak?"

**Komitmen penutup yang wajib diucapkan:** tanggal kunjungan berikutnya + satu langkah konkret. Tanpa itu, kunjungan dianggap belum selesai.

---

## 5. Penanganan Keberatan

> Pola semua naskah: **akui → jelaskan dengan angka → beri langkah kecil**. Jangan memotong, jangan mengulang janji, jangan menekan.

### 5.1 "Saya sudah punya pelanggan sendiri"

**Yang sebenarnya dikhawatirkan:** takut direpotkan tanpa tambahan order.

> "Justru karena Bapak sudah punya pelanggan, platform ini bukan untuk cari pelanggan baru buat Bapak. Fungsinya dua: pertama, pelanggan Bapak yang sudah ada bisa pesan sendiri dan bayar DP, jadi Bapak nggak perlu nagih. Kedua, tanggal yang Bapak isi itu muncul kalau ada orang dari luar jaringan Bapak cari hiburan di tanggal itu. Pelanggan lama tetap milik Bapak — kami nggak pernah ngambil kontak pelanggan Bapak."

**Jangan bilang:** "Nanti pelanggan Bapak pindah semua ke aplikasi."

### 5.2 "Takut pelanggan saya diambil"

**Yang sebenarnya dikhawatirkan:** data pelanggan dan hubungan personal diambil alih.

> "Saya paham. Di sistem kami, data pelanggan Bapak nggak pernah kami minta. Yang saya catat cuma tanggal dan status — 'tanggal 12 sudah terisi'. Nama, nomor HP, alamat, harga yang Bapak terima dari pelanggan itu — nggak masuk. Jadi walaupun saya mau, saya nggak punya daftar pelanggan Bapak. Terakhir, saya agen yang digaji untuk dampingin Bapak, bukan untuk jualan ke pelanggan Bapak."

### 5.3 "Komisi terlalu besar"

**Yang sebenarnya dikhawatirkan:** potongan terasa besar, terutama di acara mahal.

> "Saya jelaskan angkanya, Pak, biar jelas.
>
> Kalau acaranya **Rp 4 juta**: komisi 10% = **Rp 400 ribu**. Bapak terima Rp 3,6 juta sebelum biaya gateway.
>
> Kalau acaranya **Rp 40 juta**: bukan 10% dari Rp 40 juta — itu Rp 4 juta. Yang berlaku bertingkat. 10% dari Rp 10 juta pertama = Rp 1 juta. Sisanya Rp 30 juta kena 5% = Rp 1,5 juta. Total **Rp 2,5 juta**, atau 6,25%. Bapak hemat **Rp 1,5 juta** dibanding tarif datar.
>
> Di acara kecil juga ada lantainya: minimum Rp 25 ribu per booking. Dan ada batas paling tinggi Rp 7,5 juta per booking, jadi acara sangat besar nggak bikin potongan terus naik.
>
> Yang saya minta Bapak bandingkan bukan komisi dengan nol, tapi komisi dengan order yang sekarang lewat tanpa DP dan sering batal."

**Jangan bilang:** "Komisinya bisa saya kurangi." (Agen tidak berwenang — §5.10.)

### 5.4 "Saya tidak bisa pakai aplikasi"

**Yang sebenarnya dikhawatirkan:** takut salah pencet, takut ribet, malu kelihatan gaptek.

> "Bapak nggak perlu bisa pakai aplikasi. Booking masuk ke WhatsApp Bapak, tinggal pencet **Terima** atau **Tolak**. Kalau Bapak nggak balas dalam 4 jam, sistem nelpon saya, dan saya yang bantu jawab atas nama Bapak — tercatat di sistem bahwa itu saya. Untuk isi kalender, saya yang isi di depan Bapak, Bapak tinggal bilang tanggal mana yang sudah ada acara. Kalau nanti Bapak mau coba sendiri, saya ajarin 10 menit."

**Jangan bilang:** "Gampang kok, tinggal klik-klik." (Meremehkan kekhawatiran.)

### 5.5 "Nanti saja setelah lebaran"

**Yang sebenarnya dikhawatirkan:** tidak ada urgensi, atau takut terikat.

> "Boleh, Pak. Saya cuma mau pastikan satu hal: yang Bapak tunda itu bukan pendaftaran, tapi **tanggal**. Kalau setelah lebaran baru daftar, tanggal-tanggal Ramadan dan Lebaran yang sekarang masih kosong sudah diisi orang lain di aplikasi — dan yang cari hiburan di aplikasi nggak akan lihat Bapak.
>
> Jadi usul saya: sekarang kita isi jadwal dan portofolio dulu, sekitar satu jam. Bapak nggak keluar uang sepeser pun, nggak ada kontrak eksklusif, dan bisa berhenti kapan saja. Setelah lebaran kita lihat hasilnya."

*Jika tetap menolak:* "Baik, saya catat. Saya mampir lagi tanggal [tanggal], saya bawa data berapa orang cari hiburan di [kecamatan] bulan itu." **Jangan menawarkan insentif tambahan.**

### 5.6 "Saya tidak punya KTP / rekening"

**Yang sebenarnya dikhawatirkan:** malu, atau memang belum punya persyaratan.

> "Tidak masalah, kita cek pelan-pelan. Yang wajib ada dua: KTP pemilik usaha dan rekening bank atas nama yang sama dengan KTP. Kalau rekening masih atas nama istri atau saudara, itu belum bisa — sistem kami mencocokkan nama rekening dengan identitas vendor, supaya uangnya nggak salah masuk.
>
> Kalau KTP-nya ada tapi sedang dipegang orang, kita foto hari lain. Kalau rekening belum ada, Bapak bisa buka rekening dulu, saya bantu jelaskan syaratnya. Sementara itu, saya tetap bisa bantu isi portofolio dan kalender, supaya begitu dokumen siap, Bapak langsung tayang. Yang belum lengkap memang belum bisa kami ajukan — itu aturan sistem, bukan saya."

**Jangan bilang:** "Bisa pakai rekening orang lain dulu."

### 5.7 "Nanti uang saya ditahan"

**Yang sebenarnya dikhawatirkan:** takut platform membawa kabur uang atau menahan terlalu lama.

> "Wajar kalau Bapak curiga. Yang perlu Bapak tahu: uang pelanggan **tidak masuk ke rekening kami**. Ditahan di gateway berizin, dan kami cuma mencatat kewajiban kami ke Bapak. Rilis dana dilakukan admin keuangan setelah acara selesai dan masa sengketa lewat, target paling lambat 3 hari kerja. Rilis di atas Rp 1 juta harus disetujui dua orang berbeda. Jadi bukan satu orang yang bisa memindahkan uang seenaknya.
>
> Yang justru lebih berisiko itu cara sekarang: pelanggan bayar DP tunai ke Bapak, tapi kalau Bapak sakit dan nggak bisa hadir, Bapak yang harus kembalikan sendiri. Di sini ada catatannya."

**Jangan bilang:** "Dijamin besok cair." (Bukan kewenangan agen.)

### 5.8 "Apa bedanya dengan WA?"

**Yang sebenarnya dikhawatirkan:** merasa WA sudah cukup, tidak melihat nilai tambah.

> "Kalau cuma chat, memang sama. Bedanya ada tiga.
>
> **Pertama, jadwal.** Di WA, Bapak harus jawab satu-satu 'tanggal 12 kosong'. Di sini, tanggal yang Bapak isi langsung kelihatan kosong atau terisi, dan tanggal yang sudah dibooking terkunci — jadi nggak ada double booking.
>
> **Kedua, uang.** Di WA, janji tinggal janji. Di sini, pelanggan bayar DP 30% lewat gateway sebelum tanggal dikunci.
>
> **Ketiga, bukti.** Kalau ada masalah, ada catatan siapa memesan apa dan kapan. Di WA, riwayatnya tenggelam di grup.
>
> WA tetap dipakai — booking-nya malah masuk ke WA Bapak. Yang ditambah cuma jadwal dan uangnya."

### 5.9 "Bisa komisinya lebih murah?"

**Yang sebenarnya dikhawatirkan:** ingin merasa menang negosiasi.

> "Saya nggak punya wewenang ubah tarif, Pak — dan kalau saya bilang 'bisa', itu artinya saya bohong, karena yang menetapkan PO dan Finance. Yang bisa saya sampaikan: tarifnya sudah bertingkat supaya acara besar nggak kena 10% penuh. Kalau Bapak punya kasus khusus, saya catat dan saya ajukan. Tapi jangan saya janjikan."

### 5.10 "Kenapa saya harus kasih foto KTP? Takut disalahgunakan"

**Yang sebenarnya dikhawatirkan:** penipuan identitas.

> "Pertanyaan yang benar. KTP Bapak dipakai untuk dua hal saja: memastikan yang daftar memang pemilik usaha, dan mencocokkan nama dengan rekening supaya uang nggak salah orang. Fotonya diunggah lewat aplikasi, terenkripsi, dan cuma admin verifikasi yang bisa lihat — agen nggak menyimpan foto KTP di ponsel. Kalau Bapak mau, Bapak yang pegang ponsel dan yang tekan tombol unggah; saya nggak perlu menyentuh KTP-nya."

---

## 6. Prosedur Onboarding Vendor

Total estimasi: **60 menit**. Bisa dipecah dua sesi bila vendor sibuk. Urutan tidak boleh dibolak-balik: verifikasi dulu, baru tayang.

| # | Langkah | Waktu | Yang agen lakukan | Yang harus terlihat |
|---|---|---|---|---|
| 1 | **Pendaftaran akun** | 5 menit | Bantu buat akun dengan nomor WA vendor. Pastikan OTP masuk. Minta vendor membaca dan menyetujui syarat + kebijakan privasi | Akun aktif, consent tercatat |
| 2 | **Verifikasi KTP** | 5 menit | Vendor memegang ponselnya sendiri, foto KTP lewat kamera aplikasi. Cocokkan nama & NIK di layar | KTP terunggah, nama sama dengan pemilik |
| 3 | **Rekening bank** | 5 menit | Isi nama bank, nomor rekening, nama pemilik. **Nama rekening harus sama dengan KTP.** Jelaskan cooling 7 hari bila ganti rekening | Rekening tersimpan, status menunggu verifikasi |
| 4 | **Foto/video portofolio** | 15 menit | 5 foto: panggung/tempat, alat, tim, 1 foto acara, 1 foto depan lokasi. 1 video ≤60 detik. Vendor menyatakan media miliknya sendiri | 5 foto + 1 video, pernyataan lisensi dicentang |
| 5 | **Pembuatan paket** | 10 menit | 3 paket: kecil / menengah / lengkap. Isi durasi, jumlah personel, fasilitas. Harga "mulai dari". Transport dihitung terpisah dan disetujui pelanggan | 3 paket, harga wajar dibanding daftar harga vendor |
| 6 | **Isi kalender 30 hari** | 10 menit | Tanya tanggal yang sudah terisi (Bagian 7). Tandai **terpesan** untuk yang terisi, **tersedia** untuk yang benar-benar bisa dipakai, **diblokir** untuk yang tidak bisa dipakai tapi belum ada acara. Jangan biarkan "belum diisi" | ≥30 hari ke depan punya status |
| 7 | **Uji terima booking** | 5 menit | Kirim 1 permintaan booking uji dari akun internal. Pastikan WA masuk, tombol Terima/Tolak berfungsi, lalu batalkan uji | Vendor berhasil menerima 1 booking uji |

**Setelah langkah 7:**
- Sampaikan: verifikasi admin ≤2 hari kerja; media tayang hanya setelah disetujui.
- Sepakati tanggal kunjungan ulang (maks. 7 hari) untuk memastikan sudah tayang.
- Beri tahu nomor CS: 08.00–21.00 WIB, 7 hari/minggu.

**Kegagalan yang paling sering terjadi dan cara menanganinya:**

| Gejala | Penyebab | Tindakan agen |
|---|---|---|
| Vendor tidak menerima OTP | Nomor salah / sinyal | Cek nomor, kirim ulang, jangan minta kode OTP vendor |
| Verifikasi tertahan >2 hari | Media belum disetujui / KTP buram | Foto ulang, cek antrean moderasi, eskalasi ke Ops Lead bila lewat 2 hari kerja |
| Rekening ditolak | Nama tidak sama dengan KTP | Minta rekening atas nama pemilik; jangan akali dengan ejaan lain |
| Vendor sudah tayang tapi tidak muncul di pencarian | Kalender "belum diisi" atau wilayah nonaktif | Isi kalender, cek wilayah, laporkan ke Ops bila tetap tidak muncul |

---

## 7. Prosedur Input Kalender Massal

Tujuan: mengisi 30–90 hari ke depan dalam satu sesi **tanpa** meminta data pelanggan vendor.

### 7.1 Cara menanyakan

> "Pak, saya bacakan tanggal 1 sampai 30. Bapak cukup bilang 'ada' atau 'kosong'. Saya nggak perlu tahu acaranya siapa, di mana, atau harganya. Cukup tanggalnya."

**Dilarang ditanyakan:** nama pelanggan, nomor HP pelanggan, alamat acara, harga yang disepakati, jenis acara yang bisa mengidentifikasi orang.

**Bila vendor menyebut nama pelanggan:**
> "Nggak perlu namanya, Pak. Cukup tanggalnya — saya catat 'terisi'."

### 7.2 Format pencatatan (di aplikasi dan di lembar kerja)

| Tanggal | Status | Sesi | Catatan non-pribadi |
|---|---|---|---|
| 2026-11-01 | T (terpesan) | Malam | — |
| 2026-11-02 | K (tersedia) | — | — |
| 2026-11-03 | B (diblokir) | — | keluarga, tidak bisa terima order |
| 2026-11-04 | ? (belum diisi) | — | tanyakan ulang |

**Definisi status (D-10, FR-108):**
- **T — terpesan:** sudah ada komitmen, tidak bisa dipakai.
- **K — tersedia:** benar-benar bisa menerima order.
- **B — diblokir:** tidak bisa dipakai, tetapi belum ada acara (mis. alat diservis).
- **? — belum diisi:** tidak ada informasi. **Tidak boleh dianggap tersedia dan tidak boleh dibiarkan** pada vendor yang sudah aktif.

### 7.3 Aturan input

1. Maksimal 90 hari ke depan per sesi. Selebihnya dijadwalkan di kunjungan berikutnya.
2. Satu tanggal = satu baris. Jangan menulis rentang "1–7 November" tanpa memecah per tanggal.
3. Multi-sesi (pagi/siang/malam) hanya dicatat bila vendor memang menerima lebih dari satu acara sehari.
4. Input dilakukan **di depan vendor**, bukan dicatat di kertas lalu dimasukkan malam.
5. Perubahan langsung terlihat di pencarian ≤60 detik (FR-020). Bila tidak, laporkan.

### 7.4 Verifikasi ulang

| Kapan | Apa yang dilakukan | Lulus bila |
|---|---|---|
| Segera setelah input | Bacakan ulang 5 tanggal acak: "tanggal 12 terisi, betul?" | Vendor mengonfirmasi semua |
| Sebelum meninggalkan lokasi | Tunjukkan layar kalender ke vendor | Vendor melihat status benar |
| 7 hari kemudian | Kunjungan/telepon: cek apakah ada perubahan tanggal yang belum tercatat | 0 selisih |
| Audit sampling | Ops membandingkan 10% entri dengan konfirmasi vendor | ≥95% cocok |

**Bila ada selisih:** koreksi hari itu juga, catat penyebabnya (vendor lupa, agen salah dengar, aplikasi gagal simpan), laporkan di laporan mingguan.

---

## 8. Aturan Insentif dan Pencatatan

### 8.1 Ketentuan yang berlaku (tidak boleh ditafsirkan lain)

| Butir | Ketentuan | Rujukan |
|---|---|---|
| Siapa yang dapat | 40 vendor perintis yang tayang, ditetapkan Admin | §15.1 |
| Bentuk | Komisi **0%** selama 2 bulan | §15.1 |
| Anggaran | Rp 40.000.000 total, berhenti otomatis saat kuota habis | §15.1 |
| Bentuk pemberian | **Kredit**, bukan uang tunai | §15.1 |
| Perkiraan biaya | 40 vendor × 2 booking × Rp 400.000 = Rp 32.000.000 [ASUMSI PRD] | §15.1 |
| Perpanjangan | Tidak ada. Agen tidak menjanjikan perpanjangan | — |

### 8.2 Kapan dihitung

- Tanggal mulai dan berakhirnya insentif ditetapkan Admin saat vendor disetujui.
- Agen **tidak menghitung sendiri**. Sebelum menyebut "2 bulan", agen wajib menanyakan tanggal berlaku ke Ops Lead dan menyebutkannya dengan tanggal, bukan dengan "sekitar 2 bulan".
- Insentif hanya berlaku untuk booking baru pada periode tersebut; booking setelah periode berjalan memakai tarif normal (D-12, tidak retroaktif).

### 8.3 Bukti yang diperlukan

| Bukti | Bentuk | Disimpan di |
|---|---|---|
| Vendor berstatus perintis | Tanggal approve + ID vendor dari admin | Sistem, bukan ponsel agen |
| Periode insentif | Catatan Ops Lead (tanggal mulai–selesai) | Catatan Ops |
| Onboarding selesai | Status "menunggu verifikasi" dengan 7 langkah lengkap | Sistem |
| Kunjungan | Check-in lokasi + catatan kunjungan | Sistem |
| Kalender terisi | `calendar_updated_at` + tangkapan layar kalender | Sistem |

### 8.4 Larangan

1. **Dilarang memberikan uang tunai** dalam bentuk apa pun: transport, rokok, "uang lelah", kompensasi, atau titipan.
2. **Dilarang menjanjikan insentif di luar 40 vendor / di luar 2 bulan / di luar kuota Rp 40 juta.**
3. **Dilarang menandai vendor sebagai perintis sendiri** atau menjanjikan slot perintis yang belum dikonfirmasi Admin.
4. **Dilarang menagih atau menerima pembayaran dari vendor** untuk jasa onboarding, foto, atau paket.
5. Dilarang meminta vendor mentransfer uang ke rekening pribadi agen dengan alasan apa pun.

### 8.5 Cara mencatat vendor perintis

1. Saat onboarding, tanyakan ke Ops Lead apakah vendor masih masuk kuota 40.
2. Catat di sistem: `status_perintis = menunggu konfirmasi` (jangan `ya` sebelum dikonfirmasi).
3. Setelah Admin approve, salin tanggal mulai–selesai insentif ke kartu vendor.
4. Di laporan mingguan, tulis jumlah kumulatif: "perintis terpakai X dari 40".
5. Bila kuota habis, hentikan penyebutan insentif pada kunjungan berikutnya — jangan menjanjikan "nanti diusahakan".

---

## 9. Eskalasi

### 9.1 Siapa dihubungi untuk apa

| Pemicu | Ke | Kanal | Waktu | Yang disiapkan |
|---|---|---|---|---|
| Vendor menanyakan status verifikasi >2 hari kerja | Ops Lead | WA | Segera | ID vendor, tanggal submit |
| Booking tidak masuk ke WA vendor | Ops Lead | WA | ≤15 menit | ID booking, tangkapan layar |
| Vendor komplain payout belum masuk | **Finance** | Tiket | ≤2 jam | ID vendor, tanggal completed, nominal |
| Payout gagal 2× pada vendor yang sama | **Finance**, hentikan payout | Tiket + telepon | Segera | Mutasi/error gateway |
| Vendor menolak syarat/ToS dan minta perubahan | **Legal** lewat Ops Lead | Tiket | ≤1 hari kerja | Kutipan keberatan vendor |
| Vendor minta komisi di luar D-17 | Ops Lead → PO + Finance | Tiket | ≤2 hari kerja | Nilai transaksi, kategori |
| Dugaan penipuan (lihat 9.2) | Ops Lead + Finance + Legal | Telepon | ≤2 jam | Semua bukti |
| Insiden data pribadi (KTP/HP bocor) | Ops Lead → Tech Lead + Legal | Telepon | **≤1 jam** | Apa yang bocor, ke siapa, kapan |
| Vendor no-show hari-H | CS + Ops Lead | Telepon | ≤1 jam | ID booking, kontak vendor |
| Sengketa >Rp 2.000.000 | Finance + Ops Lead | Telepon | ≤2 jam | Bukti booking |

Rujukan: `PRD-v1.1.md` §10.2 dan §10.6.

### 9.2 Tanda berhenti — hentikan proses dan eskalasi

Berhenti melayani, jangan tandatangani apa pun, jangan menerima uang, dan hubungi Ops Lead hari itu juga bila menemukan:

1. KTP terlihat jelas palsu, diedit, atau nama tidak cocok dengan orang yang ditemui.
2. Rekening atas nama pihak ketiga yang tidak ada hubungannya dengan vendor, dan vendor memaksa memakainya.
3. Vendor meminta pembayaran dilakukan **di luar aplikasi** atau minta DP ditransfer ke rekening pribadi.
4. Vendor meminta data pelanggan lain, daftar vendor lain, atau menawarkan membeli daftar itu.
5. Vendor menawarkan uang kepada agen agar "dibantu lolos verifikasi" atau "dinaikkan peringkat".
6. Vendor meminta agen memalsukan tanggal, harga, atau portofolio milik orang lain.
7. Ada tekanan agar agen menandatangani surat kuasa, perjanjian eksklusif, atau dokumen yang tidak berasal dari Tarlink.

**Kalimat berhenti:**
> "Pak, ini di luar yang saya bisa bantu. Saya nggak bisa lanjutkan prosesnya hari ini. Saya laporkan ke atasan saya dan beliau yang akan menghubungi Bapak."

---

## 10. Pelaporan

### 10.1 Laporan harian — 5 baris (pukul 17.00, ke Ops Lead)

Kirim lewat WA dengan format persis ini:

```
LAPORAN HARIAN — [nama agen] — [tanggal]
1. Kunjungan: [selesai]/[target] | lokasi: [kecamatan]
2. Onboarding selesai: [n] | pendaftaran dimulai: [n] | tayang baru: [n]
3. Kalender: [n] vendor diperbarui | vendor dengan 30 hari terisi: [n] dari [total]
4. Kendala: [1 kalimat] | eskalasi: [tidak ada / ke siapa, jam berapa]
5. Rencana besok: [3 nama vendor] + [1 tindak lanjut]
```

Aturan: **angka sebenarnya**, tanpa pembulatan ke atas. Bila target tidak tercapai, tulis alasannya di baris 4, bukan menaikkan angka.

### 10.2 Laporan mingguan — tabel (Sabtu, 16.00, ke Ops Lead; tembusan Finance untuk biaya dan Growth untuk CAC)

| Metrik | Minggu ini | Kumulatif | Target | Status |
|---|---|---|---|---|
| Kunjungan tatap muka | | | 30 / minggu | |
| Pendaftaran dimulai | | | 18 / minggu | |
| Onboarding selesai | | | 12 / minggu | |
| Vendor tayang | | | 40 total | |
| Vendor perintis terpakai | | | 40 kuota | |
| Vendor kalender ≥30 hari terisi | | | ≥75% tayang | |
| Vendor aktif (update ≤7 hari) | | | 100% tayang | |
| Response rate vendor ≤24 jam | | | ≥85% | |
| Median waktu accept | | | ≤6 jam | |
| Eskalasi terbuka >2 jam | | | 0 | |
| Penolakan vendor (jumlah + alasan terbanyak) | | | — | |

### 10.3 Metrik yang dilaporkan dan pemiliknya

| Metrik | Definisi | Pemilik di PRD |
|---|---|---|
| Vendor aktif | Vendor terverifikasi dengan ≥1 tanggal diperbarui dalam 7 hari | Ops (§9.1) |
| Response rate vendor | Respons pertama ≤24 jam ÷ booking masuk | Ops (§9.1) |
| Waktu accept | Median jam dari booking dibuat ke respons pertama | Ops (§9.1) |
| Kesegaran kalender | Median hari sejak `calendar_updated_at` | Ops (§9.1) |
| CAC vendor | (biaya agen + insentif + biaya event) ÷ vendor terverifikasi baru | Growth (§9.1) |
| Vendor terverifikasi | Jumlah vendor tayang per kabupaten/kategori | Admin (§6.2) |

---

## 11. Etika Lapangan

### 11.1 Persetujuan data (UU PDP 27/2022)

1. Vendor harus menyetujui syarat layanan dan kebijakan privasi **sebelum** pendaftaran dilanjutkan. Tanpa centang persetujuan, proses berhenti (FR-103).
2. Jelaskan tujuan pengambilan data dalam satu kalimat: "KTP untuk verifikasi identitas dan pencocokan rekening; foto untuk portofolio yang tampil ke calon pelanggan."
3. Vendor berhak menolak memberikan data tertentu; konsekuensinya adalah proses tidak bisa dilanjutkan, dan itu disampaikan tanpa mengancam.
4. Permintaan hapus akun diproses ≤30 hari (FR-101), permintaan data (DSAR) ≤14 hari (NFR-024). Agen meneruskan permintaan ke Ops, tidak memproses sendiri.
5. Insiden data pribadi dilaporkan ≤1 jam (§10.6).

### 11.2 Larangan menyimpan KTP di ponsel pribadi

| Dilarang | Yang benar |
|---|---|
| Memfoto KTP dengan kamera ponsel agen | Vendor memegang ponselnya, foto lewat kamera aplikasi |
| Mengirim foto KTP lewat WA pribadi, termasuk ke atasan | Unggah lewat aplikasi; bila gagal, eskalasi ke Ops |
| Menyimpan KTP di galeri, Google Drive, atau folder "data vendor" | Tidak ada salinan di perangkat agen |
| Menyimpan nomor rekening di catatan ponsel | Data rekening hanya di sistem |
| Menunjukkan data vendor lain ke vendor | Setiap layar hanya menampilkan vendor yang sedang dilayani |

Bila terlanjur ada salinan: hapus segera, laporkan ke Ops Lead pada hari yang sama.

### 11.3 Larangan menekan vendor

1. Tidak memaksa vendor menandatangani di tempat.
2. Tidak menghubungi vendor lebih dari **2 kali dalam 7 hari** setelah ia menolak.
3. Tidak memakai alasan "nanti ketinggalan" berulang kali dalam satu kunjungan.
4. Tidak menakut-nakuti dengan klaim palsu ("vendor lain sudah ambil semua tanggal").
5. Tidak menelepon pada jam tidak wajar (di luar 08.00–21.00).
6. Tidak meminta imbalan apa pun untuk mempercepat proses.

### 11.4 Menangani penolakan dengan sopan

> "Baik, Pak, saya catat. Terima kasih sudah meluangkan waktu. Kalau nanti berubah pikiran, nomor saya sudah ada. Saya nggak akan sering menelepon — saya mampir lagi sekitar [bulan]."

Catat di sistem: tanggal, alasan utama (pilih satu: tidak butuh / takut data / komisi / gaptek / sudah punya kanal / lain-lain), dan apakah boleh dihubungi lagi. Vendor yang menolak tetap dihitung dalam laporan, bukan dihapus.

---

## 12. Checklist 10 Menit Sebelum Meninggalkan Lokasi Vendor

Jalankan berurutan. Bila ada yang belum, selesaikan atau jadwalkan ulang sebelum pergi.

- [ ] **1. Akun** — vendor bisa login sendiri dengan nomor WA-nya.
- [ ] **2. Consent** — syarat layanan dan kebijakan privasi sudah disetujui.
- [ ] **3. KTP** — terunggah lewat aplikasi, nama cocok, tidak ada salinan di ponsel agen.
- [ ] **4. Rekening** — nama pemilik rekening sama dengan KTP; vendor paham cooling 7 hari bila ganti rekening.
- [ ] **5. Media** — minimal 5 foto + 1 video ≤60 detik, pernyataan kepemilikan media dicentang.
- [ ] **6. Paket** — minimal 3 paket dengan harga "mulai dari" dan durasi yang jelas.
- [ ] **7. Kalender** — 30 hari ke depan punya status; tanggal yang terisi ditandai **terpesan**, bukan dibiarkan kosong.
- [ ] **8. Uji booking** — 1 permintaan uji masuk ke WA vendor, tombol Terima berfungsi, lalu dibatalkan.
- [ ] **9. Nomor penting** — vendor menyimpan nomor CS (08.00–21.00) dan tahu kapan menghubungi agen.
- [ ] **10. Janji berikutnya** — tanggal kunjungan ulang ≤7 hari disepakati dan dicatat; vendor tahu apa yang akan terjadi setelah ini (verifikasi ≤2 hari kerja, lalu tayang).

**Kalimat penutup:**
> "Selesai, Pak. Rata-rata dua hari kerja Bapak sudah tayang. Saya mampir [hari, tanggal] untuk pastikan sudah muncul dan kalendernya masih benar. Kalau ada booking masuk sebelum itu, balas WA-nya saja, nanti saya bantu."

---

*SOP ini turunan operasional dari `PRD-v1.1.md`. Perubahan kebijakan komisi, insentif, atau SLA hanya boleh berasal dari PRD atau keputusan tertulis PO/Finance, bukan dari praktik lapangan.*
