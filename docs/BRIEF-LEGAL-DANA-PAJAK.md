# BRIEF LEGAL DAN PAJAK — Penahanan Dana DP Pelanggan

| Field | Isi |
|---|---|
| Dokumen | Brief untuk konsultan eksternal (daftar pertanyaan dan opsi, **bukan opini hukum**) |
| Versi / tanggal | v1.0 — 21 Oktober 2026 |
| Pemilik dokumen | PO + Finance |
| Penerima | Konsultan hukum fintech; konsultan pajak; calon PJP/gateway (Bagian 6) |
| Status | Draf kerja M0. Setiap kesimpulan wajib keluar dari konsultan berizin |
| Rujukan internal | `PRD-v1.1.md` §2.2 (D-01, D-03, D-16, D-17), §5.2, §5.10, §5.12, §6.2–6.3, §11.3, §13.1–13.4, §14 (K-01..K-05) |

---

## 1. Tujuan dan Batas Dokumen

### 1.1 Tujuan

Dokumen ini menyiapkan bahan agar konsultan eksternal dapat memberi **pendapat tertulis** atas dua hal yang saat ini menghambat rilis:

1. Struktur penahanan dana DP pelanggan yang sah dan dapat dioperasikan (K-01, K-05).
2. Perlakuan pajak atas komisi, biaya layanan, dan pajak hiburan daerah (K-02, D-16).

Keluaran yang diharapkan dari konsultan: memo tertulis yang menjawab pertanyaan di Bagian 4, 5, dan 7, bukan penjelasan lisan.

### 1.2 Bukan opini hukum

> **Dokumen ini bukan nasihat hukum, bukan opini hukum, dan tidak menyatakan bahwa model bisnis patuh atau tidak patuh.**
>
> - Seluruh isi adalah **pertanyaan untuk dikonfirmasi** dan **opsi untuk diuji**, disusun oleh pihak non-hukum.
> - Tidak ada satu pun pernyataan di sini yang boleh dibaca sebagai jaminan kepatuhan, izin, atau pembebasan tanggung jawab.
> - Nama regulator, jenis izin, dan nama rezim pajak disebut hanya untuk menandai topik. Nomor pasal, nomor izin, dan kutipan peraturan **tidak** dikarang; bila tidak pasti, ditandai `[PERLU VERIFIKASI KONSULTAN]`.
> - Setiap kesimpulan yang mengikat perusahaan wajib berasal dari konsultan berizin, dan menjadi tanggung jawab profesi konsultan tersebut.

### 1.3 Cara konsultan menggunakan dokumen ini

1. Baca Bagian 2 untuk fakta bisnis. Bila ada fakta yang tidak sesuai, koreksi sebelum menjawab.
2. Nilai Opsi A–E di Bagian 3, lalu jawab pertanyaan di Bagian 4 (hukum) dan Bagian 5 (pajak).
3. Untuk setiap opsi, tandai: dapat dijalankan / dapat dijalankan dengan syarat / tidak dapat dijalankan, beserta alasannya.
4. Isi kolom "implikasi produk" pada Bagian 7. Tim produk akan memakai kolom itu untuk mengubah lingkup Fase 1/Fase 2.

### 1.4 Istilah

| Istilah | Arti dalam dokumen ini |
|---|---|
| PJP | Penyedia Jasa Pembayaran; pihak yang memproses pembayaran dan/atau penyaluran dana |
| Gateway | Kanal teknis pembayaran (QRIS/VA/e-wallet) yang dipakai pelanggan |
| Split settlement | Pembagian hasil pembayaran oleh PJP ke lebih dari satu rekening tujuan pada saat settlement |
| Escrow / rekening bersama | Rekening yang dananya ditahan PJP atas nama transaksi dan dilepas berdasarkan instruksi |
| Disbursement / payout | Penyaluran dana dari PJP ke rekening vendor |
| Dana tertahan | Nilai yang sudah dibayar pelanggan tetapi belum menjadi hak vendor atau platform |
| PBJT | Pajak Barang dan Jasa Tertentu, termasuk jasa hiburan, menurut ketentuan pajak daerah `[PERLU VERIFIKASI KONSULTAN: dasar hukum dan cakupan]` |
| M0 | Milestone 0 (minggu 1–4, 21 Okt–17 Nov 2026) menurut PRD §11.3 |

---

## 2. Fakta Bisnis yang Relevan

### 2.1 Model dan peran yang diklaim

Tarlink adalah marketplace yang mempertemukan penyelenggara acara (pelanggan) dengan vendor hiburan di Pantura. Posisi yang diklaim: **perantara yang mempertemukan dan mencatat kewajiban, bukan pemilik dana.**

| Aspek | Posisi saat ini | Rujukan |
|---|---|---|
| Peran platform | Perantara; menetapkan aturan, memverifikasi vendor, mencatat kewajiban, mengirim instruksi rilis | §2.1, §2.3 |
| Kepemilikan dana | Tidak pernah berada di rekening platform (D-01) | §2.2, §13.2 |
| Penahanan dana | Ditahan gateway/PJP berizin sampai acara terbukti selesai | §2.2, §6.2 |
| Eksekusi rilis | Platform hanya mengirim instruksi; PJP mengeksekusi | §13.2 |
| Kewajiban ke vendor | Dicatat sebagai liabilitas di ledger, bukan saldo rekening platform | §2.2, §13.2 |
| Rekening penampung sendiri | **BLOCKED** sampai ada dasar legal | §2.2, §13.2 |

### 2.2 Alur dana yang direncanakan

| Tahap | Peristiwa | Pihak yang memegang dana | Catatan |
|---|---|---|---|
| T1 | Pelanggan membayar DP 30% + biaya layanan pelanggan 1% melalui QRIS/VA/e-wallet | Belum ada; dana masuk ke rekening PJP | DP 30% menurut §5.2; biaya layanan ditampilkan terpisah (§5.10) |
| T2 | Dana DP tertahan di PJP | PJP | Platform mencatat posisi dana dan referensi gateway, tanpa memegang dana |
| T3 | Pelunasan sisa 70% melalui kanal yang sama | PJP | Jadwal pelunasan mengikuti kebijakan booking (FR-041); tidak diatur di brief ini |
| T4 | Acara selesai; bukti diterima; jendela sengketa berjalan | PJP | Auto-complete H+3, jendela sengketa sampai H+7 (§6.2) |
| T5 | Platform mengirim instruksi rilis setelah maker-checker | PJP | Instruksi, bukan eksekusi; ambang approval Rp 1.000.000 (D-14) |
| T6 | PJP memotong komisi, gateway fee, biaya disbursement, lalu menyalurkan sisa ke rekening vendor | PJP → rekening vendor | Angka menurut §5.3 |
| T7 | Komisi platform dan biaya layanan pelanggan menjadi hak platform | **Belum ditetapkan** — bergantung struktur yang dipilih | Ini celah yang harus dijawab Opsi A–E |

### 2.3 Titik-titik yang secara hukum belum jelas

| # | Pertanyaan faktual | Mengapa penting |
|---|---|---|
| F-1 | Bila dana tidak pernah masuk rekening platform, bagaimana komisi platform dibayarkan? | Menentukan apakah platform tetap menerima aliran dana pihak ketiga |
| F-2 | Apakah instruksi rilis dari platform dianggap perintah pemindahan dana atau sekadar instruksi merchant? | Menentukan kebutuhan izin |
| F-3 | Apakah platform tampil sebagai penjual jasa (principal) atau perantara di mata pelanggan dan vendor? | Menentukan tanggung jawab konsumen dan pajak |
| F-4 | Siapa yang menjadi pemilik dana selama T2–T4? | Menentukan siapa menanggung risiko kebangkrutan PJP |
| F-5 | Apakah platform boleh menahan dana lebih lama dari jadwal karena sengketa? | Menentukan batas waktu penahanan (K-05) |

### 2.4 Nilai transaksi dan komisi

Rentang nilai transaksi: **Rp 750.000 – Rp 50.000.000** per booking (§5.12). Nilai transaksi di atas Rp 50 juta (tarling papan atas) berada di luar cakupan awal.

Komisi bertingkat (D-17): lantai Rp 25.000/booking; 10% untuk bagian nilai transaksi sampai Rp 10.000.000; 5% untuk bagian di atas Rp 10.000.000; batas absolut Rp 7.500.000/booking. Biaya layanan pelanggan tetap 1% dan ditampilkan terpisah.

| Nilai transaksi | Komisi platform | Tarif efektif | Biaya layanan 1% | Total pendapatan platform |
|---|---|---|---|---|
| Rp 750.000 | Rp 75.000 | 10,00% | Rp 7.500 | Rp 82.500 |
| Rp 4.000.000 | Rp 400.000 | 10,00% | Rp 40.000 | Rp 440.000 |
| Rp 10.000.000 | Rp 1.000.000 | 10,00% | Rp 100.000 | Rp 1.100.000 |
| Rp 40.000.000 | Rp 2.500.000 | 6,25% | Rp 400.000 | Rp 2.900.000 |
| Rp 50.000.000 | Rp 3.000.000 | 6,00% | Rp 500.000 | Rp 3.500.000 |
| Rp 140.000.000 | Rp 7.500.000 (batas) | 5,36% | Rp 1.400.000 | Rp 8.900.000 |

Ilustrasi skala dana tertahan (bukan proyeksi, memakai bauran B §5.12: 20 tarling Rp 40 jt + 80 transaksi Rp 4 jt per 100 booking): DP 30% per kohort 100 booking ≈ **Rp 336.000.000** `[ILUSTRASI INTERNAL]`. Angka ini dipakai hanya untuk menunjukkan bahwa nilai dana yang ditahan material, sehingga struktur penahanan tidak bisa dipilih secara informal.

### 2.5 Cakupan dan fase

| Aspek | Isi | Rujukan |
|---|---|---|
| Wilayah pilot | 2 kabupaten: Indramayu dan Cirebon | §15.1 |
| Fase 1 (10 minggu) | DP via gateway, rilis manual oleh `admin_finance` dengan maker-checker, rekonsiliasi harian | §6.2 |
| Fase 2 (10 minggu) | Escrow otomatis, saldo/payout, refund otomatis, sengketa, clawback | §6.3 |
| Sifat Fase 2 | Mengotomasi mekanisme yang sudah live di Fase 1, bukan memperkenalkan mekanisme dana baru | §6.3 |
| Ketergantungan | K-01 dan K-05 harus selesai akhir M0; K-02 sebelum Gate 1 | §14 |

### 2.6 Fakta yang masih asumsi

| # | Asumsi | Dampak bila salah |
|---|---|---|
| A-1 | PJP bersedia menyediakan split settlement/escrow untuk marketplace jasa hiburan lokal | Opsi A/B gugur; produk jatuh ke Opsi E |
| A-2 | PJP mendukung verifikasi nama rekening vendor (name matching) | Payout manual, risiko salah transfer (K-04) |
| A-3 | Platform tidak memenuhi unsur jasa pembayaran | Bila salah, seluruh model harus ditinjau ulang |
| A-4 | Pajak hiburan daerah adalah kewajiban vendor/penyelenggara acara | Bila salah, harga dan invoice Fase 1 berubah |
| A-5 | Nilai transaksi Rp 40–50 jt dapat diproses tanpa perlakuan khusus | Bila salah, segmen tarling dikeluarkan dari rilis awal |

---

## 3. Opsi Struktur Penahanan Dana

Lima opsi disusun untuk diuji, bukan untuk dipilih sendiri oleh tim. Opsi E disertakan sebagai pembanding agar konsekuensi "tidak menahan dana" terlihat.

### 3.1 Ringkasan perbandingan

| Opsi | Dana di rekening platform | Pihak yang memegang dana | Kandidat status | Dampak utama ke produk |
|---|---|---|---|---|
| A. Split settlement di gateway | Tidak | PJP | Kandidat utama | Rilis manual Fase 1 dapat dipertahankan |
| B. Escrow/rekening bersama PJP | Tidak | PJP (rekening terpisah) | Kandidat utama | Perlu kontrak escrow; otomatisasi Fase 2 |
| C. Disbursement setelah settlement ke rekening platform | **Ya** | Platform | **RISIKO TINGGI — bertentangan dengan D-01** | Seluruh kontrol dana berpindah ke platform |
| D. Rekening penampung sendiri | **Ya** | Platform | **BLOCKED (D-01)** | Tidak boleh dibangun |
| E. Tanpa penahanan (bayar langsung ke vendor + invoice komisi) | Tidak | Vendor | Pembanding | Kehilangan jaminan DP; nilai inti produk hilang |

### 3.2 Opsi A — Split settlement di gateway

| Elemen | Uraian |
|---|---|
| Cara kerja | Pelanggan membayar satu tagihan. Saat settlement, PJP membagi dana: bagian vendor ke rekening vendor (dengan penundaan sesuai instruksi), bagian komisi dan biaya layanan ke rekening platform. Selama penundaan, dana berada di PJP. |
| Siapa memegang dana | PJP sampai instruksi rilis; setelah rilis, dana terbagi ke vendor dan platform |
| Izin yang mungkin diperlukan | Status perizinan melekat pada PJP. Perlu dikonfirmasi apakah platform tetap memerlukan izin tersendiri karena menerima bagian dana dan mengirim instruksi rilis `[PERLU VERIFIKASI KONSULTAN]` |
| Pro | Tidak ada dana di rekening platform; jalur pencairan paling dekat dengan kemampuan gateway yang sudah ada; tidak menambah rekening baru; dapat dioperasikan di Fase 1 |
| Kontra | Bergantung pada kemampuan PJP menahan dana per transaksi; model pembagian bisa membatasi penundaan; platform tidak punya kendali teknis atas eksekusi; biaya per payout |
| Dampak ke produk | Fase 1 tetap: DP, rilis manual, maker-checker, rekonsiliasi harian. Fase 2: otomatisasi instruksi rilis dan rekonsiliasi. Perlu field baru: `settlement_split_reference`, status penahanan per komponen |
| Pertanyaan ke PJP | (1) Apakah penundaan dana per transaksi didukung, berapa lama maksimumnya? (2) Apakah pembagian ke dua rekening dapat dilakukan pada saat rilis, bukan saat pembayaran? (3) Apakah ada batas nilai per transaksi untuk split? (4) Siapa yang menanggung risiko bila dana sudah dirilis tetapi sengketa muncul kemudian? |

### 3.3 Opsi B — Escrow/rekening bersama PJP

| Elemen | Uraian |
|---|---|
| Cara kerja | PJP membuka rekening escrow/ rekening bersama atas nama kerja sama, dana pelanggan masuk ke rekening itu, dan hanya keluar berdasarkan instruksi yang disepakati (termasuk untuk refund). Platform tidak memiliki akses penarikan. |
| Siapa memegang dana | PJP, pada rekening yang terpisah dari rekening operasional platform |
| Izin yang mungkin diperlukan | Perlu dikonfirmasi apakah rekening bersama menempatkan platform sebagai pihak dalam perjanjian escrow dan apakah itu menimbulkan kewajiban perizinan atau pelaporan `[PERLU VERIFIKASI KONSULTAN]` |
| Pro | Pemisahan dana paling jelas; perlindungan terhadap kegagalan operasional PJP lebih mudah dijelaskan; audit trail kuat; cocok untuk nilai transaksi besar (tarling Rp 40–50 jt) |
| Kontra | Tidak semua PJP menyediakan; proses pembukaan dan perjanjian lebih berat; biaya administrasi; rekonsiliasi lebih rumit karena ada dua lapisan (rekening escrow dan rekening vendor); waktu rilis bergantung jam kerja PJP |
| Dampak ke produk | Fase 1: alur rilis menjadi instruksi ke rekening escrow, bukan split. Fase 2: otomatisasi rilis dan refund wajib memakai API escrow. Perlu nomor referensi escrow per booking dan laporan saldo escrow harian |
| Pertanyaan ke PJP | (1) Apakah escrow tersedia untuk per transaksi, bukan per proyek? (2) Siapa pemilik rekening secara hukum? (3) Apakah dana dipisahkan dari aset PJP dan bagaimana bila PJP berhenti beroperasi? (4) Apakah refund dapat dilakukan dari rekening escrow tanpa persetujuan vendor? (5) Berapa biaya administrasi bulanan dan per transaksi? |

### 3.4 Opsi C — Disbursement setelah settlement ke rekening platform

| Elemen | Uraian |
|---|---|
| Cara kerja | PJP menyelesaikan seluruh dana ke rekening platform, lalu platform menahan dan menyalurkan ke vendor sesuai jadwal. |
| Siapa memegang dana | **Platform** |
| Izin yang mungkin diperlukan | Berpotensi dipandang sebagai kegiatan penghimpunan/penyaluran dana pihak ketiga; memerlukan kajian izin tersendiri `[PERLU VERIFIKASI KONSULTAN]` |
| Pro | Kontrol penuh atas waktu rilis, refund, dan clawback; tidak bergantung fitur PJP; rekonsiliasi internal lebih sederhana |
| Kontra | **Bertentangan langsung dengan D-01**; memunculkan risiko dana pihak ketiga, pembekuan rekening, dan kewajiban perizinan; memindahkan risiko gagal bayar ke platform; memerlukan modal kerja |
| Dampak ke produk | Bila dipakai, seluruh desain Fase 1 berubah: rekening platform, kontrol akses, rekonsiliasi kas, audit eksternal. Ini bukan penambahan fitur, melainkan penggantian model. |
| Status | **RISIKO TINGGI — tidak dipakai tanpa pendapat tertulis yang menyatakan sebaliknya** |
| Pertanyaan ke PJP | (1) Apakah PJP mengizinkan settlement ke rekening platform untuk dana yang secara ekonomi milik vendor? (2) Apakah PJP akan menolak atau membekukan rekening bila pola aliran dana terdeteksi sebagai penampungan? (3) Klausul apa yang membatasi penggunaan dana tersebut? |

### 3.5 Opsi D — Rekening penampung sendiri

| Elemen | Uraian |
|---|---|
| Cara kerja | Platform membuka rekening khusus untuk menampung DP pelanggan sebelum diteruskan ke vendor. |
| Siapa memegang dana | **Platform** |
| Izin yang mungkin diperlukan | Diasumsikan memerlukan izin dan tata kelola dana pihak ketiga `[PERLU VERIFIKASI KONSULTAN]` |
| Pro | Kendali operasional paling besar; tidak bergantung PJP |
| Kontra | Melanggar keputusan D-01; eksposur hukum dan tata kelola paling tinggi; memerlukan modal, audit, dan kemungkinan izin yang tidak dimiliki |
| Dampak ke produk | Tidak boleh dibangun. Tidak ada pekerjaan desain yang diizinkan sampai ada dasar legal. |
| Status | **BLOCKED sesuai D-01 dan §13.2. Opsi ditutup, bukan ditunda.** |

### 3.6 Opsi E — Tanpa penahanan (pembanding)

| Elemen | Uraian |
|---|---|
| Cara kerja | Pelanggan membayar DP langsung ke vendor (transfer atau kanal milik vendor). Platform hanya menagih komisi dan biaya layanan melalui invoice terpisah. |
| Siapa memegang dana | Vendor |
| Izin yang mungkin diperlukan | Paling ringan; platform tidak menyentuh dana pelanggan `[PERLU VERIFIKASI KONSULTAN]` |
| Pro | Hampir tanpa risiko dana pihak ketiga; cepat diluncurkan; biaya gateway rendah |
| Kontra | Kehilangan jaminan DP, yang merupakan nilai inti produk (§2.1, §15.2); tidak ada bukti pembayaran terpusat; komisi sulit ditagih; risiko bypass tinggi (R-03) |
| Dampak ke produk | Fase 1 menyusut menjadi katalog dan pencatatan booking; FR-040/042/043 tidak berlaku; target konversi dan kepercayaan tidak tercapai |
| Status | Pembanding untuk mengukur biaya kepatuhan Opsi A/B. Bukan rekomendasi. |
| Pertanyaan ke PJP | (1) Apakah PJP menyediakan penagihan komisi tanpa penahanan dana? (2) Bagaimana memverifikasi pembayaran langsung pelanggan ke vendor? |

---

## 4. Pertanyaan untuk Konsultan Hukum Fintech

Diisi oleh konsultan; setiap jawaban diminta merujuk dasar hukum dan menandai bagian yang masih terbuka.

### 4.1 Peran dan kualifikasi platform

1. Berdasarkan alur di §2.2, bagaimana platform dikualifikasikan: perantara yang menjual jasa vendor, agen penagihan, penyelenggara transaksi, atau pihak lain? Kriteria apa yang menentukan kualifikasi itu?
2. Apakah instruksi rilis dana dari platform ke PJP merupakan "perintah pemindahan dana" yang memerlukan izin, atau cukup diperlakukan sebagai instruksi pemberi kerja/merchant kepada penyedia jasa pembayaran?
3. Apakah pencatatan kewajiban ke vendor sebagai liabilitas di ledger — tanpa dana singgah di rekening platform — cukup untuk menghindari kualifikasi sebagai pihak yang menghimpun dana?
4. Jika platform menerima komisi dari nilai yang dibayar pelanggan sebelum dana diteruskan ke vendor (Opsi A), apakah komisi itu harus diperlakukan sebagai dana pihak ketiga?
5. Apakah model di mana platform menetapkan harga, menagih pelanggan, dan mengatur pembayaran vendor membuat platform menjadi **principal** secara hukum, bukan perantara? Apa konsekuensinya terhadap tanggung jawab dan izin?
6. Apakah perbedaan perlakuan muncul bila pelanggan membayar penuh di muka (bukan hanya DP 30%)?

### 4.2 Perizinan dan batas kegiatan

7. Izin atau status apa yang wajib dimiliki entitas platform untuk menjalankan Opsi A dan Opsi B, dan bagian mana yang sudah tercakup oleh izin PJP mitra? `[PERLU VERIFIKASI KONSULTAN]`
8. Apakah kegiatan platform memenuhi unsur "jasa pembayaran" atau "pengiriman uang" menurut ketentuan yang berlaku, meskipun dana tidak masuk rekening platform? `[PERLU VERIFIKASI KONSULTAN]`
9. Apakah ada batas nilai per transaksi atau per pelanggan yang memicu kewajiban tambahan, terutama untuk transaksi Rp 40–50 juta?
10. Apakah platform wajib mendaftar sebagai Penyelenggara Sistem Elektronik, dan apakah pendaftaran itu menjadi prasyarat penandatanganan kontrak dengan PJP (K-03)?
11. Apakah bentuk badan usaha tertentu (PT vs bentuk lain) menjadi syarat untuk menandatangani perjanjian PJP dan menerima split settlement?

### 4.3 Tanggung jawab, sengketa, dan dana mengendap

12. Bila vendor tidak menyerahkan jasa, siapa yang bertanggung jawab kepada pelanggan: vendor, platform, atau PJP? Bagaimana mengalokasikan tanggung jawab di Syarat & Ketentuan agar tidak dikualifikasikan sebagai klausul yang dilarang dalam perlindungan konsumen?
13. Apakah platform dapat memutuskan refund tanpa persetujuan vendor? Dasar kontraktual apa yang wajib ada di perjanjian vendor agar keputusan itu sah?
14. Apa konsekuensi hukum bila platform menahan dana vendor lebih lama dari jadwal karena sengketa? Perlukah batas waktu eksplisit dan pemberitahuan tertulis?
15. Bagaimana perlakuan dana yang tidak dapat dicairkan karena vendor tidak aktif, rekening ditutup, atau nama tidak cocok? Berapa lama boleh ditahan dan ke mana dana diserahkan bila pemiliknya tidak ditemukan?
16. Apakah platform boleh memotong dana vendor untuk klaim pasca-pencairan (clawback) tanpa persetujuan baru per kasus? Klausul apa yang wajib dicantumkan di perjanjian vendor?
17. Bila terjadi double booking atau pembatalan sepihak vendor, apakah platform dapat memindahkan dana dari vendor ke pelanggan tanpa proses hukum?

### 4.4 APU-PPT, verifikasi identitas, dan batas penahanan

18. Apakah platform termasuk pihak yang wajib menerapkan program APU-PPT, atau kewajiban itu sepenuhnya berada pada PJP? Bila platform bukan pihak pelapor, kewajiban apa yang tetap melekat (identifikasi pihak, pemantauan, pelaporan internal)? `[PERLU VERIFIKASI KONSULTAN]`
19. Berapa batas nilai dan durasi penahanan dana yang diizinkan, dan apakah dana yang mengendap menimbulkan kewajiban pelaporan (K-05)?
20. Siapa yang menanggung kewajiban verifikasi identitas (KYC) pelanggan dan vendor: platform atau PJP? Data apa yang boleh diminta dan disimpan platform tanpa melampaui kewenangan?
21. Apakah transaksi bernilai tinggi (Rp 40–50 juta) memerlukan verifikasi tambahan atau pemicu pelaporan otomatis?

### 4.5 Kontrak, konsumen, dan data

22. Klausul minimum apa yang wajib ada di perjanjian PJP agar platform tidak dipandang sebagai pemegang dana: pembagian tanggung jawab, hak instruksi, SLA, batas ganti rugi, hak audit, dan mekanisme keluar?
23. Bila izin PJP dicabut atau PJP berhenti beroperasi, apa status dana pelanggan dan bagaimana perlindungannya? Apakah dana di escrow dipisahkan dari aset PJP?
24. Apakah platform boleh menyatakan di halaman pembayaran bahwa "dana ditahan PJP berizin" sebagai jaminan kepada konsumen? Bagaimana merumuskannya agar tidak menjadi janji yang tidak dapat dipenuhi?
25. Informasi apa yang wajib diungkap sebelum pembayaran (identitas vendor, jadwal, kebijakan pembatalan, pihak yang memegang dana, kanal pengaduan)?
26. Apakah sengketa konsumen bernilai kecil wajib/disarankan melalui forum tertentu, dan apakah klausul arbitrase diperbolehkan untuk konsumen?
27. Dalam pemrosesan data, platform berperan sebagai pengendali atau prosesor terhadap data pembayaran? Apakah diperlukan perjanjian pengolahan data bersama dengan PJP?

---

## 5. Pertanyaan untuk Konsultan Pajak

Diisi oleh konsultan; setiap jawaban diminta menyebut dasar hukum, tarif, dan tenggat kewajiban.

### 5.1 PPN dan status PKP

1. Apakah komisi platform merupakan jasa yang dikenai PPN? Pada ambang peredaran bruto berapa platform wajib berstatus PKP? `[PERLU VERIFIKASI KONSULTAN: ambang dan dasar hukum]`
2. Bila platform belum PKP, apakah invoice komisi tanpa PPN sah? Apa konsekuensi bila ambang terlampaui di tengah tahun dan bagaimana kewajiban PPN dihitung sejak saat itu?
3. Apakah biaya layanan pelanggan 1% diperlakukan sama dengan komisi (objek PPN), atau merupakan bagian dari harga jasa vendor?
4. Apa dasar pengenaan PPN: nilai total tagihan, nilai komisi saja, atau nilai setelah diskon/promo? Bagaimana perlakuan biaya transport yang bersifat pass-through?
5. Apakah platform wajib memungut PPN atas seluruh nilai transaksi karena dianggap principal, atau hanya atas komisi karena berposisi sebagai perantara? Indikator apa yang menentukan posisi itu?
6. Apakah PPN terutang pada saat pembayaran diterima pelanggan, atau pada saat dana dirilis ke vendor?

### 5.2 PPh dan pemotongan

7. Apakah komisi yang dibayar platform kepada vendor merupakan objek pemotongan PPh? Siapa yang wajib memotong: platform atau PJP?
8. Bila vendor adalah orang pribadi tanpa badan usaha, apa kewajiban pemotongan dan bagaimana bila vendor tidak memiliki NPWP?
9. Apakah pembayaran pelanggan kepada vendor yang disalurkan melalui PJP menimbulkan kewajiban pemotongan bagi platform?
10. Apakah biaya gateway dan biaya disbursement yang dipotong dari payout vendor mengurangi penghasilan bruto vendor atau merupakan biaya yang harus diperlakukan terpisah?

### 5.3 PBJT dan pajak daerah

11. Dalam PBJT atas jasa hiburan, siapa yang dikualifikasikan sebagai penyelenggara: vendor, pemilik tempat, atau platform yang menjual booking? `[PERLU VERIFIKASI KONSULTAN]`
12. Bila platform dianggap penyelenggara, apakah dasar pengenaan PBJT adalah nilai total tagihan atau hanya nilai jasa hiburan (tanpa biaya layanan dan transport)?
13. Peraturan daerah mana yang berlaku: lokasi acara atau domisili vendor? Apakah ada perbedaan antara Indramayu dan Cirebon, dan bagaimana bila acara digelar di luar kedua kabupaten itu?
14. Apakah ada perbedaan perlakuan PBJT antar kategori (tarling, organ tunggal, seni tradisi) dan antar nilai transaksi?

### 5.4 Invoice, pelaporan, dan refund

15. Format invoice/faktur apa yang wajib: identitas dan NPWP penerbit, nomor urut, DPP, PPN, keterangan jasa, dan apakah invoice komisi ke vendor berbeda dari invoice ke pelanggan?
16. Apakah platform wajib menerbitkan bukti potong untuk komisi dan/atau pajak hiburan, atau cukup invoice komersial?
17. Pelaporan apa yang wajib dilakukan platform, pada SPT mana, dan apakah transaksi yang diproses melalui PJP perlu dilaporkan terpisah?
18. Saat booking dibatalkan dan dana dikembalikan, bagaimana perlakuan PPN dan PBJT yang sudah dipungut? Apakah diperlukan faktur pengganti/nota pembatalan dan apa tenggatnya?
19. Bagaimana perlakuan pajak atas clawback dan denda vendor: objek pajak, pengurang, atau transaksi yang harus dilaporkan terpisah?
20. Apakah biaya layanan pelanggan yang ikut dikembalikan saat refund mengurangi dasar pengenaan PPN platform?

---

## 6. Dokumen yang Harus Diminta dari Calon PJP/Gateway

Checklist ini dipakai saat kontak awal. Dokumen bertanda **G** bersifat gating: tanpa dokumen ini, opsi tidak dapat dinilai.

| # | Dokumen / informasi | Isi minimum yang diminta | Alasan | G |
|---|---|---|---|---|
| D-1 | Perjanjian kerja sama (draf) | Pembagian tanggung jawab, hak instruksi, batas ganti rugi, durasi, pemutusan | Menentukan siapa memegang risiko | G |
| D-2 | Bukti izin dan status entitas PJP | Izin yang berlaku, cakupan layanan, masa berlaku | Memastikan mitra berizin | G |
| D-3 | Mekanisme settlement dan escrow | Alur, jadwal, batas nilai, dokumen per transaksi | Menentukan kelayakan Opsi A/B | G |
| D-4 | Kemampuan name matching rekening | Otomatis atau manual, tingkat kecocokan, penanganan ketidakcocokan | K-04; mencegah salah transfer | G |
| D-5 | SLA dan jam operasi | Waktu settlement, penyelesaian gangguan, kanal eskalasi | Menentukan janji rilis ke vendor | — |
| D-6 | Struktur biaya | Biaya transaksi, settlement, disbursement, refund, chargeback, biaya bulanan | Masuk ke unit economics §5.3 | G |
| D-7 | Kebijakan refund dan chargeback | Siapa memutuskan, tenggat, bukti yang diperlukan, penanggung biaya | D-03 | — |
| D-8 | Format laporan rekonsiliasi | Frekuensi, tingkat detail, ketersediaan API/unduhan | FR-131 rekonsiliasi harian | — |
| D-9 | Kebijakan data dan lokasi penyimpanan | Data yang diproses, lokasi, retensi, kewajiban notifikasi insiden | DPA §13.1 | — |
| D-10 | Rencana kontinuitas dan exit | Penanganan bila layanan berhenti, portability data, migrasi dana | Risiko R-13 | — |
| D-11 | Kemampuan pembayaran bertahap | Dukungan DP + pelunasan dalam satu booking | FR-041 | — |
| D-12 | Kemampuan penahanan per transaksi | Durasi maksimum, dasar pelepasan, biaya | Inti Opsi A/B | G |

Aturan penilaian: PJP yang tidak dapat memenuhi D-1, D-2, D-3, D-4, D-6, atau D-12 tidak dilanjutkan ke tahap kontrak, sekalipun biayanya lebih murah.

---

## 7. Matriks Keputusan

### 7.1 Cara membaca

Kolom "perubahan produk" hanya berlaku **jika** konsultan memberi jawaban pada kolom kedua. Matriks ini bukan prediksi; ia memastikan tim tahu apa yang harus diubah sebelum jawaban datang.

| # | Jika jawaban konsultan | Opsi terdampak | Perubahan produk | Fase |
|---|---|---|---|---|
| M-1 | Split settlement tidak menjadikan platform pemegang dana | A | Tidak ada perubahan besar; Fase 1 berjalan sesuai rencana; tambah referensi split per booking | F1 |
| M-2 | Platform memerlukan izin tersendiri untuk mengirim instruksi rilis | A, B | Instruksi rilis dipindahkan ke PJP; platform hanya mengirim konfirmasi faktual; SLA rilis memanjang; kontrol produk atas waktu rilis hilang | F1 |
| M-3 | Escrow per transaksi tersedia dan diizinkan | B | Ganti alur rilis Fase 1 ke escrow; tambah saldo escrow harian dan laporan per booking; refund lewat escrow | F1–F2 |
| M-4 | Escrow hanya tersedia untuk nilai di bawah ambang tertentu | B | Transaksi tarling Rp 40–50 jt dipisahkan ke jalur pembayaran bertahap atau manual; katalog menandai metode pembayaran per segmen | F1 |
| M-5 | Dana tidak boleh ditahan lebih dari N hari | A, B | Timer rilis otomatis; auto-release atau auto-refund saat batas tercapai; pembatalan otomatis bila bukti tidak lengkap | F1–F2 |
| M-6 | Platform dianggap principal, bukan perantara | A, B, C, E | ToS berubah (platform sebagai penjual jasa), invoice berubah, tanggung jawab konsumen pindah ke platform; harga wajib memuat pajak | F1 |
| M-7 | PJP tidak mendukung name matching otomatis | A, B | Verifikasi manual wajib sebelum payout; cooling period tetap; tambah antrean admin dan bukti verifikasi | F1 |
| M-8 | Platform wajib APU-PPT sebagai pihak pelapor | A, B | Perlu prosedur identifikasi, pemantauan, dan pelaporan; tambah peran kepatuhan; rilis tertahan sampai prosedur ada | F1 |
| M-9 | PBJT adalah kewajiban platform sebagai penyelenggara | A, B | Baris pajak di checkout dan invoice; harga tampil "termasuk pajak"; komisi bersih turun; kalkulasi ulang unit economics | F1 |
| M-10 | Platform wajib PKP lebih awal dari rencana | A, B | Invoice komisi ber-PPN; harga jasa platform naik efektif; ubah FR-043/FR-046 dan tampilan biaya layanan | F1 |
| M-11 | Tidak ada PJP yang bersedia menahan dana untuk marketplace ini | Semua | Jatuh ke Opsi E; Fase 1 menjadi katalog + pencatatan; janji "DP aman" dicabut dari materi pemasaran | F1 |
| M-12 | Dana mengendap berisiko dikualifikasikan sebagai dana tak bertuan | A, B | Mekanisme pengingat, auto-refund, dan prosedur penyerahan dana; laporan kepatuhan berkala | F2 |
| M-13 | Refund tanpa persetujuan vendor tidak diperbolehkan | A, B | Refund butuh persetujuan vendor atau keputusan sengketa; SLA refund memanjang; playbook sengketa berubah | F1–F2 |
| M-14 | Clawback tanpa persetujuan per kasus tidak sah | A, B | Klaim pasca-pencairan menjadi tagihan, bukan potong otomatis; tahan sebagian dana 3 booking pertama | F2 |

### 7.2 Konsekuensi pada gate

| Bila | Maka |
|---|---|
| K-01 tidak selesai akhir M0 | Fase 1 tidak dapat memproses DP; rilis mundur (§14) |
| K-02 tidak selesai sebelum Gate 1 | Desain Fase 2 memakai asumsi pajak; Gate 2 menahan penerapan (§6.3) |
| Opsi terpilih baru diketahui di minggu 4 | Tidak ada waktu untuk membangun ulang alur pembayaran; Fase 1 memakai Opsi A dengan rilis manual, atau mundur |

---

## 8. Risiko Hukum Bila Salah Struktur

| # | Skenario salah pilih | Dampak hukum | Dampak bisnis | Deteksi dini |
|---|---|---|---|---|
| H-1 | Memakai Opsi C/D tanpa dasar legal | Kegiatan dana pihak ketiga tanpa izin; sanksi administratif; kemungkinan tuntutan | Pembekuan rekening; operasi berhenti; dana pelanggan tidak dapat dikembalikan | PJP menolak atau membekukan rekening; permintaan klarifikasi dari bank |
| H-2 | Menahan dana melebihi batas yang diizinkan | Pelanggaran ketentuan penahanan dana; sengketa konsumen | Refund massal; kehilangan kepercayaan vendor dan pelanggan | Keluhan "dana tidak keluar" >2% booking; umur dana tertahan melewati batas |
| H-3 | Tidak memenuhi kewajiban APU-PPT | Sanksi administratif; kewajiban perbaikan prosedur | Rilis tertahan; biaya kepatuhan mendadak; mitra PJP meninjau ulang kontrak | Permintaan data dari PJP; temuan audit |
| H-4 | Salah menempatkan kewajiban PBJT | Kurang bayar pajak daerah; sanksi bunga | Tagihan pajak mundur; harga harus dinaikkan di tengah pilot; sengketa dengan vendor | Surat dari pemda; vendor menolak memungut pajak |
| H-5 | Invoice komisi tanpa PPN padahal sudah wajib PKP | Kurang pungut PPN; sanksi | Kewajiban membayar PPN dari margin sendiri; margin per booking tergerus | Peredaran bruto melewati ambang; temuan konsultan |
| H-6 | ToS menyatakan platform "menjamin" dana atau "bertanggung jawab penuh" | Klausul menjadi dasar gugatan perdata; klaim konsumen di luar kemampuan | Pembayaran ganti rugi; kehilangan margin beberapa bulan | Lonjakan klaim konsumen; ulasan negatif berpola |
| H-7 | Payout ke rekening yang tidak cocok identitas | Salah transfer; potensi tuduhan kelalaian | Dana hilang atau tertahan; vendor menuntut; proses hukum | Payout gagal >0,5% (R-12); keluhan vendor |
| H-8 | PJP berhenti beroperasi atau izinnya dicabut | Dana pelanggan tidak terlindungi; platform ikut digugat | Kehilangan dana tertahan; kegagalan rilis massal | Berita regulator; gangguan SLA; permintaan migrasi mendadak |
| H-9 | Perjanjian vendor tidak memuat hak potong dan clawback | Klaim pasca-pencairan tidak dapat dieksekusi | Saldo negatif menumpuk (R-20); biaya penagihan | Vendor menolak pemotongan; saldo negatif naik |
| H-10 | Data pembayaran diproses tanpa dasar yang memadai | Pelanggaran pelindungan data pribadi (UU 27/2022, §13.4) | Sanksi; kewajiban notifikasi insiden; kehilangan kepercayaan | Temuan audit data; permintaan DSAR meningkat |

Catatan: risiko H-1, H-5, dan H-8 tidak dapat dimitigasi oleh produk. Mitigasi hanya dapat berupa keputusan struktur dan kontrak.

---

## 9. Rencana Kerja M0 (4 Minggu)

Periode: 21 Oktober – 17 November 2026 (M0 menurut §11.3). Tenggat keputusan: akhir minggu 4.

### 9.1 Prinsip

1. Satu lawan bicara per konsultan; tidak ada pertanyaan paralel dari beberapa orang ke pihak yang sama.
2. Semua pertanyaan dikirim tertulis, dengan nomor yang sama seperti di dokumen ini, agar jawaban dapat dipetakan kembali.
3. Tidak ada keputusan struktur yang diambil berdasarkan jawaban lisan.
4. Bila konsultan menyatakan suatu opsi tidak dapat dijalankan, opsi dicoret dari daftar, bukan dijalankan dengan risiko.

### 9.2 Siapa menghubungi siapa

| Pihak | Dihubungi oleh | Tujuan | Keluaran |
|---|---|---|---|
| Konsultan hukum fintech | PO | Penunjukan, lingkup kerja, jadwal | Surat penugasan + jadwal |
| Konsultan pajak | Finance | Penunjukan, lingkup kerja, jadwal | Surat penugasan + jadwal |
| Calon PJP #1 dan #2 | Finance | Uji kemampuan split/escrow dan name matching | Dokumen D-1..D-12 |
| Notaris/OSS (K-03) | PO | Badan usaha, NIB/KBLI, PSE | Daftar syarat pendirian |
| Auditor/akuntan (opsional) | Finance | Perlakuan liabilitas vendor di ledger | Catatan metodologi |

### 9.3 Dokumen yang dikirim ke konsultan

| # | Dokumen | Untuk konsultan hukum | Untuk konsultan pajak | Catatan |
|---|---|---|---|---|
| 1 | Brief ini | Ya | Ya | Dokumen utama |
| 2 | Kutipan PRD §2.2, §5.2, §5.10, §6.2–6.3, §13.2–13.3, §14 | Ya | Ya | Hanya bagian relevan, bukan seluruh PRD |
| 3 | Diagram alur dana T1–T7 (§2.2) | Ya | Ya | Satu halaman |
| 4 | Skema komisi D-17 dan contoh perhitungan (§2.4) | Ya | Ya | Termasuk transaksi Rp 750 rb dan Rp 50 jt |
| 5 | Draf Syarat & Ketentuan Pelanggan | Ya | — | Belum ada; dikirim sebagai draf awal |
| 6 | Draf Perjanjian Vendor | Ya | Ya | Memuat klausul komisi, refund, clawback |
| 7 | Draf perjanjian PJP (bila sudah ada) | Ya | — | Dikirim setelah D-1 diterima |
| 8 | Rencana invoice dan bukti pungut | — | Ya | Format yang diusulkan |
| 9 | Proyeksi volume dan nilai transaksi 6 bulan | Ya | Ya | Untuk uji ambang PKP dan batas penahanan |

Tiga pertanyaan pembuka untuk email ke PJP (bila kontak belum formal): (1) apakah penahanan dana per transaksi didukung dan berapa lama; (2) apakah rekening escrow tersedia untuk marketplace; (3) apakah name matching rekening vendor tersedia otomatis.

### 9.4 Jadwal

| Minggu | Tanggal | Aktivitas | PIC | Keluaran |
|---|---|---|---|---|
| 1 | 21–27 Okt | Finalisasi brief; penunjukan konsultan; kirim dokumen 1–4 | PO, Finance | Surat penugasan; dokumen terkirim |
| 1 | 21–27 Okt | Kontak awal PJP #1 dan #2; minta D-1, D-2, D-3, D-12 | Finance | Jadwal pertemuan; daftar PJP |
| 2 | 28 Okt–3 Nov | Sesi kerja konsultan hukum (Opsi A–E); sesi konsultan pajak (PPN/PPh) | PO, Finance | Catatan sesi; daftar pertanyaan lanjutan |
| 2 | 28 Okt–3 Nov | Kirim draf ToS dan Perjanjian Vendor | PO | Draf terkirim |
| 3 | 4–10 Nov | Terima dan uji D-1..D-12; verifikasi klaim kemampuan PJP | Finance | Matriks kemampuan PJP |
| 3 | 4–10 Nov | Draf memo konsultan (versi 1) untuk ditinjau | Konsultan | Draf memo |
| 4 | 11–17 Nov | Revisi memo; jawab pertanyaan terbuka; finalisasi | PO, Finance | **Memo tertulis final** |
| 4 | 11–17 Nov | Keputusan K-01 dan K-05; perbarui §13.2 dan §14 | PO | Keputusan tercatat |

### 9.5 Bentuk keluaran yang diminta

Keluaran wajib **tertulis dan ditandatangani**, bukan presentasi lisan atau pesan singkat.

| # | Keluaran | Isi minimum | Dari |
|---|---|---|---|
| O-1 | Memo hukum fintech | Jawaban per nomor Bagian 4; status tiap opsi (dapat/tidak dapat/dengan syarat); daftar dokumen yang wajib diubah; asumsi yang dipakai | Konsultan hukum |
| O-2 | Memo pajak | Jawaban per nomor Bagian 5; tarif dan dasar hukum; kewajiban dan tenggat; format invoice yang disetujui | Konsultan pajak |
| O-3 | Tabel jawaban PJP | D-1..D-12 terisi per PJP; klaim yang belum terbukti ditandai | Finance |
| O-4 | Rekomendasi struktur | Satu opsi utama + satu opsi cadangan, dengan alasan | PO + konsultan |
| O-5 | Daftar perubahan produk | Turunan dari Bagian 7 yang disetujui konsultan | PO + Tech Lead |

Format memo: maksimum 12 halaman, memakai penomoran pertanyaan yang sama, dan memisahkan tegas antara "yang dapat dipastikan" dan "yang masih memerlukan klarifikasi regulator".

### 9.6 Kriteria selesai M0

| # | Kriteria | Bukti |
|---|---|---|
| 1 | K-01 terjawab: satu struktur dipilih dan disetujui tertulis | Memo O-1 + keputusan tercatat |
| 2 | K-05 terjawab: batas nilai dan durasi penahanan diketahui | Memo O-1, bagian batas penahanan |
| 3 | K-02 dijadwalkan: desain pajak disetujui sebelum Gate 1 | Memo O-2 + jadwal |
| 4 | Minimal satu PJP memenuhi D-1, D-2, D-3, D-4, D-6, D-12 | Matriks O-3 |
| 5 | Daftar perubahan produk Fase 1 disetujui | O-5 |

Bila salah satu dari kriteria 1–3 tidak terpenuhi pada 17 November 2026: Fase 1 tidak masuk build untuk alur pembayaran, dan keputusan default adalah menunda, bukan melanjutkan dengan asumsi (§14).
