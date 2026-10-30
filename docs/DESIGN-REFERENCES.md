# Referensi Desain — `opendesain/`

Folder `opendesain/` berisi ekspor HTML dari OpenDesign. File-file ini adalah
**acuan visual**, bukan kode aplikasi: tidak di-serve, tidak di-import, dan tidak
boleh diedit manual. Nilai yang sudah final tetap hidup di
`apps/mobile/lib/app/theme.dart`, `apps/mobile/lib/core/ui.dart`, dan
`apps/mobile/lib/features/vendor/vendor_theme.dart`.

| File | Isi | Acuan untuk |
|---|---|---|
| `opendesain/Tampilan_Pelanggan.html` | Ekspor layar pelanggan (welcome, beranda, jelajah, detail vendor, booking, status, profil) | `apps/mobile/DESIGN.md` |
| `opendesain/Tampilan_Vendor_grup.html` | Ekspor 6 layar portal vendor (beranda, detail pesanan, kalender, saldo, semua pesanan, profil) | `apps/mobile/lib/features/vendor/*` |
| `opendesain/open-design-diagnostics-*.zip` | Arsip diagnostik ekspor | **Tidak di-commit** (lihat `.gitignore`) |

## Cara memakai

1. Buka file HTML langsung di browser (ukuran acuan 390 × 844).
2. Bandingkan tata letak dan hierarki, lalu terapkan memakai komponen yang sudah ada
   (`StageHeader`, `VendorCard`, `MoneyBlock`, `StickyActionBar`, `SegmentBar`, dll).
3. Populate hanya dengan data nyata dari API. Jangan menyalin angka, ulasan, foto,
   atau teks contoh dari mockup.
4. Kalau butuh komponen bersama baru, tambahkan ke `lib/core/ui.dart` lewat lead —
   jangan menduplikasinya di dalam fitur.

## Aturan

- Token warna/font yang berlaku adalah yang ada di `theme.dart` (Graphite · Lime),
  bukan nilai yang tertulis di HTML.
- Jangan menaruh file ekspor baru di luar `opendesain/`.
- Jangan mengubah HTML ekspor; regenerasi dari OpenDesign lalu ganti filenya.
- Portal vendor memakai token lokal `features/vendor/vendor_theme.dart`; jangan
  mencampur token pelanggan dan vendor dalam satu layar.

Terkait: [apps/mobile/DESIGN.md](../apps/mobile/DESIGN.md) ·
[docs/ARCHITECTURE.md](ARCHITECTURE.md#9-aplikasi-flutter-pelanggan--portal-vendor)
