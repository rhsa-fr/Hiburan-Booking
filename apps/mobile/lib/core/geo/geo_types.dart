/// A coordinate read from the device location service.
class GeoReading {
  const GeoReading({
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
  });

  final double latitude;
  final double longitude;
  final double accuracyMeters;

  /// `-6.32710, 108.32420` — the shape Google Maps parses directly.
  String get coordinateText =>
      '${latitude.toStringAsFixed(5)}, ${longitude.toStringAsFixed(5)}';
}

/// `deniedForever` is separate from `denied` because only the first one can be
/// fixed from the app settings screen, and the form offers that shortcut.
enum GeoFailure { denied, deniedForever, unavailable, timeout, unsupported }

class GeoException implements Exception {
  const GeoException(this.failure, this.message);

  final GeoFailure failure;
  final String message;

  @override
  String toString() => 'GeoException($failure): $message';
}
