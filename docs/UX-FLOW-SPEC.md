# UX Flow Spec — Marketplace Booking Hiburan Pantura

| Field | Nilai |
|---|---|
| Versi | 1.0 (draf untuk review desain) |
| Tanggal | 2026-10-21 |
| Dokumen acuan | `PRD-v1.1.md` (v1.1) dan `PRD-Booking-Hiburan-Pantura.md` (v1.0) |
| Cakupan | Alur, hierarki, state, copy, aksesibilitas, anti-kesalahan, handoff WhatsApp, peta layar→FR |
| Bukan cakupan | Gambar, wireframe, mockup visual final, kontrak API, skema data |

**Kedudukan dokumen.** PRD v1.0 §4.4 hanya mendaftar nama layar tanpa alur, hierarki, state, dan copy. Dokumen ini mengisi kekosongan itu agar desain visual dan implementasi tidak mengarang keputusan sendiri. Semua keputusan di sini diturunkan dari persona dan requirement; bila bertentangan dengan PRD v1.1, PRD v1.1 yang berlaku.

**Cara membaca.**
- Rujukan `§x` = `PRD-v1.1.md §x`, kecuali ditulis `v1.0 §x`.
- Tanda **[ASUMSI-UX]** = keputusan UX yang PRD belum tetapkan; wajib dikonfirmasi PO sebelum desain final.
- Fase tiap layar mengikuti §6.2–§6.5. Layar Fase 2 tetap dispesifikasikan karena alurnya bersambung dengan Fase 1.
- Prioritas: `M` = Must, `S` = Should, `C` = Could (mengikuti §7.1–§7.2).

---

## 1. Prinsip Desain untuk Konteks Ini

Konteks pengikat: vendor mayoritas gaptech, Android RAM 2–3 GB, sinyal desa lemah, kuota terbatas (§3.2, §4.1 P3); pelanggan literasi digital rendah–menengah (§4.1 P1–P2); WhatsApp adalah kanal utama (§2.2 D-15, §15.2).

| # | Prinsip | Konsekuensi konkret | Rujukan |
|---|---|---|---|
| 1 | **Satu layar, satu tugas.** | Layar Kalender hanya mengubah tanggal. Paket, profil, dan rekening punya layar sendiri. Tidak ada tab campuran "Kelola" yang menggabungkan tiga tugas. | §4.1 P3 "tidak mau mengisi aplikasi"; §15.1 aktivasi butuh 1–2 kunjungan |
| 2 | **Ikon tidak pernah berdiri sendiri.** | Setiap ikon punya label teks di bawah/sampingnya. Navigasi bawah memakai ikon + kata ("Beranda", "Pesanan", "Kalender", "Akun"), bukan ikon saja. | §4.1 P1/P3 keahlian teknis rendah–menengah |
| 3 | **Satu tombol primer per layar, di jangkauan jempol.** | Tombol aksi utama menempel di bawah layar (bukan di header), tinggi ≥48dp, lebar penuh. Aksi sekunder menjadi teks. | §8.3 NFR-029; pemakaian satu tangan malam hari §4.1 P1 |
| 4 | **Kalender adalah layar utama vendor, bukan menu tersier.** | Kalender menjadi salah satu dari 4 tab utama. Status "belum diisi" harus terbaca tanpa legenda tambahan. | §2.2 D-10; §7.2 FR-108; §9.1 "vendor aktif" diukur dari `calendar_updated_at` |
| 5 | **Uang ditulis sebagai "yang kamu terima", bukan persentase.** | Di layar terima booking: harga pelanggan, komisi platform, dan **dana bersih vendor** dalam rupiah. Persentase hanya penjelas sekunder. | §2.2 D-17; §5.3 posisi vendor Rp 3.536.400; §5.10 biaya layanan wajib terpisah |
| 6 | **Setiap aksi bisa diulang tanpa mengulang isian.** | Form onboarding dan form booking menyimpan draf lokal per langkah. Aksi yang gagal karena sinyal masuk antrean, bukan error yang menghapus data. | §8.3 NFR-033; §2.2 D-11 idempotensi |
| 7 | **Vendor tidak wajib membuka aplikasi untuk menerima order.** | Notifikasi WhatsApp memuat semua angka yang dibutuhkan untuk memutuskan. Aplikasi adalah tempat melihat riwayat, bukan syarat menjawab. | §2.2 D-15; §7.2 FR-111; §4.2 P3 "jawab tanpa buka aplikasi" |
| 8 | **Bahasa sehari-hari, tanpa istilah sistem.** | Label memakai kata yang dipakai vendor di percakapan sehari-hari (§5.3). Tidak ada "escrow", "payout", "settlement", "slot", "timeout" di UI. | §8.3 NFR-032; §4.1 P3 |

**Yang sengaja tidak dilakukan:** animasi transisi antar-layar, video autoplay, ilustrasi besar, onboarding carousel, fitur banding vendor (FR-016 baru Fase 4 §7.1), chat dalam aplikasi (di luar Fase 1 §6.2).

---

## 2. Inventaris Layar

Kode state: **L** = memuat, **K** = kosong, **J** = gagal jaringan, **S** = gagal server, **O** = offline, **B** = berhasil, **D** = ditolak/diblokir. Rincian tiap state ada di §4. Layar bersama yang dipakai kedua peran (S-01, S-02) ada di §2.4.

### 2.1 Pelanggan (P1, P2)

| ID | Layar | Tujuan tunggal | Masuk dari | Aksi utama | State wajib | Fase |
|---|---|---|---|---|---|---|
| C-01 | Beranda | Mulai pencarian dengan tanggal + lokasi | Buka aplikasi, tab Beranda | "Cari grup hiburan" | L, K, J, O, B | 1 |
| C-02 | Cari & Filter | Persempit kategori, tanggal, lokasi, harga | C-01, "Ubah" di C-03 | "Tampilkan grup" | L, J, S, B | 1 |
| C-03 | Hasil Pencarian | Pilih satu vendor dari daftar yang benar-benar kosong di tanggal itu | C-01, C-02 | Buka kartu vendor | L, K, J, S, O, B | 1 |
| C-04 | Detail Vendor | Putuskan paket yang dipakai | C-03 | "Pilih paket ini" | L, K, J, S, O, B, D | 1 |
| C-05 | Form Booking | Isi detail acara dan kirim permintaan | C-04, "Pesan lagi" di C-11 | "Kirim permintaan" | L, J, O, B, D | 1 |
| C-06 | Ringkasan Sebelum Kirim | Pastikan tanggal, paket, dan estimasi biaya benar | C-05 | "Kirim permintaan" | J, O, B, D | 1 |
| C-07 | Status Permintaan | Tahu posisi permintaan tanpa menebak | Setelah kirim, notifikasi, C-10 | "Lihat pesanan" / "Cari grup lain" | L, J, S, O, B, D | 1 |
| C-08 | Pembayaran DP | Bayar uang muka sekali, tanpa ragu soal nominal | C-07 (accepted), notifikasi | "Bayar uang muka" | L, J, S, O, B, D | 1 |
| C-09 | Status Pembayaran | Tahu apakah uang sudah masuk | C-08, notifikasi | "Cek status" | L, J, S, O, B, D | 1 |
| C-10 | Daftar Pesanan | Temukan pesanan yang sedang berjalan | Tab Pesanan | Buka pesanan | L, K, J, O, B | 1 |
| C-11 | Detail Pesanan | Jalankan hari-H dan lihat status uang | C-10, notifikasi | "Konfirmasi acara selesai", "Ada masalah" | L, J, S, O, B, D | 1 |
| C-12 | Lapor Masalah & Unggah Bukti | Kirim bukti dengan tenang saat masalah terjadi | C-11 | "Kirim laporan" | L, J, S, O, B, D | 1 (no-show FR-119), 2 (sengketa FR-056) |
| C-13 | Pelunasan | Lunasi sisa tagihan sebelum acara | C-11, pengingat H-7 | "Bayar pelunasan" | L, J, S, O, B, D | 1 |
| C-14 | Akun & Pengaturan | Ubah data, unduh dokumen, hapus akun | Tab Akun | "Hapus akun", "Unduh nota" | L, J, B, D | 1 |
| C-15 | Notifikasi | Lihat riwayat pemberitahuan | Lonceng di Beranda | Buka pesanan terkait | L, K, J, O, B | 1 |
| C-16 | Favorit | Simpan vendor untuk hajatan berikutnya | C-04, tab Akun | Buka vendor | L, K, J, O, B | 1 (Should FR-015) |

### 2.2 Vendor (P3)

| ID | Layar | Tujuan tunggal | Masuk dari | Aksi utama | State wajib | Fase |
|---|---|---|---|---|---|---|
| V-01 | Onboarding 1 — Identitas & Kategori | Isi identitas grup dan kategori | Daftar → pilih "Vendor" | "Lanjut" | L, J, O, B, D | 1 |
| V-02 | Onboarding 2 — Media & Lisensi | Unggah foto/video dan nyatakan lisensi | V-01 | "Lanjut" | L, K, J, O, B, D | 1 |
| V-03 | Onboarding 3 — Rekening | Tetapkan satu rekening pencairan | V-02 | "Lanjut" | L, J, S, B, D | 1 |
| V-04 | Onboarding 4 — Paket & Harga | Buat minimal satu paket | V-03 | "Lanjut" | L, K, J, O, B, D | 1 |
| V-05 | Onboarding 5 — Ringkasan & Kirim | Kirim pengajuan lengkap atau berhenti dengan draf | V-04 | "Kirim pengajuan" | L, J, O, B, D | 1 |
| V-06 | Status Pengajuan | Tahu keputusan admin dan apa yang harus diperbaiki | Setelah kirim, notifikasi | "Perbaiki & kirim ulang" | L, J, S, O, B, D | 1 |
| V-07 | Beranda Vendor | Tahu apa yang perlu dikerjakan hari ini | Tab Beranda | Buka order masuk / kalender | L, K, J, S, O, B | 1 |
| V-08 | Order Masuk | Lihat permintaan yang belum dijawab beserta sisa waktu | Tab Pesanan, notifikasi | Buka detail order | L, K, J, S, O, B | 1 |
| V-09 | Detail Order & Jawab | Putuskan terima/tolak dengan angka jelas | V-08, tautan WA | "Terima", "Tolak", "Tawar harga" | L, J, O, B, D | 1 |
| V-10 | Kalender | Lihat dan ubah status tanggal | Tab Kalender | Ketuk tanggal | L, K, J, S, O, B, D | 1 |
| V-11 | Isi Banyak Tanggal | Tandai beberapa tanggal sekaligus dengan cepat | V-10 | "Simpan" | J, O, B, D | 1 |
| V-12 | Paket & Harga | Kelola paket dan harga musiman | Tab Akun | "Tambah paket" | L, K, J, O, B, D | 1 |
| V-13 | Profil & Portofolio | Kelola tampilan publik grup | Tab Akun | "Simpan perubahan" | L, J, O, B, D | 1 |
| V-14 | Rekening & Pencairan | Kelola rekening tujuan dan lihat dana | Tab Akun | "Ganti rekening" | L, K, J, S, O, B, D | 1 (rekening), 2 (saldo) |
| V-15 | Job Hari-H & Check-in | Buktikan kehadiran di lokasi | Notifikasi hari-H, V-07 | "Saya sudah sampai" | L, J, O, B, D | 2 (FR-117) |
| V-16 | Notifikasi Vendor | Riwayat pemberitahuan | Lonceng | Buka order | L, K, J, O, B | 1 |
| V-17 | Akun Vendor | Ganti vendor aktif, hapus akun | Tab Akun | "Hapus akun" | L, J, B, D | 1 |

### 2.3 Admin (P5, panel web — ringkas)

| ID | Layar | Tujuan tunggal | Masuk dari | Aksi utama | State wajib | Fase |
|---|---|---|---|---|---|---|
| A-01 | Antrean Kerja | Tahu apa yang menunggu hari ini | Login admin | Buka antrean | L, K, J, S, B | 1 |
| A-02 | Verifikasi Vendor | Putuskan pengajuan vendor dengan alasan | A-01 | "Setujui" / "Tolak" | L, K, J, S, B, D | 1 |
| A-03 | Moderasi Media | Setujui atau tolak media sebelum tayang | A-01 | "Setujui" / "Tolak" | L, K, J, S, B, D | 1 |
| A-04 | Daftar Booking | Cari dan periksa satu booking | A-01 | Buka detail | L, K, J, S, B | 1 |
| A-05 | Rilis Dana | Rilis dana per booking dengan dua approver | A-04 | "Ajukan rilis" / "Setujui" | L, K, J, S, B, D | 1 |
| A-06 | Refund Manual | Kembalikan uang dengan alasan dan bukti | A-04 | "Ajukan refund" | L, J, S, B, D | 1 |
| A-07 | Kebijakan & Versi | Ubah komisi/DP/wilayah sebagai versi baru | Menu Pengaturan | "Terbitkan versi" | L, J, B, D | 1 |
| A-08 | Audit Log | Telusuri aksi admin tanpa bisa mengubahnya | Menu Audit | Filter & ekspor | L, K, J, S, B | 1 |
| A-09 | Rekonsiliasi Harian | Tutup selisih gateway vs ledger sebelum 09.00 | A-01 | "Tandai selesai" | L, K, J, S, B, D | 1 |
| A-10 | Suspend Vendor | Hentikan vendor bermasalah dan bekukan dananya | A-02, A-04 | "Suspend" | J, B, D | 1 |
| A-11 | Antrean No-show & Laporan | Tangani kasus hari-H dan laporan pengguna | A-01 | "Buka kasus" | L, K, J, S, B | 1 |

**Layar yang tidak dibuat di Fase 1:** chat (§6.2 "di luar cakupan"), ulasan, saldo & penarikan mandiri, event multi-vendor, ekspor laporan vendor. Jangan menaruh tombol mati untuk fitur ini.

### 2.4 Layar bersama (pelanggan & vendor)

| ID | Layar | Tujuan tunggal | Masuk dari | Aksi utama | State wajib | Fase |
|---|---|---|---|---|---|---|
| S-01 | Registrasi, OTP & Persetujuan | Membuat akun dengan satu nomor HP dan satu persetujuan | Buka aplikasi pertama kali | "Kirim kode", "Lanjut" | L, J, S, O, B, D | 1 |
| S-02 | Pilih Peran | Menentukan satu peran aktif | Selesai OTP | Pilih "Saya pesan hiburan" / "Saya punya grup" | L, J, B | 1 |

---

## 3. Alur Kritis

Format tiap alur: prasyarat → langkah bernomor → titik keputusan → jalur gagal. Alur yang menyentuh uang selalu berakhir di status yang bisa dilihat pelanggan, bukan di layar kosong.

### 3.a Onboarding vendor dengan sinyal lemah

**Rujukan:** §15.1 (tahap Pendaftaran–Aktivasi), FR-001, FR-002, FR-003, FR-100, FR-103, FR-104, FR-140, §8.3 NFR-033.
**Prasyarat:** vendor sudah dihubungi agen dan bersedia mendaftar. Agen mendampingi **di perangkat vendor**, bukan mengunggah dari akun agen (tidak ada konsol agen di PRD).
**Target:** pendaftaran selesai per kunjungan ≥60% (§15.1).

| # | Langkah | Layar | Wajib terlihat | Kalau gagal di sini |
|---|---|---|---|---|
| 1 | Masukkan nomor HP, terima kode 6 angka lewat WhatsApp | S-01 | Kolom nomor + tombol "Kirim kode"; hitungan percobaan tersisa | Kode tidak masuk → "Kirim ulang" setelah 60 detik; percobaan ke-6 ditolak (FR-100) |
| 2 | Setujui Syarat & Ketentuan serta Kebijakan Privasi | S-01 | Nama versi dokumen + tanggal berlaku | Tidak setuju → pendaftaran berhenti, tidak ada akun dibuat (FR-103) |
| 3 | Pilih peran "Vendor" | S-02 | Dua kartu besar: "Saya pesan hiburan" / "Saya punya grup" | Salah pilih → bisa ganti sebelum pengajuan dikirim (FR-002) |
| 4 | Isi nama grup, kategori (boleh lebih dari satu), area layanan | V-01 | Jumlah kategori terpilih terlihat; minimal 1 kategori | Keluar aplikasi → draf dipulihkan di langkah ini |
| 5 | Foto KTP pimpinan | V-01 | Bingkai panduan, peringatan "di tempat terang", pratinjau hasil | Buram/terpotong → "Foto kurang jelas, ulangi" sebelum dikirim; tidak lanjut ke langkah berikutnya (FR-003) |
| 6 | Unggah foto grup + sampel video/audio, lalu nyatakan lisensi tiap media | V-02 | Progres per file, status per file, tombol ulang per file | Sinyal putus → file yang sudah selesai tetap tersimpan, hanya file gagal yang diulang |
| 7 | Isi rekening bank tujuan pencairan | V-03 | Nama pemilik rekening + peringatan harus sama dengan KTP | Nama tidak cocok → ditolak sebelum kirim; verifikasi manual admin bila perlu (FR-104) |
| 8 | Buat paket pertama (durasi, jumlah personel, fasilitas, harga dasar) | V-04 | Contoh pengisian; harga dasar berlabel "harga mulai dari" | Tidak ada paket → pengajuan tidak bisa dikirim (FR-003) |
| 9 | Periksa ringkasan, kirim pengajuan | V-05 | Daftar item lengkap + item yang kurang ditandai | Offline → tombol berubah "Kirim saat sinyal ada", isian tetap utuh |
| 10 | Tunggu keputusan admin ≤2 hari kerja | V-06 | Status + tanggal perkiraan + nomor agen pendamping | Ditolak → alasan per item + tombol "Perbaiki & kirim ulang" (FR-004) |
| 11 | Setelah disetujui, isi kalender 3 bulan ke depan | V-10 | Ajakan mengisi kalender, bukan layar sukses kosong | Belum diisi → vendor tetap tayang tetapi ditandai "kalender belum lengkap" ke agen (FR-108, §15.1) |

**Titik keputusan**
- **Langkah 6:** vendor ingin memakai video lama dari galeri, bukan rekam baru. Keputusan: dua pilihan setara ("Rekam sekarang" / "Pilih dari galeri"); video >60 detik dipotong otomatis atau ditolak dengan penjelasan durasi.
- **Langkah 7:** rekening atas nama orang lain (istri/kru). Keputusan: ditolak dengan penjelasan, rujuk ke agen; bukan jalan pintas "lewati dulu".
- **Langkah 10:** pengajuan ditolak karena media. Keputusan: hanya item yang salah yang dibuka ulang; langkah 4–8 tidak diulang.

**Jalur gagal**

| Kegagalan | Yang dilihat vendor | Aksi tersedia | Data yang dipertahankan |
|---|---|---|---|
| Sinyal putus saat unggah video 20 MB | Progres berhenti di angka terakhir, label "menunggu sinyal" | "Lanjutkan" per file, "Kirim nanti" | Semua field + file yang sudah terunggah |
| Aplikasi tertutup paksa (RAM 2 GB) | Saat dibuka: "Isianmu sudah disimpan" + kembali ke langkah terakhir | "Lanjutkan" / "Mulai ulang langkah ini" | Draf lokal seluruh langkah |
| Kode OTP tidak pernah masuk | Hitungan 60 detik + tombol "Kirim lewat SMS" | Kirim ulang, ganti nomor | Nomor + peran terpilih |
| KTP ditolak admin | Alasan spesifik ("foto bagian belakang tidak terbaca") | Foto ulang hanya field itu | Semua data lain |
| Vendor tidak punya email | Form tidak pernah meminta email | — | — |

### 3.b Vendor mengisi kalender massal (≤30 detik per tanggal)

**Rujukan:** FR-020, FR-021, FR-022, FR-023 (AC ≤30 detik), FR-024 (Should), FR-108, §8.3 NFR-033.
**Prasyarat:** vendor sudah disetujui dan tayang (FR-010).
**Target waktu:** 1 tanggal = 2 ketukan (ketuk tanggal → pilih status). Tidak ada dialog konfirmasi; koreksi lewat "Urungkan".

| # | Langkah | Layar | Wajib terlihat | Kalau gagal di sini |
|---|---|---|---|---|
| 1 | Buka tab Kalender | V-10 | Bulan berjalan + 2 bulan berikutnya bisa digeser | Offline → tampil kalender terakhir yang tersimpan + label "data per <tanggal>" |
| 2 | Baca 4 status: belum diisi, kosong bisa dipesan, sudah ada job, diblokir | V-10 | Legenda 4 status selalu terlihat, bukan disembunyikan di menu | Vendor salah paham "belum diisi" → lihat §10 T-04 |
| 3 | Ketuk satu tanggal | V-10 | Lembar bawah: 3 tombol besar (Bisa dipesan / Sudah ada job / Blokir) + nama tanggal | Tanggal sudah dibooking → tombol "Bisa dipesan" nonaktif dengan alasan (FR-021) |
| 4 | Pilih status | V-10 | Status berubah langsung di grid; muncul "Urungkan" 10 detik | Server menolak (bentrok) → tanggal kembali ke status lama + alasan |
| 5 | Untuk banyak tanggal: tekan "Isi banyak tanggal" | V-11 | Mode pilih: ketuk beberapa tanggal, penghitung "7 tanggal dipilih" | — |
| 6 | Pilih satu status untuk semua tanggal terpilih, lalu "Simpan" | V-11 | Ringkasan "7 tanggal ditandai bisa dipesan" | Sebagian gagal → daftar per tanggal: berhasil / gagal + alasan |
| 7 | Untuk job offline: tanggal → "Sudah ada job" → isi nama acara (opsional) | V-10 | Tanggal langsung memblokir pencarian | Offline → tersimpan di antrean, label "menunggu kirim" (FR-023) |

**Titik keputusan**
- **Langkah 3:** tanggal sudah "sudah ada job" dari booking platform. Keputusan: tidak bisa diubah ke "bisa dipesan" dari aplikasi; arahkan ke Detail Order untuk pembatalan (FR-021, §6.2 FR-022 anti double booking).
- **Langkah 4:** vendor ingin siang dan malam berbeda. Keputusan: bila multi-sesi aktif, tombol status membuka pilihan sesi (Siang / Malam / Sehari penuh) (FR-024 Should).
- **Langkah 6:** rentang panjang (mis. sebulan penuh ramai). Keputusan: tetap multi-pilih per tanggal; tidak ada "pilih semua bulan" untuk mencegah salah blokir massal.

**Jalur gagal**

| Kegagalan | Yang dilihat | Aksi | Data |
|---|---|---|---|
| Offline saat menyimpan | Grid sudah berubah + label "menunggu kirim" per tanggal | "Coba kirim sekarang" | Perubahan tersimpan lokal, maksimal 20 aksi antre (NFR-033) |
| Beda perangkat, kalender sudah berubah di tempat lain | Grid lama + spanduk "Kalender sudah diperbarui di perangkat lain" | "Muat ulang" | Perubahan lokal yang belum terkirim ditahan, tidak ditimpa diam-diam |
| Tanggal jatuh di masa lalu | Tanggal tidak bisa diketuk | — | — |
| Perubahan tercermin di pencarian >60 detik | Label "sedang diperbarui" pada tanggal terkait | "Muat ulang" | Status lokal dipertahankan sampai server mengonfirmasi (FR-020 AC) |

### 3.c Vendor menerima booking dari WhatsApp → aplikasi (dan jalur tanpa aplikasi)

**Rujukan:** FR-031, FR-032, FR-111, FR-112, FR-143, FR-021, §2.2 D-15, §9.2 `booking_responded.channel`.
**Prasyarat:** pelanggan sudah mengirim permintaan (FR-030).

| # | Langkah | Kanal | Wajib terlihat | Kalau gagal di sini |
|---|---|---|---|---|
| 1 | Sistem mengirim pesan WhatsApp ke nomor vendor | WA | — | Nomor tidak aktif → push + masuk daftar agen (FR-112) |
| 2 | Vendor membaca isi pesan: tanggal, nama acara, paket, lokasi, harga pelanggan, komisi, **dana diterima**, batas jawab 24 jam | WA | Semua angka dalam rupiah, bukan persentase saja | Pesan terpotong → tautan "Lihat di aplikasi" di badan pesan |
| 3 | Vendor menekan tombol **Terima** | WA | Tombol quick-reply hanya Terima / Tolak (FR-111) | Token kedaluwarsa / sudah dipakai → balasan "Tautan sudah tidak berlaku, buka aplikasi" |
| 4 | Sistem mencatat respons ≤60 detik, mengunci tanggal, memberi tahu pelanggan | Server | — | Webhook gagal → vendor menerima balasan "Belum tercatat, coba lagi"; tidak ada status setengah jadi |
| 5 | Vendor membuka aplikasi (opsional) dan melihat order berstatus "menunggu pembayaran DP" | V-09 / V-08 | Sisa waktu pembayaran pelanggan + apa yang terjadi bila pelanggan tidak bayar | — |
| 6 | Bila vendor butuh menawar harga atau menolak dengan alasan, ia membuka V-09 | V-09 | Alasan penolakan terstruktur (tanggal terisi / di luar radius / harga / kapasitas / lain-lain) | Menolak tanpa alasan → tombol "Tolak" meminta pilihan alasan lebih dulu (FR-143 Should) |

**Jalur tanpa membuka aplikasi.** Langkah 2–4 selesai seluruhnya di WhatsApp. Aplikasi tidak diperlukan untuk memutuskan, sesuai §4.2 P3 ("jawab tanpa harus buka aplikasi"). Yang tidak bisa dilakukan dari WA: tawar harga, lihat riwayat, ubah kalender.

**Titik keputusan**
- **Langkah 3:** vendor menekan Terima pada booking yang sudah kedaluwarsa (melewati 24 jam). Keputusan: ditolak dengan pesan "Waktu jawab sudah habis. Tanggal ini sudah dibuka lagi." (FR-032).
- **Langkah 3:** vendor menekan Terima dua kali. Keputusan: token sekali pakai; tekanan kedua diabaikan tanpa pesan error (FR-111).
- **Langkah 6:** vendor ingin menerima tetapi tanggalnya sudah diisi manual sebagai job offline. Keputusan: blok — "Tanggal ini sudah kamu tandai ada job. Periksa kalender dulu." (FR-021, FR-022).

**Jalur gagal**

| Kegagalan | Yang dilihat vendor | Aksi | Efek pada pelanggan |
|---|---|---|---|
| WA tidak terkirim (nomor mati) | Tidak ada apa pun di WA; push masuk bila aplikasi terpasang | Agen menelepon ≤4 jam (FR-112) | Status tetap "menunggu jawaban", tidak ada perubahan diam-diam |
| Vendor tidak merespons 4 jam | Agen menelepon dan mencatat respons atas nama vendor | Respons telepon dicatat dengan identitas agen | Sama seperti respons vendor, dengan jejak audit |
| Vendor tidak merespons 24 jam | Pesan terakhir "Waktu jawab habis" | — | Booking expired ≤5 menit setelah deadline, tanggal dilepas (FR-032) |
| Vendor menerima lalu sadar salah | Status accepted + tombol "Batalkan" di V-09 | Pembatalan butuh konfirmasi + alasan | Pelanggan diberi tahu + refund dihitung dari snapshot kebijakan booking (FR-044, FR-114) |

### 3.d Pelanggan cari → bandingkan → kirim booking (maks 3 langkah dari beranda)

**Rujukan:** FR-012, FR-013, FR-014, FR-030, FR-110, FR-108, FR-033 (Should), §4.2 P1.
**Target:** dari Beranda ke "permintaan terkirim" dalam 3 langkah dan ≤5 menit (§4.2 P1 kriteria sukses).
**Hitungan langkah:** (1) Cari, (2) pilih vendor + paket di halaman detail, (3) isi dan kirim. Membuka detail bukan langkah tambahan; ia adalah satu ketukan drill-down dari kartu hasil.

| # | Langkah | Layar | Wajib terlihat | Kalau gagal di sini |
|---|---|---|---|---|
| 1 | Isi tanggal acara + lokasi, tekan "Cari grup hiburan" (kategori opsional, default "Semua") | C-01 | Tanggal + kecamatan + kategori dalam satu kartu; tidak ada form panjang | Tanggal kosong → tombol nonaktif dengan alasan "Isi tanggal acara dulu" |
| 2 | Pilih vendor dari daftar hasil, buka detail, pilih paket | C-03 → C-04 | Harga "mulai dari", jarak, jumlah personel, status tanggal terpilih, media | 0 hasil → lihat jalur gagal di bawah |
| 3 | Isi detail acara di form, periksa ringkasan, kirim | C-05 → C-06 | Tanggal, jam/sesi, lokasi, jenis acara, estimasi tamu, catatan, estimasi total + biaya layanan 1% + transport | Kirim gagal → draf tersimpan, bisa kirim ulang tanpa mengisi ulang (FR-115) |

**Perbandingan tanpa fitur banding.** FR-016 (bandingkan 3 vendor) baru Fase 4, jadi perbandingan dilakukan di dalam daftar hasil: setiap kartu menampilkan harga mulai dari, jarak, jumlah personel, dan status tanggal. Tidak ada layar "bandingkan" dan tidak ada tabel pembanding di Fase 1.

**Titik keputusan**
- **Langkah 1:** pelanggan tidak tahu kategori grup yang diinginkan. Keputusan: kategori opsional; hasil menampilkan semua kategori dengan label kategori di tiap kartu (FR-012, FR-106).
- **Langkah 2:** tanggal yang dipilih ternyata sudah diambil orang lain sesudah pencarian. Keputusan: kartu ditandai "tanggal baru saja diambil" dan tidak bisa dibuka untuk tanggal itu; tawarkan 3 vendor lain di tanggal sama (v1.0 §4.3).
- **Langkah 3:** harga musiman membuat total berbeda dari "mulai dari". Keputusan: selisih dijelaskan di ringkasan sebelum kirim, dan harga final baru terkunci saat vendor menerima (FR-110, D-13).

**Jalur gagal**

| Kegagalan | Yang dilihat | Aksi | Data |
|---|---|---|---|
| 0 hasil untuk tanggal + radius | "Belum ada grup di tanggal ini." + 3 saran: tanggal terdekat, perluas jarak, hapus filter harga | Salah satu saran sekali ketuk | Filter asli tersimpan agar bisa dikembalikan |
| Semua hasil berstatus "belum diisi" | Hasil kosong + penjelasan "Grup di sekitar belum mengisi jadwal." | "Cari di tanggal lain" | — (jangan pernah menampilkan "belum diisi" sebagai tersedia, FR-108) |
| Kirim gagal karena sinyal | "Tersimpan di HP. Akan dikirim saat sinyal ada." + status "menunggu kirim" | "Coba kirim sekarang", "Batalkan" | Draf penuh + `Idempotency-Key` agar tidak dobel (FR-115) |
| Tanggal terisi tepat saat mengirim | "Tanggal ini baru saja diambil orang lain." | Pilih tanggal lain / lihat 3 alternatif | Isian form dipertahankan |
| Vendor menolak / kedaluwarsa | C-07 dengan alasan + 3 vendor serupa | "Cari grup lain" | Detail acara dipakai ulang untuk permintaan berikutnya |
| Pelanggan menutup aplikasi di tengah form | Saat dibuka: "Lanjutkan pesanan yang belum dikirim?" | Lanjutkan / buang | Draf lokal |

### 3.e Pelanggan membayar DP (QRIS/VA) termasuk state menunggu & gagal

**Rujukan:** FR-040, FR-041, FR-042, FR-043, FR-044, FR-046 (Should), FR-073 (kebijakan DP), §5.10, §8.3 NFR-033.
**Prasyarat:** vendor sudah menerima (accepted). Tanggal sudah terkunci sejak penerimaan (FR-021); DP mengubah status pembayaran, bukan kepemilikan tanggal.
**Batas waktu bayar:** ditampilkan sebagai hitung mundur; nilainya mengikuti pengaturan admin (FR-073). Angka default belum ditetapkan PRD → **[ASUMSI-UX] 24 jam**.

| # | Langkah | Layar | Wajib terlihat | Kalau gagal di sini |
|---|---|---|---|---|
| 1 | Buka C-08 dari notifikasi atau C-07 | C-08 | Hitung mundur + nama vendor + tanggal acara | Sesi habis → login ulang, kembali ke C-08 yang sama |
| 2 | Baca rincian: harga paket, biaya layanan 1%, transport (bila ada), total, **DP 30%**, sisa pelunasan | C-08 | Setiap baris punya label; tidak ada angka tanpa penjelasan (§5.10) | Harga berubah karena aturan musiman → C-08 memuat harga final dari accept, bukan "mulai dari" (FR-110) |
| 3 | Pilih metode: QRIS / transfer bank (VA) / e-wallet | C-08 | Tiga pilihan dengan ikon + label, bukan ikon saja | Metode tidak tersedia → pilihan dinonaktifkan dengan alasan, bukan error setelah ditekan |
| 4 | Layar tunggu: instruksi + nomor VA/QR + hitung mundur + "Cek status" | C-09 | Kalimat "Jangan bayar dua kali" + nominal yang harus dibayar | Pengguna menutup aplikasi → status dicek ulang saat dibuka |
| 5 | Pembayaran masuk, status berubah ≤60 detik | C-09 → C-11 | "Pembayaran diterima" + tanggal terkunci + langkah berikutnya (pelunasan H-7) | Webhook terlambat → status "menunggu konfirmasi", bukan "gagal" |
| 6 | Nota dapat diunduh/dibagikan | C-14 / C-11 | Tombol "Unduh nota" (FR-046 Should) | — |

**Titik keputusan**
- **Langkah 2:** pelanggan keberatan pada biaya layanan. Keputusan: biaya dijelaskan satu baris ("biaya layanan platform 1%") dan tidak bisa dihapus; tidak ada negosiasi di layar ini.
- **Langkah 3:** pelanggan memilih transfer bank lalu tidak menemukan nomor VA. Keputusan: VA ditampilkan dengan tombol "Salin" + nominal persis, dan peringatan bahwa nominal berbeda tidak terdeteksi otomatis.
- **Langkah 5:** pelanggan sudah bayar tetapi status tetap menunggu >15 menit. Keputusan: tampilkan tombol "Hubungi CS" + nomor WhatsApp, jangan menampilkan "gagal".

**Jalur gagal**

| Kegagalan | Yang dilihat | Aksi | Perilaku sistem |
|---|---|---|---|
| QR/VA kedaluwarsa | "Kode bayar sudah kedaluwarsa." + tombol buat kode baru | "Buat kode baru" | Kode lama mati; tidak ada tagihan ganda (FR-040) |
| Pembayaran ditolak bank | Alasan singkat dari penyedia + nominal tetap | "Coba metode lain" | Status tetap belum dibayar |
| Sinyal putus setelah menekan "Bayar" | "Kami belum tahu status pembayaranmu." + "Cek status" | Cek status manual | Cek otomatis maksimal 6× (interval 10 detik), lalu berhenti agar kuota tidak habis |
| Pelanggan membayar dua kali | Peringatan + tombol "Laporkan pembayaran ganda" | Lapor ke CS | Kelebihan dikembalikan lewat refund manual (FR-133) |
| Waktu bayar habis | "Waktu pembayaran habis. Tanggal dibuka lagi." | "Cari grup lain" | Booking kedaluwarsa; tanggal dilepas (FR-032 analog untuk DP) |
| Vendor membatalkan setelah DP | Status pembatalan + penjelasan + estimasi uang kembali | "Lihat rincian uang kembali" | Refund manual dengan approver kedua; status terlihat ≤1 jam (FR-133, FR-044) |

### 3.f Check-in hari-H dengan sinyal buruk

**Rujukan:** FR-117 (Must Fase 2), FR-063 (Should Fase 2), FR-051, FR-052 (Should Fase 1), §10.1 on-call hari-H, §8.3 NFR-033.
**Catatan fase:** check-in GPS formalnya Fase 2. Pola antrean offline-nya harus sudah dipakai di Fase 1 oleh kalender (FR-023), agar vendor tidak belajar dua perilaku berbeda.

| # | Langkah | Layar | Wajib terlihat | Kalau gagal di sini |
|---|---|---|---|---|
| 1 | H-1 dan hari-H vendor menerima pengingat berisi tombol "Buka job" | WA / push | Tanggal, jam, lokasi, nama acara | Vendor tidak membuka WA → push; tetap tidak → agen menelepon (§10.1) |
| 2 | Buka V-15: satu kartu job berisi alamat, jam, kontak pelanggan, kebutuhan teknis | V-15 | Alamat + tombol "Buka di peta" + tombol telepon | Peta gagal dimuat → alamat teks tetap tampil lengkap |
| 3 | Tekan "Saya sudah sampai" | V-15 | Tombol besar di bawah layar; status "mencari lokasi…" maksimal 10 detik | GPS tidak dapat → lanjut tanpa lokasi, ditandai "perlu verifikasi" |
| 4 | Ambil foto panggung/lokasi | Kamera | Pratinjau + tombol "Pakai foto" / "Ulangi" | Kamera gagal → kirim GPS lebih dulu, foto menyusul dari antrean |
| 5 | Kirim check-in | V-15 | Status "Terkirim" + jam kirim | Offline → "Tersimpan. Akan dikirim saat sinyal ada." |
| 6 | Pelanggan melihat "Grup sudah tiba di lokasi" | C-11 | Jam check-in + foto | — |

**Titik keputusan**
- **Langkah 3:** vendor tiba di luar radius 2 km (mis. lokasi acara bergeser). Keputusan: check-in tetap diterima dan ditandai "perlu verifikasi", bukan diblokir (FR-117 AC).
- **Langkah 4:** vendor menolak izin kamera. Keputusan: check-in tetap bisa dikirim dengan GPS saja, ditandai kurang bukti; jangan memblokir vendor di lapangan.
- **Langkah 5:** vendor sudah check-in lalu acara batal di lokasi. Keputusan: gunakan "Laporkan masalah", bukan membatalkan check-in.

**Jalur gagal**

| Kegagalan | Yang dilihat | Aksi | Data |
|---|---|---|---|
| Tidak ada sinyal sama sekali | "Tersimpan. Akan dikirim saat sinyal ada." + jam perangkat | "Coba kirim sekarang" | GPS + foto + waktu perangkat tersimpan lokal, bertahan setelah aplikasi ditutup |
| Baterai/HP mati sebelum terkirim | Setelah HP menyala: "Ada 1 check-in belum terkirim" | Kirim | Antrean persisten |
| Check-in terkirim 3 jam terlambat | Status "terkirim terlambat" + jam asli perangkat | — | Admin melihat dua waktu (perangkat vs server) untuk menilai (§10.3 langkah 4) |
| GPS aktif tetapi tidak akurat (>500 m) | Label "lokasi kurang tepat" | Ambil ulang | Check-in tetap tersimpan |
| Vendor tidak check-in sama sekali | Pelanggan melihat "Belum ada kabar dari grup" + tombol "Ada masalah" | Lapor | Masuk jalur no-show, antrean prioritas ≤2 jam (FR-119) |

### 3.g Sengketa: pelanggan mengunggah bukti

**Rujukan:** FR-119 (no-show, Must Fase 1), FR-123 (lapor, Must Fase 1), FR-056/FR-072 (sengketa, Must Fase 2), FR-118 (jendela H+7), FR-122 (klaim pasca-pencairan), §10.3 playbook.
**Dua pintu, satu layar:** C-12 dibuka dengan pilihan "Grup tidak datang" (jalur no-show Fase 1) atau "Tidak sesuai janji" (jalur sengketa Fase 2). Jangan gabungkan menjadi satu tombol "Sengketa" — pelanggan tidak memakai kata itu.

| # | Langkah | Layar | Wajib terlihat | Kalau gagal di sini |
|---|---|---|---|---|
| 1 | Dari C-11, tekan "Ada masalah dengan pesanan ini" | C-11 | Tombol tersedia sejak hari-H sampai H+7 | Lewat H+7 → tombol berubah jadi "Hubungi CS" (FR-118) |
| 2 | Pilih jenis masalah dari daftar | C-12 | 5 pilihan: grup tidak datang / tidak sesuai paket / kualitas / batal mendadak / pembayaran | — |
| 3 | Tulis kronologi singkat (maks 500 karakter) + tanggal kejadian | C-12 | Contoh pengisian satu baris | Kronologi kosong → tidak bisa kirim, dengan alasan jelas |
| 4 | Lampirkan bukti: foto/video, maksimal 5 file | C-12 | Progres per file, ukuran tiap file, tombol hapus per file | File terlalu besar → dikompres otomatis; bila tetap gagal, tampilkan batasnya |
| 5 | Kirim laporan | C-12 | Ringkasan: "Laporan diterima. Kami hubungi kamu maksimal 1 hari." + nomor tiket | Offline → draf bukti tersimpan, bisa dilanjutkan |
| 6 | Dana untuk booking itu dibekukan otomatis; pelanggan melihat status "sedang ditinjau" | C-11 | Tahapan: diterima → bukti diminta → ditinjau → diputuskan (§10.2) | Bila dana sudah cair → status "klaim setelah pencairan", jalur clawback ≤30 hari (FR-122) |
| 7 | Pelanggan menerima keputusan tertulis + cara banding | C-11 | Alasan keputusan + nominal + tenggat banding 5 hari kerja | Banding → satu tingkat, diputuskan `admin_super` (§10.2) |

**Titik keputusan**
- **Langkah 2:** pelanggan memilih "grup tidak datang" padahal grup datang terlambat. Keputusan: pertanyaan penyaring "Apakah grup datang sama sekali?" sebelum jenis masalah ditetapkan, agar klasifikasi kasus benar (§10.3 langkah 2).
- **Langkah 4:** pelanggan hanya punya tangkapan layar chat WA. Keputusan: tangkapan layar diterima; jangan menuntut format tertentu.
- **Langkah 5:** pelanggan mengirim laporan pada H+8. Keputusan: jalur normal ditutup, tetapi "Hubungi CS" tetap ada; jangan sembunyikan kanal bantuan.

**Jalur gagal**

| Kegagalan | Yang dilihat | Aksi | Data |
|---|---|---|---|
| Unggah 5 foto gagal semua | Daftar file dengan status "gagal" masing-masing | "Coba lagi" per file | Kronologi + jenis masalah tetap tersimpan |
| Aplikasi tertutup saat unggah | "Laporanmu belum terkirim" + lanjutkan | "Lanjutkan laporan" | Draf + file terpilih |
| Laporan terkirim dua kali | Hanya satu tiket; percobaan kedua diarahkan ke tiket yang ada | "Lihat laporan" | Kunci idempotensi per booking + jenis (FR-115) |
| Vendor membantah | Status "bukti sedang diperiksa", pelanggan bisa menambah bukti ≤24 jam | "Tambah bukti" | Berkas bukti tersimpan per pihak |
| Keputusan tidak sesuai harapan | Alasan + rujukan snapshot kebijakan booking | "Ajukan banding" | Snapshot kebijakan tidak berubah (FR-114) |

---

## 4. State Wajib per Layar Kunci

Aturan umum:
- **Cache dipakai** hanya untuk data yang boleh basi: kalender, daftar pesanan, detail vendor yang sudah dibuka. **Tidak pernah** untuk status pembayaran, saldo, atau keputusan sengketa.
- Semua state error memuat: apa yang terjadi (1 kalimat), apa yang bisa dilakukan (1 tombol), dan apakah data pengguna aman.
- Tidak ada spinner tanpa batas: setelah 10 detik, spinner berubah menjadi pesan + tombol "Coba lagi".
- Tidak ada state kosong tanpa jalan keluar.

### 4.1 V-10 Kalender

| State | Yang dilihat | Aksi | Cache |
|---|---|---|---|
| Memuat | Grid bulan dengan placeholder abu-abu, legenda tetap tampil | — | Tampilkan bulan tersimpan bila ada, dengan label "memuat" |
| Kosong (belum pernah diisi) | Grid penuh status "belum diisi" + kartu ajakan "Isi 3 bulan ke depan" + tombol "Mulai isi" | "Mulai isi", "Isi banyak tanggal" | Tidak perlu cache |
| Gagal jaringan | Grid terakhir + spanduk "Sinyal lemah. Kalender mungkin belum terbaru." + jam data terakhir | "Coba lagi", tetap bisa melihat | **Ya**, data terakhir |
| Gagal server | "Kalender sedang tidak bisa dimuat." + jam percobaan terakhir | "Coba lagi" | **Ya**, hanya baca; edit dinonaktifkan dengan alasan |
| Offline | Spanduk "Kamu sedang offline" + perubahan lokal berlabel "menunggu kirim" | Ubah tanggal (masuk antrean), "Kirim sekarang" | **Ya**, baca + tulis antrean (maks 20) |
| Berhasil simpan | Grid berubah + "Urungkan" 10 detik | "Urungkan" | Status lokal langsung |
| Ditolak (tanggal terkunci booking) | Lembar bawah: "Tanggal ini sudah dipesan." + nama acara + tombol "Lihat pesanan" | Lihat pesanan, tutup | — |

### 4.2 V-08 / V-09 Order Masuk & Detail Order

| State | Yang dilihat | Aksi | Cache |
|---|---|---|---|
| Memuat | 3 kartu placeholder + jumlah order "memuat" | — | — |
| Kosong | "Belum ada permintaan masuk." + penjelasan singkat cara order datang + pengingat isi kalender | "Isi kalender" | — |
| Gagal jaringan | Daftar terakhir + spanduk "Sinyal lemah" | "Coba lagi", buka order dari cache (baca saja) | **Ya**, daftar + detail |
| Gagal server | "Order tidak bisa dimuat sekarang." | "Coba lagi" | **Ya**, baca saja; tombol jawab nonaktif |
| Offline | Spanduk offline; tombol "Terima"/"Tolak" nonaktif dengan alasan "Butuh sinyal untuk menjawab" | Lihat detail dari cache | **Ya** |
| Berhasil jawab | Status berubah + konfirmasi "Pesanan diterima. Tanggal dikunci." | "Lihat kalender" | Status lokal |
| Ditolak | "Pesanan ini sudah kedaluwarsa." atau "Tanggal sudah dipakai job lain." | "Tutup" | — |

### 4.3 C-03 Hasil Pencarian

| State | Yang dilihat | Aksi | Cache |
|---|---|---|---|
| Memuat | 3 kartu placeholder dengan bentuk kartu sebenarnya (bukan spinner penuh layar) | — | — |
| Kosong | "Belum ada grup di tanggal ini." + 3 saran (tanggal terdekat / perluas jarak / hapus harga) | Terapkan saran sekali ketuk | Filter tersimpan untuk kembali |
| Gagal jaringan | Pesan "Sinyal sedang lemah. Coba lagi." + tombol | "Coba lagi" | Hasil terakhir untuk filter sama, bila ada |
| Gagal server | "Pencarian sedang bermasalah." + jam | "Coba lagi" | Tidak |
| Offline | "Kamu sedang offline. Hasil terakhir tetap bisa dilihat." | Lihat hasil lama (tanpa tombol pesan) | **Ya**, hasil terakhir |
| Berhasil | Daftar kartu + jumlah hasil + filter aktif terlihat | Buka kartu | Ya |
| Ditolak/blokir | Bila tanggal tidak valid: "Tanggal sudah lewat." | "Ubah tanggal" | — |

### 4.4 C-08 / C-09 Pembayaran DP & Status Pembayaran

| State | Yang dilihat | Aksi | Cache |
|---|---|---|---|
| Memuat | Rincian biaya dengan placeholder per baris; nominal tidak pernah tampil setengah | — | Tidak |
| Kosong | Tidak berlaku (selalu ada tagihan) | — | — |
| Gagal jaringan | "Kami belum bisa membuat tagihan." + nominal tidak ditampilkan | "Coba lagi" | Tidak |
| Gagal server | "Pembayaran sedang tidak bisa diproses." + nomor CS | "Coba lagi", "Hubungi CS" | Tidak |
| Offline | Tombol "Bayar uang muka" nonaktif + "Butuh sinyal untuk membayar." | Lihat rincian dari cache (baca saja) | **Ya**, rincian saja |
| Menunggu (bukan error) | "Kami sedang menunggu pembayaranmu." + hitung mundur + nominal + "Jangan bayar dua kali." | "Cek status" (otomatis maks 6×) | Tidak |
| Berhasil | "Pembayaran diterima." + tanggal terkunci + langkah berikutnya | "Lihat pesanan", "Unduh nota" | Status final di-cache; tidak bisa dibalik oleh cache basi |
| Ditolak/gagal | Alasan singkat + nominal yang benar | "Coba metode lain", "Buat kode baru" | Tidak |

### 4.5 V-01 s.d. V-05 Onboarding Vendor

| State | Yang dilihat | Aksi | Cache |
|---|---|---|---|
| Memuat | Form dengan kerangka field; progres langkah terlihat | — | Draf lokal langsung dirender |
| Kosong | Setiap langkah punya contoh isian singkat, bukan halaman kosong | "Mulai" | — |
| Gagal jaringan | "Sinyal sedang lemah." + isian tetap di layar | "Coba lagi", "Lanjut nanti" | **Ya**, semua field |
| Gagal server | "Pengajuan belum bisa diproses." + isian aman | "Coba lagi" | **Ya**, semua field |
| Offline | Spanduk offline; unggah file masuk antrean; langkah tanpa unggah tetap bisa diisi | "Simpan & lanjut nanti" | **Ya**, draf + file |
| Berhasil | "Pengajuan sudah dikirim." + perkiraan 2 hari + nomor agen | "Lihat status pengajuan" | Draf dikunci jadi pengajuan |
| Ditolak (validasi) | Field bermasalah ditandai merah + alasan di bawah field | Perbaiki field itu | Field lain utuh |

### 4.6 C-12 Lapor Masalah & Unggah Bukti

| State | Yang dilihat | Aksi | Cache |
|---|---|---|---|
| Memuat | Form + daftar file placeholder | — | — |
| Kosong (belum ada file) | Kotak "Tambahkan foto atau video" + batas ukuran jelas | Ambil foto / pilih galeri | — |
| Gagal jaringan | File berstatus "gagal" satu per satu, bukan seluruh form | "Coba lagi" per file | Kronologi + file terpilih |
| Gagal server | "Laporan belum terkirim." + nomor tiket sementara tidak ditampilkan | "Coba lagi" | **Ya** |
| Offline | "Tersimpan. Akan dikirim saat sinyal ada." | "Kirim nanti" | **Ya**, termasuk file |
| Berhasil | "Laporan diterima." + nomor tiket + tahapan + SLA 1 hari | "Lihat status" | Tiket di-cache |
| Ditolak (lewat jendela) | "Batas lapor H+7 sudah lewat." + tombol CS | "Hubungi CS" | — |

### 4.7 State untuk layar lain (ringkas)

| Layar | State minimum yang wajib dirancang | Catatan |
|---|---|---|
| C-01 Beranda | L, J, O, B | Beranda tidak boleh punya state kosong: kategori selalu tersedia dari cache |
| C-04 Detail Vendor | L, J, S, O, B, D | D = vendor dinonaktifkan/di-suspend: tampilkan "Grup ini tidak tersedia" (FR-132) |
| C-11 Detail Pesanan | L, J, S, O, B, D | Dua state berbeda: "menunggu jawaban grup" dan "ditolak" |
| V-06 Status Pengajuan | L, J, S, O, B, D | D = ditolak, alasan per item |
| V-11 Isi Banyak Tanggal | J, O, B, D | D = sebagian tanggal bentrok, daftar per tanggal |
| V-15 Job Hari-H | L, J, O, B, D | O = inti alur; D = di luar jendela waktu check-in |
| A-02 Verifikasi Vendor | L, K, J, S, B, D | D = pengajuan tidak lengkap (data hilang) |
| A-05 Rilis Dana | L, K, J, S, B, D | D = menunggu approver kedua; status harus eksplisit, bukan tombol mati |

---

## 5. Copy Indonesia Sederhana

Aturan: maksimal 12 kata per kalimat; tidak ada istilah teknis; sapaan "kamu" untuk pelanggan dan vendor; angka rupiah selalu utuh (`Rp 3.536.400`, bukan `3,5 jt` di layar keputusan uang); tanggal `dd-mm-yyyy` (§8.3 NFR-032).

### 5.1 Padanan istilah

| Istilah internal / PRD | Kata di UI | Alasan | Rujukan |
|---|---|---|---|
| booking (kata benda) | **Pesanan** (pelanggan), **Order masuk** (vendor) | Dipakai sehari-hari di kedua sisi | §4.1 P1/P3 |
| booking (kata kerja) | **Pesan** / **Kirim permintaan** | "Booking" tidak diucapkan vendor | §4.1 P3 |
| DP | **Uang muka (DP)** — "DP" hanya muncul dalam kurung | Orang hajatan mengenal "DP" tetapi tidak selalu "down payment" | §5.2 |
| escrow / dana ditahan | **Uang ditahan aman** | Menjelaskan manfaat, bukan mekanisme | §2.1, D-01 |
| refund | **Uang kembali** | Kata yang dipakai saat mengurus di bank | FR-044 |
| payout / pencairan | **Pencairan ke rekening** | "Payout" asing bagi vendor | FR-045 |
| settlement | **Dana diteruskan ke grup** | Menghindari istilah finansial | §10.3 |
| komisi | **Potongan platform** (dengan angka rupiah) | Persentase saja tidak dipahami | D-17, §5.10 |
| biaya layanan pelanggan | **Biaya layanan** | Lebih pendek di rincian | §5.10 |
| sengketa / dispute | **Laporan masalah** | Pelanggan tidak menyebut "sengketa" | FR-056 |
| clawback | **Tagihan susulan** | Menjelaskan konsekuensi, bukan mekanisme | FR-122 |
| slot / tanggal terkunci | **Tanggal sudah dipesan** | Kata benda konkret | FR-021 |
| expired | **Waktu habis** | Bukan "kedaluwarsa" di tombol | FR-032 |
| no-show | **Grup tidak datang** | Kalimat lengkap, bukan label | FR-119 |
| completed | **Acara selesai** | Sama dengan yang diucapkan pelanggan | FR-118 |
| OTP | **Kode 6 angka** | Tidak menyebut singkatan | FR-001 |
| verifikasi vendor | **Pengajuan diperiksa** | Proses, bukan status teknis | FR-004 |
| counter-offer | **Tawar harga** | Umum di pasar lokal | FR-031 |
| VA / virtual account | **Transfer bank** + nomor rekening tujuan | Nomor tetap ditampilkan, istilahnya tidak | FR-040 |
| invoice | **Nota** | Lebih dikenal untuk pertanggungjawaban panitia | FR-046 |
| suspend | **Dinonaktifkan sementara** | Menjelaskan durasi, bukan sanksi permanen | FR-132 |

### 5.2 Tabel copy

| ID | Momen | Layar | Teks | Kata |
|---|---|---|---|---|
| K-01 | Tombol utama beranda | C-01 | "Cari grup hiburan" | 3 |
| K-02 | Tombol filter | C-03 | "Ubah tanggal atau lokasi" | 4 |
| K-03 | Judul hasil kosong | C-03 | "Belum ada grup di tanggal ini." | 6 |
| K-04 | Aksi hasil kosong | C-03 | "Coba tanggal terdekat" | 3 |
| K-05 | Penjelasan hasil kosong karena kalender | C-03 | "Grup di sekitar belum mengisi jadwal." | 6 |
| K-06 | Tombol pilih paket | C-04 | "Pilih paket ini" | 3 |
| K-07 | Label harga di kartu | C-03, C-04 | "Mulai dari Rp 4.000.000" | 5 |
| K-08 | Tombol kirim form | C-05, C-06 | "Kirim permintaan" | 2 |
| K-09 | Peringatan sebelum kirim | C-06 | "Grup punya waktu 24 jam untuk menjawab." | 8 |
| K-10 | Konfirmasi terkirim | C-07 | "Permintaan sudah dikirim." | 3 |
| K-11 | Status menunggu | C-07 | "Menunggu jawaban grup." | 3 |
| K-12 | Status ditolak | C-07 | "Grup belum bisa menerima tanggal ini." | 6 |
| K-13 | Status waktu habis | C-07 | "Waktu habis. Tanggal sudah dibuka lagi." | 6 |
| K-14 | Tombol bayar | C-08 | "Bayar uang muka" | 3 |
| K-15 | Label rincian biaya | C-08 | "Biaya layanan" | 2 |
| K-16 | Instruksi bayar | C-09 | "Bayar sesuai jumlah di atas. Jangan bayar dua kali." | 9 |
| K-17 | State menunggu bayar | C-09 | "Kami sedang menunggu pembayaranmu." | 4 |
| K-18 | Pembayaran gagal | C-09 | "Pembayaran belum masuk. Coba lagi." | 5 |
| K-19 | Error jaringan | semua | "Sinyal sedang lemah. Coba lagi." | 5 |
| K-20 | Error server | semua | "Ada gangguan di sistem kami. Coba beberapa saat lagi." | 9 |
| K-21 | Offline | semua | "Kamu sedang offline. Data terakhir tetap bisa dilihat." | 8 |
| K-22 | Antrean kirim | C-05, V-10 | "Tersimpan di HP. Akan dikirim saat sinyal ada." | 9 |
| K-23 | Tombol lanjut onboarding | V-01..V-05 | "Lanjut" | 1 |
| K-24 | Draf tersimpan | V-01..V-05 | "Isianmu sudah disimpan." | 3 |
| K-25 | Unggah gagal | V-02 | "Foto gagal diunggah. Coba lagi." | 5 |
| K-26 | KTP buram | V-01 | "Foto kurang jelas. Ulangi di tempat terang." | 7 |
| K-27 | Nama rekening beda | V-03 | "Nama di rekening berbeda dengan nama KTP." | 7 |
| K-28 | Pengajuan terkirim | V-05, V-06 | "Pengajuan sudah dikirim. Kami periksa maksimal 2 hari." | 9 |
| K-29 | Judul kalender kosong | V-10 | "Belum ada tanggal yang diisi." | 5 |
| K-30 | Legenda kalender | V-10 | "Belum diisi" / "Bisa dipesan" / "Sudah ada job" / "Kamu blokir" | 2–3 |
| K-31 | Konfirmasi isi massal | V-11 | "7 tanggal ditandai bisa dipesan." | 5 |
| K-32 | Undo | V-10 | "Tanggal diubah. Urungkan" | 3 |
| K-33 | Konfirmasi terima order | V-09 | "Terima pesanan ini?" | 3 |
| K-34 | Konsekuensi terima | V-09 | "Tanggal ini akan dikunci. Kamu terima Rp 3.536.400." | 9 |
| K-35 | Pertanyaan alasan tolak | V-09 | "Kenapa ditolak?" | 2 |
| K-36 | Konfirmasi batal | V-09, C-11 | "Batalkan pesanan? Uang muka dihitung ulang sesuai aturan." | 8 |
| K-37 | Tombol check-in | V-15 | "Saya sudah sampai" | 3 |
| K-38 | Check-in offline | V-15 | "Check-in tersimpan. Akan dikirim saat sinyal ada." | 8 |
| K-39 | Tombol lapor | C-11 | "Ada masalah dengan pesanan ini" | 5 |
| K-40 | Aksi tambah bukti | C-12 | "Tambahkan foto atau video" | 4 |
| K-41 | Laporan diterima | C-12 | "Laporan diterima. Kami hubungi kamu maksimal 1 hari." | 8 |
| K-42 | Hapus akun | C-14, V-17 | "Hapus akun? Data pribadi dihapus dalam 30 hari." | 8 |
| K-43 | Dana belum cair | V-14 | "Dana masuk 3 hari kerja setelah acara." | 7 |
| K-44 | Batas lapor lewat | C-12 | "Batas lapor sudah lewat. Hubungi CS." | 6 |

**Aturan tambahan**
- Tidak ada kalimat yang dimulai dengan "Error", "Gagal memuat data", atau kode angka.
- Kode kesalahan tidak pernah tampil ke pengguna; hanya nomor tiket yang bisa disebut ke CS.
- Pesan konfirmasi selalu menyebut akibat, bukan hanya pertanyaan ("Batalkan pesanan?" bukan cukup).
- Angka rupiah di layar keputusan memakai pemisah titik penuh, tanpa "jt" atau "rb" (kecuali di kartu hasil, di mana "Rp 3 jt" boleh dipakai sebagai ringkasan yang tidak mengikat).

---

## 6. Aksesibilitas & Perangkat Lemah

### 6.1 Target dan ukuran

| Aspek | Ketetapan | Rujukan |
|---|---|---|
| Area sentuh | ≥48×48 dp, jarak antar-target ≥8 dp; tombol utama lebar penuh, tinggi 56 dp | NFR-029 |
| Kontras | ≥4,5:1 untuk teks normal, ≥3:1 untuk teks ≥18sp tebal dan ikon status | NFR-028 |
| Ukuran font | Body ≥16sp; label tombol ≥18sp; judul layar ≥22sp; teks bantu ≥14sp dan tidak dipakai untuk informasi penting | NFR-031 |
| Skala teks | Harus utuh pada 130% tanpa pemotongan; tidak ada tinggi baris tetap; tombol tumbuh, bukan teks yang terpotong | NFR-031 |
| Status kalender | Tidak boleh dibedakan hanya dengan warna: warna + pola/ikon + label teks saat diketuk | NFR-028 |
| Bahasa | Indonesia default, IDR, WIB, `dd-mm-yyyy` | NFR-032 |
| Pembaca layar | 8 alur kritis selesai dengan TalkBack/VoiceOver; setiap tombol punya label aksi, bukan "tombol 1" | NFR-030, §15.3 |

### 6.2 Media dan kuota

| Aspek | Ketetapan | Rujukan |
|---|---|---|
| Foto yang diunggah | Maksimal 10 MB per file dari kamera/galeri; dikompres ke ≤300 KB sebelum dikirim; pratinjau sebelum unggah | NFR-034, **[ASUMSI-UX]** batas 10 MB |
| Video | Maksimal 60 detik; default 480p; tanpa autoplay; tombol putar eksplisit | NFR-034, §10.4 (moderator: video ≤60 detik) |
| Jumlah file per laporan | Maksimal 5 file; setiap file punya progres, status, dan tombol hapus sendiri | **[ASUMSI-UX]** |
| Indikator unggah | Progres per file (persen atau "3 dari 5"), bukan spinner global; file selesai tidak diulang saat file lain gagal | NFR-033 |
| Batas bersamaan | Maksimal 2 unggahan berjalan pada satu waktu untuk perangkat RAM 2–3 GB | **[ASUMSI-UX]** |
| Data per sesi | ≤20 MB per 10 menit; gambar daftar dimuat bertahap (lazy), video hanya saat diminta | NFR-012, NFR-034 |

### 6.3 Animasi dan beban render

| Aturan | Ketetapan |
|---|---|
| Animasi | Hanya transisi opacity/posisi ≤200 ms. Tidak ada parallax, blur, atau animasi layar penuh saat berpindah layar. |
| Skeleton | Maksimal 1 pola skeleton per layar, tanpa efek shimmer berjalan (cukup warna statis). |
| List | Muat 10 item per halaman; gambar berukuran tetap agar layout tidak melompat. |
| Peta | Tidak dimuat otomatis; hanya saat tombol "Buka di peta" ditekan. |
| Efek khusus | Tidak ada confetti, getaran berulang, atau suara. Getaran satu kali hanya untuk konfirmasi check-in. **[ASUMSI-UX]** |

### 6.4 Anggaran request per layar

| Layar | Maksimal request saat pertama dibuka | Aturan tambahan |
|---|---|---|
| C-01 Beranda | 2 (sesi + kategori/wilayah) | Tidak ada request pencarian sebelum pengguna menekan "Cari" |
| C-03 Hasil | 1 per halaman | Pencarian diketik manual ditunda 400 ms (debounce); maksimal 1 request per jeda |
| C-04 Detail | 1 + 3 media pertama | Media lain dimuat saat digulir |
| C-08 Pembayaran | 1 (buat tagihan) | Pembuatan tagihan tidak diulang otomatis; hanya lewat tombol |
| C-09 Status bayar | 1 + cek otomatis maks 6× (interval 10 detik) | Setelah 6× berhenti, sisakan tombol manual agar kuota tidak habis |
| V-10 Kalender | 1 per bulan yang dibuka | Bulan berikutnya hanya saat digeser |
| V-08 Order Masuk | 1 | Tidak ada polling; pembaruan lewat push |
| Semua layar | ≤60 request/menit per pengguna | NFR-022 |

**Larangan:** tidak ada refresh otomatis berkala di latar belakang; tidak ada pengambilan lokasi di luar layar check-in; tidak ada unggahan otomatis saat aplikasi dibuka.

---

## 7. Anti-Kesalahan

### 7.1 Aksi merusak dan konfirmasinya

| Aksi | Tingkat risiko | Perlakuan | Rujukan |
|---|---|---|---|
| Batalkan pesanan (pelanggan) | Tinggi — menyangkut uang | Dialog menyebut akibat uang kembali + pihak yang menanggung biaya; butuh pilihan alasan; tidak ada undo | FR-044, D-03 |
| Batalkan pesanan (vendor) | Tinggi — merugikan pelanggan | Konfirmasi dua tahap: alasan terstruktur lalu ringkasan akibat; notifikasi pelanggan otomatis | FR-044, FR-143 |
| Blokir tanggal | Sedang | Tanpa dialog; langsung berubah + "Urungkan" 10 detik | FR-020 |
| Ubah status tanggal yang sudah dipesan | Tinggi | Tombol nonaktif + alasan; perubahan hanya lewat pembatalan pesanan | FR-021, FR-022 |
| Hapus paket | Sedang | Dialog menyebut apakah paket dipakai pesanan aktif; tidak bisa dihapus bila sedang dipakai | FR-011 |
| Ganti rekening | Tinggi — menyangkut dana | Konfirmasi + penjelasan masa tunggu 7 hari + notifikasi ke nomor lama | FR-105 |
| Hapus akun | Tinggi | Dua langkah: pilih alasan, lalu ketik nomor HP untuk konfirmasi; jelaskan data yang dihapus dan yang disimpan | FR-101 |
| Suspend vendor (admin) | Tinggi | Wajib alasan + ringkasan dampak (listing hilang, pencairan beku, jumlah pesanan aktif) | FR-132 |

### 7.2 Undo, validasi, dan double-tap

| Mekanisme | Ketetapan |
|---|---|
| Undo | Hanya untuk aksi yang tidak menyentuh uang: status kalender, hapus favorit, ubah catatan. Jendela 10 detik, satu kali. |
| Tanpa undo | Pembatalan pesanan, refund, rilis dana, ganti rekening, hapus akun — semuanya pakai konfirmasi, bukan undo. |
| Validasi inline | Diperiksa saat field kehilangan fokus, bukan saat mengetik; pesan muncul di bawah field + penanda ikon; field lain tidak dikunci. |
| Validasi akhir | Validasi menyeluruh baru di langkah terakhir (V-05, C-06), dengan daftar item yang kurang. |
| Nomor HP | Format 08xxxxxxxxxx; kesalahan format ditampilkan sebelum menekan "Kirim kode", bukan setelah OTP terkirim. |
| Tanggal acara | Tanggal lampau tidak bisa dipilih; tanggal hari ini diperbolehkan dengan catatan "acara hari ini". |
| Double-tap | Setiap tombol yang mengirim data langsung nonaktif setelah ditekan (label berubah "Mengirim…"); kunci idempotensi mencegah duplikasi di server |
| Kembali | Tombol kembali tidak pernah membuang isian; bila ada perubahan belum tersimpan, tampilkan "Simpan dulu?" dengan pilihan Simpan / Buang / Batal. |
| Isian salah berulang | Setelah 3 percobaan gagal pada field yang sama, tampilkan bantuan tambahan (contoh gambar/foto KTP yang benar) + nomor agen/CS. |

### 7.3 Menampilkan konsekuensi komisi secara jujur (sebelum vendor menerima)

Layar V-09 dan pesan WhatsApp wajib memuat blok yang sama, dengan urutan tetap:

```
Harga paket                        Rp 4.000.000
Biaya layanan (dibayar pelanggan)  Rp    40.000
──────────────────────────────────────────────
Total dibayar pelanggan            Rp 4.040.000
Potongan platform                  Rp   400.000
Biaya gateway & transfer           Rp    63.600
──────────────────────────────────────────────
Kamu terima                        Rp 3.536.400
```

| Aturan | Ketetapan | Rujukan |
|---|---|---|
| Selalu rupiah | "Potongan platform Rp 400.000", bukan "komisi 10%". Persentase boleh muncul sebagai penjelas kecil di bawah angka. | D-17, §5.3 |
| Tarif bertingkat | Untuk transaksi >Rp 10 juta, tampilkan rincian dua lapis: 10% sampai Rp 10 juta + 5% di atasnya, plus lantai Rp 25.000 dan batas Rp 7.500.000. | D-17 |
| Biaya pihak ketiga | Biaya gateway dan transfer ditampilkan terpisah agar vendor tahu itu bukan pendapatan platform. | §5.3 |
| Tanpa kejutan | Tidak boleh ada potongan yang muncul setelah vendor menerima. Semua angka pada layar konfirmasi sama dengan angka di pesan WA dan di nota. | FR-110, FR-043 |
| Konsekuensi tanggal | Satu baris sebelum tombol Terima: "Tanggal ini akan dikunci." | FR-021 |
| Bila pelanggan tidak bayar | Sebutkan akibatnya: "Kalau pelanggan tidak membayar dalam 24 jam, tanggal terbuka lagi." | FR-032, **[ASUMSI-UX]** 24 jam |
| Pembatalan | Sebelum menerima, vendor bisa melihat akibat pembatalan (bagian uang yang menjadi haknya) sesuai kebijakan booking. | FR-044, FR-114 |
| Aksesibilitas angka | Blok rincian bisa dibaca pembaca layar sebagai satu kalimat utuh, bukan tujuh angka lepas. | NFR-030 |

---

## 8. Handoff WhatsApp

### 8.1 Prinsip

1. WhatsApp dipakai untuk **memberi tahu dan meminta satu keputusan**, bukan untuk bernegosiasi atau memindahkan uang. Rujukan: §2.2 D-15, §4.2 P3.
2. Setiap pesan memuat cukup informasi untuk bertindak tanpa membuka aplikasi (untuk terima/tolak), atau tautan yang jelas bila tindakan hanya ada di aplikasi.
3. Tidak ada angka yang muncul pertama kali di WhatsApp lalu berbeda di aplikasi. Sumber angka sama: harga final saat accept (FR-110) dan potongan sesuai D-17.
4. Semua balasan masuk lewat webhook dan dicatat sebagai respons dengan kanal (`app`/`wa`/`phone`) sesuai §9.2 `booking_responded.channel`. Tidak ada status yang diubah manual tanpa jejak.
5. Percakapan bebas (grup WA pribadi) tidak menjadi bukti resmi. Bukti resmi: pesan template, snapshot syarat booking (FR-114), check-in, dan rekaman agen (§10.3).

### 8.2 Kapan percakapan pindah ke WhatsApp

| Momen | Pemicu | Pengirim | Isi wajib | Balasan sah | Kembali ke aplikasi |
|---|---|---|---|---|---|
| Kode masuk | Pendaftaran / login | Sistem | Kode 6 angka, masa berlaku, peringatan "jangan bagikan" | — (kode diketik di aplikasi) | Sesi aktif setelah verifikasi (FR-001) |
| Order baru | Booking dibuat | Sistem | Tanggal, nama acara, paket, lokasi, harga pelanggan, potongan, **dana diterima**, batas jawab 24 jam, tombol Terima/Tolak | Terima / Tolak (+ alasan) | Webhook mencatat respons ≤60 detik, status berubah di C-07/V-09 (FR-111) |
| Pengingat jawab | 4 jam tanpa respons | Sistem | "Order ini belum dijawab. Sisa waktu X jam." | Terima / Tolak | Sama; bila tetap diam, agen menelepon (FR-112) |
| Pesanan diterima | Vendor menekan Terima | Sistem | Nominal DP, batas waktu bayar pelanggan, apa yang terjadi bila pelanggan tidak bayar | — | Status di C-07 dan V-09 |
| DP diterima | Webhook pembayaran sukses | Sistem | Nominal, tanggal acara, "tanggal sudah dikunci" | — | Status pembayaran di C-11 |
| Pengingat pelunasan | H-7 dan H-1 | Sistem | Sisa tagihan, cara bayar, tenggat | — | C-13 |
| Pengingat hari-H | Hari-H pagi | Sistem | Jam, alamat, kontak, tombol "Buka job" | — | V-15 |
| Info pencairan | Acara selesai | Sistem | Nominal bersih, perkiraan tanggal masuk rekening | — | V-14 (Fase 2) |
| Status laporan | Laporan masalah dibuat / diputuskan | Sistem | Nomor tiket, tahap, tenggat, keputusan + alasan | Tambah bukti (tautan) | C-11/C-12 |
| Pendampingan agen | Vendor tidak merespons WA 4 jam | Agen (manusia) | Ringkasan order + pertanyaan keputusan | Terima / Tolak / minta waktu | Agen mencatat respons atas nama vendor + jejak audit (FR-112) |
| Bantuan umum | Pengguna menekan "Hubungi CS" | Pengguna | — | Bebas | Tiket CS; keluhan tentang pesanan ditautkan ke nomor pesanan |

### 8.3 Yang tidak boleh lewat WhatsApp

| Larangan | Alasan | Rujukan |
|---|---|---|
| Negosiasi harga final | Harga harus tercatat pada snapshot booking, bukan di percakapan | FR-110, FR-114 |
| Instruksi transfer ke rekening pribadi | Semua pembayaran lewat gateway | D-01 |
| Persetujuan refund | Wajib approver kedua dan alasan tertulis di panel admin | FR-133, FR-128 |
| Perubahan tanggal acara | Harus lewat alur reschedule agar slot dan kebijakan ikut berubah | FR-037 (Fase 2) |
| Pengumuman perubahan kebijakan | Harus lewat notifikasi resmi dengan versi | FR-130, FR-137 |

### 8.4 Aturan teknis pesan

| Aturan | Ketetapan |
|---|---|
| Token tombol | Sekali pakai, kedaluwarsa bersama batas jawab booking; penggunaan ulang ditolak (FR-111) |
| Bahasa pesan | Sama dengan copy aplikasi (§5); maksimal 12 kata per kalimat; angka rupiah utuh |
| Ukuran pesan | Satu pesan = satu keputusan. Rincian panjang diringkas; tautan aplikasi disediakan |
| Kegagalan kirim | Dicatat di `outbox_messages`; percobaan ulang otomatis terbatas, lalu push + daftar agen (FR-051, FR-112) |
| Nomor berubah | Wajib verifikasi ulang OTP sebelum nomor baru menerima pesan transaksi (v1.0 §4.3) |
| Riwayat | Nomor pesan template disimpan agar CS bisa menelusuri apa yang diterima vendor (§10.2) |

---

## 9. Peta Layar → FR

### 9.1 Layar → requirement yang dilayani

| Layar | FR yang dilayani | AC kunci yang harus terbukti di layar | Fase |
|---|---|---|---|
| S-01 Registrasi & OTP | FR-001, FR-100, FR-103 | Daftar + OTP ≤2 menit; percobaan ke-6 ditolak; versi ToS tersimpan | 1 |
| S-02 Pilih Peran | FR-002 | Tepat 1 peran aktif, 2 alur berbeda | 1 |
| C-01 Beranda | FR-012 | Titik mulai pencarian; filter tanggal/lokasi terbaca | 1 |
| C-02 Cari & Filter | FR-012, FR-106 | Filter tanggal/lokasi/harga akurat pada 50 kasus; kategori multi | 1 |
| C-03 Hasil Pencarian | FR-012, FR-014, FR-108 | 0 vendor terpesan/diblokir muncul; "belum diisi" bukan hasil | 1 |
| C-04 Detail Vendor | FR-013, FR-110 | Paket, portofolio, status tanggal; "mulai dari Rp X" | 1 |
| C-05 Form Booking | FR-030, FR-022 | Kirim ≤900 ms; tanggal/lokasi/paket/estimasi tersimpan utuh | 1 |
| C-06 Ringkasan Sebelum Kirim | FR-110, FR-114, FR-115 | Harga final saat accept; snapshot syarat; 1 booking per key | 1 |
| C-07 Status Permintaan | FR-031, FR-032 | Deadline 24 jam terlihat; expired ≤5 menit setelah deadline | 1 |
| C-08 Pembayaran DP | FR-040, FR-043 | QRIS/VA/e-wallet; 0 pembayaran ganda pada 100 retry | 1 |
| C-09 Status Pembayaran | FR-040, FR-051 | Status ≤60 detik setelah webhook | 1 |
| C-10 Daftar Pesanan | FR-051, FR-118 | Status tiap pesanan terbaca tanpa membuka detail | 1 |
| C-11 Detail Pesanan | FR-118, FR-119, FR-044, FR-133 | Auto-complete H+3; tandai no-show; status refund ≤1 jam | 1 |
| C-12 Lapor Masalah & Bukti | FR-123, FR-119 | Lapor ≤3 klik; tiket otomatis; tinjauan ≤1×24 jam | 1 (FR-123, FR-119), 2 (FR-056) |
| C-13 Pelunasan | FR-041 | Sisa tagihan Rp 0 setelah lunas; pengingat H-7 dan H-1 | 1 |
| C-14 Akun & Pengaturan | FR-101, FR-046 | Hapus akun ≤30 hari dengan status terlihat; nota terunduh | 1 |
| C-15 Notifikasi | FR-051, FR-052 | 6 perubahan status utama; pengingat H-7/H-1/hari-H | 1 |
| C-16 Favorit | FR-015 | Favorit tersimpan dan muncul di profil | 1 (Should) |
| V-01 Onboarding 1 | FR-003, FR-106, FR-002 | Pengajuan tidak terkirim bila identitas kurang; multi-kategori | 1 |
| V-02 Onboarding 2 | FR-140, FR-107 | Media tanpa pernyataan lisensi tidak bisa diajukan | 1 |
| V-03 Onboarding 3 | FR-104 | Nama rekening harus cocok; rilis diblokir bila belum verified | 1 |
| V-04 Onboarding 4 | FR-011 | Paket dibuat/diubah; harga identik di detail dan form | 1 |
| V-05 Onboarding 5 | FR-003, FR-010 | Tidak bisa kirim bila KTP/media/rekening kurang; profil tayang ≤2 menit setelah approve | 1 |
| V-06 Status Pengajuan | FR-004, FR-010 | Keputusan ≤2 hari kerja dengan alasan; perbaikan per item | 1 |
| V-07 Beranda Vendor | FR-031, FR-108 | Jumlah order belum dijawab; pengingat tanggal belum diisi | 1 |
| V-08 Order Masuk | FR-031, FR-032 | Deadline 24 jam terlihat pada 100% booking masuk | 1 |
| V-09 Detail Order & Jawab | FR-031, FR-111, FR-112, FR-143, FR-021 | Respons ≤1 menit; kanal tercatat; alasan terstruktur | 1 |
| V-10 Kalender | FR-020, FR-021, FR-022, FR-023, FR-108, FR-024 | 4 status berbeda; job offline ≤30 detik; perubahan ≤60 detik di pencarian | 1 |
| V-11 Isi Banyak Tanggal | FR-020, FR-023 | Banyak tanggal, satu status, hasil per tanggal | 1 |
| V-12 Paket & Harga | FR-011, FR-109 | Aturan musiman per rentang; harga tertinggi berlaku tercatat | 1 |
| V-13 Profil & Portofolio | FR-010, FR-107, FR-140 | Profil memuat ≥1 media approved + ≥1 area layanan | 1 |
| V-14 Rekening & Pencairan | FR-104, FR-105 | Cooling 7 hari; notifikasi ke nomor lama; 0 rilis ke rekening baru | 1 (rekening), 2 (saldo) |
| V-15 Job Hari-H & Check-in | FR-117, FR-063 | GPS + foto + timestamp; di luar radius ditandai | 2 |
| V-16 Notifikasi Vendor | FR-051, FR-052 | Push ≤60 detik untuk 6 status utama | 1 |
| V-17 Akun Vendor | FR-101, FR-102 | Satu akun ≥2 vendor terpisah; hapus akun ≤30 hari | 1 |
| A-01 Antrean Kerja | FR-070, FR-129 | Tiap peran hanya melihat antrean yang boleh ia putuskan | 1 |
| A-02 Verifikasi Vendor | FR-004, FR-070, FR-132 | Keputusan beralasan, tercatat audit | 1 |
| A-03 Moderasi Media | FR-071, FR-107, FR-140 | 0 media tayang sebelum approved; SLA ≤1×24 jam | 1 |
| A-04 Daftar Booking | FR-070 | Cari dan ubah status booking; 0 aksi tanpa audit | 1 |
| A-05 Rilis Dana | FR-042, FR-043, FR-128 | 0% dana ke rekening platform; 2 approver >Rp 1 juta | 1 |
| A-06 Refund Manual | FR-044, FR-133, FR-128, FR-129 | 6 skenario refund benar; support tidak bisa menyetujui | 1 |
| A-07 Kebijakan & Versi | FR-073, FR-125, FR-130 | Perubahan hanya untuk booking baru; wilayah tanpa rilis kode | 1 |
| A-08 Audit Log | FR-075, FR-127 | Append-only; 100% aksi tercatat; update/delete ditolak | 1 |
| A-09 Rekonsiliasi Harian | FR-131 | Selesai ≤09.00; selisih >Rp 1 jadi temuan | 1 |
| A-10 Suspend Vendor | FR-132 | Listing hilang ≤1 menit; payout beku; booking aktif ditandai | 1 |
| A-11 Antrean No-show & Laporan | FR-119, FR-123, FR-112 | Antrean ≤2 jam; keputusan refund ≤3 hari kerja | 1 |

Catatan: tidak ada layar tanpa FR. Layar navigasi/agregasi (C-01, C-10, V-07, C-15, V-16) memetakan ke FR yang isinya ditampilkan dan tidak menambah kemampuan baru.

### 9.2 Cek cakupan — FR Must Fase 1

Sumber daftar: §6.2 tabel fitur Fase 1 (Must). Semua baris di bawah harus punya layar penanggung.

| FR | Layar penanggung | Bukti di layar |
|---|---|---|
| FR-001 | S-01 | Kolom nomor + OTP + hitung percobaan |
| FR-002 | S-02 | Dua kartu peran, satu peran aktif |
| FR-003 | V-01, V-02, V-03, V-05 | Daftar kelengkapan + tombol kirim terkunci |
| FR-004 | A-02, V-06 | Tombol setujui/tolak + alasan wajib |
| FR-010 | V-13, V-05 | Status tayang + media approved + area layanan |
| FR-011 | V-12, V-04 | Daftar paket + form paket |
| FR-012 | C-01, C-02 | Kartu tanggal/lokasi + filter |
| FR-013 | C-04 | Paket, portofolio, status tanggal |
| FR-014 | C-03 | Hanya vendor tersedia di tanggal terpilih |
| FR-020 | V-10 | Grid 4 status |
| FR-021 | V-09, V-10 | Tanggal terkunci setelah terima; tombol ubah nonaktif |
| FR-022 | V-10, C-05 | Penolakan tanggal bentrok |
| FR-023 | V-10, V-11 | "Sudah ada job" + nama acara |
| FR-030 | C-05 | Form detail acara |
| FR-031 | V-09, V-08, C-07 | Batas jawab 24 jam + tombol jawab |
| FR-032 | C-07, V-08 | Hitung waktu + status waktu habis |
| FR-040 | C-08, C-09 | Tiga metode + layar tunggu |
| FR-041 | C-13, C-11 | Sisa tagihan + tombol lunasi |
| FR-042 | A-05 | Rilis per booking dengan approver kedua |
| FR-043 | A-05, C-08 | Potongan platform di rincian + nota |
| FR-044 | A-06, C-11 | Refund dengan alasan + estimasi uang kembali |
| FR-051 | C-15, V-16, C-09 | Daftar notifikasi + status berubah |
| FR-070 | A-04, A-01, A-02 | Pencarian dan ubah status booking/vendor |
| FR-071 | A-03 | Antrean moderasi dengan keputusan |
| FR-073 | A-07 | Form komisi/DP/wilayah + versi |
| FR-075 | A-08 | Daftar audit dengan filter |
| FR-100 | S-01 | Batas percobaan OTP + kirim ulang |
| FR-101 | C-14, V-17 | Hapus akun + status permintaan |
| FR-102 | V-17 | Pemilih vendor aktif + data terpisah |
| FR-103 | S-01 | Versi ToS/Privasi + centang persetujuan |
| FR-104 | V-03 | Nama rekening + status verified |
| FR-105 | V-14 | Peringatan cooling 7 hari + nomor lama |
| FR-106 | V-01, C-02 | Multi-kategori + filter kategori |
| FR-107 | A-03 | Status media sebelum tayang |
| FR-108 | V-10, C-03 | Label "belum diisi" |
| FR-109 | V-12 | Rentang tanggal + aturan harga |
| FR-110 | C-04, C-06 | "Mulai dari" lalu harga final |
| FR-111 | V-09 | Blok pesan WA + tombol Terima/Tolak |
| FR-112 | A-11, V-08 | Daftar eskalasi agen + status telepon |
| FR-114 | C-06 | Tautan syarat + versi kebijakan booking |
| FR-115 | C-06, C-12 | Tombol nonaktif setelah kirim + status antrean |
| FR-118 | C-11 | Status auto-selesai + tenggat lapor H+7 |
| FR-119 | C-11, C-12 | Tombol "Grup tidak datang" + unggah bukti |
| FR-123 | C-12 | Tombol lapor ≤3 klik + nomor tiket |
| FR-125 | A-07 | Daftar wilayah aktif/nonaktif |
| FR-127 | A-08 | Detail sebelum/sesudah + IP + waktu |
| FR-128 | A-05, A-06 | Dua approver berbeda |
| FR-129 | A-01, A-06 | Antrean per peran; tombol refund tidak ada untuk support |
| FR-130 | A-07 | Daftar versi + tanggal berlaku |
| FR-131 | A-09 | Ringkasan selisih + tiket temuan |
| FR-132 | A-10 | Alasan suspend + ringkasan dampak |
| FR-133 | A-06, C-11 | Alasan + bukti + approver + status ≤1 jam |
| FR-140 | V-02 | Pernyataan lisensi per media |

**Hasil cek:** 53 dari 53 FR Must Fase 1 punya layar penanggung. Tidak ada FR Must Fase 1 yang hanya hidup di backend tanpa permukaan UI. Tidak ada layar Fase 1 yang tidak melayani FR.

### 9.3 FR Should Fase 1 (tetap punya layar)

| FR | Layar | Catatan |
|---|---|---|
| FR-015 | C-16 | Favorit, tanpa kebutuhan layar baru |
| FR-024 | V-10 | Pilihan sesi Siang/Malam/Penuh |
| FR-033 | C-06 | Baris transport + persetujuan sebelum bayar |
| FR-046 | C-14, C-11 | Tombol "Unduh nota" |
| FR-052 | C-15, V-16 | Pengingat H-7/H-1/hari-H tampil di riwayat |
| FR-137 | C-15 | Notifikasi perubahan kebijakan ≥14 hari |
| FR-143 | V-09 | Daftar alasan penolakan terstruktur |

---

## 10. Hal yang Harus Diuji ke 5 Vendor Nyata Sebelum Desain Final

Metode: 5 vendor, minimal 3 dengan keahlian teknis rendah (§4.1 P3), di perangkat milik sendiri, di lokasi mereka. Fasilitator tidak membantu kecuali diminta; setiap bantuan dicatat sebagai kegagalan desain. Ini uji desain, bukan uji bug. Rujukan: §15.3 UAT (15 pengguna: 10 penyelenggara, 5 vendor) dan §15.1.

| # | Tugas uji | Kondisi | Yang diamati | Ambang lulus | Keputusan desain yang dipicu bila gagal |
|---|---|---|---|---|---|
| U-01 | Daftar jadi vendor tanpa dibantu, dari nol sampai pengajuan terkirim | Perangkat sendiri, sinyal biasa | Di langkah mana berhenti, berapa kali bertanya, apakah paham istilah | ≥3 dari 5 selesai tanpa bantuan | Sederhanakan urutan langkah atau tambah contoh isian |
| U-02 | Ambil foto KTP dengan benar | Cahaya ruangan malam, KTP asli | Berapa kali ulang, apakah paham pesan "kurang jelas" | ≥4 dari 5 berhasil ≤2 percobaan | Ubah panduan foto (bingkai, contoh, tombol lampu) |
| U-03 | Unggah video sampel di sinyal lemah | Throttle 3G, video 30–60 detik | Apakah menunggu, apakah mengulang dari awal, apakah menyerah | ≥4 dari 5 berhasil tanpa mengulang seluruh form | Ubah model unggah per file / izin "kirim nanti" |
| U-04 | Isi kalender 3 bulan ke depan dalam satu duduk | Perangkat sendiri | Detik per tanggal, salah ketuk, salah paham status | ≤30 detik per tanggal; ≥90% tanggal benar | Ubah pola ketuk atau legenda |
| U-05 | Jawab "tanggal ini bisa dipesan atau tidak?" tanpa dijelaskan | Kalender sudah terisi campuran | Apakah 4 status terbaca tanpa legenda | ≥4 dari 5 benar untuk 6 tanggal uji | Ubah warna/pola/label status |
| U-06 | Terima order dari WhatsApp tanpa membuka aplikasi | Pesan WA dikirim ke nomor vendor | Apakah menemukan tombol, apakah paham angka, waktu sampai terkirim | ≥4 dari 5 menerima ≤1 menit | Ubah susunan pesan WA (angka lebih awal, kalimat lebih pendek) |
| U-07 | Jawab "kalau harga 4 juta, kamu terima berapa?" dari layar terima order | V-09 dengan order contoh | Apakah menyebut angka bersih, apakah mencari-cari, apakah curiga | ≥4 dari 5 menyebut angka ±Rp 3,5 juta | Ubah hierarki blok rincian uang |
| U-08 | Tolak order dan pilih alasan | V-09 | Apakah alasan tersedia cocok dengan alasan nyata vendor | ≥4 dari 5 memilih tanpa "lain-lain" | Ubah daftar alasan (FR-143) |
| U-09 | Cari grup untuk tanggal hajatan lalu kirim permintaan | Dari beranda, tanpa arahan | Jumlah langkah, waktu, salah filter, apakah membaca "mulai dari" | ≥4 dari 5 selesai ≤5 menit dan ≤3 langkah | Ubah beranda (gabungkan tanggal+lokasi) atau kartu hasil |
| U-10 | Bayar DP sampai selesai, lalu ulangi dengan pembayaran gagal | QRIS sungguhan nominal kecil, lalu simulasi gagal | Apakah ragu soal nominal, apakah membayar dua kali, apakah paham state menunggu | 5 dari 5 tidak melakukan pembayaran ganda; ≥4 paham status | Ubah copy "jangan bayar dua kali" atau letak nominal |
| U-11 | Check-in di lokasi acara dengan sinyal 1 bar | Lokasi sebenarnya atau simulasi throttle | Apakah menunggu di tempat, apakah kehilangan foto, apakah menyerah | ≥4 dari 5 berhasil tanpa mengulang | Ubah urutan (GPS dulu, foto menyusul) atau umpan balik antrean |
| U-12 | Kirim laporan masalah dengan 3 foto bukti | Sinyal lemah | Apakah paham jenis masalah, apakah berhasil unggah, apakah tahu kelanjutannya | ≥4 dari 5 berhasil dan tahu langkah berikutnya | Ubah pilihan jenis masalah atau janji waktu tanggapan |
| U-13 | Selesaikan 4 tugas inti dengan skala teks 130% dan TalkBack | Pengaturan aksesibilitas aktif | Teks terpotong, tombol tidak terbaca, fokus kacau | 0 layar terpotong; semua tombol punya label | Ubah tinggi komponen dan urutan fokus |

**Cara memakai hasil.** Setiap kegagalan yang muncul ≥3 kali pada 5 vendor dianggap masalah desain, bukan masalah pengguna, dan wajib menghasilkan perubahan pada dokumen ini sebelum desain visual dimulai. Temuan dibagi tiga: (a) masalah urutan/hierarki, (b) masalah copy, (c) masalah kepercayaan (vendor tidak yakin uangnya aman). Temuan (c) tidak boleh diselesaikan dengan menambah teks penjelasan panjang; harus lewat angka dan bukti.

---

## Catatan Penutup

| Hal | Status |
|---|---|
| Alur kritis dispesifikasikan | 7 (3.a–3.g), semuanya dengan jalur gagal |
| Layar dalam inventaris | 2 bersama + 16 pelanggan + 17 vendor + 11 admin |
| FR Must Fase 1 tercakup | 53/53 (§9.2) |
| Entri copy | 44 (K-01..K-44) |
| Yang belum diputuskan | Batas waktu bayar DP (usul 24 jam), batas ukuran file, jumlah file per laporan, ambang getaran/haptik — semua ditandai **[ASUMSI-UX]** |
| Ketergantungan | `TECH-DESIGN-v1.0.md` untuk kontrak endpoint, idempotensi, dan kanal notifikasi |

