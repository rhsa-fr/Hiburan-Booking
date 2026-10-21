# PRD v1.1 — Marketplace Booking Hiburan Pantura

| Field | Nilai |
|---|---|
| Versi dokumen | 1.1 |
| Status | Draft-Review |
| Tanggal | 2026-10-21 |
| Dokumen dasar | `PRD-Booking-Hiburan-Pantura.md` v1.0 (07-10-2026) |
| Pemilik produk | [PO] |
| Reviewer wajib | Legal, Finance, Tech Lead, Ops |
| Dokumen teknis terkait | `TECH-DESIGN-v1.0.md` (terpisah, tidak diduplikasi di sini) |
| Cakupan dokumen | Bisnis: masalah, persona, unit economics, ruang lingkup fase, requirement, metrik, operasi, tim, risiko, legal |

## 1. Header, Status, dan Ringkasan Perubahan

### 1.1 Tujuan Revisi

Review v1.0 menemukan tujuh lubang yang bersifat *blocking*: (a) tidak ada dasar legal untuk menahan dana pelanggan, (b) tidak ada unit economics sehingga komisi 8–12% tidak dapat dipertahankan secara angka, (c) urutan fase membuat booking tidak mengikat karena pembayaran baru ada di Fase 2, (d) ledger diklaim double-entry tetapi strukturnya single-entry, (e) tidak ada verifikasi rekening tujuan pencairan, (f) admin dapat memindahkan uang tanpa audit trail dan tanpa 2FA, (g) sengketa pasca-pencairan mustahil diselesaikan dalam model yang ada.

Revisi 1.1 menutup ketujuh lubang itu melalui Decision Register D-01..D-16 yang bersifat **frozen** (tidak boleh diubah tanpa keputusan tertulis pemilik produk dan reviewer Legal/Finance). Dokumen ini adalah dokumen **bisnis**; arsitektur, skema data, endpoint, dan diagram runtime dirujuk ke `TECH-DESIGN-v1.0.md`.

### 1.2 Ringkasan Eksekutif Perubahan

- Dana pelanggan **tidak pernah masuk rekening platform** pada rilis awal; penahanan dilakukan PJP/payment gateway berizin (D-01). Opsi rekening penampung sendiri berstatus **BLOCKED**.
- Fase 1 kini mencakup pembayaran DP melalui gateway dengan **rilis manual oleh admin_finance** dan notifikasi WhatsApp/push. Booking menjadi mengikat sejak fase pertama (D-04).
- Unit economics ditetapkan: AOV Rp 4.000.000 (segmen pilot), take rate 11% (komisi 10% + biaya layanan 1%), contribution margin Rp 436.300/booking, break-even 107 booking/bln (2 dev) dan 176 booking/bln (4 dev) (D-02). Untuk transaksi di atas Rp 10 jt berlaku komisi bertingkat D-17; tingkat harga per kategori divalidasi di 5.12.
- Status booking dipecah menjadi tiga sumbu, ledger menjadi double-entry sejati, uang disimpan sebagai BIGINT rupiah utuh (D-05, D-06, D-09).
- Verifikasi rekening bank vendor, cooling period saat ganti rekening, snapshot kebijakan per booking, harga musiman, respons booking via WhatsApp, pengingat berjenjang, clawback pasca-pencairan, audit log admin, dan 2FA/maker-checker menjadi requirement eksplisit (FR-100..FR-145).
- Pajak belum dipungut di Fase 1; validasi konsultan pajak menjadi **syarat masuk Fase 2**, bukan pertanyaan terbuka (D-16).

### 1.3 Tabel Perubahan dari v1.0

| # | Bagian | Perubahan | Alasan |
|---|---|---|---|
| 1 | Posisi dana pelanggan | Rilis awal tidak menampung dana; dana ditahan PJP/gateway (split settlement/escrow). Rekening penampung sendiri dinyatakan BLOCKED | v1.0 tidak punya dasar legal; menampung dana pihak ketiga berisiko izin usaha pengiriman uang |
| 2 | Unit economics | Ditambahkan biaya per booking, revenue platform, COGS, break-even, sensitivitas AOV × volume, dan 3 opsi margin | v1.0 menetapkan komisi 8–12% tanpa perhitungan biaya dan titik impas |
| 3 | Urutan fase | DP via gateway + rilis manual + notifikasi WA/push masuk Fase 1; escrow otomatis, payout, refund, chat, ulasan, sengketa masuk Fase 2 | Di v1.0 booking baru mengikat di Fase 2 sehingga Fase 1 tidak menghasilkan transaksi |
| 4 | Status booking | Dipecah 3 sumbu: lifecycle, payment_status, settlement_status | Satu enum 13 nilai tidak dapat menyatakan kombinasi nyata (mis. selesai tetapi belum dicairkan) |
| 5 | Ledger | Double-entry sejati; saldo dihitung dari jurnal, bukan disimpan sebagai angka berjalan | Struktur v1.0 (`balance_after`, satu sisi per entri) secara faktual single-entry |
| 6 | Entitas wajib | `events`, `vendor_categories`, `vendor_bank_accounts`, `booking_terms_snapshot`, `booking_slots`, `calendar_updated_at`, `webhook_events`, `outbox_messages`, `device_tokens`, `otp_requests`, `regions`, `idempotency_keys`, `policy_versions`, `package_price_rules` | Menutup celah multi-vendor, multi-kategori, rekening payout, snapshot kebijakan, dan idempotensi |
| 7 | Peran | `customer`, `vendor_owner`, `vendor_member`, `admin_support`, `admin_finance`, `admin_super`; satu user boleh memiliki lebih dari satu vendor | Peran tunggal v1.0 tidak memisahkan kewenangan uang dari kewenangan dukungan |
| 8 | Tipe uang | BIGINT rupiah utuh + `currency` CHAR(3); tanpa desimal sen | Menghindari galat pembulatan pada penjumlahan ledger |
| 9 | Kalender | Membedakan "belum diisi" dan "eksplisit tersedia"; `calendar_updated_at` dipakai sebagai definisi vendor aktif | Kalender kosong di v1.0 tidak dapat dibedakan dari kalender penuh |
| 10 | Idempotensi | `Idempotency-Key` wajib pada POST booking/respond/payment/payout/dispute | Mencegah duplikasi transaksi akibat retry jaringan buruk |
| 11 | Kebijakan | `policy_versions` + snapshot di booking; kebijakan tidak retroaktif | Melindungi kedua pihak saat kebijakan berubah |
| 12 | Harga | Harga musiman via `package_price_rules`; Fase 1 menampilkan "mulai dari", harga final dikonfirmasi saat accept | Permintaan musim hajatan berharga berbeda; harga statis v1.0 tidak realistis |
| 13 | Admin | 2FA wajib; maker-checker untuk refund/payout di atas Rp 1.000.000 [ASUMSI]; audit log Must sejak Fase 1 | Admin v1.0 bisa memindahkan uang tanpa jejak dan tanpa persetujuan kedua |
| 14 | Respons vendor | Terima/tolak via WhatsApp interactive template (Fase 1), fallback agen menelepon | Vendor gaptek tidak akan membuka aplikasi setiap hari |
| 15 | Pajak | Belum memungut pajak di Fase 1; invoice komisi tanpa PPN sampai platform PKP; pajak hiburan daerah tetap kewajiban penyelenggara; validasi konsultan pajak wajib sebelum Fase 2 | Menghindari klaim kepatuhan yang belum diverifikasi |
| 16 | Requirement | FR-001..FR-075 dipertahankan; ditambah FR-100..FR-145 untuk 20 celah yang ditemukan review | Traceability requirement tidak boleh hilang antarversi |
| 17 | NFR | Semua target diberi definisi metrik, jendela pengukuran, dan ambang angka | Target "< 3 detik" di v1.0 tidak dapat diuji |
| 18 | Metrik & operasi | Ditambahkan definisi presisi metrik, tracking plan, SLA CS/sengketa, playbook, kapasitas agen | v1.0 hanya punya daftar target tanpa rumus dan pemilik |
| 19 | Risiko & legal | R-01..R-09 dipertahankan dengan kolom trigger dan pemilik; ditambah 10 risiko baru; checklist dokumen legal | Risiko v1.0 tanpa pemicu deteksi sehingga tidak dapat dipantau |
| 20 | Open questions | Dipangkas dari 10 menjadi maksimal 5 item yang murni butuh pihak eksternal | 5 dari 10 pertanyaan v1.0 dapat diputuskan sendiri |
| 21 | Harga pasar | Ditambahkan 5.12 (validasi harga sekunder) dan D-17 (komisi bertingkat dengan lantai dan langit-langit nominal) | Riset pasar 21 Okt 2026: AOV Rp 4 jt hanya berlaku untuk segmen kecil, sedangkan tarling Rp 40–50 jt; tarif datar 10% memicu bypass di transaksi besar dan tidak ekonomis di transaksi kecil |
| 22 | Batas bayar DP | Ditambahkan D-18: 24 jam default, 48 jam untuk transaksi ≥ Rp 10 jt | Slot terkunci sejak accept (FR-021), sehingga batas bayar harus realistis untuk pembayaran QRIS/VA di daerah |

### 1.4 Batas Dokumen

**Diatur di sini:** masalah dan hipotesis pasar, persona, model bisnis dan unit economics, ruang lingkup per fase, functional dan non-functional requirement, metrik dan tracking plan, operasi, tim dan anggaran, risiko, kepatuhan, keputusan terbuka, GTM.

**Tidak diatur di sini (rujuk `TECH-DESIGN-v1.0.md`):** DDL dan indeks, kontrak endpoint, diagram arsitektur, strategi migrasi, topologi deploy, pemilihan library. Bila dokumen ini dan tech design berbeda soal perilaku bisnis, dokumen ini yang berlaku; bila berbeda soal implementasi, tech design yang berlaku.

### 1.5 Konvensi Label

| Label | Arti | Konsekuensi |
|---|---|---|
| **[ASUMSI]** | Angka atau klaim yang belum divalidasi data lapangan | Wajib punya cara validasi dan tenggat; tidak boleh dipakai sebagai janji ke investor tanpa catatan |
| **BLOCKED** | Opsi yang dilarang sampai ada dasar legal | Tidak boleh diimplementasikan, termasuk sebagai fitur tersembunyi |
| **Frozen** | Keputusan yang tidak dapat diubah dalam siklus ini | Perubahan butuh persetujuan PO + reviewer terkait |
| **Δ** | Perubahan dibanding v1.0 | Dijelaskan di kolom catatan |

## 2. Ringkasan Produk dan Keputusan Kunci

### 2.1 Ringkasan Produk

Marketplace mobile (Flutter, Android + iOS) yang mempertemukan penyelenggara acara dengan vendor hiburan dan pendukung acara di Pantura: Tarling/Tarling Dangdut, Organ Tunggal, Seni Tradisi, dan Pendukung Acara. Nilai inti bukan sekadar katalog: (1) ketersediaan tanggal yang dapat dipercaya, (2) respons vendor yang terikat batas waktu, (3) DP yang ditahan pihak berizin sampai acara terbukti selesai, (4) jejak bukti (check-in, foto, snapshot syarat) yang membuat sengketa dapat diputuskan.

Wilayah awal: Indramayu dan Cirebon (pilot), lalu Subang, Majalengka, Brebes, Tegal, Karawang. Model pendapatan: komisi vendor bertingkat D-17 (10% sampai nilai transaksi Rp 10 jt, 5% di atasnya, lantai Rp 25.000, batas absolut Rp 7.500.000) + biaya layanan pelanggan 1%. Model biaya: agen lapangan sebagai kanal akuisisi supply, CS tunggal, infra ringan.

### 2.2 Keputusan Kunci (Ringkas)

| ID | Keputusan | Konsekuensi Bisnis |
|---|---|---|
| D-01 | Rilis awal TIDAK menampung dana di rekening platform. Dana ditahan gateway/PJP berizin (split settlement/escrow). Kewajiban ke vendor hanya dicatat. Rekening penampung sendiri BLOCKED sampai ada dasar legal | Platform tidak butuh izin pengiriman uang; rilis dana bergantung kemampuan PJP; rekonsiliasi jadi fungsi wajib sejak Fase 1 |
| D-02 | Baseline: AOV Rp 4.000.000; komisi 10% (range 8–12%); biaya layanan pelanggan 1%; gateway fee dan disbursement dipotong dari payout vendor; COGS platform ± Rp 3.700/booking; opex tetap Rp 17 jt/bln; break-even 107 booking/bln (2 dev) atau 176 booking/bln (4 dev) | Harga jual dan target volume terkunci; setiap skenario harga wajib diuji terhadap 107/176 |
| D-03 | Biaya gateway pada refund ditanggung pihak yang membatalkan (dipotong dari refund); jika vendor yang membatalkan, platform menyerap dan mencatatnya sebagai biaya | Refund bukan biaya netral; pembatalan vendor menekan margin dan harus dipantau |
| D-04 | Urutan fase baru: F1 DP via gateway + rilis manual + notifikasi WA/push; F2 escrow otomatis, payout, refund, chat, ulasan, sengketa; F3 operasional vendor; F4 pertumbuhan | Pendapatan dan risiko uang muncul di Fase 1; Fase 2 mengotomasi, bukan memperkenalkan |
| D-05 | Status booking 3 sumbu (lifecycle / payment_status / settlement_status) | Laporan dan SLA dapat dihitung per sumbu; tidak ada status gabungan yang ambigu |
| D-06 | Ledger double-entry sejati; saldo dihitung, bukan disimpan sebagai angka berjalan | Setiap rupiah dapat ditelusuri ke dua sisi; rekonsiliasi harian menjadi mungkin |
| D-07 | Entitas wajib: `events`, `vendor_categories`, `vendor_bank_accounts` (verified + cooling period), `booking_terms_snapshot`, `booking_slots`, `calendar_updated_at`, `webhook_events`, `outbox_messages`, `device_tokens`, `otp_requests`, `regions`, `idempotency_keys`, `policy_versions`, `package_price_rules` | Menutup celah multi-vendor, rekening payout, snapshot kebijakan, dan pengiriman notifikasi yang andal |
| D-08 | Peran: `customer`, `vendor_owner`, `vendor_member`, `admin_support`, `admin_finance`, `admin_super`. Satu user boleh punya lebih dari satu vendor | Kewenangan uang terpisah dari dukungan; vendor dengan beberapa unit usaha terlayani |
| D-09 | Uang: BIGINT rupiah utuh + `currency` CHAR(3); tanpa desimal sen | Tidak ada selisih pembulatan pada penjumlahan ledger dan payout |
| D-10 | Kalender membedakan "belum diisi" dan "eksplisit tersedia" | Pencarian tidak menampilkan vendor yang sebenarnya belum mengisi jadwal |
| D-11 | `Idempotency-Key` wajib pada POST booking/respond/payment/payout/dispute | Retry pada sinyal buruk tidak menciptakan transaksi ganda |
| D-12 | Kebijakan tidak retroaktif: `policy_versions` + snapshot di booking | Booking lama tetap memakai aturan saat dibuat |
| D-13 | Harga musiman via `package_price_rules`; Fase 1 menampilkan "mulai dari", harga final dikonfirmasi saat accept | Ekspektasi harga jujur; tidak ada tagihan kejutan |
| D-14 | Admin: 2FA wajib; maker-checker untuk refund/payout di atas Rp 1.000.000 [ASUMSI]; audit log Must sejak Fase 1 | Uang tidak dapat dipindahkan oleh satu orang tanpa jejak |
| D-15 | Vendor dapat menerima/menolak booking lewat WhatsApp interactive template (Fase 1), fallback agen menelepon | Supply dapat merespons tanpa memasang aplikasi |
| D-16 | Belum memungut pajak di Fase 1; invoice komisi tanpa PPN sampai platform PKP; pajak hiburan daerah tetap kewajiban penyelenggara; validasi konsultan pajak wajib sebelum Fase 2 | Tidak ada klaim kepatuhan premature; beban pajak tidak dialihkan diam-diam ke vendor |
| D-17 | Komisi bertingkat: lantai Rp 25.000/booking; 10% untuk bagian nilai transaksi sampai Rp 10.000.000; 5% untuk bagian di atasnya; batas absolut Rp 7.500.000/booking. Biaya layanan pelanggan tetap 1% | Tarif datar 10% tidak dapat melayani transaksi Rp 750 rb (tidak ekonomis) dan Rp 40 jt (bypass tinggi) sekaligus. Efektif 6,25% pada tarling Rp 40 jt, mendekati 5% pada transaksi sangat besar; ditinjau setelah 6 bulan data |
| D-18 | Batas bayar DP setelah booking `accepted`: **24 jam** (default, dapat diubah admin); **48 jam** untuk nilai transaksi ≥ Rp 10.000.000. Slot berstatus `held` selama batas itu; lewat batas → `expired` dan slot dilepas | Slot terkunci sejak accept (FR-021) tetapi tidak boleh terkunci terlalu lama; transaksi tarling butuh waktu bayar lebih panjang daripada organ tunggal |

### 2.3 Prinsip Operasi yang Diturunkan dari Register

1. **Uang tidak pernah "mengendap tanpa nama".** Setiap perubahan posisi dana harus punya dua sisi jurnal dan satu referensi eksternal (gateway reference).
2. **Satu aksi, satu otorisasi.** Aksi finansial di atas ambang wajib dua approver berbeda; aksi di bawah ambang tetap tercatat.
3. **Bukti sebelum uang bergerak.** Rilis dana memerlukan sinyal selesai (konfirmasi pelanggan, auto-complete, atau check-in + bukti).
4. **Kebijakan yang berlaku adalah kebijakan yang di-snapshot.** Tidak ada penerapan kebijakan baru ke booking lama.
5. **Supply dijaga manusia, bukan hanya aplikasi.** Agen lapangan adalah bagian model biaya, bukan tim sementara.

## 3. Masalah, Bukti, dan Hipotesis

### 3.1 Masalah Sisi Permintaan (Penyelenggara)

| # | Masalah | Gejala yang Dilaporkan [ASUMSI] | Dampak Bisnis | Cara Validasi |
|---|---|---|---|---|
| M-01 | Sulit menemukan grup yang benar-benar tersedia di tanggal acara | Menelepon 5–10 kontak, sebagian besar sudah terisi | Waktu pencarian panjang, pelanggan kembali ke jalur mulut ke mulut | Survei 100 penyelenggara + uji pilot: ukur waktu cari hingga booking terkirim |
| M-02 | Harga tidak transparan, negosiasi berulang | Harga berbeda untuk tetangga dan orang luar | Kepercayaan rendah, sulit membandingkan | Wawancara 20 penyelenggara + analisis 50 percakapan WA |
| M-03 | Tidak ada jaminan saat DP sudah dibayar | DP hilang saat vendor batal atau tidak sesuai janji | Kerugian finansial langsung, permintaan ganti rugi sulit | Pilot: hitung insiden DP bermasalah per 100 booking |
| M-04 | Kualitas tidak dapat dinilai sebelum memesan | Hanya mengandalkan rekomendasi tetangga | Salah pilih vendor, acara rusak | Uji pilot: bandingkan rating pra-acara dengan keluhan pasca-acara |
| M-05 | Panitia desa/institusi butuh beberapa vendor sekaligus | Mengurus organ, sound, MC, dekor secara terpisah | Koordinasi manual, risiko jadwal tidak sinkron | Wawancara 10 panitia desa + ukur permintaan multi-vendor di pilot |

### 3.2 Masalah Sisi Penawaran (Vendor)

| # | Masalah | Gejala yang Dilaporkan [ASUMSI] | Dampak Bisnis | Cara Validasi |
|---|---|---|---|---|
| M-06 | Jadwal dicatat manual sehingga bentrok | Buku tulis, catatan WA, ingatan pimpinan grup | Kerugian reputasi dan pembatalan sepihak | Audit kalender 30 vendor saat onboarding: hitung bentrok 12 bulan terakhir |
| M-07 | Jangkauan pelanggan terbatas pada relasi | Order hanya dari kenalan dan mulut ke mulut | Utilisasi tanggal rendah di luar musim | Baseline utilisasi 30 vendor (hari terisi per bulan) |
| M-08 | Pelanggan membatalkan sepihak atau tidak melunasi | Vendor mengejar pelunasan setelah acara | Piutang tak tertagih | Wawancara 30 vendor: frekuensi dan nilai piutang 12 bulan terakhir |
| M-09 | Tidak ada portofolio digital yang mudah dibagikan | Kirim video lewat WA, kualitas turun, memori penuh | Sulit meyakinkan pelanggan baru | Uji pilot: ukur jumlah view portofolio per vendor |
| M-10 | Pencatatan keuangan tidak rapi | Tidak tahu pendapatan bersih per job | Sulit mengatur harga dan bagi hasil kru | Uji pilot: bandingkan laporan platform dengan catatan vendor |

### 3.3 Status Bukti

| Klaim | Status Bukti | Label | Cara Validasi | Tenggat |
|---|---|---|---|---|
| Ada cukup permintaan hajatan di 2 kabupaten pilot untuk 100 booking/bln | Belum ada data | [ASUMSI] | Hitung jumlah hajatan dari data desa/DPT dan survei 100 responden | Sebelum Gate 1 (minggu 15) |
| Vendor bersedia memberi komisi sesuai D-17 (efektif 6,25% pada transaksi Rp 40 jt, 10% pada Rp 4 jt) | Belum diuji | [ASUMSI] | Uji pilot dengan 40 vendor, ukur churn setelah komisi berlaku; pisahkan hasil per kategori | Gate 1 |
| Pelanggan bersedia membayar DP 30% via gateway | Belum diuji | [ASUMSI] | Ukur konversi accepted → DP paid pada pilot | Gate 1 |
| Booking umumnya dibuat 30–90 hari sebelum acara | Belum diukur | [ASUMSI] | Analisis distribusi selisih tanggal booking vs tanggal acara | Bulan ke-4 |
| Vendor dapat diaktifkan lewat kunjungan agen 1–2 kali | Belum diukur | [ASUMSI] | Ukur onboarding completion per kunjungan | Gate 1 |
| WhatsApp lebih efektif daripada aplikasi untuk respons vendor | Belum diukur | [ASUMSI] | A/B: respons via WA vs push dalam aplikasi | Bulan ke-3 |
| Pasar tidak memiliki pemain dominan | Belum diverifikasi | [ASUMSI] | Pemetaan 20 grup/vendor per kabupaten dan kanal yang dipakai | Minggu 4 |

Satu-satunya angka pasar yang dikutip bersumber publik dan dilabeli **[RISET SEKUNDER]** di 5.12 (harga vendor Cirebon/Indramayu). Sisanya adalah asumsi berlabel yang wajib diganti dengan hasil pengukuran pada tenggat di atas. Harga pada 5.12 belum menggantikan D-02: ia hanya membatasi segmen mana yang boleh memakai AOV Rp 4 jt.

### 3.4 Hipotesis dan Kriteria Salah

| ID | Hipotesis | Metrik Uji | Ambang Lulus | Ambang Gagal (Pivot) | Jadwal |
|---|---|---|---|---|---|
| H-01 | Respons vendor terikat waktu (≤24 jam) meningkatkan kepercayaan pelanggan | Response rate ≤24 jam | ≥85% | <60% setelah 2 siklus perbaikan | Gate 1 |
| H-02 | DP yang ditahan PJP meningkatkan konversi booking accepted → paid | Konversi accepted → DP paid | ≥60% | <40% | Gate 1 |
| H-03 | Komisi bertingkat D-17 dapat diterima vendor tanpa bypass masif | Proporsi transaksi yang diselesaikan di luar platform | Bypass ≤10% | >25% | Bulan ke-6 |
| H-04 | Agen lapangan menurunkan CAC vendor secara signifikan | CAC per vendor terverifikasi | ≤Rp 250.000 | >Rp 500.000 | Bulan ke-6 |
| H-05 | Ulasan dan bukti check-in menurunkan sengketa kualitas | Dispute rate per booking completed | ≤5% | >10% | Bulan ke-8 |
| H-06 | Harga musiman menaikkan AOV tanpa menurunkan konversi | AOV dan konversi pada tanggal musim ramai | AOV naik ≥10%, konversi turun ≤5 poin | Konversi turun >15 poin | Bulan ke-6 |
| H-07 | Permintaan multi-vendor per acara layak secara operasional | Proporsi event dengan ≥2 vendor | ≥15% dari event | <5% | Bulan ke-9 |
| H-08 | Vendor repeat memakai platform tanpa insentif komisi | Repeat booking rate pelanggan | ≥15% dalam 180 hari | <7% | Bulan ke-6 |

Aturan keputusan: hipotesis yang gagal pada dua siklus perbaikan berturut-turut tidak diulang tanpa perubahan model; hipotesis yang lulus menjadi bagian baseline dan dipindahkan ke metrik operasional (Bagian 9).

**Dua tingkat ambang, jangan dicampur:** ambang **Gate** (Response rate ≥80%, konversi accepted → DP ≥50%) adalah syarat minimum untuk boleh lanjut fase; ambang **hipotesis** (≥85% dan ≥60%) adalah target keberhasilan penuh. Keduanya sengaja berbeda: Gate tidak boleh dinaikkan tanpa data M0, dan hipotesis tidak boleh diturunkan hanya karena Gate lolos. Rujukan silang: 6.2 (Gate) dan 9.1 (metrik operasional).

## 4. Persona dan Jobs-to-be-Done

### 4.1 Persona

Konteks pemakaian dan hambatan pada tabel berikut berasal dari observasi awal dan berstatus **[ASUMSI]** sampai survei lapangan (Bagian 3.3) selesai. Jumlah persona, nama, dan atributnya sengaja tidak diberi angka pasar.
| Persona | Deskripsi | Konteks Pemakaian | Kebutuhan Utama | Hambatan | Keahlian Teknis |
|---|---|---|---|---|---|
| **P1 — Penyelenggara keluarga** | Tuan rumah hajatan (nikah, khitanan, syukuran, sedekah bumi) usia 30–55 | Di rumah, malam hari, sering dibantu anak/keluarga | Cari hiburan yang tersedia di tanggal acara, harga jelas, DP aman | Tidak biasa transaksi online bernilai besar, sinyal desa lemah | Rendah–Menengah |
| **P2 — Panitia desa/institusi** | Panitia hajatan desa, karang taruna, sekolah, instansi, paguyuban | Rapat panitia, satu orang bendahara | Beberapa vendor untuk satu acara, dokumen pembayaran rapi, anggaran terkunci | Butuh bukti transaksi untuk pertanggungjawaban, keputusan kolektif | Menengah |
| **P3 — Vendor/grup hiburan** | Pimpinan grup tarling, pemilik organ tunggal, dalang, penyedia sound/tenda/MC | Di panggung, di jalan, malam hari | Order baru, jadwal tidak bentrok, DP terjamin, pembayaran tepat waktu | Gaptek, sibuk, tidak mau mengisi aplikasi | Rendah |
| **P4 — Anggota grup/kru** *(Fase 3)* | Penyanyi, pemain, kru panggung | Hari-H, lokasi acara | Tahu jadwal, lokasi, kebutuhan teknis | Tidak punya akun mandiri di v1.0 | Rendah |
| **P5 — Admin/operasi platform** *(internal)* | Tim CS, agen lapangan, admin keuangan | Desktop, jam kerja + on-call hari-H | Antrean kerja jelas, keputusan dapat diaudit, tidak salah mencairkan dana | Volume kasus manual tinggi di musim ramai | Menengah–Tinggi |

**P2 sebagai segmen terpisah.** Panitia desa/institusi berbeda dari P1 dalam tiga hal: (a) pembelian multi-vendor dalam satu keputusan, (b) kebutuhan dokumen (invoice, kontrak, bukti bayar) untuk pertanggungjawaban, (c) siklus keputusan kolektif sehingga waktu accept lebih panjang. Karena itu P2 dilayani lewat `events` (parent multi-vendor) dan ekspor laporan, bukan lewat alur booking tunggal.

### 4.2 Jobs-to-be-Done

| Persona | Job | Kapan | Kriteria Sukses | Hambatan Utama | Fitur Penopang |
|---|---|---|---|---|---|
| P1 | "Saat saya punya hajatan, saya ingin tahu grup mana yang benar-benar kosong di tanggal saya, supaya saya tidak kehilangan waktu menelepon" | H-90 sampai H-14 | Daftar kandidat tersedia ≤5 menit, tanpa kontak yang sudah terisi | Kalender vendor tidak akurat | FR-014, FR-020, FR-108, FR-116 |
| P1 | "Saat saya membayar DP, saya ingin uang saya tidak hilang kalau grup tidak datang" | Saat booking accepted | DP ditahan pihak berizin, refund jelas | Takut ditipu, tidak paham mekanisme | FR-042, FR-044, FR-118, FR-119 |
| P1 | "Saat harga berbeda dari yang saya lihat, saya ingin tahu mengapa" | Sebelum bayar | Harga final terkunci saat accept, rincian terlihat | Harga musiman tidak dijelaskan | FR-109, FR-110, FR-114 |
| P2 | "Saat panitia memutuskan pakai 3 vendor, saya ingin semuanya terkunci di satu acara" | Rapat panitia | Semua vendor terkonfirmasi, satu ringkasan biaya | Booking terpisah, jadwal tidak sinkron | FR-113, FR-036, FR-035, FR-046 |
| P2 | "Saat saya menyetor laporan, saya ingin bukti pembayaran dan invoice yang bisa dicetak" | Setelah acara | Dokumen lengkap ≤1 jam | Tidak ada invoice resmi | FR-046, FR-126, FR-136 |
| P3 | "Saat ada order masuk, saya ingin bisa jawab tanpa harus buka aplikasi" | Setiap notifikasi | Terima/tolak selesai ≤1 menit dari WA | Tidak memasang/membuka aplikasi | FR-111, FR-112, FR-051 |
| P3 | "Saat saya sudah terima DP, saya ingin job lain tidak masuk di tanggal itu" | Setelah accept | Tanggal terkunci otomatis | Kalender manual | FR-021, FR-022, FR-023 |
| P3 | "Saat acara selesai, saya ingin uang masuk tanpa menagih berulang" | H+1 sampai H+3 | Dana cair ≤3 hari kerja setelah selesai | Pelunasan terlambat, sengketa menggantung | FR-042, FR-045, FR-118, FR-122 |
| P4 | "Saat saya diminta manggung, saya ingin tahu jam, lokasi, dan kebutuhan panggung" | H-3 sampai hari-H | Informasi lengkap di satu layar | Info tersebar di WA | FR-061, FR-062, FR-139 |
| P5 | "Saat saya mencairkan dana, saya ingin yakin tidak ada duplikasi atau rekening salah" | Setiap hari kerja | 0 payout salah, rekonsiliasi bersih | Volume tinggi, data rekening berubah | FR-104, FR-105, FR-128, FR-131 |

### 4.3 Prioritas Segmen

| Segmen | Prioritas | Alasan | Fase Masuk |
|---|---|---|---|
| P1 Penyelenggara keluarga | Primer | Volume terbesar, keputusan cepat, satu vendor per acara | Fase 1 |
| P3 Vendor/grup | Primer | Supply menentukan kualitas katalog; tanpa supply tidak ada produk | Fase 1 |
| P2 Panitia desa/institusi | Sekunder | Nilai transaksi lebih besar, tetapi butuh multi-vendor dan dokumen | Fase 2 (event), Fase 3 (laporan) |
| P4 Kru | Tersier | Meningkatkan retensi vendor, bukan pendorong transaksi | Fase 3 |
| P5 Admin/ops | Pendukung | Menentukan biaya operasi dan kualitas keputusan | Fase 1 |

### 4.4 Anti-Persona

| Anti-persona | Mengapa Tidak Dilayani di Rilis Awal |
|---|---|
| Penyelenggara konser/tiket besar | Model tiket, kapasitas, dan perizinan berbeda; di luar cakupan |
| Vendor yang hanya mau transaksi tunai penuh di muka | Bertentangan dengan model DP ditahan PJP dan perlindungan pelanggan |
| Pihak yang mencari hiburan di luar Pantura | Biaya akuisisi dan verifikasi lapangan tidak tertutup pada skala awal |
| Perorangan tanpa badan usaha yang menawarkan jasa di luar kategori | Risiko kualitas dan legalitas tidak dapat diverifikasi dengan proses yang ada |

## 5. Model Bisnis dan Unit Economics

### 5.1 Sumber Pendapatan

| Sumber | Mekanisme | Nilai | Fase | Status |
|---|---|---|---|---|
| Komisi vendor | Persentase dari harga paket + add-on, dipotong saat rilis dana | 10% (range 8–12%, diatur admin per kategori/wilayah) | 1 | Wajib |
| Biaya layanan pelanggan | Ditambahkan ke tagihan pelanggan | 1% dari AOV | 1 | Wajib |
| Langganan vendor | Fitur prioritas tampil, statistik lanjutan | Rp 99.000/bln (usulan) [ASUMSI] | 4 | Opsional |
| Iklan/prioritas tampil | Slot sorotan per kabupaten/kategori | Rp 150.000/slot/bln (usulan) [ASUMSI] | 4 | Opsional |
| Biaya pencairan cepat | Payout <1 hari kerja | Belum ditetapkan | — | Tidak di rilis awal |

Take rate efektif baseline = (komisi + biaya layanan) ÷ AOV = 11,0%. Take rate bersih setelah promo rata-rata 5% dari GMV = 10,45%.

### 5.2 Asumsi Dasar

| Parameter | Nilai | Sumber | Sensitivitas |
|---|---|---|---|
| AOV (nilai paket rata-rata) | Rp 4.000.000 | D-02 [ASUMSI]; hanya valid untuk segmen pilot organ tunggal kecil + pendukung acara (5.12) | Diuji pada Rp 2,5 jt dan Rp 6 jt (5.8); tarling Rp 40–50 jt berada di luar baseline dan memakai D-17 |
| Komisi vendor | 10% (8–12%) | D-02 | Setiap +1 poin komisi = +Rp 40.000/booking |
| Biaya layanan pelanggan | 1% | D-02 | +0,5 poin = +Rp 20.000/booking |
| DP | 30% dari total | v1.0, dipertahankan | DP lebih kecil menurunkan komitmen vendor |
| Gateway fee | 1,5% dari total tagihan [ASUMSI] | Perkiraan blended QRIS/VA/e-wallet | +0,3 poin = +Rp 12.000 beban vendor |
| Disbursement | Rp 3.000/payout [ASUMSI] | Perkiraan flat per transfer | Batching Fase 2 menurunkan ke ± Rp 900/booking |
| COGS notifikasi + OTP | Rp 3.700/booking | D-02 [ASUMSI] | Rincian di 5.5 |
| Opex tetap | Rp 17.000.000/bln | D-02 | 2 agen Rp 9 jt + 1 CS Rp 5 jt + infra Rp 3 jt |
| Biaya dev | Rp 15.000.000/dev/bln | D-02 | 2 dev Rp 30 jt; 4 dev Rp 60 jt |

### 5.3 Biaya per Booking (AOV Rp 4.000.000)

| Komponen | Nilai | Ditanggung Siapa | Catatan |
|---|---|---|---|
| Harga paket | Rp 4.000.000 | Pelanggan | Basis AOV; tidak termasuk transport |
| Biaya layanan pelanggan 1% | Rp 40.000 | Pelanggan | Masuk pendapatan platform |
| Komisi vendor 10% | Rp 400.000 | Vendor | Dipotong dari payout, bukan ditagih terpisah |
| Gateway fee 1,5% | Rp 60.600 | Vendor | Dihitung dari total tagihan Rp 4.040.000; dipotong dari payout |
| Disbursement | Rp 3.000 | Vendor | Flat per payout; turun dengan batching di Fase 2 |
| COGS notifikasi + OTP | Rp 3.700 | Platform | Rincian di 5.5 |
| Transport | Rp 0–150.000 [ASUMSI] | Pelanggan | Pass-through, komisi 0%; di luar AOV |
| Biaya refund gateway | Rp 5.000–65.600 [ASUMSI] | Pihak pembatal (D-03) | Platform menyerap bila vendor yang membatalkan |
| Promo/voucher | Rp 0–200.000 | Platform | Hanya bila promo aktif |

**Posisi vendor per booking:** Rp 4.000.000 − Rp 400.000 − Rp 60.600 − Rp 3.000 = **Rp 3.536.400** (88,4% dari AOV). Vendor tidak dikenai biaya bulanan di Fase 1–3.

### 5.4 Pendapatan Platform per Booking

| Komponen | Nilai | % dari AOV | Fase |
|---|---|---|---|
| Komisi vendor 10% | Rp 400.000 | 10,00% | 1 |
| Biaya layanan pelanggan 1% | Rp 40.000 | 1,00% | 1 |
| **Total pendapatan platform** | **Rp 440.000** | **11,00%** | 1 |
| Langganan vendor (alokasi per booking pada 100 booking/bln) | Rp 0 | 0% | 4 |
| Iklan/prioritas (alokasi per booking) | Rp 0 | 0% | 4 |

Pada 100 booking/bln: GMV Rp 400.000.000; pendapatan platform Rp 44.000.000. D-02 menulis "± Rp 44,1 jt"; selisih Rp 100.000 (0,2%) berasal dari pembulatan agregat dan tidak mengubah break-even maupun keputusan.

### 5.5 COGS Platform per Booking

| Komponen | Volume/booking | Harga satuan [ASUMSI] | Biaya | Ditanggung |
|---|---|---|---|---|
| Notifikasi WhatsApp transaksional | 6 pesan | Rp 450 | Rp 2.700 | Platform |
| OTP (WhatsApp utama) | 1,1 permintaan | Rp 600 | Rp 660 | Platform |
| OTP SMS cadangan | 0,2 pesan | Rp 700 | Rp 140 | Platform |
| Push notification (FCM) | 8 pesan | Rp 0 | Rp 0 | Platform |
| Penyimpanan + CDN media (amortisasi) | — | — | Rp 200 | Platform |
| **Total COGS variabel** | | | **Rp 3.700** | Platform |

COGS ini **tidak** termasuk gateway fee dan disbursement karena keduanya dipotong dari payout vendor (D-02). Konsekuensi: kenaikan tarif gateway tidak langsung menekan platform, tetapi menekan pendapatan bersih vendor dan meningkatkan risiko churn serta bypass — dipantau lewat metrik "pendapatan bersih vendor" (Bagian 9).

### 5.6 Contribution Margin per Booking

| Baris | Nilai |
|---|---|
| Pendapatan platform | Rp 440.000 |
| COGS variabel | Rp 3.700 |
| **Contribution margin** | **Rp 436.300** |
| CM sebagai % AOV | 10,91% |
| CM sebagai % pendapatan | 99,16% |

### 5.7 Break-even

| Skenario | Biaya Tetap/bln | CM/booking | Break-even Matematis | Angka Acuan | Status |
|---|---|---|---|---|---|
| 2 developer | Rp 47.000.000 | Rp 436.300 | 107,7 booking | **107 booking** | D-02 |
| 4 developer | Rp 77.000.000 | Rp 436.300 | 176,5 booking | **176 booking** | D-02 |
| 2 developer + peran non-produksi | Rp 62.500.000 | Rp 436.300 | 143,3 booking | 144 booking | Interna v1.1 |
| 4 developer + peran non-produksi | Rp 92.500.000 | Rp 436.300 | 212,0 booking | 212 booking | Interna v1.1 |

Rincian biaya tetap: 2 agen lapangan Rp 9.000.000 + 1 CS Rp 5.000.000 + infra/tools Rp 3.000.000 = Rp 17.000.000 (D-02). Skenario 2 dev = Rp 17 jt + Rp 30 jt; 4 dev = Rp 17 jt + Rp 60 jt. Peran non-produksi (PO 0,5 FTE Rp 6 jt, QA 0,5 FTE Rp 4 jt, desain 0,3 FTE Rp 3 jt, finance/ops 0,3 FTE Rp 2,5 jt) ditambahkan pada skenario "opex penuh".

Catatan pembulatan: D-02 memakai pembulatan ke bawah, sehingga 107,7 menjadi 107 dan 176,5 menjadi 176. Pada 108 booking CM Rp 47.120.400 sudah melewati biaya tetap 2 dev; pada 177 booking CM Rp 77.225.100 melewati biaya tetap 4 dev. Karena itu Gate Fase 2 dan Gate Fase 3 memakai ambang aman **110** dan **180** booking/bln (bagian 6), bukan angka minimum pembulatan.

### 5.8 Sensitivitas Contribution Margin

Nilai dalam Rp juta per bulan. Penanda: **2d** = menutup biaya tetap 2 dev (Rp 47 jt); **4d** = menutup biaya tetap 4 dev (Rp 77 jt); **—** = belum menutup.

| AOV | CM/booking | 50 booking | 100 booking | 176 booking | 250 booking |
|---|---|---|---|---|---|
| Rp 2.500.000 | Rp 271.300 | 13,6 — | 27,1 — | 47,7 2d | 67,8 2d |
| Rp 4.000.000 | Rp 436.300 | 21,8 — | 43,6 — | 76,8 2d | 109,1 2d, 4d |
| Rp 6.000.000 | Rp 656.300 | 32,8 — | 65,6 2d | 115,5 2d, 4d | 164,1 2d, 4d |

Temuan yang mengikat keputusan:
1. Pada AOV Rp 2,5 jt, skenario 4 dev **tidak pernah** tercapai sampai 250 booking/bln (67,8 jt < 77 jt). Menambah developer hanya rasional bila AOV naik atau volume ≥284 booking/bln.
2. Pada AOV Rp 4 jt dan 176 booking, CM Rp 76,8 jt masih Rp 0,2 jt di bawah biaya tetap 4 dev. Gate Fase 3 karena itu ditetapkan 180 booking/bln.
3. Kenaikan AOV 50% (Rp 4 jt → Rp 6 jt) menaikkan CM/booking 50,4% (Rp 436.300 → Rp 656.300) tanpa menambah beban kasus per booking. Kenaikan volume 50% (100 → 150 booking) memberi kenaikan CM bulanan yang sama besar, tetapi menambah beban CS, agen, dan risiko operasi. Karena itu prioritas perbaikan margin adalah AOV dan take rate, bukan volume semata.

### 5.9 Opsi Menaikkan Margin

| Opsi | Mekanisme | Dampak Kuantitatif | Break-even 2 dev | Break-even 4 dev | Risiko |
|---|---|---|---|---|---|
| **O1 — Naikkan take rate** | Komisi 12% (batas atas range D-02) + biaya layanan tetap 1% | CM/booking Rp 516.300 (+18,3%); pendapatan Rp 520.000/booking; pada 100 booking +Rp 8,0 jt/bln | 91 booking | 149 booking | Vendor churn 5–10% [ASUMSI]; bypass naik karena selisih komisi terasa |
| **O2 — Langganan vendor** | Rp 99.000/bln untuk prioritas tampil + statistik; konversi 20% dari 150 vendor aktif = 30 vendor | Rp 2.970.000/bln, margin ±90% = Rp 2.673.000/bln; setara 6,1 booking | 102 booking | 170 booking | Vendor kecil menolak biaya tetap; butuh bukti nilai sebelum menagih |
| **O3 — Iklan/prioritas tampil** | 20 slot (10/kabupaten × 2 kabupaten) Rp 150.000/bln | Rp 3.000.000/bln, margin ±95% = Rp 2.850.000/bln; setara 6,5 booking | 101 booking | 170 booking | Mengaburkan peringkat organik; perlu label "berbayar" agar tidak menipu pelanggan |

Urutan eksekusi yang disarankan: O3 lebih dulu (tidak mengubah harga transaksi), lalu O2 setelah ada data performa vendor, dan O1 hanya jika data bypass ≤10% dan churn vendor ≤5%/bln. O1 tidak dijalankan bersamaan dengan pengurangan insentif onboarding karena keduanya menekan supply pada saat yang sama.

### 5.10 Aturan Harga dan Biaya

| Aturan | Ketetapan | Konsekuensi |
|---|---|---|
| Range komisi | 8–12% untuk bagian nilai transaksi sampai Rp 10 jt; di luar range butuh persetujuan PO + Finance | Mencegah perang harga antarwilayah |
| Komisi bertingkat (D-17) | Lantai Rp 25.000/booking; 10% sampai Rp 10 jt; 5% di atas Rp 10 jt; batas absolut Rp 7.500.000/booking | Transaksi kecil tetap ekonomis; transaksi tarling tidak memicu bypass |
| Batas absolut komisi | Rp 7.500.000/booking; perubahan butuh persetujuan PO + Finance + kajian churn | Menjaga daya terima vendor pada transaksi bernilai tinggi |
| Perubahan tarif | Berlaku hanya untuk booking baru (`policy_versions`) | Tidak ada penagihan retroaktif |
| Biaya layanan pelanggan | Ditampilkan terpisah sebelum pembayaran, tidak boleh disamarkan ke harga paket | Kepatuhan perlindungan konsumen dan kepercayaan |
| Transport | Pass-through, komisi 0%, wajib disetujui pelanggan sebelum bayar | Tidak membebani vendor untuk jarak |
| Refund | Mengikuti kebijakan berjenjang; biaya gateway ditanggung pihak pembatal (D-03) | Platform hanya menyerap bila vendor membatalkan |
| Force majeure | Reschedule tanpa penalti bila kedua pihak setuju ≤7 hari; biaya gateway ditanggung platform | Biaya dibatasi, wajib persetujuan admin |
| Promo | Dibiayai platform, bukan dipotong dari payout vendor; kuota dan masa berlaku mengikat | Margin turun terukur, vendor tidak dirugikan |
| Batas biaya layanan | Maksimum 1,5% sampai ada bukti elastisitas harga | Mencegah penurunan konversi tanpa data |

### 5.11 Guardrail Ekonomi

| Guardrail | Ambang | Tindakan Bila Dilanggar |
|---|---|---|
| CM/booking | ≥ Rp 400.000 (setelah promo) | Tinjau promo dan biaya gateway; hentikan promo non-terukur |
| Take rate efektif | ≥ 10,4% untuk transaksi < Rp 10 jt; ≥ 5,5% untuk transaksi ≥ Rp 10 jt | Evaluasi kebocoran diskon dan komisi manual. Ambang agregat tidak dipakai karena bauran tarling menurunkan rata-rata secara sah (5.12) |
| Biaya akuisisi vendor | ≤ Rp 250.000 | Ubah bauran kanal; kurangi kunjungan berulang |
| Rasio biaya CS | ≤ Rp 25.000/booking | Tambah self-service atau perbaiki UX |
| Nilai refund | ≤ 8% GMV | Audit kebijakan pembatalan dan kualitas supply |
| Payout gagal | ≤ 0,5% | Hentikan payout otomatis, audit rekening |

### 5.12 Validasi Harga Pasar (Riset Sekunder, 21 Okt 2026)

Status: **[RISET SEKUNDER]** — harga publik dari media dan daftar harga vendor, bukan survei terkontrol. Wajib dikonfirmasi lewat minimal 30 wawancara vendor pada M0 sebelum dipakai untuk penetapan tarif final.

| Segmen | Rentang harga publik | Sumber | Waktu Data |
|---|---|---|---|
| Sewa sound system saja (1.000–5.000 W, termasuk operator) | Rp 750.000 – Rp 2.250.000 | Daftar harga Aris Item Cirebon | Jan 2025 |
| Organ tunggal + sound 1 penyanyi (1.000–4.000 W) | Rp 3.000.000 – Rp 4.500.000 | Daftar harga H3Pro Music & Sound | — |
| Organ tunggal mapan, satu hari-semalam | Rp 11.000.000 – Rp 15.000.000 | Jejak Kata, wawancara pimpinan Tunggal Nada (Cirebon) | Jul 2025 |
| Seni tradisi (berokan, jaran cecek) per tanggap | ± Rp 5.000.000 | Detik Jabar, wawancara sanggar | 2023 |
| Tarling dangdut menengah (10.00–24.00) | Rp 40.000.000 – Rp 50.000.000 | Jejak Kata, Anica Nada (Cirebon) | Jul 2025 |
| Tarling papan atas | Ratusan juta rupiah | Jejak Kata, Dian Prima | Jul 2025 |
| Tarling all-in minimum (3–5 penyanyi, 5 kru, 5–7 pemain) | ± Rp 40.000.000 | Vibrasi.co, wawancara Aas Rolani (Indramayu) | Agu 2024 |

**Temuan yang mengubah D-02:**

1. **AOV Rp 4.000.000 bukan rata-rata pasar, melainkan hanya segmen bawah.** Nilai itu valid untuk Pendukung Acara dan organ tunggal kelas bawah. Untuk Tarling, nilai transaksi 10–12× lebih besar. Menyamakan keduanya membuat GMV, kebutuhan kapasitas, dan risiko sengketa salah di kedua arah.
2. **Komisi persentase datar gagal di dua ujung sekaligus.** Pada tarling Rp 40 jt, komisi 10% = Rp 4 jt — beban yang dirasakan vendor sangat besar dan menjadi pemicu bypass terkuat (R-03). Pada sound Rp 750 rb, komisi 10% = Rp 75 rb, sementara gateway fee 1,5% + disbursement + COGS menyerap sebagian besar sisanya.
3. **Beban komisi naik linear terhadap nilai transaksi, sedangkan manfaat platform relatif tetap.** Karena itu tarif harus bertingkat, bukan datar.
4. **Biaya sengketa juga naik mengikuti nilai transaksi.** Satu sengketa tarling senilai Rp 40 jt setara 10 sengketa organ tunggal dalam hal eksposur finansial dan waktu penanganan admin, sehingga playbook sengketa wajib membedakan jalur nilai tinggi.

**Keputusan turunan — D-17 (komisi bertingkat):**
- Lantai komisi Rp 25.000/booking, agar transaksi kecil tidak merugi.
- 10% untuk bagian nilai transaksi sampai Rp 10.000.000.
- 5% untuk bagian nilai transaksi di atas Rp 10.000.000.
- Batas absolut Rp 7.500.000/booking (tercapai pada nilai transaksi ± Rp 140 jt).
- Biaya layanan pelanggan tetap 1% dan ditampilkan terpisah.

**Dampak pada pendapatan per 100 booking (ilustrasi bauran):**

| Bauran | GMV | Komisi | Biaya layanan 1% | Pendapatan platform | Take rate efektif |
|---|---|---|---|---|---|
| A — pilot: organ kecil + pendukung, AOV Rp 4 jt | Rp 400 jt | Rp 40,0 jt | Rp 4,0 jt | Rp 44,0 jt | 11,0% |
| B — 20 tarling Rp 40 jt + 80 transaksi Rp 4 jt | Rp 1.120 jt | Rp 82,0 jt | Rp 11,2 jt | Rp 93,2 jt | 8,3% |
| C — 50 tarling Rp 40 jt + 50 transaksi Rp 4 jt | Rp 2.200 jt | Rp 145,0 jt | Rp 22,0 jt | Rp 167,0 jt | 7,6% |

Catatan: pada bauran C, take rate turun tetapi pendapatan absolut naik 3,8× dibanding bauran A. Karena itu **guardrail take rate harus dibaca per kategori**, bukan agregat (lihat 5.11).

**Konsekuensi strategis yang mengikat:**
- **Target supply pilot adalah organ tunggal menengah (Rp 3–15 jt) dan pendukung acara, bukan tarling papan atas.** Tarling papan atas sudah penuh jadwal dan tidak punya masalah permintaan, sehingga tidak akan membayar komisi.
- **Tarling menengah (Rp 40–50 jt) tetap masuk katalog**, tetapi dengan tarif bertingkat dan penanganan sengketa jalur nilai tinggi.
- **Segmen paling rentan adalah transaksi < Rp 1 jt** (sound kecil). Di segmen ini komisi 10% tidak menutup biaya; lantai Rp 25.000 dan dorongan bundling ("sound + MC") adalah jalan keluarnya.

## 6. Ruang Lingkup per Fase

### 6.1 Ringkasan Fase

| Fase | Nama | Fokus Bisnis | Durasi | Hasil yang Diikat |
|---|---|---|---|---|
| 1 | Booking yang Mengikat | Katalog terverifikasi, kalender jujur, permintaan booking, DP via gateway, rilis manual, notifikasi WA/push | 10 minggu | Booking menghasilkan uang dan jadwal terkunci |
| 2 | Uang Otomatis dan Kepercayaan | Escrow otomatis, saldo + payout, refund, chat, ulasan, sengketa, clawback, promo | 10 minggu | Siklus uang berjalan tanpa intervensi harian |
| 3 | Operasional Vendor dan Wawasan | Dashboard vendor, anggota/kru, rider, laporan, lencana, analitik admin | 8 minggu | Vendor dapat mengelola bisnis; admin dapat mengelola kohort |
| 4 | Pertumbuhan dan Ekosistem | Rekomendasi, paket kombinasi, loyalitas, kemitraan desa, ekspansi wilayah, API mitra | 8 minggu | Pertumbuhan tanpa menambah biaya manual per transaksi |

### 6.2 Fase 1 — Booking yang Mengikat

**Tujuan:** penyelenggara menemukan vendor yang tersedia, mengirim permintaan booking yang direspons dalam batas waktu, membayar DP melalui gateway, dan dana dirilis ke vendor setelah bukti acara selesai — dengan dana tidak pernah berada di rekening platform (D-01). Rilis dana dilakukan manual oleh `admin_finance` dengan maker-checker (D-14).

**Fitur dan Requirement**

| Domain | Fitur | FR | Prioritas |
|---|---|---|---|
| Akun | OTP dengan rate limit, pilih peran, consent kebijakan, hapus akun | FR-001, FR-002, FR-100, FR-101, FR-103 | Must |
| Multi-entitas | Satu akun mengelola beberapa vendor | FR-102 | Must |
| Vendor | Pengajuan verifikasi, keputusan admin, profil, paket, multi-kategori | FR-003, FR-004, FR-010, FR-011, FR-106 | Must |
| Rekening | Verifikasi rekening tujuan payout, ganti rekening dengan cooling period | FR-104, FR-105 | Must |
| Media | Moderasi sebelum tayang, pernyataan lisensi konten | FR-107, FR-140 | Must |
| Katalog | Pencarian, filter tanggal/lokasi/harga, detail vendor, hanya yang tersedia | FR-012, FR-013, FR-014 | Must |
| Kalender | Tiga status termasuk "belum diisi", kunci otomatis, anti double booking, job offline, multi-sesi | FR-020, FR-021, FR-022, FR-023, FR-108 (Must); FR-024 (Should) | Must (FR-024 Should) |
| Harga | Aturan harga musiman, tampilan "mulai dari", harga final saat accept | FR-109, FR-110 | Must |
| Booking | Form booking, respons vendor (app/WA/telepon), expiry otomatis, snapshot syarat, idempotensi | FR-030, FR-031, FR-032, FR-111, FR-112, FR-114, FR-115 | Must |
| Pembayaran | DP, pelunasan, komisi otomatis, penahanan di PJP, refund manual terarah, invoice | FR-040, FR-041, FR-042, FR-043, FR-044, FR-133 (Must); FR-046 (Should) | Must (FR-046 Should) |
| Penyelesaian | Auto-complete H+3, jendela sengketa H+7, penanganan no-show | FR-118, FR-119 | Must |
| Notifikasi | Push status, pengingat WA H-7/H-1/hari-H | FR-051 (Must); FR-052 (Should) | Must (FR-052 Should) |
| Kepercayaan | Laporkan konten/pengguna | FR-123 | Must |
| Admin | Panel dasar, moderasi, pengaturan komisi/DP/wilayah, audit log, 2FA + maker-checker, pemisahan peran, policy versions, rekonsiliasi harian, suspend vendor | FR-070, FR-071, FR-073, FR-075, FR-125, FR-127, FR-128, FR-129, FR-130, FR-131, FR-132 | Must |
| Pendukung | Transport otomatis (pass-through), favorit | FR-033, FR-015 | Should |

**Acceptance Criteria Fase 1 (seluruh FR Must)**

| FR | AC Terukur |
|---|---|
| FR-001 | Registrasi + OTP selesai ≤2 menit (p95, uji 30 pengguna); verifikasi OTP sukses ≥95% |
| FR-002 | Setiap akun baru memiliki tepat 1 peran aktif; pemilihan peran mengarah ke 2 alur berbeda dan 0 akun tanpa peran |
| FR-003 | Pengajuan vendor tidak dapat dikirim jika KTP, media, atau rekening belum lengkap (validasi 100%) |
| FR-004 | Keputusan admin ≤2 hari kerja; 100% keputusan memiliki alasan dan tercatat di audit log |
| FR-010 | Profil tayang ≤2 menit setelah approve; memuat ≥1 media approved dan ≥1 area layanan |
| FR-011 | Paket dapat dibuat/diubah; harga pada detail vendor dan form booking identik pada 100 sampel (0 selisih) |
| FR-012 | Pencarian mengembalikan hasil ≤800 ms p95; filter tanggal, lokasi, dan harga akurat pada 50 kasus uji |
| FR-013 | Detail memuat paket, portofolio, dan status ketersediaan tanggal terpilih pada 100% tampilan |
| FR-014 | 0 vendor berstatus terpesan/diblokir muncul pada hasil untuk tanggal terpilih (uji 100 kombinasi) |
| FR-020 | Perubahan kalender tercermin di pencarian ≤60 detik; 3 status dapat dibedakan pada 100% tanggal |
| FR-021 | Booking accepted mengunci tanggal; upaya booking kedua pada tanggal sama ditolak 100% |
| FR-022 | Uji 50 request paralel pada slot sama menghasilkan tepat 1 booking aktif, 0 slot ganda |
| FR-023 | Job offline dapat ditambahkan ≤30 detik dan langsung memblokir tanggal di pencarian |
| FR-030 | Form booking terkirim ≤900 ms p95; tanggal, lokasi, paket, dan estimasi harga tersimpan utuh pada 100% kasus |
| FR-031 | Respons vendor tercatat ≤1 menit setelah aksi; deadline 24 jam terlihat pada 100% booking masuk |
| FR-032 | Booking tanpa respons berubah expired ≤5 menit setelah deadline dan slot dilepas 100% |
| FR-040 | DP dapat dibayar via QRIS/VA/e-wallet; status terupdate ≤60 detik setelah webhook; 0 pembayaran ganda pada 100 retry |
| FR-041 | Sisa tagihan setelah pelunasan = Rp 0 pada 100% booking; pengingat terkirim H-7 dan H-1 |
| FR-042 | 0% dana masuk rekening platform; rilis hanya dieksekusi setelah approver kedua menyetujui bukti selesai |
| FR-043 | Komisi terpotong sesuai tarif berlaku pada 100% booking; invoice komisi terbit otomatis |
| FR-044 | 6 skenario pembatalan uji menghasilkan nominal refund yang benar 100% sesuai kebijakan versi booking |
| FR-051 | Push terkirim ≤60 detik untuk 6 perubahan status utama; delivery rate ≥95% |
| FR-070 | Admin dapat mencari dan mengubah status vendor/booking; 0 aksi tanpa jejak audit |
| FR-071 | 0 media tampil sebelum disetujui; antrean moderasi dapat diselesaikan ≤1×24 jam per item |
| FR-073 | Perubahan komisi/DP/wilayah hanya berlaku untuk booking baru (0 efek pada 20 booking uji) |
| FR-075 | 100% aksi admin tercatat; percobaan ubah/hapus entri log ditolak 100% |
| FR-100 | Percobaan OTP ke-6 per nomor dalam 1 jam ditolak; biaya OTP ≤Rp 1.000/booking pada uji 1.000 permintaan/jam |
| FR-101 | Permintaan hapus akun selesai ≤30 hari; data pribadi dianonimkan dan status terlihat di aplikasi |
| FR-102 | Satu akun dapat mengelola ≥2 vendor dengan pemisahan data dan rekening 100% |
| FR-103 | Registrasi mencatat versi ToS dan Kebijakan Privasi; tanpa persetujuan, pendaftaran tidak dapat dilanjutkan |
| FR-104 | Rilis dana diblokir 100% sampai nama rekening cocok dengan identitas vendor atau diverifikasi manual `admin_finance` |
| FR-105 | Perubahan rekening memicu cooling 7 hari, pemblokiran rilis, dan notifikasi ke nomor lama; 0 rilis ke rekening baru sebelum 7 hari |
| FR-106 | Vendor tampil pada setiap kategori yang dipilih dan dapat difilter pada tiap kategori (100% uji) |
| FR-107 | 0 media tayang tanpa status approved; SLA moderasi ≤1×24 jam terpenuhi ≥90% |
| FR-108 | Tanggal tanpa data berlabel "belum diisi" dan tidak dianggap tersedia; 0 tanggal tanpa status muncul sebagai hasil tersedia |
| FR-109 | Aturan harga musiman dapat ditetapkan per rentang tanggal; harga booking memakai aturan tertinggi yang berlaku dan tercatat pada snapshot |
| FR-110 | Kartu vendor menampilkan "mulai dari Rp X"; harga final terkunci saat accept dan tidak berubah setelah DP pada 100% booking |
| FR-111 | Template WA dengan tombol Terima/Tolak; respons tercatat ≤60 detik setelah webhook; token berlaku sekali pakai (uji 100 penggunaan ulang ditolak) |
| FR-112 | Jika tidak ada respons WA dalam 4 jam, agen dihubungi sistem; respons telepon tercatat atas nama vendor dengan jejak audit |
| FR-114 | Setiap booking menyimpan versi ToS, kebijakan refund, dan syarat pembatalan; perubahan kebijakan baru tidak mengubah 100% booking lama |
| FR-115 | 100 request paralel dengan Idempotency-Key sama menghasilkan 1 booking dan 0 duplikasi pembayaran |
| FR-118 | Booking menjadi completed otomatis H+3 tanpa sengketa; jendela sengketa tetap terbuka sampai H+7; notifikasi terkirim 100% |
| FR-119 | Penandaan no-show tersedia pada hari-H; kasus masuk antrean prioritas ≤2 jam dan refund diputuskan ≤3 hari kerja |
| FR-123 | Pelaporan selesai ≤3 klik; tiket otomatis dibuat; tinjauan ≤1×24 jam dan pelapor menerima status |
| FR-125 | Wilayah dapat diaktifkan/dinonaktifkan tanpa rilis kode; vendor di wilayah nonaktif tidak muncul pada pencarian |
| FR-127 | 100% aksi finansial admin tercatat (aktor, sebelum/sesudah, IP, waktu); log tidak dapat diubah; retensi ≥5 tahun |
| FR-128 | Refund/payout >Rp 1.000.000 memerlukan 2 approver berbeda; 0 eksekusi tanpa approval pada uji 20 kasus |
| FR-129 | `admin_support` tidak dapat menyetujui refund; 100% percobaan ditolak dan tercatat |
| FR-130 | Publikasi kebijakan menghasilkan versi baru dengan tanggal berlaku; booking lama tetap memakai snapshot |
| FR-131 | Rekonsiliasi harian selesai ≤09.00 WIB; selisih >Rp 1 tercatat sebagai temuan dengan tiket |
| FR-132 | Suspend menyembunyikan listing ≤1 menit dan membekukan payout; seluruh booking aktif ditandai untuk tindak lanjut |
| FR-133 | Refund manual memerlukan alasan, bukti, dan approver kedua; status refund terlihat pelanggan ≤1 jam |
| FR-140 | Vendor wajib menyatakan kepemilikan/lisensi setiap media; media tanpa pernyataan tidak dapat diajukan (100%) |

**Acceptance Criteria tambahan (Should Fase 1)**

- [ ] FR-052: pengingat WA H-7, H-1, dan hari-H terkirim ≥95% tepat jadwal.
- [ ] FR-033: biaya transport dihitung dari jarak dan disetujui pelanggan sebelum pembayaran; 0 tagihan transport setelah DP.
- [ ] FR-015: favorit tersimpan dan muncul di profil pada 100% percobaan.
- [ ] FR-024: booking multi-sesi dalam satu hari tidak saling mengunci slot yang berbeda.
- [ ] FR-046: invoice dapat diunduh dan totalnya sama dengan pembayaran (0 selisih).
- [ ] FR-143: ≥90% penolakan booking memakai alasan terstruktur; laporan alasan tersedia mingguan.
- [ ] FR-137: notifikasi perubahan kebijakan terkirim ≥14 hari sebelum berlaku.

**Di luar cakupan Fase 1:** chat dalam aplikasi, ulasan, sengketa formal, saldo dan penarikan mandiri, refund otomatis, promo, event multi-vendor, laporan ekspor vendor.

**Go/No-Go Gate Fase 1 → Fase 2**

| Kriteria | Ambang | Sumber Data |
|---|---|---|
| Vendor terverifikasi | ≥40 (≥15 per kabupaten pilot, ≥3 per kategori) | Admin |
| Vendor dengan rekening terverifikasi | 100% dari vendor tayang | Admin |
| Permintaan booking terkirim | ≥100 dalam 60 hari | Analytics |
| Response rate ≤24 jam | ≥80% (minimum Gate; target hipotesis 85%) | Analytics |
| Median waktu accept | ≤6 jam | Analytics |
| Konversi accepted → DP paid | ≥50% (minimum Gate; target hipotesis 60%) | Payments |
| Insiden dana keluar tanpa maker-checker | 0 | Audit log |
| Double booking | 0 | Basis data |
| Crash-free rate | ≥99,5% (7 hari) | Crashlytics |
| p95 booking create | ≤900 ms | APM |
| Tiket CS per booking | ≤0,35 | CS |
| Temuan rekonsiliasi belum selesai | 0 pada hari kerja | Finance |

Aturan: gagal pada kriteria dana/audit/double booking = **No-Go mutlak** (perbaikan tanpa menambah scope). Gagal pada kriteria volume = perpanjangan 2 minggu, lalu evaluasi ulang; bila tetap gagal, kurangi target Fase 2 (tunda promo dan multi-vendor) dan jangan menambah tim.

### 6.3 Fase 2 — Uang Otomatis dan Kepercayaan

**Tujuan:** mengubah rilis manual menjadi siklus otomatis yang dapat diaudit: escrow berbasis PJP, saldo dan penarikan vendor, refund otomatis, chat, ulasan, sengketa, klaim pasca-pencairan, serta event multi-vendor untuk panitia (P2). Fase ini **tidak** memperkenalkan mekanisme dana baru; ia mengotomasi mekanisme yang sudah live di Fase 1.

**Fitur dan Requirement**

| Domain | Fitur | FR | Prioritas |
|---|---|---|---|
| Payout | Saldo tersedia/tertunda, penarikan ke rekening terverifikasi, riwayat payout | FR-045 | Must |
| Escrow | Rilis otomatis setelah completed + jendela sengketa, pembekuan saat sengketa | FR-042 (lanjutan) | Must |
| Refund | Refund otomatis sesuai kebijakan versi booking | FR-044 (lanjutan) | Must |
| Chat | Chat teks, foto, lokasi; penyaringan kontak | FR-050, FR-135 | Must/Should |
| Ulasan | Ulasan hanya dari booking completed, balasan vendor | FR-053, FR-054 | Must/Should |
| Sengketa | Pengajuan bukti, keputusan admin, banding | FR-056, FR-072 | Must |
| Clawback | Klaim pasca-pencairan ≤30 hari, potong payout berikutnya | FR-122 | Must |
| Event | Parent event multi-vendor, satu ringkasan biaya | FR-113, FR-036 | Must/Should |
| Pengingat | Berjenjang H-30/H-7/H-3/H-1/H+1, eskalasi agen | FR-116 | Must |
| Bukti kehadiran | Check-in GPS + foto + timestamp + radius | FR-117, FR-063 | Must/Should |
| Promo | Kode promo, kuota, batas per akun, dampak ke payout | FR-047, FR-121 | Should |
| Kontrak | PDF ringkasan kesepakatan | FR-035 | Should |
| Add-on | Tambahan durasi/personel/sound | FR-034 | Should |
| Reschedule | Perubahan jadwal dengan persetujuan | FR-037, FR-134 | Should |
| Favorit | Simpan vendor | FR-015 | Should |
| Dashboard | Ringkasan order dan saldo | FR-060 | Should |
| Rider | Kebutuhan teknis terlampir pada booking | FR-062 | Should |
| Admin | Moderasi ulasan, laporan keuangan, ekspor kepatuhan | FR-074, FR-136 | Should |

**Acceptance Criteria Fase 2 (seluruh FR Must)**

| FR | AC Terukur |
|---|---|
| FR-045 | Payout hanya ke rekening berstatus verified; saldo tersedia tidak pernah negatif; payout sukses ≥99,5%; waktu proses ≤1 hari kerja |
| FR-050 | Pesan terkirim ≤2 detik p95; riwayat tersimpan 100%; chat hanya terbuka untuk booking milik pihak terkait (uji 20 akses lintas akun ditolak) |
| FR-053 | 0 ulasan dari booking yang belum completed; 1 ulasan per booking; rating tampil ≤60 detik setelah submit |
| FR-056 | Sengketa dapat diajukan ≤7 hari setelah tanggal acara; status terlihat 100%; pelapor menerima notifikasi setiap perubahan status |
| FR-072 | Keputusan sengketa ≤3 hari kerja pada ≥90% kasus; 100% keputusan memiliki alasan, bukti rujukan, dan approver kedua bila nominal >Rp 1.000.000 |
| FR-113 | Satu event dapat menampung ≥3 booking vendor; DP dihitung per vendor; pembatalan 1 vendor tidak mengubah 2 vendor lain (uji 10 skenario) |
| FR-116 | Pengingat H-30, H-7, H-3, H-1, H+1 terkirim ≥95% tepat jadwal; eskalasi agen berjalan bila kalender belum diperbarui pada H-7 |
| FR-117 | Check-in mencatat GPS, foto, dan timestamp; check-in di luar radius 2 km ditandai "perlu verifikasi"; bukti dapat diakses admin ≤5 menit |
| FR-122 | Klaim pasca-pencairan ≤30 hari menghasilkan pemotongan payout berikutnya atau tagihan; saldo negatif tercatat di ledger; 100% keputusan dengan maker-checker |
| FR-124 | Laporan hak cipta diproses ≤3 hari kerja; konten diturunkan sementara bila ada bukti prima facie; 100% keputusan tercatat di audit log |

**Acceptance Criteria tambahan (Should Fase 2)**

- [ ] FR-121: kuota, masa berlaku, batas per akun, dan larangan stacking divalidasi server; 0 penggunaan melebihi kuota pada 1.000 klaim paralel.
- [ ] FR-047: voucher tidak dapat dipakai pada booking yang sudah dibayar.
- [ ] FR-054: balasan vendor tampil di bawah ulasan ≤60 detik.
- [ ] FR-063: check-in hanya diterima dalam radius yang ditetapkan untuk lokasi acara (uji 20 titik).
- [ ] FR-074: laporan keuangan harian cocok 100% dengan ledger.
- [ ] FR-135: ≥80% pesan yang memuat nomor HP/akun media sosial terdeteksi pada set uji 200 pesan.

**Go/No-Go Gate Fase 2 → Fase 3**

| Kriteria | Ambang | Sumber Data |
|---|---|---|
| Booking completed per bulan | ≥176 (ambang aman 180) | Database |
| GMV per bulan | ≥Rp 700.000.000 | Database |
| Contribution margin per bulan | ≥Rp 76.000.000 | Finance |
| Dispute rate | ≤5% dari booking completed | Dispute |
| Refund rate | ≤8% GMV | Finance |
| Payout sukses | ≥99,5% | Gateway |
| Waktu rilis dana setelah completed | ≤3 hari kerja pada ≥95% booking | Ledger |
| Repeat booking rate | ≥12% dalam 180 hari | Analytics |
| Vendor aktif | ≥120 (≥1 tanggal diperbarui 7 hari terakhir) | Analytics |
| Temuan rekonsiliasi terbuka | 0 | Finance |
| Validasi pajak D-16 | Selesai dan ditandatangani konsultan | Legal/Finance |

Aturan: kriteria pajak dan rekonsiliasi bersifat **blocking**. Bila volume tercapai tetapi pajak belum tervalidasi, Fase 3 tetap ditahan dan fokus dialihkan ke perbaikan operasi, bukan penambahan fitur.

### 6.4 Fase 3 — Operasional Vendor dan Wawasan

**Tujuan:** mengurangi beban manual vendor dan admin: dashboard, anggota/kru, rider, laporan pendapatan yang dapat diekspor, lencana, dan analitik kohort untuk keputusan ekspansi.

**Fitur dan Requirement**

| Domain | Fitur | FR | Prioritas |
|---|---|---|---|
| Dashboard vendor | Order masuk, jadwal, saldo, performa | FR-060 | Should |
| Anggota/kru | Daftar anggota dan penugasan job | FR-061, FR-139 | Could |
| Rider | Kebutuhan listrik, panggung, konsumsi, akomodasi | FR-062 | Should |
| Check-in | Perbaikan akurasi dan penanganan sinyal lemah | FR-063, FR-117 | Should |
| Laporan | Laporan pendapatan bulanan, ekspor CSV/PDF | FR-064, FR-126 | Must/Should |
| Lencana | Terverifikasi, Responsif, Favorit Pantura | FR-055 | Could |
| Reschedule | Alur ubah jadwal dengan persetujuan | FR-037 | Should |
| Analitik admin | GMV, konversi, vendor aktif, area terlaris | FR-074 | Should |
| Kualitas supply | Skor kelengkapan kalender dan pengingat | FR-138 | Should |
| Kapasitas | Batas booking per tanggal per vendor | FR-144 | Should |

**Acceptance Criteria Fase 3 (seluruh FR Must)**

| FR | AC Terukur |
|---|---|
| FR-126 | Ekspor CSV/PDF memuat tanggal, booking, GMV, komisi, payout; total cocok 100% dengan ledger; file siap ≤60 detik untuk 1.000 baris |

**Acceptance Criteria tambahan (Should/Could Fase 3)**

- [ ] FR-060: dashboard memuat ≤2 detik p95 dan menampilkan data ≤5 menit terlambat.
- [ ] FR-064: laporan bulanan tersedia ≤H+1 dan selisih terhadap ledger = Rp 0.
- [ ] FR-061/FR-139: anggota hanya melihat job yang ditugaskan; 0 akses ke saldo/payout.
- [ ] FR-062: rider terkirim ke pelanggan H-7 dan dapat dikonfirmasi.
- [ ] FR-055: lencana hanya diberikan bila ambang terukur terpenuhi (contoh: Responsif = response rate ≥90% dalam 90 hari).
- [ ] FR-138: skor kelengkapan kalender 0–100 tampil dan berkorelasi dengan booking masuk.
- [ ] FR-144: booking melebihi kapasitas harian ditolak 100%.

**Go/No-Go Gate Fase 3 → Fase 4**

| Kriteria | Ambang | Sumber Data |
|---|---|---|
| Booking completed per bulan | ≥250 | Database |
| GMV per bulan | ≥Rp 1.000.000.000 | Database |
| Vendor aktif | ≥180 | Analytics |
| Repeat booking rate | ≥15% | Analytics |
| CAC vendor | ≤Rp 250.000 | Finance |
| Churn vendor | ≤5% per bulan | Analytics |
| Dispute rate | ≤5% | Dispute |
| Beban CS | ≤Rp 25.000/booking | CS/Finance |
| Payout gagal | ≤0,5% | Gateway |
| Margin kontribusi | ≥Rp 109.000.000/bln | Finance |

### 6.5 Fase 4 — Pertumbuhan dan Ekosistem

**Tujuan:** pertumbuhan yang tidak menambah biaya manual per transaksi: rekomendasi, paket kombinasi, loyalitas, kemitraan desa, ekspansi wilayah berbasis konfigurasi, dan API mitra.

**Fitur dan Requirement**

| Domain | Fitur | FR | Prioritas |
|---|---|---|---|
| Akuisisi | Rekomendasi "populer di kecamatan/kabupaten" | FR-017 | Could |
| Perbandingan | Bandingkan hingga 3 vendor | FR-016 | Could |
| Login | Login Google (memerlukan padanan Sign in with Apple) | FR-005 | Could |
| Kalender | Sinkronisasi Google Calendar | FR-025 | Could |
| Promo lanjutan | Kampanye musiman, referral | FR-047, FR-121 | Should |
| Paket kombinasi | Organ + sound + MC + dekor dalam satu event | FR-036, FR-113 | Should |
| Tarif | Biaya layanan per wilayah/kategori | FR-145 | Should |
| Wilayah | Ekspansi kabupaten baru via konfigurasi | FR-125 | Must (kapabilitas sudah ada di Fase 1) |
| Institusi | Akun panitia desa dengan beberapa pengguna | FR-102 | Should |
| Mitra | API untuk EO/pihak ketiga | — | Could |

**Acceptance Criteria Fase 4**

- [ ] Penambahan wilayah baru selesai ≤1 hari kerja tanpa rilis kode dan tanpa perubahan data vendor.
- [ ] Voucher tidak dapat dipakai melebihi kuota, masa berlaku, atau batas per akun (uji 1.000 klaim paralel).
- [ ] Paket kombinasi menampilkan satu harga total dan satu ringkasan biaya; pembatalan satu vendor menghitung ulang total secara benar.
- [ ] Rekomendasi tidak menampilkan vendor nonaktif atau vendor dengan payout gagal berulang.

**Gate ekspansi wilayah (bukan gate fase)**

| Kriteria | Ambang |
|---|---|
| Booking/bln di wilayah existing | ≥250 selama 2 bulan berturut-turut |
| Vendor aktif di wilayah baru | ≥25 sebelum listing dibuka untuk umum |
| Kesediaan agen lapangan | ≥1 agen per 40 vendor aktif |
| Waktu respons CS | Tetap ≤15 menit pada jam layanan |
| Rekonsiliasi | 0 temuan terbuka sebelum ekspansi |

### 6.6 Backlog di Luar Fase

| Item | Alasan Ditahan |
|---|---|
| Penjualan tiket pentas | Model, perizinan, dan risiko berbeda |
| Live streaming acara | Biaya infrastruktur tidak sebanding dengan margin |
| Lelang terbuka harga | Mendorong perang harga dan menurunkan kualitas supply |
| Asuransi pembatalan | Butuh mitra asuransi dan aktuaria |
| Rekening penampung dana sendiri | **BLOCKED** oleh D-01 sampai ada dasar legal |

## 7. Functional Requirements

### 7.1 Requirement Lama (FR-001..FR-075, Dipertahankan)

Kolom "Catatan v1.1" menjelaskan perubahan prioritas/fase (Δ) atau requirement baru yang menutup celah terkait. Seluruh ID lama dipertahankan agar jejak requirement tidak hilang.

#### Akun dan Onboarding

| ID | Requirement | Prioritas | Fase | Catatan v1.1 |
|---|---|---|---|---|
| FR-001 | Pengguna dapat mendaftar/login dengan nomor HP + OTP (WhatsApp/SMS) | Must | 1 | Δ Fase 1 (sama); ditambah rate limit FR-100 |
| FR-002 | Pengguna memilih peran: Penyelenggara atau Vendor | Must | 1 | Δ Peran diperluas D-08; multi-vendor FR-102 |
| FR-003 | Vendor mengajukan verifikasi (KTP pimpinan, foto grup, sampel video/audio, alamat basis) | Must | 1 | Δ Ditambah rekening bank FR-104 |
| FR-004 | Admin dapat menyetujui/menolak verifikasi vendor dengan alasan | Must | 1 | Δ Keputusan wajib beralasan dan teraudit FR-127 |
| FR-005 | Login opsional via Google | Could | 4 | Δ Fase 3 → 4; butuh Sign in with Apple |

#### Katalog dan Pencarian

| ID | Requirement | Prioritas | Fase | Catatan v1.1 |
|---|---|---|---|---|
| FR-010 | Vendor membuat profil: nama, kategori, deskripsi, area layanan, galeri foto, video, audio | Must | 1 | Δ Multi-kategori FR-106; moderasi FR-107 |
| FR-011 | Vendor membuat satu atau lebih paket (durasi, jumlah personel, fasilitas, harga dasar) | Must | 1 | Δ Harga dasar = harga minimum; aturan musiman FR-109 |
| FR-012 | Pelanggan mencari berdasarkan kategori, lokasi acara, tanggal, rentang harga, rating | Must | 1 | Δ Target p95 ≤800 ms (NFR-003) |
| FR-013 | Halaman detail vendor menampilkan paket, portofolio, ulasan, dan status ketersediaan | Must | 1 | Δ Ulasan tampil mulai Fase 2 |
| FR-014 | Hasil pencarian hanya menampilkan vendor yang tersedia di tanggal yang dipilih | Must | 1 | Δ Wajib membedakan "belum diisi" FR-108 |
| FR-015 | Favorit/simpan vendor | Should | 2 | Δ Tidak berubah |
| FR-016 | Bandingkan hingga 3 vendor | Could | 4 | Δ Fase 3 → 4 |
| FR-017 | Rekomendasi "populer di kecamatan/kabupaten Anda" | Could | 4 | Δ Tidak berubah |

#### Kalender dan Ketersediaan

| ID | Requirement | Prioritas | Fase | Catatan v1.1 |
|---|---|---|---|---|
| FR-020 | Vendor mengelola kalender: tersedia / diblokir / sudah dipesan | Must | 1 | Δ Tiga status + "belum diisi" (D-10) |
| FR-021 | Booking yang disetujui otomatis mengunci tanggal pada kalender vendor | Must | 1 | Δ Berlaku sejak accept, bukan sejak DP |
| FR-022 | Sistem mencegah double booking pada slot yang sama | Must | 1 | Δ Diuji konkurensi 50 request |
| FR-023 | Vendor dapat memasukkan job offline agar kalender tetap sinkron | Must | 1 | Δ Tidak berubah |
| FR-024 | Mendukung beberapa sesi dalam sehari (siang / malam / penuh) | Should | 1 | Δ Fase 2 → 1 (`booking_slots`) |
| FR-025 | Sinkronisasi ke Google Calendar | Could | 4 | Δ Tidak berubah |

#### Booking

| ID | Requirement | Prioritas | Fase | Catatan v1.1 |
|---|---|---|---|---|
| FR-030 | Pelanggan mengirim permintaan booking: tanggal, jam, lokasi, jenis acara, estimasi tamu, catatan | Must | 1 | Δ Wajib Idempotency-Key FR-115 |
| FR-031 | Vendor menerima/menolak/menawar balik dalam batas waktu (24 jam) | Must | 1 | Δ Kanal WA FR-111, fallback agen FR-112 |
| FR-032 | Booking kedaluwarsa otomatis jika vendor tidak merespons | Must | 1 | Δ Tidak berubah |
| FR-033 | Biaya transport dihitung otomatis berdasarkan jarak dari basis vendor | Should | 1 | Δ Fase 2 → 1; pass-through komisi 0% |
| FR-034 | Add-on paket (tambah durasi, penyanyi, sound tambahan) | Should | 2 | Δ Tidak berubah |
| FR-035 | Kontrak/ringkasan kesepakatan digital (PDF) otomatis dibuat | Should | 2 | Δ Ditambah snapshot syarat FR-114 |
| FR-036 | Pesanan multi-vendor dalam satu acara | Should | 2 | Δ Fase 3 → 2; parent event FR-113 |
| FR-037 | Pelanggan dapat mengajukan perubahan jadwal (reschedule) | Should | 2 | Δ Fase 3 → 2 |

#### Pembayaran

| ID | Requirement | Prioritas | Fase | Catatan v1.1 |
|---|---|---|---|---|
| FR-040 | Pelanggan membayar DP via QRIS, VA bank, e-wallet | Must | 1 | Δ Fase 2 → 1; DP 30%; batas bayar 24 jam / 48 jam untuk ≥ Rp 10 jt (D-18) |
| FR-041 | Pelanggan membayar pelunasan sebelum/sesudah acara sesuai kebijakan | Must | 1 | Δ Fase 2 → 1 |
| FR-042 | Dana ditahan dan dicairkan setelah acara terkonfirmasi selesai | Must | 1 | Δ Dana ditahan PJP (D-01), rilis manual Fase 1 |
| FR-043 | Platform memotong komisi otomatis | Must | 1 | Δ Fase 2 → 1 |
| FR-044 | Kebijakan pembatalan dan refund otomatis sesuai aturan | Must | 1 | Δ Fase 1 manual terarah FR-133; otomatis Fase 2 |
| FR-045 | Vendor menarik saldo ke rekening bank (payout) | Must | 2 | Δ Fase 1: rilis per booking oleh admin; Fase 2: saldo + penarikan |
| FR-046 | Invoice dan bukti pembayaran dapat diunduh/dibagikan | Should | 1 | Δ Fase 2 → 1 |
| FR-047 | Voucher/kode promo | Should | 2 | Δ Fase 4 → 2; mesin promo FR-121 |

#### Komunikasi dan Kepercayaan

| ID | Requirement | Prioritas | Fase | Catatan v1.1 |
|---|---|---|---|---|
| FR-050 | Chat dalam aplikasi antara pelanggan dan vendor (teks, foto, lokasi) | Must | 2 | Δ Tidak berubah; penyaringan kontak FR-135 |
| FR-051 | Push notification untuk setiap perubahan status booking | Must | 1 | Δ Tidak berubah |
| FR-052 | Notifikasi/pengingat via WhatsApp (H-7, H-1, hari-H) | Should | 1 | Δ Fase 2 → 1; berjenjang FR-116 |
| FR-053 | Ulasan dan rating hanya dari pelanggan yang menyelesaikan booking | Must | 2 | Δ Tidak berubah |
| FR-054 | Vendor dapat membalas ulasan | Should | 2 | Δ Fase 3 → 2 |
| FR-055 | Lencana vendor: Terverifikasi, Responsif, Favorit Pantura | Could | 3 | Δ Tidak berubah |
| FR-056 | Laporkan vendor/pengguna dan ajukan sengketa | Must | 2 | Δ Laporan konten Fase 1 lewat FR-123; sengketa Fase 2 |

#### Operasional Vendor

| ID | Requirement | Prioritas | Fase | Catatan v1.1 |
|---|---|---|---|---|
| FR-060 | Dashboard vendor: order masuk, jadwal, saldo, performa | Should | 3 | Δ Tidak berubah |
| FR-061 | Manajemen anggota grup dan penugasan ke job | Could | 3 | Δ Akses dibatasi FR-139 |
| FR-062 | Rider teknis digital yang terlampir pada booking | Should | 2 | Δ Fase 3 → 2 (informasi dibutuhkan sebelum hari-H) |
| FR-063 | Check-in lokasi pada hari-H (GPS) sebagai bukti kehadiran | Should | 2 | Δ Fase 3 → 2; bukti foto FR-117 |
| FR-064 | Laporan pendapatan bulanan | Should | 3 | Δ Ekspor FR-126 |

#### Admin

| ID | Requirement | Prioritas | Fase | Catatan v1.1 |
|---|---|---|---|---|
| FR-070 | Panel admin web: kelola pengguna, vendor, kategori, booking | Must | 1 | Δ Tidak berubah |
| FR-071 | Moderasi konten (foto, video, ulasan) | Must | 1 | Δ Fase 2 → 1; moderasi pra-tayang FR-107 |
| FR-072 | Penanganan sengketa dan keputusan refund/pencairan | Must | 2 | Δ Termasuk klaim pasca-pencairan FR-122 |
| FR-073 | Pengaturan komisi, kebijakan DP, dan wilayah layanan | Must | 1 | Δ Fase 2 → 1; policy versions FR-130 |
| FR-074 | Laporan keuangan dan analitik platform | Should | 2 | Δ Fase 3 → 2 |
| FR-075 | Audit log aksi admin | Must | 1 | Δ Should/Fase 3 → Must/Fase 1 (D-14); append-only FR-127 |

### 7.2 Requirement Baru (FR-100..FR-145)

Setiap baris memuat AC ringkas yang terukur; AC lengkap per fase ada di Bagian 6.

#### Identitas, Akun, dan Keamanan

| ID | Requirement | Prioritas | Fase | AC Ringkas |
|---|---|---|---|---|
| FR-100 | Permintaan OTP dibatasi per nomor, per IP, dan per perangkat; verifikasi dibatasi jumlah percobaan; deteksi nomor virtual dan lonjakan (anti SMS-pumping) | Must | 1 | Percobaan ke-6 per nomor dalam 1 jam ditolak; biaya OTP ≤Rp 1.000/booking pada 1.000 permintaan/jam |
| FR-101 | Pengguna dapat menghapus akun langsung dari aplikasi; data pribadi dianonimkan, data transaksi dipertahankan sesuai kewajiban | Must | 1 | Permintaan diproses ≤30 hari; status terlihat di aplikasi; 0 data pribadi tersisa pada profil publik |
| FR-102 | Satu akun dapat memiliki/mengelola lebih dari satu vendor dengan data, rekening, dan payout terpisah | Must | 1 | ≥2 vendor pada 1 akun berjalan dengan pemisahan data 100% |
| FR-103 | Persetujuan Syarat & Ketentuan serta Kebijakan Privasi dicatat dengan versi dan waktu | Must | 1 | Tanpa persetujuan, pendaftaran tidak dapat dilanjutkan; versi tersimpan pada 100% akun |
| FR-140 | Vendor menyatakan kepemilikan atau lisensi setiap media yang diunggah, disertai indemnitas | Must | 1 | Media tanpa pernyataan tidak dapat diajukan (100%); pernyataan tersimpan dengan timestamp |

#### Vendor, Rekening, dan Katalog

| ID | Requirement | Prioritas | Fase | AC Ringkas |
|---|---|---|---|---|
| FR-104 | Rekening bank vendor diverifikasi: nama pemilik cocok dengan identitas vendor, rekening aktif, dan tercatat sebagai satu-satunya tujuan payout | Must | 1 | Rilis dana diblokir 100% sampai rekening berstatus verified |
| FR-105 | Perubahan rekening bank memicu cooling period 7 hari, pemblokiran rilis, dan notifikasi ke nomor lama | Must | 1 | 0 rilis ke rekening baru sebelum 7 hari; notifikasi terkirim 100% |
| FR-106 | Vendor dapat terdaftar pada lebih dari satu kategori dan tampil pada setiap kategori yang dipilih | Must | 1 | Filter per kategori mengembalikan vendor pada 100% kategori terpilih |
| FR-107 | Media vendor (foto, video, audio) dimoderasi sebelum tayang | Must | 1 | 0 media tayang tanpa status approved; SLA ≤1×24 jam pada ≥90% item |
| FR-108 | Kalender membedakan "belum diisi" dan "eksplisit tersedia", dengan pencatatan waktu pembaruan terakhir | Must | 1 | Tanggal "belum diisi" tidak pernah tampil sebagai tersedia (100% uji) |
| FR-109 | Vendor/admin dapat menetapkan aturan harga musiman (rentang tanggal, hari raya, akhir pekan, kategori) | Must | 1 | Harga booking memakai aturan tertinggi yang berlaku dan tercatat pada snapshot |
| FR-110 | Halaman vendor menampilkan harga "mulai dari"; harga final dikonfirmasi saat accept dan terkunci setelah DP | Must | 1 | 0 perubahan harga setelah DP pada 100% booking |
| FR-125 | Admin dapat menambah, mengaktifkan, dan menonaktifkan wilayah layanan tanpa rilis kode | Must | 1 | Perubahan berlaku ≤5 menit; vendor di wilayah nonaktif hilang dari pencarian 100% |
| FR-132 | Admin dapat menangguhkan (suspend) vendor, menyembunyikan listing, membekukan payout, dan menandai booking aktif | Must | 1 | Listing hilang ≤1 menit; payout beku 100%; booking aktif masuk daftar tindak lanjut |

#### Booking dan Respons

| ID | Requirement | Prioritas | Fase | AC Ringkas |
|---|---|---|---|---|
| FR-111 | Vendor menerima/menolak booking melalui WhatsApp interactive template dengan token sekali pakai | Must | 1 | Respons tercatat ≤60 detik setelah webhook; token bekas ditolak 100% |
| FR-112 | Bila vendor tidak merespons WA dalam 4 jam, agen menelepon dan mencatat respons atas nama vendor | Must | 1 | Respons telepon tercatat dengan identitas agen dan waktu; 100% tercatat di audit |
| FR-114 | Setiap booking menyimpan snapshot syarat layanan, kebijakan refund, dan kebijakan pembatalan yang berlaku | Must | 1 | Perubahan kebijakan tidak mengubah 100% booking lama |
| FR-115 | Semua POST kritis (booking, respond, payment, payout, dispute) wajib Idempotency-Key | Must | 1 | 100 request paralel dengan key sama menghasilkan 1 transaksi |
| FR-113 | Satu acara dapat berupa parent event yang menampung beberapa booking vendor | Must | 2 | ≥3 vendor per event; pembatalan 1 vendor tidak mengubah vendor lain (10 skenario) |
| FR-116 | Pengingat otomatis berjenjang (H-30, H-7, H-3, H-1, H+1) dengan eskalasi ke agen bila kalender belum diperbarui | Must | 2 | ≥95% terkirim tepat jadwal; eskalasi H-7 berjalan 100% |
| FR-117 | Check-in hari-H mencatat GPS, foto, dan timestamp; check-in di luar radius ditandai untuk verifikasi | Must | 2 | Bukti dapat diakses admin ≤5 menit; 100% check-in di luar 2 km ditandai |
| FR-118 | Booking selesai otomatis H+3 bila tidak ada sengketa, dengan jendela sengketa sampai H+7 | Must | 1 | Auto-complete berjalan 100%; jendela sengketa tetap terbuka sampai H+7 |
| FR-119 | Penanganan no-show: pelanggan menandai, sistem mengumpulkan bukti, kasus masuk antrean prioritas | Must | 1 | Masuk antrean ≤2 jam; keputusan refund ≤3 hari kerja |
| FR-143 | Alasan penolakan booking menggunakan daftar terstruktur (tanggal terisi, di luar radius, harga, kapasitas, lain-lain) | Should | 1 | ≥90% penolakan memakai alasan terstruktur; laporan mingguan tersedia |
| FR-144 | Vendor dapat menetapkan kapasitas maksimum booking per tanggal | Should | 2 | Booking melebihi kapasitas ditolak 100% |

#### Uang, Sengketa, dan Kepatuhan

| ID | Requirement | Prioritas | Fase | AC Ringkas |
|---|---|---|---|---|
| FR-122 | Sengketa pasca-pencairan (clawback): klaim ≤30 hari, pemotongan payout berikutnya atau tagihan, saldo negatif tercatat | Must | 2 | 100% keputusan dengan maker-checker; saldo negatif tercatat di ledger |
| FR-124 | Alur takedown hak cipta: laporan, verifikasi bukti, penurunan konten, banding | Must | 2 | Laporan diproses ≤3 hari kerja; konten diturunkan sementara bila bukti prima facie |
| FR-123 | Pengguna dapat melaporkan konten, pesan, atau vendor dari dalam aplikasi | Must | 1 | Pelaporan ≤3 klik; tiket otomatis; tinjauan ≤1×24 jam |
| FR-121 | Kode promo/voucher: kuota, masa berlaku, batas per akun, larangan stacking, dan pembebanan biaya ke platform | Should | 2 | 0 penggunaan melebihi kuota pada 1.000 klaim paralel |
| FR-120 | Peringkat reliabilitas vendor dan suspensi otomatis setelah 2 no-show tervalidasi dalam 90 hari | Should | 2 | Vendor dengan 2 no-show tervalidasi otomatis delisted sementara |
| FR-134 | Pembatalan force majeure dan reschedule tanpa penalti dengan persetujuan kedua pihak dan admin | Should | 2 | Keputusan ≤2 hari kerja; biaya gateway platform tercatat terpisah |
| FR-135 | Deteksi dan peringatan kontak di luar platform (nomor HP, akun media sosial) sebelum DP | Should | 2 | ≥80% percobaan pada set uji 200 pesan terdeteksi |
| FR-136 | Laporan kepatuhan: daftar vendor, rekening terverifikasi, dan transaksi per periode untuk audit/pajak | Should | 2 | Laporan siap ≤1 hari kerja; total cocok 100% dengan ledger |
| FR-141 | Pengguna dapat meminta ekspor data pribadi (DSAR) dari dalam aplikasi | Should | 2 | Permintaan dipenuhi ≤14 hari |
| FR-142 | Pengguna dapat memblokir pengguna lain pada percakapan | Could | 2 | Pesan dari pihak yang diblokir tidak ditampilkan 100% |

#### Admin, Kebijakan, dan Operasi

| ID | Requirement | Prioritas | Fase | AC Ringkas |
|---|---|---|---|---|
| FR-127 | Audit log append-only untuk seluruh aksi admin, termasuk nilai sebelum/sesudah, IP, dan waktu | Must | 1 | 100% aksi tercatat; update/delete entri ditolak 100% |
| FR-128 | 2FA wajib untuk seluruh akun admin; maker-checker untuk refund/payout di atas Rp 1.000.000 | Must | 1 | 0 eksekusi tanpa 2 approver berbeda pada 20 kasus uji |
| FR-129 | Pemisahan peran admin: support, finance, super, dengan least privilege | Must | 1 | `admin_support` tidak dapat menyetujui refund (100% ditolak dan tercatat) |
| FR-130 | Publikasi kebijakan sebagai versi baru dengan tanggal berlaku dan riwayat yang dapat dilihat | Must | 1 | 100% booking memakai versi yang berlaku saat dibuat |
| FR-131 | Rekonsiliasi harian antara settlement gateway, ledger, dan mutasi rekening vendor | Must | 1 | Selesai ≤09.00 WIB; selisih >Rp 1 menjadi temuan dengan tiket |
| FR-133 | Refund manual terarah pada Fase 1: alasan, bukti, approver kedua, dan status yang terlihat pelanggan | Must | 1 | Status refund terlihat ≤1 jam; 100% dengan approver kedua |
| FR-137 | Notifikasi perubahan kebijakan kepada pengguna aktif sebelum berlaku | Should | 1 | Terkirim ≥14 hari sebelum tanggal berlaku |
| FR-138 | Skor kelengkapan kalender vendor dan pengingat pengisian berkala | Should | 2 | Skor 0–100 tampil; pengingat terkirim bila 30 hari ke depan kosong |
| FR-126 | Vendor dapat mengekspor laporan pendapatan, komisi, dan payout (CSV/PDF) | Must | 3 | Total laporan = ledger (selisih Rp 0); siap ≤60 detik untuk 1.000 baris |
| FR-139 | Penugasan anggota vendor ke job dengan akses terbatas | Could | 3 | Anggota hanya melihat job yang ditugaskan; 0 akses saldo |
| FR-145 | Tarif biaya layanan dapat diatur per wilayah/kategori oleh admin | Should | 3 | Booking baru memakai tarif berlaku; 0 efek retroaktif |

### 7.3 Aturan Prioritas

| Aturan | Konsekuensi |
|---|---|
| Must = penghalang rilis fase | Tidak ada rilis fase bila satu Must belum lulus AC |
| Should = boleh tertunda satu fase | Harus tercatat sebagai utang produk dengan pemilik dan tenggat |
| Could = tidak dijanjikan | Tidak masuk rencana kapasitas sampai Gate fase terlewati |
| Perubahan prioritas Must → Should | Butuh persetujuan PO dan catatan risiko di Bagian 12 |
| Penambahan FR baru di tengah fase | Ditolak kecuali menutup celah keamanan, dana, atau kewajiban hukum |

## 8. Non-Functional Requirements (Angka dan Definisi)

Metode pengukuran default: **server-side p95** diukur di API gateway atas jendela bergulir 7 hari, mengecualikan waktu jaringan klien. Untuk metrik aplikasi, sumbernya Firebase Performance/Crashlytics pada versi yang sedang beredar (≥1% instalasi).

### 8.1 Performa dan Keandalan

| ID | Kategori | Requirement | Target | Definisi/Cara Ukur |
|---|---|---|---|---|
| NFR-001 | Latensi API — pencarian | p95 pencarian vendor | ≤800 ms | Diukur di gateway, query dengan filter tanggal + radius 25 km |
| NFR-002 | Latensi API — detail vendor | p95 halaman detail | ≤600 ms | Termasuk 3 media pertama |
| NFR-003 | Latensi API — buat booking | p95 POST booking | ≤900 ms | Termasuk pengecekan ketersediaan, tidak termasuk upload foto |
| NFR-004 | Latensi API — inisiasi pembayaran | p95 pembuatan tagihan | ≤1.200 ms | Termasuk panggilan ke gateway |
| NFR-005 | Latensi webhook | p95 acknowledgement webhook | ≤500 ms | Dihitung sampai respons 2xx; pemrosesan berat asinkron |
| NFR-006 | Latensi admin | p95 daftar transaksi 100 baris | ≤1.500 ms | Filter tanggal + status |
| NFR-007 | Cold start aplikasi | p95 hingga layar utama interaktif | ≤2,5 detik | Perangkat Android 2 GB RAM, 4G, cache kosong, Firebase Performance |
| NFR-008 | Uptime inti | Ketersediaan bulanan (30 hari) | ≥99,5% | Error budget 0,5% = 216 menit/bulan; probe sintetis 1 menit |
| NFR-009 | Uptime alur pembayaran | Ketersediaan pembayaran dan rilis dana | ≥99,9% | Error budget 43 menit/bulan |
| NFR-010 | Skalabilitas musim | Trafik 10× normal tanpa penurunan p95 >20% | 1.000 req/menit selama 60 menit | Uji beban pra-musim, hasil dilampirkan |
| NFR-011 | Ukuran aplikasi | Unduhan Android (AAB) dan iOS (thinned) | Android ≤35 MB; iOS ≤60 MB | Play Console/App Store Connect |
| NFR-012 | Penggunaan data | Data per sesi 10 menit | ≤20 MB | Uji dengan penghitung data pada 3 perangkat |
| NFR-013 | Crash-free | Sesi tanpa fatal exception ÷ total sesi, 7 hari setelah rilis | ≥99,5% | Crashlytics; rilis dianggap gagal bila <99,0% |

### 8.2 Data, Keamanan, dan Kepatuhan

| ID | Kategori | Requirement | Target | Definisi/Cara Ukur |
|---|---|---|---|---|
| NFR-014 | RPO | Kehilangan data maksimum | ≤15 menit | Point-in-time recovery diuji bulanan |
| NFR-015 | RTO inti | Pemulihan layanan booking/pembayaran | ≤4 jam | Simulasi restore, dicatat |
| NFR-016 | RTO analitik | Pemulihan pelaporan | ≤24 jam | Simulasi restore |
| NFR-017 | Backup | Backup harian + PITR 7 hari; uji restore bulanan | 100% berhasil | Log backup dan laporan uji restore |
| NFR-018 | Enkripsi | TLS 1.2+; enkripsi at rest AES-256 untuk KTP dan rekening | 100% kolom sensitif | Audit konfigurasi per kuartal |
| NFR-019 | Sesi | Access token ≤15 menit; refresh ≤30 hari; revoke saat ganti perangkat | 100% | Uji 20 skenario |
| NFR-020 | Otorisasi | Setiap endpoint memeriksa kepemilikan resource; uji lintas akun | 0 kebocoran pada 50 uji | Pentest + uji otomasi |
| NFR-021 | Idempotensi | Retensi kunci idempotensi | 24 jam | Uji retry 24 jam |
| NFR-022 | Rate limit API | Per pengguna terautentikasi | 60 req/menit; burst 20 | Gateway |
| NFR-023 | PCI | Tidak menyimpan data kartu; seluruh data kartu berada di gateway | 0 data kartu di basis data | Pemindaian kuartalan |
| NFR-024 | PDP | Consent, DSAR ≤14 hari, anonimisasi ≤30 hari | 100% permintaan terpenuhi | Audit kepatuhan |
| NFR-025 | Retensi data | Transaksi/ledger 10 tahun; chat 2 tahun; KTP 1 tahun setelah vendor nonaktif; log OTP 90 hari; analytics 25 bulan | 100% kebijakan diterapkan | Audit otomasi penghapusan |
| NFR-026 | Lokasi data | Data pengguna disimpan di wilayah Indonesia | 100% | Konfigurasi region penyedia |
| NFR-027 | Auditabilitas | Aksi finansial admin tercatat lengkap | 100%, retensi ≥5 tahun | Uji sampling 50 aksi |

### 8.3 Aksesibilitas dan Lokalisasi

| ID | Kategori | Requirement | Target | Definisi/Cara Ukur |
|---|---|---|---|---|
| NFR-028 | Kontras | Rasio kontras teks normal | ≥4,5:1 | Alat pemeriksa kontras pada 20 layar utama |
| NFR-029 | Target sentuh | Ukuran minimum area sentuh | ≥48×48 dp | Pemeriksaan desain + uji perangkat |
| NFR-030 | Pembaca layar | Alur kritis dapat diselesaikan dengan TalkBack/VoiceOver | 100% dari 8 alur kritis | Uji manual dengan 5 pengguna, 2 di antaranya pengguna pembaca layar |
| NFR-031 | Teks | Dukungan skala teks sistem 130% tanpa pemotongan | 0 layar terpotong | Uji 10 layar utama |
| NFR-032 | Lokalisasi | Bahasa Indonesia default; IDR; WIB; format tanggal dd-mm-yyyy | 100% | Uji string dan format |
| NFR-033 | Koneksi lemah | Data terakhir (kalender, booking aktif) terbuka ≤2 detik tanpa jaringan; antrean aksi maksimum 20 | 100% pada uji throttling 3G | Uji perangkat dengan network link conditioner |
| NFR-034 | Media hemat kuota | Gambar ≤300 KB; video default 480p, unduh on-demand | 100% aset | Pemeriksaan pipeline media |

### 8.4 Aturan NFR

1. NFR yang gagal pada Gate fase bersifat **blocking** setara FR Must, kecuali NFR-012 dan NFR-011 yang boleh diberi pengecualian satu rilis dengan catatan.
2. Setiap insiden yang melanggar NFR-008, NFR-009, NFR-014, atau NFR-027 wajib menghasilkan catatan insiden dan tindakan perbaikan.
3. Perubahan target NFR hanya boleh melalui persetujuan Tech Lead dan PO, dengan alasan tertulis.

## 9. Metrik dan Tracking Plan

### 9.1 Definisi Metrik

Semua metrik dihitung per bulan kalender WIB, kecuali dinyatakan lain. "Booking completed" berarti `lifecycle = completed` dan tidak dibatalkan pada bulan yang sama.

| Metrik | Definisi Presisi | Rumus | Sumber Data | Target 6 Bulan | Pemilik |
|---|---|---|---|---|---|
| **GMV** | Nilai transaksi yang dibayar pelanggan dan tidak dibatalkan, dihitung pada tanggal acara | Σ `total_amount` booking dengan `payment_status` ∈ {dp_paid, fully_paid} dan `lifecycle` ∉ {cancelled, expired, rejected} | Basis data transaksi | Rp 480.000.000/bln (120 booking × Rp 4 jt) | Finance |
| **Take rate efektif** | Bagian GMV yang menjadi pendapatan platform setelah promo yang dibiayai platform | (komisi + biaya layanan − promo platform) ÷ GMV | Ledger + tabel promo | ≥10,4% | Finance |
| **Contribution margin per booking** | Margin setelah COGS variabel, sebelum biaya tetap | (pendapatan platform − COGS variabel) ÷ booking completed | Ledger + biaya notifikasi | ≥Rp 400.000 | Finance |
| **Pendapatan bersih vendor** | Nilai yang diterima vendor per booking setelah komisi, gateway fee, dan disbursement | (AOV − komisi − gateway fee − disbursement) ÷ booking completed | Ledger + mutasi rekening vendor | ≥Rp 3.500.000 | Finance |
| **Vendor aktif** | Vendor terverifikasi dengan ≥1 tanggal kalender diperbarui dalam 7 hari terakhir | Jumlah vendor memenuhi definisi ÷ total vendor terverifikasi | `calendar_updated_at` | 90 vendor (60% dari 150) | Ops |
| **Response rate vendor** | Proporsi booking yang direspons ≤24 jam | Booking dengan respons pertama ≤24 jam ÷ booking masuk, dinilai 7 hari setelah masuk | Log respons (app/WA/telepon) | ≥85% | Ops |
| **Waktu accept** | Jarak waktu dari booking dibuat ke respons pertama vendor | median dan p75 dalam jam | Log booking | median ≤6 jam; p75 ≤12 jam | Ops |
| **Dispute rate** | Proporsi booking completed yang disengketakan | Booking dengan ≥1 sengketa ÷ booking completed | Dispute | ≤5% | Ops |
| **Refund rate** | Proporsi GMV yang dikembalikan | Nilai refund diproses ÷ GMV | Ledger | ≤8% | Finance |
| **CAC vendor** | Biaya akuisisi per vendor terverifikasi baru | (biaya agen + insentif + biaya event akuisisi) ÷ vendor terverifikasi baru | Finance + absensi agen | ≤Rp 250.000 | Growth |
| **Repeat booking rate** | Proporsi pelanggan yang memesan lagi | Pelanggan dengan ≥2 booking completed dalam 180 hari ÷ pelanggan dengan ≥1 completed | Basis data booking | ≥15% | Growth |
| Konversi request → DP | Proporsi booking accepted yang dibayar DP | Booking dengan DP paid ÷ booking accepted | Payments | ≥50% | Growth |
| No-show rate | Proporsi booking yang vendornya tidak hadir | Booking dengan no-show tervalidasi ÷ booking completed | Dispute/CS | ≤2% | Ops |
| Payout sukses | Proporsi payout berhasil pada percobaan pertama | Payout sukses ÷ total payout | Gateway | ≥99,5% | Finance |
| Waktu rilis dana | Jarak completed → dana dirilis | p50 dan p95 hari | Ledger | p95 ≤3 hari kerja | Finance |
| Respons pertama CS | Waktu sampai balasan manusia pada jam layanan | p95 menit | Helpdesk | ≤15 menit | Ops |
| Crash-free rate | Sesi tanpa fatal exception ÷ total sesi | 7 hari setelah rilis | Crashlytics | ≥99,5% | Tech Lead |
| Kesegaran kalender | Median hari sejak pembaruan kalender terakhir vendor aktif | median(`now − calendar_updated_at`) | Basis data | ≤7 hari | Ops |
| Ketepatan pengingat | Pengingat terkirim dalam ±30 menit dari jadwal | Terkirim tepat waktu ÷ total pengingat | Outbox | ≥95% | Ops |
| Clawback rate | Nilai klaim pasca-pencairan yang disetujui ÷ GMV | 30 hari bergulir | Dispute + ledger | ≤1% | Finance |

### 9.2 Tracking Plan — Event Analytics

| Nama Event | Kapan Dikirim | Properti Wajib | Funnel |
|---|---|---|---|
| `auth_otp_requested` | Setelah permintaan OTP | `channel`, `attempt_no`, `device_os` | Akuisisi |
| `auth_completed` | Login/registrasi sukses | `role`, `is_new_user` | Akuisisi |
| `vendor_verification_submitted` | Pengajuan vendor dikirim | `vendor_id`, `category_count`, `media_count`, `has_bank_account` | Supply |
| `vendor_approved` | Admin menyetujui vendor | `vendor_id`, `review_hours` | Supply |
| `calendar_updated` | Vendor mengubah kalender | `vendor_id`, `date`, `status`, `source` | Supply |
| `search_performed` | Hasil pencarian ditampilkan | `category_id`, `event_date`, `region`, `result_count`, `latency_ms` | Permintaan |
| `vendor_viewed` | Detail vendor dibuka | `vendor_id`, `from_search`, `price_from` | Permintaan |
| `booking_requested` | Booking berhasil dibuat | `booking_id`, `vendor_id`, `event_date`, `aov`, `lead_days` | Booking |
| `booking_responded` | Vendor merespons | `booking_id`, `action`, `channel` (app/wa/phone), `latency_seconds` | Booking |
| `payment_initiated` | Tagihan dibuat | `booking_id`, `type`, `method`, `amount` | Pembayaran |
| `payment_succeeded` | Webhook sukses diterima | `booking_id`, `type`, `amount`, `gateway` | Pembayaran |
| `payment_failed` | Pembayaran gagal/kedaluwarsa | `booking_id`, `reason`, `method` | Pembayaran |
| `checkin_recorded` | Check-in hari-H | `booking_id`, `distance_m`, `has_photo` | Penyelesaian |
| `booking_completed` | Auto/manual complete | `booking_id`, `source` (customer/auto/admin) | Penyelesaian |
| `dispute_opened` | Sengketa dibuat | `booking_id`, `reason`, `within_window`, `post_settlement` | Sengketa |
| `payout_requested` | Vendor mengajukan payout | `vendor_id`, `amount`, `bank_verified` | Payout |
| `payout_settled` | Payout sukses/gagal | `vendor_id`, `status`, `days_since_completed` | Payout |
| `review_submitted` | Ulasan dikirim | `booking_id`, `rating`, `has_photo` | Retensi |
| `account_deleted` | Permintaan hapus akun | `role`, `days_since_register` | Kepatuhan |

### 9.3 Funnel yang Dipantau

| Funnel | Langkah | Ambang Perbaikan |
|---|---|---|
| Permintaan | `search_performed` → `vendor_viewed` → `booking_requested` | Konversi <15% memicu audit relevansi pencarian dan kualitas foto |
| Booking | `booking_requested` → `booking_responded` → `payment_succeeded` | Drop >30% pada langkah respons memicu intervensi agen |
| Penyelesaian | `checkin_recorded` → `booking_completed` → `review_submitted` | Review <40% memicu pengingat ulasan |
| Supply | `vendor_verification_submitted` → `vendor_approved` → `calendar_updated` | Drop >25% saat verifikasi memicu perbaikan form/onboarding |

### 9.4 Prinsip Pengukuran

1. Tidak ada metrik tanpa pemilik dan tanpa sumber data tunggal (single source of truth).
2. GMV dan pendapatan dihitung dari ledger, bukan dari tabel agregat manual.
3. Event analytics tidak boleh memuat PII (nomor HP, nama, alamat) di properti.
4. Setiap perubahan definisi metrik dicatat dengan tanggal berlaku agar tren tidak terputus diam-diam.

## 10. Operasi

### 10.1 Jam Layanan

| Kanal | Jam | Catatan |
|---|---|---|
| CS dalam aplikasi + WhatsApp | 08.00–21.00 WIB, 7 hari/minggu | Di luar jam ini, bot membalas dan tiket diantrekan |
| On-call hari-H | 06.00–24.00 WIB untuk booking yang acaranya hari itu | Eskalasi ke Ops Lead bila tidak direspons 15 menit |
| Admin keuangan (rilis dana) | 08.00–17.00 WIB, Senin–Jumat | Rilis dana di luar jam hanya untuk kasus force majeure |
| Agen lapangan | 09.00–17.00 WIB, Senin–Sabtu | Kunjungan vendor dan pendampingan kalender |

### 10.2 SLA

| Jenis | Tahap | Target | Definisi Pengukuran |
|---|---|---|---|
| CS | Respons pertama | ≤15 menit | Dihitung pada jam layanan, dari pesan masuk ke balasan manusia |
| CS | Penyelesaian tiket umum | ≤1×24 jam | Dihitung dari tiket dibuat |
| CS | Masalah pembayaran/DP | ≤2 jam | Termasuk pengecekan ke gateway |
| Sengketa | Pengakuan (acknowledge) | ≤2 jam | Notifikasi ke kedua pihak bahwa kasus diterima |
| Sengketa | Pengumpulan bukti | ≤1×24 jam | Permintaan bukti ke vendor dan pelanggan |
| Sengketa | Investigasi | ≤3 hari kerja | Verifikasi check-in, chat, foto, rekaman agen |
| Sengketa | Keputusan | ≤3 hari kerja sejak bukti lengkap | Keputusan tertulis dengan alasan |
| Sengketa | Banding | ≤5 hari kerja | Satu tingkat banding, diputuskan `admin_super` |
| Payout | Verifikasi dan eksekusi | ≤1 hari kerja | Setelah status completed + jendela sengketa |
| Refund | Eksekusi setelah keputusan | ≤3 hari kerja | Termasuk waktu proses gateway |
| Moderasi | Media dan laporan konten | ≤1×24 jam | Antrean moderasi |

### 10.3 Playbook Sengketa (7 Langkah)

1. **Terima dan bekukan.** Kasus dicatat, status sengketa dibuka, dan rilis dana untuk booking terkait dibekukan otomatis. Jika dana sudah dicairkan, kasus ditandai `post_settlement` dan masuk jalur clawback.
2. **Klasifikasi.** Kasus dikelompokkan: no-show, tidak sesuai paket, kualitas, pembatalan mendadak, atau masalah pembayaran. Setiap kategori punya daftar bukti minimum.
3. **Kumpulkan bukti.** Minta bukti ke kedua pihak dalam 24 jam: foto/video, check-in GPS, chat, rekaman telepon agen, snapshot syarat booking.
4. **Verifikasi silang.** Cocokkan bukti dengan data sistem (waktu check-in, jarak, riwayat pembatalan vendor, riwayat sengketa pelanggan).
5. **Putuskan.** Pilih satu: refund penuh, refund sebagian, rilis ke vendor, atau pembagian. Nominal mengikuti snapshot kebijakan booking, bukan kebijakan terbaru. Keputusan >Rp 1.000.000 memerlukan approver kedua.
6. **Komunikasikan.** Kedua pihak menerima keputusan tertulis, alasan, dan langkah banding dalam 1 jam setelah keputusan.
7. **Tutup dan pelajari.** Perbarui skor vendor, catat akar masalah, dan bila penyebabnya produk (mis. deskripsi paket ambigu), buat tiket perbaikan produk.

### 10.4 Kapasitas Agen dan Beban Kasus

| Peran | Rasio/Kapasitas | Dasar |
|---|---|---|
| Agen lapangan | 1 agen : 40 vendor aktif | 2 agen untuk 80 vendor aktif pada Fase 1–2 [ASUMSI] |
| Agen lapangan (Fase 3) | 1 agen : 60 vendor aktif | Vendor sudah mandiri mengisi kalender |
| CS | 1 CS : 120 booking/bln | Termasuk tiket, perubahan jadwal, dan tindak lanjut pembayaran [ASUMSI] |
| Admin finance | 1 orang : 300 rilis dana/bln | Dengan maker-checker dan rekonsiliasi harian [ASUMSI] |
| Moderator | 150 media/hari | Termasuk video ≤60 detik [ASUMSI] |

### 10.5 Estimasi Beban Kasus per 100 Booking [ASUMSI]

| Jenis Kasus | Volume per 100 Booking | Waktu Penanganan | Beban (menit) |
|---|---|---|---|
| Pertanyaan status/pembayaran | 12 | 8 | 96 |
| Perubahan jadwal/reschedule | 5 | 20 | 100 |
| Kendala hari-H (sinyal, lokasi, keterlambatan) | 6 | 25 | 150 |
| No-show | 2 | 90 | 180 |
| Sengketa kualitas/tidak sesuai | 3 | 120 | 360 |
| Refund dan pembatalan | 4 | 30 | 120 |
| Masalah payout/rekening | 2 | 45 | 90 |
| **Total** | **34 kasus** | | **1.096 menit (18,3 jam)** |

Implikasi: 100 booking/bln membutuhkan ±18 jam penanganan kasus, setara 0,12 FTE CS per 100 booking ditambah waktu tunggu dan eskalasi. Dengan 1 CS (176 jam/bln efektif), kapasitas teoretis ±960 booking/bln untuk beban kasus, tetapi SLA 15 menit membatasi kapasitas nyata ke ±120–150 booking/bln karena konsentrasi kasus pada jam tertentu.

### 10.6 Aturan Eskalasi

| Pemicu | Eskalasi | Waktu |
|---|---|---|
| Tiket CS tanpa respons 15 menit | Ops Lead | Segera |
| Sengketa >Rp 2.000.000 | Admin finance + Ops Lead | ≤2 jam |
| Dugaan penipuan/chargeback | Finance + Legal | ≤2 jam |
| Payout gagal 2× pada vendor sama | Hentikan payout, verifikasi rekening | Segera |
| Insiden data pribadi | Tech Lead + Legal, notifikasi sesuai kebijakan | ≤1 jam |
| Vendor no-show pada hari-H | CS + agen lapangan, cari vendor pengganti | ≤1 jam |

## 11. Tim, Budget, dan Timeline

### 11.1 Roster per Fase

| Peran | FTE Fase 1 | Biaya F1/bln | FTE Fase 2 | Biaya F2/bln | FTE Fase 3–4 | Biaya F3–4/bln |
|---|---|---|---|---|---|---|
| Product Owner | 0,5 | Rp 6.000.000 | 0,5 | Rp 6.000.000 | 0,5 | Rp 6.000.000 |
| Tech Lead/Backend | 1,0 | Rp 18.000.000 | 1,0 | Rp 18.000.000 | 1,0 | Rp 18.000.000 |
| Backend Engineer | 0,0 | Rp 0 | 1,0 | Rp 14.000.000 | 1,0 | Rp 14.000.000 |
| Flutter Engineer | 1,0 | Rp 12.000.000 | 2,0 | Rp 28.000.000 | 2,0 | Rp 28.000.000 |
| QA Engineer | 0,5 | Rp 4.000.000 | 0,5 | Rp 4.000.000 | 0,5 | Rp 4.000.000 |
| UI/UX Designer | 0,3 | Rp 3.000.000 | 0,3 | Rp 3.000.000 | 0,3 | Rp 3.000.000 |
| Agen Lapangan | 2,0 | Rp 9.000.000 | 2,0 | Rp 9.000.000 | 3,0 | Rp 13.500.000 |
| Customer Service | 1,0 | Rp 5.000.000 | 1,0 | Rp 5.000.000 | 2,0 | Rp 10.000.000 |
| Finance/Ops | 0,3 | Rp 2.500.000 | 0,3 | Rp 2.500.000 | 0,3 | Rp 2.500.000 |
| Infra & tools | — | Rp 3.000.000 | — | Rp 3.000.000 | — | Rp 3.000.000 |
| **Total opex bulanan** | | **Rp 62.500.000** | | **Rp 92.500.000** | | **Rp 102.000.000** |

Catatan konsistensi D-02: biaya dev Fase 1 = Rp 30.000.000 (Tech Lead Rp 18 jt + Flutter Rp 12 jt); Fase 2 = Rp 60.000.000 (Tech Lead Rp 18 jt + Backend Rp 14 jt + 2 Flutter Rp 28 jt). Opex tetap non-dev D-02 Rp 17.000.000 (agen Rp 9 jt + CS Rp 5 jt + infra Rp 3 jt). Peran PO, QA, desain, dan finance adalah biaya tambahan di luar D-02 dan karena itu break-even "opex penuh" pada 5.7 lebih tinggi (144 dan 212 booking).

### 11.2 Kebutuhan Runway

| Komponen | Skenario Dasar [ASUMSI] | Skenario Lambat (pendapatan 50%) [ASUMSI] |
|---|---|---|
| Opex 18 bulan | Rp 1.689.000.000 | Rp 1.689.000.000 |
| Pemasaran (Rp 5 jt/bln) | Rp 90.000.000 | Rp 90.000.000 |
| Pendapatan platform kumulatif | Rp 633.600.000 | Rp 316.800.000 |
| Defisit kas kumulatif puncak | Rp 1.145.000.000 | Rp 1.462.000.000 |
| Kontingensi 15% | Rp 172.000.000 | Rp 219.000.000 |
| **Kebutuhan dana** | **± Rp 1.320.000.000** | **± Rp 1.680.000.000** |

Proyeksi pendapatan memakai ramp booking berikut [ASUMSI]: 0/bln (bulan 1–3), 30/bln (4–6), 55/bln (7–9), 90/bln (10–12), 130/bln (13–15), 175/bln (16–18) pada AOV Rp 4 jt. Jika ramp lebih lambat dari 55/bln pada bulan 9, keputusan yang diambil adalah menahan penambahan agen dan CS (kembali ke opex Rp 92,5 jt), bukan menambah fitur.

### 11.3 Milestone

| Milestone | Isi | Minggu | Tanggal Perkiraan | Ketergantungan | Kriteria Selesai |
|---|---|---|---|---|---|
| M0 | Riset lapangan, pemetaan kanal, desain, kontrak PJP, kajian legal D-01 | 1–4 | 21 Okt–17 Nov 2026 | Validasi struktur penahanan dana (Bagian 14) | Kontrak/NDA PJP ditandatangani; desain alur booking-DP disetujui |
| M1 | Fase 1 build + beta tertutup 20 vendor | 5–14 | 18 Nov 2026–26 Jan 2027 | M0; rekening vendor terverifikasi; WA template disetujui | Seluruh FR Must Fase 1 lulus AC; Gate 1 |
| G1 | Gate Fase 1 → 2 | 15 | 27 Jan–2 Feb 2027 | M1 | Kriteria 6.2 terpenuhi |
| M2 | Fase 2 build + beta terbuka 1 kabupaten | 16–25 | 3 Feb–13 Apr 2027 | G1; validasi pajak D-16; saldo & payout teruji di sandbox | Seluruh FR Must Fase 2 lulus AC; Gate 2 |
| G2 | Gate Fase 2 → 3 dan rilis publik Pantura | 26 | 14–20 Apr 2027 | M2; load test 10×; pentest | Kriteria 6.3 terpenuhi; tidak ada bug kritis |
| M3 | Fase 3 | 27–34 | 21 Apr–16 Jun 2027 | G2; data 8 minggu untuk dashboard | FR-126 lulus AC; laporan cocok ledger |
| G3 | Gate Fase 3 → 4 | 35 | 17–23 Jun 2027 | M3 | Kriteria 6.4 terpenuhi |
| M4 | Fase 4 + ekspansi 2 kabupaten baru | 36–43 | 24 Jun–18 Agu 2027 | G3; agen tambahan direkrut | Gate ekspansi 6.5 terpenuhi |
| M5 | Evaluasi siklus pertama penuh | 44 | 19–25 Agu 2027 | M4 | Laporan kohort, keputusan ekspansi berikutnya |

### 11.4 Kalender Musim sebagai Constraint Rilis

| Periode | Karakter Permintaan [ASUMSI] | Constraint Rilis | Tindakan |
|---|---|---|---|
| Okt–Des 2026 | Hajatan pasca panen; platform belum live | Tidak ada rilis | Fokus build; siklus ini tidak dikejar, komunikasikan ke vendor pilot |
| Jan–Feb 2027 | Booking Ramadan/Lebaran mulai masuk | Fase 1 **wajib live ≤ minggu 14** (paling lambat 26 Jan 2027) agar selaras dengan M1; tidak ada tambahan fitur setelah minggu 12 | Rilis bertahap 10%→50%→100%; siapkan agen untuk input kalender massal |
| Feb–Mar 2027 | Puncak Ramadan dan Lebaran | **Freeze rilis minggu 17–22**; hanya perbaikan kritis | On-call hari-H; hentikan uji beban di produksi |
| Apr–Jun 2027 | Pasca Lebaran, musim panen; permintaan menengah | Jendela terbaik untuk rilis berisiko (Fase 2) | Launch pembayaran otomatis minggu 26; audit rekonsiliasi harian |
| Jul–Sep 2027 | 17-an, Maulid, sedekah laut/bumi, panen gadu | **Freeze rilis Jul–Agu**; load test sebelum Juli | Kapasitas 10×; tambah CS sementara; awasi dispute rate |
| Okt 2027 | Siklus kedua | Evaluasi | Bandingkan kohort dengan siklus pertama |

Tanggal kalender hijriah bersifat perkiraan dan wajib dikonfirmasi ulang setiap tahun; pergeseran tanggal menggeser freeze window, bukan milestone build.

## 12. Risiko

Skala: Dampak H/M/L (H = menghentikan operasi atau menyebabkan kerugian finansial/legal material); Kemungkinan H/M/L. Setiap risiko wajib punya pemicu deteksi yang dapat dipantau mingguan.

| ID | Risiko | Dampak | Kemungkinan | Trigger Deteksi | Mitigasi | Pemilik |
|---|---|---|---|---|---|---|
| R-01 | Vendor enggan memakai aplikasi / gaptek | H | H | Onboarding completion <60%; vendor tidak pernah membuka aplikasi 14 hari | Onboarding tatap muka, input kalender dibantu agen, respons via WhatsApp (D-15), UI sederhana | Ops |
| R-02 | Kalender vendor tidak diperbarui sehingga bentrok | H | H | Kesegaran kalender >14 hari; keluhan bentrok >1% booking | Pengingat berjenjang FR-116, skor kelengkapan FR-138, sanksi delisting, input job offline | Ops |
| R-03 | Bypass platform untuk menghindari komisi | H | M | Chat memuat kontak; booking accepted tanpa DP >40%; vendor menolak DP; khusus transaksi > Rp 10 jt: penurunan booking masuk >30% setelah vendor mengetahui komisi | Nilai tambah jaminan dana, komisi bertingkat D-17 (6,25% efektif pada Rp 40 jt), penyaringan kontak FR-135, insentif repeat | Growth |
| R-04 | Pelanggan atau vendor menipu | H | M | Payout ke rekening berubah mendadak; akun baru dengan nilai transaksi tinggi; pola pembatalan berulang | Verifikasi vendor + rekening, penahanan dana PJP, maker-checker, skor reliabilitas | Ops |
| R-05 | Sengketa kualitas sulit dibuktikan | M | H | Dispute rate >5%; keputusan tanpa bukti cukup >10% | Deskripsi paket detail, snapshot syarat, check-in + foto, playbook bukti minimum | Ops |
| R-06 | Sinyal buruk di lokasi acara | M | H | Check-in gagal karena jaringan >5%; keluhan hari-H | Mode offline, antrean aksi, konfirmasi via WA/telepon, fallback agen | Tech Lead |
| R-07 | Lonjakan trafik musim hajatan | M | M | p95 >1,5× baseline; error rate >1% | Load test 10× sebelum musim, autoscaling, caching, freeze rilis saat puncak | Tech Lead |
| R-08 | Perubahan regulasi perizinan/pajak hiburan daerah | M | M | Perda baru, surat edaran pajak, perubahan aturan PJP | Kajian legal berkala, D-16, vendor tetap penanggung pajak hiburan | Legal |
| R-09 | Kebocoran data pribadi | H | L | Akses tidak wajar ke KTP/rekening; alert ekspor data | Enkripsi, least privilege, audit log, DSAR, uji pentest | Tech Lead |
| R-10 | Chargeback dan fraud pembayaran | H | M | Chargeback >0,3% transaksi; pola kartu/e-wallet sama pada banyak akun | 3DS bila tersedia, pembatasan akun baru, bukti serah terima (check-in + foto) untuk melawan chargeback | Finance |
| R-11 | SMS pumping / OTP bombing | M | M | Lonjakan OTP per nomor/IP; biaya OTP >Rp 1.000/booking | Rate limit berlapis FR-100, deteksi nomor virtual, CAPTCHA pada anomali, anggaran OTP harian | Tech Lead |
| R-12 | Kegagalan disbursement ke rekening vendor | H | M | Payout gagal >0,5%; nama rekening tidak cocok | Verifikasi rekening FR-104, cooling period FR-105, retry terbatas, kanal manual terverifikasi | Finance |
| R-13 | Ketergantungan pada satu payment gateway | H | M | Uptime gateway <99,5%; perubahan tarif sepihak | Kontrak dengan SLA, rencana gateway kedua untuk Fase 2, rekonsiliasi harian | Finance |
| R-14 | Perubahan regulasi pajak hiburan daerah | M | M | Perda baru atau perubahan tarif PBJT | Validasi konsultan pajak sebelum Fase 2, klausul di ToS bahwa pajak hiburan kewajiban penyelenggara | Legal |
| R-15 | Kebocoran PII melalui unggahan pengguna dan ekspor laporan | H | M | Media memuat KTP/alamat; ekspor dikirim ke pihak tidak berwenang | Moderasi media, maskir data pada ekspor, watermark, pembatasan unduh | Ops |
| R-16 | Kegagalan adopsi supply | H | H | Vendor aktif <60% target 2 bulan berturut; response rate <60% | Insentif perintis terukur, rekrutmen per kategori, kemitraan paguyuban, target per agen | Growth |
| R-17 | Konsentrasi musiman dan arus kas | M | H | 60% GMV terkumpul dalam 3 bulan; kas menipis di bulan sepi | Runway 18 bulan, biaya variabel agen, kontrak vendor fleksibel, rencana kas per musim | Finance |
| R-18 | Penyalahgunaan akses admin (insider) | H | L | Aksi finansial di luar jam kerja; payout ke rekening baru; approval oleh orang yang sama | 2FA, maker-checker, least privilege, audit log, review kuartalan akses | Finance |
| R-19 | Penolakan atau penurunan aplikasi oleh app store | M | M | Permintaan klarifikasi data safety/privacy; penolakan pembaruan | Checklist rilis Bagian 15, hapus akun in-app, privacy manifest, deskripsi izin yang jelas | Tech Lead |
| R-20 | Clawback pasca-pencairan tidak efektif | M | M | Vendor menolak pemotongan; saldo negatif menumpuk | Syarat vendor mengizinkan pemotongan, tahan sebagian dana pada 3 booking pertama, delisting bila menolak | Finance |

### 12.1 Risiko yang Diterima (Accepted)

| Risiko | Alasan Diterima | Batas Toleransi |
|---|---|---|
| R-07 lonjakan musim | Tidak ekonomis menyiapkan kapasitas puncak sepanjang tahun | p95 ≤2× baseline selama 3 hari puncak |
| R-17 konsentrasi musiman | Karakter pasar, bukan cacat model | Kas minimum 3 bulan opex tetap |
| R-10 chargeback | Sebagian tidak dapat dicegah pada pembayaran digital | ≤0,3% nilai transaksi; di atas itu pembayaran kartu ditinjau |

## 13. Legal dan Kepatuhan

### 13.1 Checklist Dokumen

| Dokumen | Isi Minimum | Pemilik | Target | Status |
|---|---|---|---|---|
| Syarat & Ketentuan Pelanggan | Peran platform sebagai perantara, kebijakan DP, pembatalan, refund, batas tanggung jawab, penyelesaian sengketa | Legal | Sebelum M1 | Belum ada |
| Perjanjian Vendor | Kewajiban kualitas, kebijakan pembatalan, komisi, izin pemotongan (termasuk clawback), sanksi, lisensi konten, kewajiban pajak hiburan | Legal | Sebelum M1 | Belum ada |
| Kebijakan Refund dan Pembatalan | Tabel berjenjang, penanggung biaya gateway (D-03), tenggat pengajuan | Legal + Finance | Sebelum M1 | Draf di 5.10 |
| Kebijakan Privasi | Data yang dikumpulkan, dasar pemrosesan, retensi, hak subjek data, kontak | Legal | Sebelum M1 | Belum ada |
| DPA dengan Payment Gateway/PJP | Peran sebagai pengendali/pemroses, lokasi data, kewajiban notifikasi insiden | Legal + Finance | Sebelum M1 | Belum ada |
| Perjanjian Disbursement | Kewenangan instruksi rilis, verifikasi rekening, tanggung jawab atas kegagalan transfer | Finance | Sebelum M1 | Belum ada |
| Lisensi Konten Vendor | Pernyataan kepemilikan/lisensi musik, video, foto; indemnitas | Legal | Sebelum M1 | Belum ada |
| Alur Takedown Hak Cipta | Kanal laporan, verifikasi bukti, penurunan sementara, banding | Legal | Sebelum M2 | Belum ada |
| Kebijakan Retensi Data | Durasi per jenis data (NFR-025) dan prosedur penghapusan | Legal + Tech Lead | Sebelum M1 | Draf di 8.2 |
| Pakta Integritas Admin | Kewajiban kerahasiaan, larangan akses tanpa alasan, konsekuensi pelanggaran | Finance | Sebelum M1 | Belum ada |

### 13.2 Status Keputusan Dana (D-01)

| Aspek | Keputusan | Dasar | Pihak yang Harus Memvalidasi | Tenggat |
|---|---|---|---|---|
| Penahanan dana | Dana pelanggan ditahan PJP/gateway berizin, tidak masuk rekening platform | D-01 | Konsultan hukum fintech + compliance PJP | M0 |
| Rekening penampung sendiri | **BLOCKED** sampai ada dasar legal | D-01 | Konsultan hukum + OJK/BI melalui PJP | Tidak ada tenggat (opsi ditutup) |
| Instruksi rilis | Platform hanya mengirim instruksi; eksekusi oleh PJP | D-01 | Compliance PJP | M0 |
| Kewajiban ke vendor | Dicatat sebagai liabilitas di ledger, bukan saldo rekening platform | D-01, D-06 | Finance + auditor | M2 |

### 13.3 Status Pajak (D-16)

| Aspek | Posisi | Validator | Tenggat | Dampak Bila Tidak Selesai |
|---|---|---|---|---|
| PPN atas komisi | Tidak dipungut sampai platform PKP; invoice komisi tanpa PPN | Konsultan pajak | Sebelum M2 | Fase 2 ditahan |
| PPh atas komisi ke vendor | Perlu penetapan apakah objek pemotongan | Konsultan pajak | Sebelum M2 | Fase 2 ditahan |
| Pajak hiburan daerah (PBJT) | Kewajiban penyelenggara acara/vendor, bukan platform; dinyatakan di ToS | Konsultan pajak + Pemda | Sebelum M2 | Risiko sengketa dengan vendor dan pemda |
| Invoice dan bukti pungut | Format dan isi minimum | Konsultan pajak + Finance | Sebelum M2 | Laporan tidak dapat diaudit |
| Pelaporan transaksi | Kewajiban pelaporan bila ada | Konsultan pajak | Sebelum M3 | Risiko sanksi administratif |

### 13.4 Kepatuhan Operasional

| Area | Kewajiban | Cara Dipenuhi |
|---|---|---|
| UU PDP (UU 27/2022) | Dasar pemrosesan, hak subjek data, notifikasi insiden | Consent FR-103, DSAR FR-141, hapus akun FR-101, retensi NFR-025 |
| UU ITE | Konten ilegal dan takedown | FR-123, FR-124 |
| Perlindungan konsumen | Informasi harga jelas, tidak ada biaya tersembunyi | FR-110, aturan biaya 5.10 |
| Perpajakan | Pemisahan kewajiban platform dan vendor | D-16, 13.3 |
| Ketenagakerjaan (agen lapangan) | Status hubungan kerja agen | Kontrak kerja sama/karyawan sesuai nasihat legal |

## 14. Sisa Keputusan Terbuka

Hanya keputusan yang membutuhkan pihak eksternal. Keputusan produk, harga, prioritas, dan operasi sudah ditetapkan di Bagian 2–11 dan tidak boleh dibuka kembali tanpa alasan baru.

| # | Keputusan | Mengapa Butuh Eksternal | Pihak yang Memutuskan | Tenggat | Dampak Bila Terlambat |
|---|---|---|---|---|---|
| K-01 | Struktur penahanan dana yang dipakai: split settlement, escrow, atau mekanisme lain yang disediakan PJP, beserta isi perjanjiannya | Menyangkut izin penghimpunan/pengiriman uang dan tanggung jawab hukum atas dana pihak ketiga | Konsultan hukum fintech + compliance PJP | Akhir M0 (minggu 4) | Fase 1 tidak dapat memproses DP; rilis mundur |
| K-02 | Perlakuan PPN komisi, PPh atas komisi vendor, dan batas kewajiban pajak hiburan daerah | Membutuhkan penafsiran peraturan pajak dan pendaftaran PKP | Konsultan pajak | Sebelum Gate 1 (minggu 15) untuk desain, sebelum Gate 2 untuk penerapan | Fase 2 ditahan (blocking) |
| K-03 | Perizinan usaha dan kewajiban sebagai penyelenggara sistem elektronik (bentuk badan usaha, NIB/KBLI, pendaftaran PSE) | Membutuhkan notaris, OSS, dan instansi terkait | Legal + notaris | Akhir M0 | Aplikasi berisiko tidak dapat dipublikasikan; kontrak PJP tidak dapat ditandatangani |
| K-04 | Mekanisme verifikasi nama rekening vendor yang didukung PJP (name match otomatis atau verifikasi manual) dan konsekuensi bila tidak cocok | Bergantung kemampuan dan kebijakan compliance masing-masing gateway | Compliance PJP + Finance | Sebelum M1 | Rilis dana berisiko salah transfer; payout manual berhenti |
| K-05 | Batas nilai dan durasi penahanan dana yang diizinkan, serta kewajiban pelaporan transaksi (termasuk bila ada kewajiban APU-PPT) | Membutuhkan penetapan otoritas/PJP, bukan keputusan internal | Konsultan hukum + compliance PJP | Sebelum Gate 2 | Model escrow otomatis Fase 2 tidak dapat dijalankan sesuai rencana |

Aturan: keputusan di atas **tidak boleh** diubah menjadi open question baru di kemudian hari tanpa menghapus barisnya di sini. Bila salah satu tidak selesai pada tenggat, tindakan default adalah menahan fase terkait, bukan melanjutkan dengan asumsi.

## 15. Lampiran

### 15.1 GTM dan Onboarding Vendor

**Prinsip:** supply lebih dulu. Katalog kosong tidak dapat memasarkan apa pun, dan vendor Pantura tidak akan mendaftar sendiri tanpa pendampingan.

| Tahap | Aktivitas | Target | Pemilik | Metrik |
|---|---|---|---|---|
| Prospeksi | Pemetaan grup dari paguyuban, spanduk hajatan, rekomendasi vendor pilot | 120 calon di 2 kabupaten | Agen | Jumlah kontak valid |
| Kunjungan | Penjelasan model, komisi, dan jaminan DP; verifikasi lapangan | 80 kunjungan | Agen | Kunjungan per agen per hari (≥5) |
| Pendaftaran | Bantu unggah KTP, foto, video, rekening; isi paket dan kalender | 50 pendaftar | Agen | Pendaftaran selesai per kunjungan (≥60%) |
| Verifikasi | Moderasi media dan rekening | 40 vendor tayang | Admin | Waktu verifikasi ≤2 hari kerja |
| Aktivasi | Isi kalender 3 bulan ke depan, uji respons WA | 30 vendor aktif | Agen | Vendor aktif ÷ vendor tayang (≥75%) |
| Retensi | Kunjungan bulanan, bantu perbarui kalender | 90% tetap aktif 3 bulan | Agen | Churn bulanan ≤5% |

**Bauran kanal pilot:** 2 kabupaten (Indramayu dan Cirebon) [ASUMSI: kepadatan hajatan dan jarak antar-vendor masih terjangkau agen]. Komposisi kategori minimum: 3 vendor per kategori per kabupaten agar pencarian tidak kosong.

**Insentif perintis:** komisi 0% selama 2 bulan pertama untuk 40 vendor perintis, dibatasi anggaran Rp 40.000.000. Perkiraan biaya: 40 vendor × 2 booking × Rp 400.000 = Rp 32.000.000 [ASUMSI]. Insentif diberikan sebagai kredit, bukan tunai, dan berhenti otomatis setelah kuota habis.

**Akuisisi pelanggan:** konten video pendek (TikTok/Instagram/Facebook) yang menampilkan cuplikan grup dan testimoni, kerja sama perangkat desa, QR di spanduk hajatan, dan grup WhatsApp warga. Anggaran pemasaran Rp 5.000.000/bln, dialokasikan 60% konten, 40% komunitas.

**CAC vendor pilot:** biaya agen Rp 9.000.000/bln ÷ 20 vendor tayang/bln = Rp 450.000 + kit onboarding Rp 100.000 = **Rp 550.000** [ASUMSI]. Target turun ke ≤Rp 250.000 pada bulan ke-6 melalui rujukan vendor dan kemitraan paguyuban.

### 15.2 Analisis Alternatif dan Kompetitor

Penilaian pada tabel berikut bersifat kualitatif berdasarkan pengamatan kanal yang dipakai vendor saat riset awal, belum diukur formal, dan berstatus **[ASUMSI]**. Validasi: pemetaan 20 vendor per kabupaten pada M0 (Bagian 3.3).
| Alternatif | Kekuatan | Kelemahan | Mengapa Platform Menang | Risiko Diserang Balik |
|---|---|---|---|---|
| Grup WhatsApp | Gratis, sudah dipakai, cepat, saling kenal | Tidak ada ketersediaan terpusat, tidak ada jaminan DP, riwayat tenggelam, penipuan sulit dilacak | Ketersediaan tanggal, bukti, dan penahanan dana | Vendor memindahkan percakapan ke WA setelah kenal |
| Instagram/Facebook | Portofolio visual, jangkauan luas, gratis | Tidak ada kalender, tidak ada transaksi, DM tidak terkelola | Booking + pembayaran + jadwal dalam satu alur | Vendor tetap pakai IG untuk portofolio dan closing langsung |
| Paguyuban seniman | Kepercayaan tinggi, rekomendasi personal, disiplin komunitas | Tidak digital, rekomendasi bergantung pengurus, tidak ada jaminan uang | Menambah jangkauan tanpa menghilangkan kepercayaan paguyuban | Paguyuban membuat kanal sendiri dan menahan anggotanya |
| EO lokal | Mengurus banyak vendor sekaligus, berpengalaman | Biaya jasa, tidak transparan, kapasitas terbatas | Harga transparan, panitia bisa mengelola sendiri | EO besar membangun platform tandingan |
| Marketplace umum | Trafik besar, pembayaran matang | Tidak fokus jasa hiburan lokal, tidak ada verifikasi lapangan, kategori dangkal | Keahlian lokal, verifikasi tatap muka, agen | Marketplace umum masuk kategori jasa lokal |

**Posisi yang dipertahankan:** platform menang bila (a) ketersediaan tanggal lebih akurat daripada bertanya ke 5 orang, (b) DP aman dan dapat dikembalikan sesuai aturan, (c) bukti selesai cukup untuk menyelesaikan sengketa tanpa berdebat. Bila salah satu dari tiga ini tidak terpenuhi, platform hanya menjadi direktori dan akan ditinggalkan setelah kontak diperoleh.

### 15.3 Strategi Pengujian

| Jenis | Cakupan | Kriteria Lulus |
|---|---|---|
| Unit | Modul pembayaran, ledger, perhitungan refund, harga musiman | Cakupan ≥70% pada modul tersebut; 0 test gagal |
| Integrasi | Gateway sandbox: sukses, gagal, kedaluwarsa, webhook ganda, webhook terlambat, refund, disbursement gagal | Semua skenario menghasilkan status dan jurnal yang benar |
| Konkurensi | 50 request paralel pada slot yang sama; 100 request dengan Idempotency-Key sama | 1 booking aktif; 0 duplikasi pembayaran |
| End-to-end | 12 alur kritis: daftar, verifikasi, cari, booking, respons WA, DP, check-in, complete, refund, sengketa, payout, hapus akun | 100% lulus di staging |
| Beban | 10× trafik normal selama 60 menit | p95 tidak naik >20%; error <1% |
| Perangkat | Android 2–3 GB RAM, iOS perangkat lama, jaringan 3G throttled | Semua alur kritis selesai; tidak ada crash |
| Keamanan | Pentest sebelum rilis publik; uji otorisasi lintas akun | 0 temuan kritis/tinggi terbuka |
| UAT | 15 pengguna asli (10 penyelenggara, 5 vendor) dari 2 kabupaten | ≥80% menyelesaikan tugas tanpa bantuan |
| Aksesibilitas | 8 alur kritis dengan TalkBack/VoiceOver, kontras, skala teks 130% | 100% alur selesai; 0 layar terpotong |

### 15.4 Checklist Rilis App Store

| Item | Android (Play) | iOS (App Store) | Status Target |
|---|---|---|---|
| Formulir data safety / privacy label | Wajib: nomor HP, lokasi, foto, riwayat transaksi, tujuan penggunaan, enkripsi | Wajib: App Privacy nutrition label | Sebelum rilis |
| Hapus akun | Tautan in-app dan halaman web | Tautan in-app | FR-101, sebelum rilis |
| Privacy manifest | Tidak berlaku | Wajib: tipe data, required reason API, status tracking | Sebelum rilis |
| Izin lokasi | Dijelaskan untuk check-in hari-H dan pencarian vendor terdekat | Sama, dengan teks tujuan | Sebelum rilis |
| Izin kamera/foto | Untuk unggah portofolio dan bukti | Sama | Sebelum rilis |
| Kebijakan pembayaran | Jasa offline/event bukan konten digital, pembayaran di luar IAP | Sama | Konfirmasi saat submit |
| Login pihak ketiga | Tidak wajib padanan | Bila login Google ditawarkan, wajib Sign in with Apple (FR-005) | Fase 4 |
| Target API level | Mengikuti kebijakan Play terbaru | Mengikuti SDK minimum yang didukung | Sebelum rilis |
| Rating konten | Kuesioner rating | Kuesioner rating | Sebelum rilis |
| Akun demo untuk reviewer | Wajib bila ada login | Wajib | Sebelum submit |
| Deskripsi dan tangkapan layar | Menjelaskan fungsi, tanpa klaim berlebihan | Sama | Sebelum submit |
| Kontak dukungan dan kebijakan privasi URL | Wajib | Wajib | Sebelum submit |
| Penanganan gangguan pembayaran | Halaman bantuan dan kontak | Sama | Sebelum submit |

### 15.5 Dokumen Terkait

| Dokumen | Isi | Status |
|---|---|---|
| `PRD-Booking-Hiburan-Pantura.md` v1.0 | Baseline requirement dan konteks awal | Ada |
| `TECH-DESIGN-v1.0.md` | Skema data, kontrak API, arsitektur, alur status, strategi migrasi | Belum ada (paket terpisah) |
| Kebijakan Privasi dan ToS | Dokumen legal | Belum ada |
| Perjanjian Vendor | Dokumen legal | Belum ada |
| Laporan Riset Lapangan | Hasil survei dan wawancara | Belum ada |
| Rencana Kas per Musim | Proyeksi arus kas bulanan | Belum ada |

### 15.6 Persetujuan

| Nama | Peran | Fokus Review | Tanda Tangan | Tanggal |
|---|---|---|---|---|
| [Nama] | Product Owner | Kelengkapan bisnis dan prioritas | | |
| [Nama] | Tech Lead | Kelayakan NFR dan ketergantungan teknis | | |
| [Nama] | Finance | Unit economics, runway, kontrol dana | | |
| [Nama] | Legal | D-01, D-16, dokumen kepatuhan | | |
| [Nama] | Ops Lead | SLA, kapasitas agen, playbook | | |
| [Nama] | Perwakilan Vendor | Keadilan komisi dan proses sengketa | | |
