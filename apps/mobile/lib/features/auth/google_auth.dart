import 'package:google_sign_in/google_sign_in.dart';

/// Google Sign-In untuk aplikasi pelanggan.
///
/// Client ID **tidak** ditanam di kode. Isinya lewat `--dart-define`:
///   flutter run --dart-define=GOOGLE_CLIENT_ID=WEB_CLIENT_ID.apps.googleusercontent.com
///   flutter run --dart-define=GOOGLE_SERVER_CLIENT_ID=WEB_CLIENT_ID.apps.googleusercontent.com
///
/// `GOOGLE_CLIENT_ID` dipakai build web/iOS, `GOOGLE_SERVER_CLIENT_ID` dipakai
/// Android (audience ID token harus sama dengan `GOOGLE_CLIENT_ID` di API).
class GoogleAuth {
  const GoogleAuth._();

  static const String _clientId = String.fromEnvironment('GOOGLE_CLIENT_ID');
  static const String _serverClientId = String.fromEnvironment(
    'GOOGLE_SERVER_CLIENT_ID',
  );

  /// Tombol Google hanya ditampilkan kalau build tahu client ID-nya.
  static bool get isConfigured =>
      _clientId.isNotEmpty || _serverClientId.isNotEmpty;

  static bool _initialized = false;

  /// Inisialisasi sekali. Web membutuhkannya sebelum tombol GIS dirender.
  static Future<void> ensureInitialized() async {
    if (_initialized) return;
    await GoogleSignIn.instance.initialize(
      clientId: _clientId.isEmpty ? null : _clientId,
      serverClientId: _serverClientId.isEmpty ? null : _serverClientId,
    );
    _initialized = true;
  }

  /// Mengembalikan Google ID token, atau `null` bila tidak ada token.
  /// Hanya untuk platform non-web: web memakai tombol GIS resmi.
  /// Melempar [GoogleSignInException] saat pengguna membatalkan.
  static Future<String?> idToken() async {
    await ensureInitialized();
    try {
      final account = await GoogleSignIn.instance.authenticate();
      return account.authentication.idToken;
    } on GoogleSignInException catch (error) {
      final detail = error.description?.toLowerCase() ?? '';
      // Status 16 ("Account reauth failed") arrives as `canceled` when a stale
      // credential needs re-authentication. Drop the cached session and let
      // the user pick the account once more before surfacing the failure.
      if (error.code != GoogleSignInExceptionCode.canceled ||
          !detail.contains('reauth')) {
        rethrow;
      }
      await GoogleSignIn.instance.signOut();
      final account = await GoogleSignIn.instance.authenticate();
      return account.authentication.idToken;
    }
  }

  /// Lupakan sesi Google supaya pemilihan akun muncul lagi.
  static Future<void> signOut() async {
    if (!_initialized) return;
    await GoogleSignIn.instance.signOut();
  }
}
