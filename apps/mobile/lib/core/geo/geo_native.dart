import 'geo_types.dart';

/// Location is not wired on native yet: it needs a geolocation plugin plus
/// Android/iOS permissions, which are outside the frozen dependency list.
/// The form hides the GPS option when this is false.
const bool locationSupported = false;

Future<GeoReading> readCurrentLocation() => Future.error(
  const GeoException(
    GeoFailure.unsupported,
    'Lokasi GPS belum tersedia di aplikasi ini.',
  ),
);
