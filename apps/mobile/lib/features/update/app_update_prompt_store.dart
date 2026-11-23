import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Last build that was offered and when. Used to snooze a declined build for a
/// day so a silent check cannot turn into a prompt loop.
class AppUpdatePromptState {
  const AppUpdatePromptState({required this.buildNumber, required this.promptedAt});

  final int buildNumber;
  final DateTime promptedAt;
}

abstract class AppUpdatePromptStore {
  Future<AppUpdatePromptState?> read();

  Future<void> write(AppUpdatePromptState state);
}

class SecureAppUpdatePromptStore implements AppUpdatePromptStore {
  SecureAppUpdatePromptStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  static const _buildKey = 'update_prompted_build';
  static const _atKey = 'update_prompted_at';

  final FlutterSecureStorage _storage;

  @override
  Future<AppUpdatePromptState?> read() async {
    try {
      final build = await _storage.read(key: _buildKey);
      final at = await _storage.read(key: _atKey);
      final buildNumber = int.tryParse(build ?? '');
      final promptedAt = DateTime.tryParse(at ?? '');
      if (buildNumber == null || promptedAt == null) return null;
      return AppUpdatePromptState(
        buildNumber: buildNumber,
        promptedAt: promptedAt,
      );
    } catch (_) {
      // A broken device store must not block updates: treat it as "never asked".
      return null;
    }
  }

  @override
  Future<void> write(AppUpdatePromptState state) async {
    try {
      await _storage.write(key: _buildKey, value: '${state.buildNumber}');
      await _storage.write(
        key: _atKey,
        value: state.promptedAt.toUtc().toIso8601String(),
      );
    } catch (_) {
      // Snooze is best effort; the session-level guard still applies.
    }
  }
}
