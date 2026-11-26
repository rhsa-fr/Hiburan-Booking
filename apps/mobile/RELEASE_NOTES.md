# Catatan rilis Tarlink

Satu bagian per versi. Workflow rilis mengambil bagian yang cocok dengan
`version:` di `pubspec.yaml` dan menaruhnya sebagai `notes` di `latest.json`,
yang tampil di dialog pembaruan saat aplikasi dibuka.

Tulis dari sudut pandang pengguna: apa yang berubah, bukan commit apa yang masuk.
Maksimal ~12 baris; dialog memakai area gulir 96 px.

## 1.0.8

- Mode gelap opsional di Profil → Tampilan; default tetap terang.
- Jadwal vendor & pelanggan berlabel Buka/Sebagian/Penuh/Tutup/Kosong.
- Portal vendor: menu cepat, acara terdekat, Saldo & Laporan lebih sederhana.
- Owner melihat tombol Kelola vendor; profil pelanggan & owner bisa diedit.
- Tab Chat berisi riwayat semua vendor yang pernah dihubungi.
- Satu tanggal satu booking; tanggal terpakai tidak bisa dipesan lagi.

## 1.0.7

- Uji jalur pembaruan: aplikasi 1.0.6 harus menawarkan versi ini otomatis.
- Tidak ada perubahan fitur; isinya sama dengan 1.0.6.

## 1.0.6

- Pembaruan otomatis saat aplikasi dibuka kini benar-benar bekerja.
- Versi baru ditawarkan beserta ringkasan perubahan dan ukuran unduhan.
- Menekan "Nanti" menunda tawaran yang sama selama 24 jam.

## 1.0.5

- Cek pembaruan tidak lagi salah menyatakan "sudah versi terbaru".
- Perbaikan pembanding versi untuk APK yang dipisah per ABI.
- Durasi paket kini memakai jam: setengah hari, 1 hari, atau full day.
- Ikon kategori di beranda lebih tegas dan mudah dibedakan.
- Ukuran teks diselaraskan agar tidak ada yang terlalu besar atau terlalu kecil.

## 1.0.4

- Pilihan durasi paket memakai jam.
- Ikon kategori beranda diperbarui.
- Penyelarasan skala teks.
