import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'theme.dart';

/// Owns the light/dark/system choice. The palette itself lives in
/// [AppColors]; this controller only flips `AppColors.forced` and rebuilds.
///
/// The preference uses the same secure store as the session. A device store
/// that is unavailable (widget tests, locked keystore) falls back to
/// [ThemeMode.system] instead of failing the app.
class ThemeController extends ChangeNotifier {
  ThemeController({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage() {
    _apply();
  }

  static const _key = 'theme_mode';

  final FlutterSecureStorage _storage;

  ThemeMode _mode = ThemeMode.light;
  ThemeMode get mode => _mode;

  Future<void> restore() async {
    ThemeMode next = ThemeMode.light;
    try {
      final raw = await _storage.read(key: _key);
      next = switch (raw) {
        'system' => ThemeMode.system,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.light,
      };
    } catch (_) {
      next = ThemeMode.light;
    }
    if (next != _mode) {
      _mode = next;
      _apply();
      notifyListeners();
    }
  }

  Future<void> setMode(ThemeMode mode) async {
    if (mode == _mode) return;
    _mode = mode;
    _apply();
    notifyListeners();
    try {
      await _storage.write(key: _key, value: _value(mode));
    } catch (_) {
      // In-memory choice still applies for this run.
    }
  }

  void _apply() {
    AppColors.forced = switch (_mode) {
      ThemeMode.light => Brightness.light,
      ThemeMode.dark => Brightness.dark,
      ThemeMode.system => null,
    };
  }

  static String _value(ThemeMode mode) => switch (mode) {
    ThemeMode.light => 'light',
    ThemeMode.dark => 'dark',
    ThemeMode.system => 'system',
  };
}

/// Lets Profil change the mode without threading a callback through routes.
class ThemeScope extends InheritedNotifier<ThemeController> {
  const ThemeScope({
    super.key,
    required ThemeController controller,
    required super.child,
  }) : super(notifier: controller);

  static ThemeController? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<ThemeScope>()?.notifier;

  static ThemeController of(BuildContext context) {
    final controller = maybeOf(context);
    assert(controller != null, 'ThemeScope tidak ditemukan di atas widget ini.');
    return controller!;
  }
}
