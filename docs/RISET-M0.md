# RISET-M0 — Paket Riset Lapangan M0

| Atribut | Isi |
|---|---|
| Versi | 1.0 |
| Tanggal | 21 Okt 2026 |
| Periode | M0, minggu 1–4 (21 Okt–17 Nov 2026) — §11.3 |
| Pemilik pelaksanaan | 2 agen lapangan + 1 analis |
| Pemutus keputusan | PO (dibantu analis) |
| Status | Siap pakai lapangan |
| Dasar | PRD v1.1 §3.1, §3.3, §3.4, §5.1–5.2, §5.10, §5.12, §6.2, §11.3, §15.1 |
| Sifat | Instrumen operasional. Tidak mengubah PRD, tidak menggantikan keputusan PO. |
| Format cetak | A4, margin 15 mm, tabel 8–9 pt. Setiap bagian dimulai pada halaman baru bila dicetak untuk lapangan |
| Keluaran | 30 wawancara vendor + 100 wawancara pelanggan; laporan 2 halaman (bagian 9 dokumen ini) |

**Aturan angka.** Semua angka di dokumen ini adalah kuota, durasi, atau ambang yang dikutip dari PRD. Tidak ada angka hasil di dokumen ini. Angka hasil hanya boleh masuk laporan setelah wawancara selesai dan dapat dilacak ke baris data mentah.

**Konvensi rujukan.** `§x.y` selalu menunjuk ke `PRD-v1.1.md`. Rujukan ke dokumen ini ditulis "bagian x.y dokumen ini".

---

## 1. Ringkasan: Enam Pertanyaan Riset

| # | Pertanyaan riset | Keputusan yang bergantung | Instrumen | Tenggat |
|---|---|---|---|---|
| Q1 | Berapa AOV sebenarnya per kategori (Tarling, Organ Tunggal, Seni Tradisi, Pendukung Acara)? | Apakah baseline AOV Rp 4 jt (§5.2) sah, harus dipecah per kategori, atau diganti; dasar sensitivitas §5.8 dan H-06 | V11, C10; pembanding rentang §5.12 | Minggu 4 |
| Q2 | Apakah vendor menerima komisi bertingkat D-17 pada transaksi Rp 4 jt, Rp 15 jt, Rp 40 jt? | Struktur tarif final sebelum M1; risiko bypass R-03 (§12); H-03 | V15–V17 (kesediaan + niat bypass di 3 titik) | Minggu 4 |
| Q3 | Berapa frekuensi hajatan berbayar per bulan di 2 kabupaten, dan berapa job per vendor saat ramai vs sepi? | Kelayakan target 100 booking/bln (§3.3, §5.4); ukuran supply Gate 1 (§6.2); H-07 | V06–V08, C03–C05, data desa (minggu 1) | Minggu 4 |
| Q4 | Berapa lama sebelum acara pelanggan benar-benar memesan? | Asumsi 30–90 hari (§3.3); desain kalender 3 bulan (§15.1); FR-109; FR-052 | C08, V12 | Minggu 4 |
| Q5 | Apakah pelanggan bersedia DP 30% lewat QRIS/VA dan biaya layanan 1%? | H-02; ambang konversi Gate 1 (§6.2); kelayakan alur DP sebelum kontrak PJP (K-01) | C13–C15 | Minggu 4 |
| Q6 | Kanal mana yang benar-benar dipakai vendor untuk merespons, dan siapkah vendor unggah KTP + rekening? | D-15 (respons via WA); R-01 (§12); FR-111/112; kelayakan 40 vendor terverifikasi (§6.2); H-01 | V18–V20 | Minggu 4 untuk preferensi; A/B WA vs push baru bulan ke-3 (§3.3) |

**Batas yang harus disepakati sejak awal.** Riset ini mengukur **pernyataan dan ingatan**, bukan perilaku transaksi. Metrik perilaku di §3.4 dan §6.2 (response rate, median accept, konversi accepted→DP, bypass aktual, repeat) hanya bisa diukur pada M1. Karena itu tiap aturan di bagian 6.3 dan 6.4 dokumen ini diberi label: **terukur di M0**, **proxy indikatif**, atau **tertunda**.

**Pemetaan ke §3.3.** Q3 → baris permintaan hajatan. Q2 → baris komisi D-17. Q5 → baris DP 30%. Q4 → baris 30–90 hari. Q6 → baris WhatsApp vs aplikasi. Dua baris §3.3 **tidak** dijawab instrumen ini: onboarding 1–2 kunjungan (diukur di M1) dan pemetaan pemain dominan (workstream terpisah per §15.2); lihat bagian 6.5 dan Tabel E pada halaman 2 laporan.

---

## 2. Rencana Sampling

### 2.1 Kerangka dan Batas Metode

| Butir | Ketetapan |
|---|---|
| Desain | Kuota non-probabilistik, purposif per kabupaten × kategori |
| Populasi vendor | Grup/penyedia hiburan berbayar yang beroperasi di Indramayu atau Cirebon, 4 kategori |
| Populasi pelanggan | Rumah tangga atau panitia yang menyewa ≥1 vendor hiburan berbayar dalam 12 bulan terakhir |
| Ukuran sampel | 30 vendor (§5.12 mewajibkan minimal 30) dan 100 pelanggan (§3.1 M-01) |
| Klaim statistik | Tidak ada margin of error. Hasil dilaporkan sebagai estimasi terarah per sel, bukan angka representatif kabupaten |
| Unit analisis | 1 responden = 1 vendor (bukan 1 personel) atau 1 acara (bukan 1 keluarga) |
| Sel minimum pelaporan | 3 responden per sel kabupaten × kategori (mengikuti komposisi minimum §6.2); sel <3 digabung atau ditandai "tidak dilaporkan" |
| Titik pengambilan | Kecamatan dipilih agen berdasarkan daftar calon §15.1; maksimum 2 kecamatan per hari per agen |

### 2.2 Kriteria Inklusi dan Eksklusi

**Vendor**

| Jenis | Kriteria |
|---|---|
| Inklusi | (a) menerima ≥1 job berbayar dalam 12 bulan terakhir; (b) beroperasi di Indramayu atau Cirebon; (c) kategori utama salah satu dari 4 kategori PRD; (d) responden adalah pimpinan/pengurus yang berwenang menyebut harga dan menerima order; (e) bersedia diwawancarai 15 menit |
| Eksklusi | (a) sudah diwawancarai pada gelombang ini (duplikat); (b) tidak dapat menunjukkan bukti job (foto, spanduk, chat order); (c) bukan penentu harga (kru, penyanyi lepas); (d) vendor fiktif/rekening bukan milik sendiri; (e) menolak dicatat meski anonim |

**Pelanggan**

| Jenis | Kriteria |
|---|---|
| Inklusi | (a) pernah membiayai/menyelenggarakan acara yang menyewa ≥1 vendor hiburan berbayar dalam 12 bulan terakhir; (b) usia ≥17 tahun; (c) berdomisili atau acaranya di kabupaten pilot; (d) dapat menyebut biaya (boleh dibantu struk/chat); (e) 1 responden mewakili 1 acara |
| Eksklusi | (a) bekerja untuk platform/agen; (b) vendor atau kru vendor yang sedang diwawancarai; (c) acara tanpa vendor berbayar (hiburan swadaya); (d) acara yang sama sudah diwakili responden lain; (e) menolak consent |

### 2.3 Kuota Vendor (30)

Dua kabupaten × 15 vendor. Angka 15 per kabupaten mengikuti syarat minimum Gate 1 (§6.2). Kolom kategori menjamin ≥3 vendor per kategori per kabupaten.

| Kabupaten | Tarling | Organ Tunggal | Seni Tradisi | Pendukung Acara | Total |
|---|---|---|---|---|---|
| Indramayu | 4 | 5 | 3 | 3 | **15** |
| Cirebon | 4 | 5 | 3 | 3 | **15** |
| **Total** | **8** | **10** | **6** | **6** | **30** |

**Alasan kuota**

| Kategori | Jumlah | Alasan |
|---|---|---|
| Organ Tunggal | 10 | Kategori dengan porsi terbesar pada baseline AOV Rp 4 jt (§5.2, §5.12). Butuh n cukup untuk memisahkan kelas kecil (Rp 3–4,5 jt) dari kelas mapan (Rp 11–15 jt) |
| Pendukung Acara | 6 | Batas minimum §6.2 (3/kabupaten) sekaligus menguji transaksi kecil yang paling rentan komisi (§5.12) |
| Seni Tradisi | 6 | Batas minimum §6.2; rentang harga publik paling sempit (± Rp 5 jt) sehingga cukup 3 per kabupaten |
| Tarling | 8 | Sebaran harga terlebar (Rp 40 jt sampai ratusan juta, §5.12) dan titik uji D-17 tertinggi. 4 per kabupaten memberi cadangan bila 1 gagal wawancara |

**Sub-kuota kanal rekrutmen vendor.** Maksimum 6 dari 30 (20%) — dari sumber mana pun — boleh berasal dari relasi pribadi agen, untuk membatasi bias "vendor yang sudah dikenal agen" (bagian 7 dokumen ini). Field `kanal_rekrut` menandai setiap kasus, dan analisis F1/F5 dipisah antara relasi dan non-relasi.

### 2.4 Kuota Pelanggan (100)

Dua kabupaten × 50 pelanggan. Sebaran kategori mengikuti bauran target supply §5.12: organ menengah dan pendukung acara mendominasi, tarling cukup untuk menguji nominal besar.

| Kabupaten | Tarling | Organ Tunggal | Seni Tradisi | Pendukung Acara | Total |
|---|---|---|---|---|---|
| Indramayu | 6 | 21 | 9 | 14 | **50** |
| Cirebon | 6 | 21 | 9 | 14 | **50** |
| **Total** | **12** | **42** | **18** | **28** | **100** |

**Alasan kuota**

| Kategori | Jumlah | Alasan |
|---|---|---|
| Organ Tunggal | 42 | Kategori yang AOV-nya menjadi dasar baseline §5.2; perlu n terbesar agar median per pita harga stabil |
| Pendukung Acara | 28 | Menguji biaya layanan 1% pada transaksi kecil dan kesediaan DP pada nominal rendah (§5.12) |
| Seni Tradisi | 18 | Cukup untuk membandingkan rentang §5.12 (± Rp 5 jt) tanpa menggeser bobot kategori utama |
| Tarling | 12 | Nilai transaksi 10–12× baseline (§5.12); 12 responden cukup untuk melihat arah kesediaan DP 30% pada nominal besar (30% × Rp 40 jt = Rp 12 jt) |

**Sub-kuota segmen.** Dari 100 responden: **≥80 penyelenggara keluarga (P1)** dan **≥20 panitia desa/institusi (P2)**, masing-masing ≥10 per kabupaten. P2 sengaja di-oversample untuk kebutuhan desain multi-vendor, sehingga **H-07 hanya dihitung dari subsampel P1** (lihat §6.2 F6). Satu acara hanya diwakili satu responden.

### 2.5 Cara Rekrutmen

| Target | Kanal | Kontribusi kuota | Cara | Risiko yang dikendalikan |
|---|---|---|---|---|
| Vendor | Paguyuban seniman (pengurus memberi daftar anggota) | 12 | Surat pengantar + kunjungan | Bias relasi agen |
| Vendor | Daftar 120 calon §15.1 (agen) | 12 | Kunjungan terjadwal | Sampel hanya yang mudah dijangkau |
| Vendor | Spanduk hajatan dan rujukan responden (snowball) | 6 | Telepon nomor di spanduk, minta 1 rujukan | Rujukan mengarah ke grup sejenis; cap 20% |
| Pelanggan | Intersepsi di hajatan (izin tuan rumah) | 40 | Datang saat acara berlangsung, wawancara 12 menit | Hanya acara besar yang teramati; imbangi dengan grup WA |
| Pelanggan | Grup WA warga/desa | 30 | Pesan singkat + jadwal telepon/WA | Self-selection; catat alasan menolak |
| Pelanggan | Perangkat desa dan karang taruna | 20 | Rujukan rumah tangga yang menggelar hajatan | Kedekatan dengan aparat; batasi 1 rujukan per desa |
| Pelanggan | Rujukan vendor (klien terakhir) | 10 | Minta 1 kontak klien | Klien pilihan vendor; cap 10% |

Kontak awal yang harus disiapkan: **90 calon vendor dan 300 calon pelanggan** (3× kuota) untuk menutup penolakan dan salah sasaran. Angka ini adalah buffer perencanaan, bukan hasil.

---

## 3. Instrumen Vendor (≤15 Menit, 20 Pertanyaan)

### 3.1 Blok dan Alokasi Waktu

| Blok | Isi | Nomor | Durasi |
|---|---|---|---|
| A | Profil dan kategori | V01–V05 | 3 menit |
| B | Volume kerja dan pencatatan jadwal | V06–V10 | 4 menit |
| C | Harga paket | V11–V12 | 2 menit |
| D | Pengalaman DP dan pembatalan | V13–V14 | 2 menit |
| E | Uji kesediaan komisi D-17 (3 titik harga) | V15–V17 | 3 menit |
| F | Adopsi aplikasi, kanal respons, dokumen | V18–V20 | 1 menit |

Aturan: pertanyaan dibacakan **apa adanya**. Sub-butir (a/b/c) adalah bagian dari satu nomor, bukan pertanyaan tambahan. Bila waktu melewati 15 menit, potong Blok F, jangan potong Blok C–E.

### 3.2 Kuesioner

| No | Pertanyaan (dibaca apa adanya) | Tipe jawaban | Pilihan / format |
|---|---|---|---|
| V01 | "Boleh saya tahu nama grup/usaha dan nama Bapak/Ibu?" | Terbuka | Teks. Dicatat untuk verifikasi, tidak dianalisis |
| V02 | "Grup ini berbasis di kabupaten dan kecamatan mana?" | Pilihan + terbuka | Indramayu / Cirebon; kecamatan: teks |
| V03 | "Kategori utama jasa yang Bapak/Ibu jual apa? Boleh lebih dari satu, sebutkan yang paling sering." | Pilihan ganda | Tarling / Organ Tunggal / Seni Tradisi / Pendukung Acara (sound, MC, dekor, tenda — sebutkan yang utama). Tandai 1 utama + sisanya pendukung |
| V04 | "Sejak tahun berapa grup ini menerima job berbayar, dan berapa orang yang terlibat dalam satu job?" | Angka | Tahun (4 digit); jumlah orang (1–100) |
| V05 | "Usaha ini berbadan usaha apa?" | Pilihan ganda | Perorangan / CV / PT / Kelompok paguyuban / Lainnya |
| V06 | "Dalam 12 bulan terakhir, pada bulan paling ramai, berapa job berbayar yang Bapak/Ibu tangani dalam satu bulan?" | Angka | Job/bulan, 0–60 |
| V07 | "Pada bulan paling sepi, berapa job berbayar dalam satu bulan?" | Angka | Job/bulan, 0–60 |
| V08 | "Pada bulan paling ramai itu, kira-kira berapa tanggal yang sudah terisi penuh dan tidak bisa menerima job lagi?" | Angka | Hari/bulan, 0–31 |
| V09 | "Sekarang jadwal job dicatat di mana, dan siapa yang mencatat?" | Pilihan ganda | Buku tulis / Catatan WA / Kalender HP / Aplikasi / Ingatan saja / Lainnya. Pencatat: pimpinan / keluarga / admin / kru |
| V10 | "Dalam 12 bulan terakhir, berapa kali dua job jatuh di tanggal yang sama? Apa yang terjadi saat itu?" | Angka + pilihan ganda | Frekuensi 0–50. Akibat: tidak pernah terjadi / salah satu dibatalkan / salah satu diserahkan ke grup lain / dikerjakan separuh / lainnya |
| V11 | "Untuk kategori utama tadi, sebutkan tiga angka: harga paket paling murah, harga yang paling sering dipakai, dan harga paling mahal. Sebutkan juga apa saja yang termasuk di harga yang paling sering dipakai." | Angka ×3 + terbuka | Rp, tanpa pembulatan. Isi paket: teks singkat |
| V12 | "Apakah harga berbeda pada bulan ramai? Berapa persen lebih tinggi?" | Pilihan + angka | Ya, naik ___% / Ya, tetapi tidak tetap / Tidak berbeda |
| V13 | "Dalam 12 bulan terakhir, berapa job yang DP-nya dibayar di muka, dan berapa yang batal setelah DP masuk? DP biasanya dibayar lewat apa?" | Angka ×2 + pilihan ganda | Job ber-DP (0–60); batal setelah DP (0–60). Kanal: tunai / transfer bank / QRIS / e-wallet / campuran |
| V14 | "Berapa persen DP yang biasa Bapak/Ibu minta?" | Pilihan ganda | Tidak minta DP / <20% / 20–29% / 30% / 31–50% / >50% |
| V15 | Uji D-17 titik 1 — lihat §3.3 | Skala + angka + pilihan ganda | 4 butir (a–d) |
| V16 | Uji D-17 titik 2 — lihat §3.3 | Skala + angka + pilihan ganda | 4 butir (a–d) |
| V17 | Uji D-17 titik 3 — lihat §3.3 | Skala + angka + pilihan ganda | 4 butir (a–d) |
| V18 | "Kalau ada aplikasi untuk menerima order dan mengatur kalender, seberapa siap Bapak/Ibu memakainya? Apa hambatan utamanya?" | Skala 1–5 + pilihan ganda | 1 = tidak siap sama sekali, 5 = sangat siap. Hambatan: tidak terbiasa / sinyal lemah / HP tidak mendukung / tidak mau menambah pekerjaan / lainnya |
| V19 | "Kalau ada order masuk, lewat mana Bapak/Ibu paling ingin dihubungi? Dalam berapa jam biasanya Bapak/Ibu membalas pesan WhatsApp pada hari kerja?" | Pilihan ganda ×2 | Kanal: WA / aplikasi / telepon / SMS. Waktu balas: <1 jam / 1–4 jam / 4–24 jam / >24 jam |
| V20 | "Untuk verifikasi, apakah Bapak/Ibu bersedia mengunggah foto KTP dan buku rekening? Dengan syarat apa?" | Pilihan ganda | Ya, keduanya / KTP saja / Rekening saja / Tidak keduanya. Syarat: tanpa syarat / hanya lewat agen / hanya setelah lihat kontrak / lainnya |

Catatan interviewer: pada V13–V17, jangan menyebut nama platform, kata "komisi", atau bahwa angka adalah tarif final. Gunakan istilah "layanan perantara" dan "potongan".

### 3.3 Uji D-17: Tiga Titik Harga

Angka potongan dihitung dari struktur D-17 (§5.10): 10% untuk bagian nilai sampai Rp 10.000.000, 5% untuk bagian di atas Rp 10.000.000, lantai Rp 25.000, batas absolut Rp 7.500.000. Pada ketiga titik di bawah, lantai dan batas absolut tidak aktif.

| Titik | Nilai transaksi | Potongan D-17 | Setara efektif | Nomor |
|---|---|---|---|---|
| T1 | Rp 4.000.000 | Rp 400.000 | 10,00% | V15 |
| T2 | Rp 15.000.000 | Rp 1.250.000 | 8,33% | V16 |
| T3 | Rp 40.000.000 | Rp 2.500.000 | 6,25% | V17 |

Titik T3 (6,25%) sama dengan angka efektif yang dipakai §3.3 dan R-03 di PRD, sehingga hasil T3 dapat dibandingkan langsung dengan ambang H-03.

**Kalimat pembuka tiap titik** (ganti angka pada tanda kurung, jangan menambah penjelasan):

> "Sekarang saya minta pendapat untuk satu kemungkinan. Ada layanan yang mengumpulkan pembayaran dari pelanggan, menahan uangnya, lalu meneruskannya ke Bapak/Ibu setelah acara selesai. Untuk acara senilai (Rp 4.000.000 / Rp 15.000.000 / Rp 40.000.000), layanan itu memotong (Rp 400.000 / Rp 1.250.000 / Rp 2.500.000)."

| Butir | Pertanyaan | Tipe | Pilihan / format |
|---|---|---|---|
| a | "Apakah Bapak/Ibu menerima potongan sebesar itu?" | Skala 4 | Ya, pasti / Ya, dengan catatan / Tidak / Tidak tahu |
| b | "Berapa potongan maksimum yang masih dapat Bapak/Ibu terima untuk nilai acara sebesar itu?" | Angka | Rp atau % (tulis satuannya) |
| c | "Untuk transaksi ini, Bapak/Ibu akan menyelesaikan pembayaran lewat layanan tersebut, atau mengurus pembayaran langsung dengan pelanggan di luar layanan?" | Pilihan ganda | Pasti di luar layanan / Mungkin di luar layanan / Tetap di dalam layanan / Tidak tahu |
| d | "Apa alasan utama jawaban tadi?" | Pilihan ganda | Potongan terlalu besar / tidak percaya dana ditahan / pelanggan bisa kabur / terbiasa tunai / lainnya (tulis) |

Butir (c) adalah **ukuran niat bypass** dan yang dipakai untuk aturan A-02 (bagian 6.3 dokumen ini), bukan butir (a). Butir (a) dan (b) dipakai menjelaskan mengapa.

---

## 4. Instrumen Pelanggan (≤12 Menit, 15 Pertanyaan)

| Blok | Isi | Nomor | Durasi |
|---|---|---|---|
| A | Profil dan acara terakhir | C01–C05 | 2 menit |
| B | Cara mencari dan memutuskan | C06–C09 | 3 menit |
| C | Biaya dan pengalaman | C10–C12 | 3 menit |
| D | Kesediaan model platform | C13–C15 | 4 menit |

Aturan: responden menjawab untuk **satu acara terakhir**, bukan gabungan beberapa acara. Bila responden menyebut lebih dari satu acara, tetapkan acara terakhir dan ulangi pertanyaan dengan kalimat "untuk acara itu".

| No | Pertanyaan (dibaca apa adanya) | Tipe jawaban | Pilihan / format |
|---|---|---|---|
| C01 | "Bapak/Ibu tinggal di kabupaten dan kecamatan mana?" | Pilihan + terbuka | Indramayu / Cirebon; kecamatan: teks |
| C02 | "Pada acara itu, Bapak/Ibu bertindak sebagai tuan rumah, panitia, atau keduanya?" | Pilihan ganda | Tuan rumah / Panitia / Keduanya |
| C03 | "Acara apa yang terakhir kali menyewa hiburan, dan kapan itu?" | Pilihan ganda + bulan/tahun | Pernikahan / Khitanan / Syukuran / Sedekah bumi atau laut / Hajatan desa / Acara instansi atau sekolah / Lainnya. Waktu: bulan dan tahun |
| C04 | "Hiburan apa saja yang disewa untuk acara itu?" | Pilihan ganda | Tarling / Organ Tunggal / Seni Tradisi / Pendukung Acara (sound, MC, dekor, tenda). Boleh lebih dari satu; tandai yang biayanya terbesar |
| C05 | "Berapa vendor hiburan berbeda yang dipakai untuk acara itu?" | Angka | 1–10 |
| C06 | "Bagaimana Bapak/Ibu menemukan vendor itu?" | Pilihan ganda | Rekomendasi tetangga atau keluarga / Grup WA / Instagram atau Facebook / Spanduk / Paguyuban / EO / Lainnya. Boleh lebih dari satu; tandai yang paling menentukan |
| C07 | "Berapa vendor yang dihubungi sebelum akhirnya memutuskan, dan dari jumlah itu berapa yang sudah terisi di tanggal acara?" | Angka ×2 | 0–20; 0–20 |
| C08 | "Berapa hari sebelum hari-H Bapak/Ibu mulai mencari vendor?" | Pilihan ganda | <7 hari / 7–29 hari / 30–59 hari / 60–90 hari / >90 hari |
| C09 | "Apa satu hal yang paling menentukan pilihan vendor?" | Pilihan ganda (1 jawaban) | Ketersediaan tanggal / harga / rekomendasi orang / portofolio dan video / jarak lokasi |
| C10 | "Berapa total biaya hiburan yang Bapak/Ibu bayar untuk acara itu, termasuk sound dan tambahan lain?" | Angka | Rp, tanpa pembulatan. Jika tidak ingat tepat: minta rentang terdekat dan tulis "≈" |
| C11 | "Apakah harga yang akhirnya dibayar sama dengan harga yang dikutip di awal?" | Pilihan ganda | Sama / Naik sedikit / Naik banyak / Tidak ada kutipan awal |
| C12 | "Apakah ada masalah dengan vendor pada acara itu? Kalau ada, uangnya kembali atau tidak?" | Pilihan ganda ×2 | Tidak ada masalah / Vendor batal / Datang terlambat / Tidak sesuai janji / Harga naik mendadak / Sengketa DP. Uang: kembali penuh / kembali sebagian / tidak kembali / tidak relevan |
| C13 | "Apakah Bapak/Ibu membayar DP? Berapa persen, dan lewat apa?" | Pilihan ganda ×2 | Tidak ada DP / <20% / 20–29% / 30% / 31–50% / >50%. Kanal: tunai / transfer bank / QRIS / e-wallet / campuran |
| C14 | "Kalau untuk mengunci tanggal Bapak/Ibu diminta membayar DP 30% lewat QRIS atau virtual account, dan uang itu ditahan pihak ketiga sampai acara selesai — apakah bersedia? Berapa DP maksimum yang bersedia?" | Skala 4 + angka | Ya, pasti / Ya, dengan catatan / Tidak / Tidak tahu. DP maksimum: ___% atau Rp |
| C15 | "Kalau di atas harga vendor ada biaya layanan 1%, misalnya Rp 40.000 untuk transaksi Rp 4 juta, apakah bersedia? Lebih suka biaya itu dibayar bagaimana, dan lewat kanal apa?" | Skala 4 + pilihan ganda ×2 | Skala: Ya, pasti / Ya, dengan catatan / Tidak / Tidak tahu. Cara bayar: ditambahkan ke tagihan / dipotong dari DP / dibayar terpisah ke agen. Kanal: QRIS / virtual account bank / e-wallet / tunai ke agen |

Catatan: contoh Rp 40.000 pada C15 adalah aritmetika 1% × Rp 4.000.000 (§5.1), bukan harga yang ditetapkan. Jangan menyebut angka lain dan jangan menyebut komisi vendor kepada pelanggan.

---

## 5. Panduan Wawancara

### 5.1 Cara Membuka (30 detik, dibaca apa adanya)

> "Selamat pagi/siang, saya (nama) dari (lembaga). Kami sedang memetakan cara orang mencari dan membayar hiburan untuk hajatan di Indramayu dan Cirebon. Saya bukan menawarkan jasa dan bukan menjual apa pun. Saya butuh 12–15 menit untuk beberapa pertanyaan. Jawaban Bapak/Ibu dicatat tanpa nama di laporan, dan boleh berhenti kapan saja."

Setelah itu: konfirmasi kriteria inklusi (satu pertanyaan saring), lalu consent (§5.4), baru mulai V01 atau C01.

### 5.2 Aturan Wawancara

| # | Aturan | Alasan |
|---|---|---|
| 1 | Jangan menyebut komisi, tarif, atau harga platform sebelum V15 | Jawaban V06–V14 akan terdistorsi bila responden sudah tahu model komisi |
| 2 | Pada V15–V17, bacakan kalimat pembuka apa adanya, sekali, lalu diam | Pengulangan dengan penekanan berbeda mengarahkan jawaban |
| 3 | Jangan menawarkan insentif, janji order, atau janji onboarding | Janji mengubah kesediaan yang diukur |
| 4 | Jangan memuji, menyanggah, atau menenangkan jawaban harga | "Wah mahal ya" atau "wajar kok" menggeser angka berikutnya |
| 5 | Angka ditulis apa adanya, tanpa pembulatan. Gunakan "≈" bila responden menaksir | Pembulatan menghapus variasi yang justru diukur |
| 6 | Satu responden, satu pewawancara | Dua pewawancara membuat responden menjawab untuk "tamu" |
| 7 | Bila responden bertanya "nanti komisinya berapa?" jawab: "Itu yang sedang kami uji, karena itu saya minta pendapat dengan angka tadi" | Menjaga netralitas tanpa berbohong |
| 8 | Bila jawaban melompat ke acara lain, kembalikan: "Untuk acara yang tadi ya, Pak/Bu" | Menjaga unit analisis 1 acara |
| 9 | Wawancara dihentikan pada 15 menit (vendor) atau 12 menit (pelanggan). Bila waktu habis, lewati V18–V20 atau C06–C09 dan tandai; V11–V17 dan C14 tidak boleh dilewati | Menjaga kuota waktu tanpa mengorbankan data harga dan DP |
| 10 | Rekaman audio hanya dengan izin terpisah; tanpa izin, catat tertulis | UU PDP dan kenyamanan responden |

### 5.3 Pencatatan Verbatim

| Jenis jawaban | Cara mencatat |
|---|---|
| Pilihan ganda dan skala | Tulis kode pilihan persis, jangan menafsirkan |
| Angka | Tulis angka + satuan (Rp, %, job, hari). Jangan mengubah ke format lain |
| Terbuka (V01, V11 isi paket, V19 alasan, C06 "lainnya") | Tulis kalimat responden apa adanya dalam tanda kutip, maksimum 2 baris. Jangan diringkas menjadi kategori |
| Alasan penolakan | Tulis 1 kalimat apa adanya + kode alasan (bagian 5.5 dokumen ini) |
| Nada/keraguan | Tandai "(ragu)" atau "(menghitung)" setelah angka, jangan dihapus |

Verbatim wajib untuk: V11 (isi paket), V10 (apa yang terjadi saat bentrok), V19 (alasan kanal), C12 (masalah dengan vendor), C15 (keberatan biaya layanan). Verbatim dipakai menyusun kutipan laporan, bukan untuk statistik.

### 5.4 Etika, Consent, dan UU PDP

**Yang dibacakan sebelum mulai** (responden harus menjawab "ya" dan dicatat):

> "Data yang saya catat: nama, nomor HP, dan jawaban Bapak/Ibu. Tujuannya hanya untuk riset kelayakan layanan hiburan di Pantura. Data disimpan di berkas terbatas yang hanya bisa dibuka tiga orang di tim riset, maksimal 12 bulan setelah laporan selesai, lalu dihapus. Laporan hanya memuat angka gabungan, bukan nama. Bapak/Ibu boleh menolak menjawab satu pertanyaan, berhenti kapan saja, dan minta data Bapak/Ibu dihapus dengan menghubungi nomor ini. Setuju saya lanjutkan?"

| Butir consent | Ketetapan |
|---|---|
| Dasar pemrosesan | Persetujuan (consent) lisan, dicatat di log consent, bukan tanda tangan basah |
| Data yang dikumpulkan | Nama, nomor HP, kabupaten/kecamatan, jawaban kuesioner. **Tidak ada salinan KTP atau buku rekening** — V20 hanya menanyakan kesediaan |
| Tujuan | Riset kelayakan M0; tidak dipakai untuk pemasaran atau onboarding paksa |
| Penyimpanan | Berkas terkunci, akses 3 orang (2 agen, 1 analis), tanpa grup WA berisi data responden |
| Retensi | Maksimal 12 bulan setelah laporan M0 diserahkan |
| Hak subjek | Menolak pertanyaan, berhenti, minta hapus, minta salinan jawaban |
| Anonimisasi | ID responden (V-01…V-30, C-001…C-100) menggantikan nama di semua tabel analisis |
| Insiden | Kehilangan berkas/perangkat dilaporkan ke PO pada hari yang sama; daftar responden dihubungi bila data pribadi terdampak |

**Log consent** (satu baris per responden): ID responden, tanggal, jam, nama pewawancara, kanal (tatap muka/telepon/WA), consent (ya/tidak), izin rekaman (ya/tidak), catatan.

### 5.5 Penanganan Penolakan

| Situasi | Tindakan | Batas |
|---|---|---|
| Menolak di awal | Ucapkan terima kasih, tawarkan waktu lain, catat alasan | Maksimum 2 kali hubungi ulang, jeda ≥1 hari |
| Menolak di tengah | Tanyakan apakah sisa pertanyaan boleh dilewati; bila tidak, tutup wawancara | Jawaban sebelum penolakan tetap dipakai bila responden setuju |
| Tidak punya waktu | Tawarkan 3 slot: hari itu, besok, atau telepon ≤10 menit | Jangan memaksa di lokasi acara |
| Curiga ditawari produk | Tegaskan tidak ada penawaran; tunjukkan lembar instrumen | Bila tetap menolak, tutup |
| Menolak pertanyaan harga | Catat "menolak", lanjut ke pertanyaan berikut | Jangan menaksir angka sendiri |
| Responden berhenti karena diminta keluarga | Tutup, catat "interupsi", jadwalkan ulang | 1 kali ulang |

Kode alasan penolakan: **T1** tidak punya waktu, **T2** tidak percaya, **T3** tidak berwenang, **T4** tidak relevan (tidak pernah menyewa), **T5** interupsi, **T6** lain (tulis). Penggantian diambil dari sel kuota yang sama; setiap penggantian dicatat di lembar kuota harian.

---

## 6. Lembar Rekap dan Analisis

### 6.1 Tabel Input (Data Dictionary)

Satu berkas spreadsheet, satu baris per responden, tanpa nama. Nama hanya ada di log consent terpisah.

| Field | Tipe | Nilai valid | Wajib | Sumber |
|---|---|---|---|---|
| `respondent_id` | Teks | V-01…V-30, C-001…C-100 | Ya | Lembar kuota |
| `tipe` | Pilihan | V / C | Ya | — |
| `kabupaten` | Pilihan | Indramayu / Cirebon | Ya | V02 / C01 |
| `kecamatan` | Teks | Nama kecamatan | Ya | V02 / C01 |
| `kategori` | Pilihan | Tarling / Organ Tunggal / Seni Tradisi / Pendukung Acara | Ya | V03 / C04 utama |
| `segmen` | Pilihan | P1 / P2 (khusus C) | Ya | C02 |
| `kanal_rekrut` | Pilihan | Paguyuban / Daftar agen / Spanduk / Grup WA / Desa / Rujukan / Relasi agen | Ya | Lembar kuota |
| `tgl_wawancara`, `durasi_menit`, `pewawancara` | Tanggal, angka, teks | — | Ya | — |
| `job_ramai`, `job_sepi`, `hari_terisi` | Angka | 0–60; 0–60; 0–31 | Ya (V) | V06–V08 |
| `bentrok_12bln` | Angka | 0–50 | Ya (V) | V10 |
| `harga_min`, `harga_typical`, `harga_max` | Angka (Rp) | >0 | Ya (V) | V11 |
| `aov_pelanggan` | Angka (Rp) | >0 | Ya (C) | C10 |
| `fee_status_4`, `fee_status_15`, `fee_status_40` | Pilihan | pasti_ya / ya_catatan / tidak / tidak_tahu | Ya (V) | V15a–V17a |
| `fee_max_4`, `fee_max_15`, `fee_max_40` | Angka (Rp atau %) | ≥0, satuan dicatat | Ya (V) | V15b–V17b |
| `komisi_diterima` | Angka (%) | `fee_max_t ÷ harga_t`, hanya bila `fee_status_t = pasti_ya` atau `ya_catatan` | Ya (V) | Turunan V15–V17 |
| `bypass_4`, `bypass_15`, `bypass_40` | Pilihan | pasti_luar / mungkin_luar / tetap_dalam / tidak_tahu | Ya (V) | V15c–V17c |
| `fee_alasan_*` | Pilihan | Sesuai V15d | Ya (V) | V15d–V17d |
| `jam_respons` | Pilihan | <1 / 1–4 / 4–24 / >24 | Ya (V) | V19 |
| `kanal_respons` | Pilihan | WA / aplikasi / telepon / SMS | Ya (V) | V19 |
| `skor_adopsi` | Angka | 1–5 | Ya (V) | V18 |
| `ktp_rekening` | Pilihan | keduanya / ktp / rekening / tidak | Ya (V) | V20 |
| `lead_time` | Pilihan | <7 / 7–29 / 30–59 / 60–90 / >90 | Ya (C) | C08 |
| `jumlah_vendor` | Angka | 1–10 | Ya (C) | C05 |
| `masalah` | Pilihan | tidak_ada / batal / terlambat / tidak_sesuai / harga_naik / sengketa_dp | Ya (C) | C12 |
| `dp_status`, `dp_max` | Pilihan, angka | Sesuai C14 | Ya (C) | C14 |
| `fee_layanan_status` | Pilihan | pasti_ya / ya_catatan / tidak / tidak_tahu | Ya (C) | C15 |
| `verbatim` | Teks | Kutipan ≤2 baris per butir wajib | Ya | bagian 5.3 dokumen ini |

### 6.2 Rumus yang Harus Dihitung

Semua perhitungan memakai **median**, bukan rata-rata. Rata-rata AOV menyesatkan karena Tarling Rp 40 jt dan sound Rp 750 rb berada di satu distribusi (§5.12).

| Kode | Nama | Rumus | Aturan pelaporan |
|---|---|---|---|
| F1 | AOV median per kategori (vendor) | `median(harga_typical)` untuk semua V dengan `kategori = k` | Laporkan n, median, p25, p75. Sel dengan n <3 tidak dilaporkan |
| F2 | AOV median per kategori (pelanggan) | `median(aov_pelanggan)` untuk semua C dengan `kategori = k` | Laporkan berdampingan dengan F1 |
| F3 | Selisih persepsi harga | `F2 − F1` per kategori | Positif = pelanggan membayar lebih dari harga yang disebut vendor; negatif = harga vendor dilebih-lebihkan |
| F4 | Tingkat penerimaan komisi per titik | `strict(t) = count(fee_status_t = pasti_ya) ÷ n_t`; `longgar(t) = count(fee_status_t ∈ {pasti_ya, ya_catatan}) ÷ n_t` | `n_t` = jumlah V yang menjawab titik t. Laporkan keduanya, jangan hanya longgar |
| F5 | Niat bypass per titik | `bypass(t) = count(bypass_t ∈ {pasti_luar, mungkin_luar}) ÷ n_t` | Ini angka yang dipakai aturan A-02, bukan F4 |
| F6 | Porsi acara multi-vendor | `count(jumlah_vendor ≥ 2) ÷ n` **hanya untuk P1** | P2 dilaporkan terpisah; jangan gabungkan (P2 di-oversample) |
| F7 | Estimasi hajatan berbayar per bulan (kabupaten) | `E1 = (RT_kab ÷ ART_kab) × p_acara ÷ 12`; `E2 = Σ(hajatan berbayar 12 bulan per desa) ÷ 12` | `RT_kab` dan `ART_kab` dari data BPS/desa; `p_acara = count(C03 ≤12 bulan & C04 ≥1 vendor berbayar) ÷ n_P1(kab)`. Laporkan E1, E2, dan rentangnya; jangan memilih satu angka tanpa menyebut yang lain |
| F8 | Capture yang dibutuhkan | `100 ÷ estimasi gabungan × 100%` | Target 100 booking/bln dari §3.3 dan §5.4. Bila hasil >100%, target mustahil secara aritmetika |
| F9 | Konversi minat DP | `count(dp_status = pasti_ya) ÷ n`; longgar ditambah `ya_catatan` | Pisahkan per kategori; nominal DP 30% pada Tarling dihitung eksplisit (30% × harga) |
| F10 | Kebiasaan respons vendor | `count(jam_respons ∈ {<1, 1–4, 4–24}) ÷ n` | Batas 24 jam mengikuti H-01; sebutkan porsi <1 jam secara terpisah |
| F11 | Kesiapan verifikasi | `count(ktp_rekening = keduanya) ÷ n` | Input untuk kelayakan 40 vendor terverifikasi (§6.2) |
| F12 | Proxy sengketa | `count(masalah ≠ tidak_ada) ÷ n` | Indikatif. Bukan pengganti dispute rate per booking completed |
| F13 | Komisi efektif per titik | `potongan_t ÷ harga_t` | Sudah dihitung di §3.3: 10,00% / 8,33% / 6,25% |
| F14 | Utilisasi tanggal | `median(hari_terisi ÷ 30)` | Penyebut 30 dipakai seragam karena V08 menanyakan satu bulan; laporkan porsi, bukan hari mentah |

**Aturan data.** (1) Field wajib kosong >20% pada satu responden → responden ditandai tidak valid dan diganti dari sel kuota yang sama; responden tidak valid tetap disimpan, tidak dihapus. (2) 10% wawancara di-spot-check analis terhadap catatan mentah; selisih dicatat. (3) Outlier tidak dibuang; laporkan median dan sebut outlier ekstrem (mis. Tarling papan atas) secara terpisah. (4) Tidak ada angka yang diisi ulang dari ingatan analis setelah wawancara.

### 6.3 Aturan Keputusan (Memetakan ke H-01…H-08)

Ambang diambil dari §3.4 dan §6.2. Zona antara = **bukan lulus, bukan gagal**; keputusan ditunda ke pilot dan tidak boleh dilaporkan sebagai bukti hipotesis.

| Kode | Indikator | LULUS | GAGAL | ZONA (tindakan) | Rujukan |
|---|---|---|---|---|---|
| A-01 | Median harga per kategori (F1, F2) | Organ Tunggal di Rp 3,0–4,5 jt dan sub-layanan sound system di Rp 0,75–2,25 jt: baseline Rp 4 jt sah untuk segmen §5.2. Layanan Pendukung lain (MC, dekor, tenda) dilaporkan tanpa ambang | Organ Tunggal di Rp 11–15 jt (kelas mapan): baseline Rp 4 jt tidak sah untuk kategori itu, D-02 wajib dipecah | Median di antara dua rentang, atau median Pendukung di bawah Rp 750 rb (transaksi <Rp 1 jt, §5.12): PO menetapkan definisi segmen sebelum harga dikunci | §5.2, §5.8, §5.12, H-06 |
| A-01b | Median harga Tarling (F1) | Rp 40–50 jt: Tarling hanya boleh memakai D-17, baseline Rp 4 jt dilarang | Di luar Rp 40–50 jt: struktur D-17 dihitung ulang pada nilai aktual | — | §5.10, §5.12, H-03 |
| A-02 | Niat bypass per titik harga (F5) | ≤10% di ketiga titik (T1, T2, T3) | >25% di salah satu titik | 10–25% di titik mana pun: lanjut ke uji pilot 40 vendor (§3.3) dengan pemantauan per titik | H-03, risiko R-03 (§12), §5.12 |
| A-03 | Estimasi hajatan berbayar/bulan, 2 kabupaten (F7) | ≥100/bulan | <100/bulan: target 100 booking/bln mustahil secara aritmetika, turunkan target atau tambah kabupaten | Tidak ada. Laporkan capture yang dibutuhkan (F8) | §3.3, §5.4 |
| A-04 | Lead time pemesanan (C08) | Median di 30–90 hari: asumsi §3.3 bertahan | Median <7 hari atau >90 hari: asumsi gugur; kalender 3 bulan (§15.1) dan pengingat H-7 (FR-052) tidak memadai | 7–29 hari: cutoff DP dan pengingat dimajukan; keputusan desain di M1 | §3.3, FR-052, FR-109 |
| A-05 | Kesediaan DP 30% via QRIS/VA (F9, ketat) | ≥60% | <40% | 40–60%: uji pilot. Perhatikan ambang Gate 1 ≥50% (§6.2) sebagai lantai minimum | H-02, §6.2, K-01 |
| A-06 | Kesediaan biaya layanan 1% (C15) | Tidak ada ambang di PRD; dilaporkan sebagai distribusi | Penolakan terkonsentrasi pada kategori Pendukung Acara (transaksi <Rp 1 jt): wajib bundling + lantai komisi Rp 25.000 | Penolakan tersebar: PO memutuskan sebelum FR-110 dikunci | §5.1, §5.10, §5.12 |
| A-07 | Kebiasaan respons vendor (F10) | ≥85% | <60% | 60–85%: desain wajib menyiapkan fallback agen (FR-112); ambang Gate 1 ≥80% berisiko | H-01, §6.2, D-15 |
| A-08 | Porsi acara dengan ≥2 vendor, hanya P1 (F6) | ≥15% | <5% | 5–15%: tunda keputusan event multi-vendor ke pilot | H-07 |
| A-09 | Proxy masalah/sengketa (F12) | ≤5% | >10% | 5–10%: siapkan playbook bukti sebelum pilot | H-05, risiko R-05 (§12) |
| A-10 | Kesiapan unggah KTP + rekening (F11) | 30 dari 30 responden menyatakan bersedia keduanya | <30: pipeline 40 vendor terverifikasi (§6.2) tidak realistis, perluas rekrutmen sebelum M1 | — | §6.2, §15.1 |
| A-11 | Biaya akuisisi vendor (H-04) | Tidak diukur di M0 | Tidak diukur di M0 | M0 hanya mencatat kunjungan per vendor dan konversi prospek → bersedia verifikasi sebagai input | H-04, §15.1 |
| A-12 | Repeat booking (H-08) | Tidak diukur di M0 | Tidak diukur di M0 | Diukur pada bulan ke-6 setelah ada booking completed | H-08 |

**Cara membaca hasil.** Satu hipotesis hanya boleh dilaporkan "lulus" bila indikatornya masuk kolom LULUS dengan n sesuai kuota. Bila satu kategori masuk LULUS dan kategori lain masuk GAGAL, tulis kesimpulan **per kategori**, bukan agregat (prinsip yang sama dengan §5.11 dan §5.12). Dilarang memakai kata "terbukti" untuk hasil survei; gunakan "mendukung", "tidak mendukung", atau "belum dapat disimpulkan".

**Batas A-03.** LULUS pada A-03 hanya berarti target 100 booking/bln **mungkin secara aritmetika**. Bila estimasi tepat 100/bulan, capture yang dibutuhkan 100%, artinya seluruh hajatan berbayar di 2 kabupaten harus masuk platform. Angka capture wajib ditulis di samping status LULUS, dan keputusan komersial tetap di tangan PO.

### 6.4 Peta ke Gate 1 (§6.2)

| Kriteria Gate 1 | Ambang | Dapat diukur di M0? | Sumber M0 | Aturan |
|---|---|---|---|---|
| Vendor terverifikasi | ≥40 (≥15/kabupaten, ≥3/kategori) | Tidak langsung | V20, daftar 120 calon §15.1 | A-10. Bila <30/30 bersedia, pipeline 40 tidak realistis |
| Vendor dengan rekening terverifikasi | 100% dari vendor tayang | Tidak | V20 (kesediaan saja) | Tidak ada salinan rekening di riset |
| Permintaan booking terkirim | ≥100 dalam 60 hari | Tidak (perilaku) | F7, F8 | Hanya uji kelayakan aritmetika, bukan bukti konversi |
| Response rate ≤24 jam | ≥80% | Tidak (perilaku) | F10 (proxy kebiasaan) | A-07: <60% = sinyal merah; 60–85% = zona |
| Median waktu accept | ≤6 jam | Tidak | — | Diukur di M1 |
| Konversi accepted → DP paid | ≥50% | Sebagian (pernyataan) | F9 | A-05. 40–50% = risiko tinggi terhadap Gate 1 |
| Insiden dana tanpa maker-checker, double booking, crash-free, p95, tiket CS | 0 / 0 / ≥99,5% / ≤900 ms / ≤0,35 | Tidak relevan riset | — | Diukur di M1 |

### 6.5 Konflik Ambang dan Cakupan yang Tidak Dijawab

**Konflik yang harus diputuskan PO sebelum laporan ditulis.** Riset tidak boleh memilih salah satu secara diam-diam.

| # | Konflik | Dampak pada pembacaan hasil | Usulan penanganan |
|---|---|---|---|
| 1 | H-01: §3.4 memakai lulus ≥85%, §6.2 memakai Gate 1 ≥80% | Satu angka hasil bisa dinyatakan lulus di riset tetapi gagal di gate | Laporkan tiga garis: hijau ≥85%, minimum gate ≥80%, merah <60% |
| 2 | H-02: §3.4 memakai lulus ≥60%, §6.2 memakai konversi ≥50% | Sama, untuk DP | Laporkan dua garis: sinyal riset ≥60%, lantai gate ≥50%, merah <40% |
| 3 | Permintaan: §3.3 dan §5.4 memakai 100 booking/bln, §6.2 memakai ≥100 permintaan dalam 60 hari | Angka "100" punya dua arti berbeda (laju vs jumlah kumulatif) | A-03 memakai 100/bln untuk kelayakan pasar; 100/60 hari tetap target operasional M1 |
| 4 | Jumlah vendor: §5.12 mewajibkan 30 wawancara, §6.2 mensyaratkan 40 vendor terverifikasi | 30 bukan target supply | 30 = sampel riset; 40 = target gate. Jangan melaporkan 30 sebagai capaian gate |

**Cakupan yang tidak dijawab instrumen ini** (jangan diisi dengan taksiran):

| Baris §3.3 | Alasan tidak dijawab | Pemilik workstream |
|---|---|---|
| Vendor dapat diaktifkan lewat 1–2 kunjungan | Butuh uji onboarding nyata, bukan wawancara | M1 (§6.2) |
| Pasar tidak memiliki pemain dominan | Butuh pemetaan 20 vendor/kabupaten dan kanal, bukan kuesioner | Workstream pemetaan §15.2, tenggat minggu 4 |

Sebutan nama kompetitor, paguyuban, atau kanal yang muncul dalam verbatim tetap direkap sebagai daftar pengamatan, tetapi **tidak boleh** diubah menjadi klaim pangsa pasar.

---

## 7. Risiko Riset

| # | Risiko | Bentuk yang muncul di lapangan | Dampak pada kesimpulan | Mitigasi | Cara mendeteksi |
|---|---|---|---|---|---|
| 1 | Bias responder: vendor yang sudah dikenal agen | Agen mewawancarai kenalan, keluarga, atau vendor binaan | Harga dan kesediaan komisi terlihat lebih baik dari kenyataan | Cap 20% (6 dari 30) untuk kanal relasi; field `kanal_rekrut` wajib; analisis dipisah relasi vs non-relasi | Bandingkan median harga dan F5 antara dua kelompok; selisih besar = bias |
| 2 | Harga dilebih-lebihkan vendor | Vendor menyebut harga penawaran, bukan harga yang benar-benar dibayar | AOV dan batas komisi terlalu tinggi | Tanya 3 angka (V11: min/tersering/max), minta contoh job terakhir; bandingkan dengan C10 pelanggan kategori sama (F3); pakai median | F3 negatif besar (vendor > pelanggan) pada kategori yang sama |
| 3 | Sampel musiman | Wawancara Okt–Nov, bulan dengan karakter permintaan tertentu (§11.4) | Job/bulan sekarang tidak mewakili setahun | Tanya dua titik: bulan paling ramai dan paling sepi (V06–V07), bukan bulan ini; recall 12 bulan | Jawaban V06 = V07 pada banyak responden, atau tidak ada variasi |
| 4 | Social desirability pada uji komisi | Vendor menjawab "ya" agar tidak mengecewakan pewawancara | Kesediaan komisi terlalu optimistis | Butir (c) niat bypass diajukan setelah (a); keputusan memakai (c) bukan (a); tegaskan tidak ada penawaran | F4 jauh lebih tinggi dari (100% − F5); jawaban (a) "ya" tetapi (c) "pasti di luar" |
| 5 | Galat ingatan pelanggan | Biaya dan tanggal acara diingat kira-kira | AOV pelanggan dan lead time bias ke angka bulat | Minta cek chat/struk bila ada; izinkan "≈"; catat sumber jawaban; laporkan sebaran kelas lead time, bukan rata-rata | Banyak jawaban berakhiran 0.000.000; banyak C10 = "tidak ingat" |
| 6 | Efek pewawancara | Agen adalah calon mitra vendor, sehingga jawaban diarahkan ke "yang menyenangkan" | Kesediaan aplikasi dan unggah KTP terlalu tinggi | Kalimat pembuka menyatakan bukan penawaran; agen tidak menjanjikan order; A-10 dibaca sebagai batas atas | Skor adopsi V18 = 5 pada hampir semua responden |
| 7 | Kuota drift | Agen mengisi sel yang mudah (organ tunggal, pelanggan di kota) dan melewatkan tarling/desa | Sebaran kategori dan wilayah menyimpang dari kuota | Lembar kuota harian per sel; stop recruitment bila sel penuh; analis cek harian | Realisasi sel vs kuota bagian 2.3–2.4 |
| 8 | Segmen bernilai tinggi sulit ditemui | Tarling dan panitia desa sulit dijadwalkan | Titik T3 (Rp 40 jt) kekurangan n | Jadwalkan lewat paguyuban dan perangkat desa sejak minggu 1; cadangan 1 vendor per sel | Realisasi sel Tarling <8 vendor atau P2 <20 pelanggan pada akhir minggu 3 |
| 9 | P2 mendominasi kesimpulan multi-vendor | Panitia desa di-oversample lalu dihitung bersama P1 | H-07 terlihat lebih tinggi dari populasi | F6 hanya dari P1; P2 dilaporkan terpisah | Proporsi multi-vendor P2 jauh di atas P1 |
| 10 | Kebocoran data pribadi | Nomor HP dan nama tersebar di grup WA tim | Pelanggaran UU PDP, responden menarik data | Tidak ada salinan KTP/rekening; berkas akses 3 orang; ID menggantikan nama; retensi 12 bulan | Audit akses mingguan oleh analis |
| 11 | Beban harian tidak tercapai | 6–7 wawancara/agen/hari di jalan Pantura | Kuota tidak selesai pada minggu 3 | Klaster maksimum 2 kecamatan/hari; 2 hari cadangan minggu 3; wawancara telepon untuk pelanggan yang jauh | Rekap harian sebelum 20.00 |
| 12 | Responden mengubah jawaban karena dijawab bersama | Wawancara di tengah acara, ditonton keluarga | Jawaban harga dan DP tidak jujur | Wawancara di tempat terpisah; bila tidak memungkinkan, catat "didampingi" dan uji sensitivitas | Field catatan "didampingi" >20% |

---

## 8. Jadwal 4 Minggu dan Pembagian Kerja

### 8.1 Jadwal

| Minggu | Tanggal | Aktivitas | Keluaran | PIC |
|---|---|---|---|---|
| 1 | 21–27 Okt | Finalisasi instrumen; uji coba 3 vendor + 5 pelanggan **di luar kuota**; revisi kalimat; susun daftar 90 calon vendor dan 300 calon pelanggan; izin paguyuban dan desa; kumpulkan RT/ART dan jumlah hajatan desa; siapkan spreadsheet + log consent; briefing agen | Instrumen v1.1, daftar kontak, baseline data desa, jadwal kunjungan per kecamatan | Analis + 2 agen |
| 2 | 28 Okt–3 Nov | Wawancara gelombang 1: 18 vendor + 60 pelanggan | 78 baris data valid | 2 agen |
| 3 | 4–10 Nov | Wawancara gelombang 2: 12 vendor + 40 pelanggan; 2 hari terakhir untuk catch-up dan penggantian | Total 30 vendor + 100 pelanggan | 2 agen |
| 4 | 11–17 Nov | Cleaning dan validasi; hitung F1–F14; susun laporan 2 halaman (bagian 9 dokumen ini); review PO; presentasi keputusan; arsip data | Laporan M0 + tabel §3.3 dan §5.12 terisi | Analis + PO |

### 8.2 Pembagian Kerja

| Peran | Wilayah | Wawancara | Beban lain |
|---|---|---|---|
| Agen 1 | Indramayu | 15 vendor + 50 pelanggan | Rekrutmen, consent, input harian sebelum 20.00 |
| Agen 2 | Cirebon | 15 vendor + 50 pelanggan | Rekrutmen, consent, input harian sebelum 20.00 |
| Analis | — | 0 | Uji coba, dashboard kuota harian, spot-check 13 wawancara (10% dari 130), cleaning, analisis, laporan |
| PO | — | 0 | Menyetujui instrumen hari 1, memutuskan konflik bagian 6.5, menerima laporan |

### 8.3 Beban Harian

| Minggu | Wawancara | Hari kerja efektif | Per agen per hari |
|---|---|---|---|
| 2 | 78 | 6 | ±6–7 |
| 3 | 52 | 5 (+2 cadangan) | ±5 |
| Total | 130 | 11 (+2 cadangan) | rata-rata ±6 |

Aturan: maksimum 2 kecamatan per hari per agen; jadwal disusun malam sebelumnya; bila realisasi <80% target harian dua hari berturut-turut, PO memindahkan 1 hari catch-up dari minggu 3 ke minggu 2.

---

## 9. Template Laporan Hasil (2 Halaman)

Laporan wajib 2 halaman, bukan lebih. Halaman 1 untuk keputusan, halaman 2 untuk pengisian PRD. Tidak ada lampiran naratif; data mentah disimpan di berkas terpisah.

### Halaman 1 — Keputusan

| Blok | Isi | Batas |
|---|---|---|
| Kepala | Judul, periode, n vendor, n pelanggan, penyusun, tanggal | 4 baris |
| 1. Ringkasan | Maksimum 5 temuan, tiap temuan memuat angka + n + arah keputusan | 5 butir |
| 2. Tabel A — AOV per kategori | Kategori, n, median, p25–p75, rentang §5.12, selisih F3, implikasi D-02 | 4 baris kategori |
| 3. Tabel B — Uji D-17 | Titik, potongan, komisi efektif, F4 ketat, F4 longgar, F5 bypass, status A-02 | 3 baris titik |
| 4. Tabel C — Permintaan | Kabupaten, E1, E2, estimasi/bulan, capture dibutuhkan (F8), status A-03 | 2 baris + total |
| 5. Tabel D — Status hipotesis | H-01…H-08, indikator M0, hasil, status (hijau/kuning/merah/tertunda), kode aturan | 8 baris |
| 6. Rekomendasi | Maksimum 5 baris: keputusan, pemilik, tenggat | 5 baris |

Format Tabel D:

| ID | Indikator M0 | Hasil (angka, n) | Status | Aturan | Catatan |
|---|---|---|---|---|---|
| H-01 | F10 | | hijau / kuning / merah / tertunda | A-07 | |
| H-02 | F9 | | | A-05 | |
| H-03 | F5 per titik | | | A-02 | |
| H-04 | — | Tidak diukur | tertunda | A-11 | Diukur di M1 |
| H-05 | F12 | | indikatif | A-09 | Bukan dispute rate |
| H-06 | F1 + V12 | | | A-01 | Konversi tidak diukur |
| H-07 | F6 (P1) | | | A-08 | P2 terpisah |
| H-08 | — | Tidak diukur | tertunda | A-12 | Bulan ke-6 |

### Halaman 2 — Pengisian PRD

**Tabel E — mengisi §3.3 (satu baris per klaim, jangan mengubah urutan).**

| Baris §3.3 | Status bukti baru | Angka | n | Metode | Label |
|---|---|---|---|---|---|
| 1 Permintaan hajatan | terisi / sebagian / tidak terisi | estimasi/bulan + capture | 100 | F7, data desa | [PRIMER] atau [PRIMER-PROXY] |
| 2 Komisi D-17 | terisi / sebagian | F5 per titik + F4 | 30 | V15–V17 | [PRIMER] |
| 3 DP 30% via gateway | terisi / sebagian | F9 | 100 | C14 | [PRIMER-PROXY] |
| 4 Booking 30–90 hari | terisi | distribusi C08 | 100 | C08 | [PRIMER] |
| 5 Aktivasi 1–2 kunjungan | tidak terisi | — | — | Diukur M1 | [TETAP ASUMSI] |
| 6 WA vs aplikasi | terisi / sebagian | F10 + kanal V19 | 30 | V19 | [PRIMER-PROXY] |
| 7 Pemain dominan | tidak terisi | — | — | Workstream §15.2 | [TETAP ASUMSI] |

**Tabel F — mengisi §5.12 (konfirmasi harga primer).**

| Segmen §5.12 | Rentang sekunder | Median primer | p25–p75 | n | Status |
|---|---|---|---|---|---|
| Sound system saja | Rp 750.000–2.250.000 | | | | terkonfirmasi / di luar rentang / data kurang |
| Organ + sound 1 penyanyi | Rp 3.000.000–4.500.000 | | | | |
| Organ tunggal mapan | Rp 11.000.000–15.000.000 | | | | |
| Seni tradisi per tanggap | ± Rp 5.000.000 | | | | |
| Tarling menengah | Rp 40.000.000–50.000.000 | | | | |
| Tarling all-in minimum | ± Rp 40.000.000 | | | | |
| Tarling papan atas | ratusan juta rupiah | | | | tidak disampel / data kurang |

**Tabel G — batas dan kualitas data.** Sel di bawah 3 responden; jumlah penolakan per kode T1–T6; porsi kanal relasi agen; porsi wawancara "didampingi"; daftar hal yang tidak terukur (H-04, H-08, baris 5 dan 7 §3.3).

### Checklist sebelum laporan dikirim

- [ ] Setiap angka di halaman 1 dapat dilacak ke baris data mentah dan punya n.
- [ ] Tidak ada rata-rata AOV; semua memakai median dan p25–p75.
- [ ] F4 dilaporkan ketat dan longgar; keputusan memakai F5.
- [ ] Kesimpulan ditulis per kategori, bukan agregat, bila arahnya berbeda.
- [ ] Konflik ambang bagian 6.5 dicantumkan, bukan diselesaikan sendiri oleh analis.
- [ ] Tidak ada nama, nomor HP, KTP, atau nomor rekening di laporan dan lampiran.
- [ ] Baris §3.3 dan §5.12 yang tidak terisi ditandai [TETAP ASUMSI], bukan dikosongkan.
