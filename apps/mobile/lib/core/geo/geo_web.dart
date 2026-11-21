import 'dart:async';
import 'dart:js_interop';

import 'geo_types.dart';

/// Browser Geolocation API, no plugin and no extra dependency. The mobile
/// build cannot import this file (conditional export keeps `dart:js_interop`
/// off the native target).
const bool locationSupported = true;

@JS('navigator.geolocation')
external _Geolocation? get _geolocation;

extension type _Geolocation._(JSObject _) implements JSObject {
  external void getCurrentPosition(
    JSFunction success,
    JSFunction error,
    JSObject options,
  );
}

extension type _Coordinates._(JSObject _) implements JSObject {
  external double get latitude;
  external double get longitude;
  external double get accuracy;
}

extension type _Position._(JSObject _) implements JSObject {
  external _Coordinates get coords;
}

extension type _PositionError._(JSObject _) implements JSObject {
  external int get code;
  external String get message;
}

Future<GeoReading> readCurrentLocation() {
  final geolocation = _geolocation;
  if (geolocation == null) {
    return Future.error(
      const GeoException(
        GeoFailure.unsupported,
        'Browser ini tidak punya layanan lokasi.',
      ),
    );
  }

  final completer = Completer<GeoReading>();

  void onSuccess(JSAny? value) {
    if (completer.isCompleted) return;
    final position = _Position._(value as JSObject);
    final coords = position.coords;
    completer.complete(
      GeoReading(
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyMeters: coords.accuracy,
      ),
    );
  }

  void onError(JSAny? value) {
    if (completer.isCompleted) return;
    final error = _PositionError._(value as JSObject);
    final failure = switch (error.code) {
      1 => GeoFailure.denied,
      3 => GeoFailure.timeout,
      _ => GeoFailure.unavailable,
    };
    completer.completeError(GeoException(failure, error.message));
  }

  geolocation.getCurrentPosition(
    onSuccess.toJS,
    onError.toJS,
    {'enableHighAccuracy': true, 'timeout': 15000, 'maximumAge': 0}.jsify()!
        as JSObject,
  );

  return completer.future;
}
