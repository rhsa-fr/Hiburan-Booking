# Tarlink Customer

Aplikasi pelanggan Tarlink — cari vendor tarling, cek jadwal, kunci DP.
Flutter 3.35; dependensi hanya `http` dan `flutter_secure_storage`.

## Jalankan
```bash
flutter pub get
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3001
```

`API_BASE_URL` default `http://localhost:3001`; client menambahkan `/v1` sendiri.
Emulator Android memakai host `10.0.2.2`:

```bash
flutter run -d emulator-5554 --dart-define=API_BASE_URL=http://10.0.2.2:3001
```

## Build & periksa

```bash
flutter analyze
flutter test
flutter build web --dart-define=API_BASE_URL=http://localhost:3001
flutter build apk --debug
```
Debug mengizinkan http lokal; build release wajib `https://`.

## Struktur

```
lib/main.dart          bootstrap: Session + ApiClient, restore sesi
lib/app/               app.dart (MaterialApp, AppScope), routes, theme tokens
lib/core/              api_client, session, models, format, widgets
lib/features/          auth, discovery, booking (stub per paket berikutnya)
lib/core/api_client.dart  /v1, bearer, refresh-on-401 sekali, timeout 20s
lib/core/session.dart     token+user di secure storage, refresh di 80% TTL
lib/core/widgets.dart     AppLoading, AppError, AppEmpty, PrimaryButton, StatusChip
```
