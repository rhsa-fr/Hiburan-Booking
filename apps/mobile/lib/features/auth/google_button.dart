// Memilih implementasi tombol Google sesuai platform.
//
// Web memakai tombol resmi GIS (`renderButton`); platform lain memakai
// placeholder karena login Google di sana lewat tombol custom + authenticate().
export 'google_button_stub.dart'
    if (dart.library.js_interop) 'google_button_web.dart';
