import 'dart:async';

import 'package:geocoding/geocoding.dart';

import 'geo_types.dart';

/// Reverse geocoding is a *suggestion* on top of a coordinate: every failure
/// (no plugin for the platform, no device geocoder, timeout, empty placemark)
/// returns null so the GPS reading itself is never lost.
///
/// The call fails closed and not at compile time on web: `geocoding` ships no
/// web implementation, so `GeocodingPlatform.instance` is null there and the
/// lookup throws, which this function converts to null.
Future<String?> reverseGeocodeAddress(GeoReading reading) async {
  try {
    final placemarks = await placemarkFromCoordinates(
      reading.latitude,
      reading.longitude,
    ).timeout(const Duration(seconds: 8));
    if (placemarks.isEmpty) return null;
    final place = placemarks.first;
    final parts = <String>[];
    final seen = <String>{};
    for (final raw in <String?>[
      place.thoroughfare,
      place.subLocality,
      place.locality,
      place.subAdministrativeArea,
      place.administrativeArea,
    ]) {
      final value = (raw ?? '').trim();
      if (value.isEmpty) continue;
      if (!seen.add(value.toLowerCase())) continue;
      parts.add(value);
    }
    return parts.isEmpty ? null : parts.join(', ');
  } catch (_) {
    return null;
  }
}
