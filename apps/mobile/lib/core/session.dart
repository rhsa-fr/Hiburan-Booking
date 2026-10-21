import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'models.dart';

/// Auth state + secure persistence. Token refresh itself lives in ApiClient and
/// is wired through [attachRefresh] so this class stays network-free.
class Session extends ChangeNotifier {
  Session({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _tokenKey = 'access_token';
  static const _expiryKey = 'expires_at';
  static const _userKey = 'user';

  final FlutterSecureStorage _storage;

  String? _token;
  DateTime? _expiresAt;
  Map<String, dynamic>? _user;
  bool _restored = false;
  String? _notice;
  Timer? _refreshTimer;
  Future<void> Function()? _refresh;
  bool _refreshing = false;

  bool get authorized => _token != null;
  bool get restored => _restored;
  String? get token => _token;
  DateTime? get expiresAt => _expiresAt;
  AppUser? get user => _user == null ? null : AppUser.fromJson(_user!);

  /// One-line explanation shown on Login (expired session, no connection...).
  String? get notice => _notice;

  bool get expiresSoon {
    final expiry = _expiresAt;
    if (expiry == null) return false;
    return expiry.difference(DateTime.now().toUtc()) < const Duration(minutes: 5);
  }

  void attachRefresh(Future<void> Function() refresh) => _refresh = refresh;

  /// Reads storage, then refreshes an expired token once. Never throws: a cold
  /// start with a broken device store or an unreachable API lands on Login with
  /// [notice] filled in.
  Future<void> restore() async {
    try {
      final token = await _storage.read(key: _tokenKey);
      final expiry = await _storage.read(key: _expiryKey);
      final userJson = await _storage.read(key: _userKey);
      _token = token == null || token.isEmpty ? null : token;
      _expiresAt = expiry == null ? null : DateTime.tryParse(expiry);
      _user = userJson == null ? null : _decodeUser(userJson);
    } catch (_) {
      _notice = 'Sesi tidak bisa dibaca di perangkat ini. Silakan masuk lagi.';
      await clear();
    }

    if (_token != null && _isExpired) {
      await _refreshNow();
      if (_token != null && _isExpired) {
        await clear();
        _notice = 'Sesi berakhir atau server tidak terjangkau. Silakan masuk lagi.';
      }
    } else if (_token != null) {
      _scheduleRefresh();
    }

    _restored = true;
    notifyListeners();
  }

  /// Accepts the raw session payload (`{access_token, ...}`) or a `{data: ...}`
  /// envelope. Persists token, expiry, and user JSON.
  Future<void> signIn(Map<String, dynamic> payload) async {
    await applySession(payload);
  }

  Future<void> applySession(Map<String, dynamic> payload) async {
    final data = payload['data'] is Map
        ? (payload['data'] as Map).cast<String, dynamic>()
        : payload;
    final token = data['access_token'];
    if (token is! String || token.isEmpty) {
      throw ArgumentError('Payload sesi tidak berisi access_token.');
    }
    final seconds = data['expires_in'] is num
        ? (data['expires_in'] as num).toInt()
        : 3600;

    _token = token;
    _expiresAt = DateTime.now().toUtc().add(Duration(seconds: seconds));
    final user = data['user'];
    if (user is Map) _user = user.cast<String, dynamic>();
    _notice = null;
    _scheduleRefresh();
    await _persist();
    notifyListeners();
  }

  /// Local sign-out. The caller revokes the token on the server first.
  Future<void> signOut() => clear();

  Future<void> clear() async {
    _refreshTimer?.cancel();
    _refreshTimer = null;
    _token = null;
    _expiresAt = null;
    _user = null;
    try {
      await _storage.delete(key: _tokenKey);
      await _storage.delete(key: _expiryKey);
      await _storage.delete(key: _userKey);
    } catch (_) {
      // Device store unavailable: the in-memory session is still gone.
    }
    notifyListeners();
  }

  Future<void> _refreshNow() async {
    final refresh = _refresh;
    if (refresh == null || _refreshing) return;
    _refreshing = true;
    try {
      await refresh();
    } finally {
      _refreshing = false;
    }
  }

  bool get _isExpired {
    final expiry = _expiresAt;
    return expiry != null && !DateTime.now().toUtc().isBefore(expiry);
  }

  /// Fires at 80% of the remaining TTL, then ApiClient reschedules on success.
  void _scheduleRefresh() {
    _refreshTimer?.cancel();
    final expiry = _expiresAt;
    if (expiry == null || _refresh == null) return;
    final remaining = expiry.difference(DateTime.now().toUtc());
    if (remaining <= Duration.zero) return;
    _refreshTimer = Timer(remaining * 0.8, () {
      _refreshNow().catchError((Object _) {});
    });
  }

  Future<void> _persist() async {
    try {
      await _storage.write(key: _tokenKey, value: _token);
      await _storage.write(key: _expiryKey, value: _expiresAt?.toIso8601String());
      final user = _user;
      await _storage.write(key: _userKey, value: user == null ? null : jsonEncode(user));
    } catch (_) {
      _notice = 'Sesi tidak bisa disimpan di perangkat ini.';
    }
  }

  Map<String, dynamic>? _decodeUser(String raw) {
    try {
      final decoded = jsonDecode(raw);
      return decoded is Map ? decoded.cast<String, dynamic>() : null;
    } catch (_) {
      return null;
    }
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }
}
