import 'dart:async';

import 'package:geolocator/geolocator.dart';

import 'geo_types.dart';

/// Native location via the `geolocator` plugin (Android/iOS). The permissions
/// live in the manifest/Info.plist; the booking form shows the GPS option
/// whenever this is true.
const bool locationSupported = true;

const _serviceOff =
    'GPS perangkat tidak aktif. Nyalakan lokasi, lalu coba lagi.';
const _denied =
    'Izin lokasi ditolak. Aktifkan izin lokasi aplikasi, lalu coba lagi.';
const _deniedForever =
    'Izin lokasi diblokir. Buka pengaturan aplikasi, izinkan lokasi, lalu coba lagi.';
const _timeout = 'Pencarian lokasi terlalu lama. Coba lagi di area terbuka.';
const _failed = 'Titik lokasi tidak ditemukan. Pastikan GPS aktif, lalu coba lagi.';

/// Reads one high-accuracy fix. Every platform failure is mapped to a
/// [GeoFailure] the form can explain in Indonesian, never a raw plugin error.
Future<GeoReading> readCurrentLocation() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const GeoException(GeoFailure.unavailable, _serviceOff);
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    final granted =
        permission == LocationPermission.whileInUse ||
        permission == LocationPermission.always;
    if (!granted) {
      final blocked = permission == LocationPermission.deniedForever;
      throw GeoException(
        blocked ? GeoFailure.deniedForever : GeoFailure.denied,
        blocked ? _deniedForever : _denied,
      );
    }

    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 20),
      ),
    );
    return GeoReading(
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyMeters: position.accuracy,
    );
  } on GeoException {
    rethrow;
  } on TimeoutException {
    throw const GeoException(GeoFailure.timeout, _timeout);
  } on LocationServiceDisabledException {
    throw const GeoException(GeoFailure.unavailable, _serviceOff);
  } catch (_) {
    throw const GeoException(GeoFailure.unavailable, _failed);
  }
}
