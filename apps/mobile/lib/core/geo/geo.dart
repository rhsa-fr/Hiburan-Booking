// `locationSupported` + `readCurrentLocation()` resolve to the browser
// implementation on web and to a no-op stub on native (see `geo_native.dart`).
export 'geo_native.dart' if (dart.library.js_interop) 'geo_web.dart';
export 'geo_types.dart';
