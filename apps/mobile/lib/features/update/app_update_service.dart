import 'package:http/http.dart' as http;

import 'app_update_channel.dart';
import 'app_update_files.dart';
import 'app_update_models.dart';
import 'app_update_prompt_store.dart';

/// Manifest location, injected at build time:
/// `flutter build apk --dart-define=APP_UPDATE_MANIFEST_URL=https://...`.
/// Empty everywhere else (local dev, widget tests, web), which disables the
/// whole feature and guarantees no network call and no channel call.
const String appUpdateManifestUrl = String.fromEnvironment(
  'APP_UPDATE_MANIFEST_URL',
  defaultValue: '',
);

/// Orchestrates the update: manifest, decision, download, digest, install, and
/// the prompt policy. Every collaborator is injected so tests never touch a
/// device, a network or a singleton.
class AppUpdateService {
  AppUpdateService({
    required http.Client client,
    required AppUpdateChannel channel,
    required this.manifestUrl,
    AppUpdatePromptStore? promptStore,
    AppUpdateFileStore? files,
    DateTime Function()? clock,
  }) : _client = client,
       _channel = channel,
       _prompts = promptStore ?? SecureAppUpdatePromptStore(),
       _files = files ?? createAppUpdateFileStore(client),
       _clock = clock ?? DateTime.now;

  /// A declined build is offered again no sooner than this.
  static const snoozeDuration = Duration(hours: 24);

  static const _requestTimeout = Duration(seconds: 15);

  final http.Client _client;
  final AppUpdateChannel _channel;
  final AppUpdatePromptStore _prompts;
  final AppUpdateFileStore _files;
  final DateTime Function() _clock;
  final String manifestUrl;

  /// Builds already offered in this app session. Independent from the persisted
  /// snooze so a cold start cannot prompt twice in a row either.
  final Set<int> _promptedThisSession = <int>{};

  AppUpdateDeviceInfo? _device;
  _PendingInstall? _pending;

  bool get enabled => manifestUrl.trim().isNotEmpty;

  /// Cached: the installed version cannot change while the process runs.
  Future<AppUpdateDeviceInfo> deviceInfo() async =>
      _device ??= await _channel.deviceInfo();

  /// True when a verified APK is cached but the installer has not been opened
  /// yet (the user went to grant "install unknown apps").
  bool get hasPendingInstall => _pending != null;

  String? get pendingInstallPath => _pending?.path;

  /// Checks the manifest and returns the offer to present, or null when there is
  /// nothing to offer. [manual] bypasses the snooze and sends `no-cache`.
  Future<AppUpdateInfo?> checkForUpdate({bool manual = false}) async {
    if (!enabled) return null;
    final device = await deviceInfo();
    final manifest = await _fetchManifest(manual: manual);
    final info = decideAppUpdate(manifest: manifest, device: device);
    if (info == null) return null;
    if (!manual && !await _shouldPrompt(info)) return null;
    return info;
  }

  /// Marks the offer as shown for this session. Forced updates ignore both the
  /// session guard and the snooze.
  void markPrompted(AppUpdateInfo info) {
    _promptedThisSession.add(info.buildNumber);
  }

  Future<void> markDeclined(AppUpdateInfo info) async {
    _promptedThisSession.add(info.buildNumber);
    await _prompts.write(
      AppUpdatePromptState(
        buildNumber: info.buildNumber,
        promptedAt: _clock().toUtc(),
      ),
    );
  }

  Future<bool> _shouldPrompt(AppUpdateInfo info) async {
    if (info.forced) return true;
    if (_promptedThisSession.contains(info.buildNumber)) return false;
    final state = await _prompts.read();
    if (state == null || state.buildNumber != info.buildNumber) return true;
    return _clock().toUtc().difference(state.promptedAt.toUtc()) >=
        snoozeDuration;
  }

  Future<AppUpdateManifest> _fetchManifest({required bool manual}) async {
    final uri = Uri.tryParse(manifestUrl.trim());
    if (uri == null || !uri.hasAuthority) {
      throw const AppUpdateException(AppUpdateError.invalidManifest);
    }

    final http.Response response;
    try {
      final request = http.Request('GET', uri);
      if (manual) request.headers['Cache-Control'] = 'no-cache';
      final streamed = await _client.send(request).timeout(_requestTimeout);
      response = await http.Response.fromStream(
        streamed,
      ).timeout(_requestTimeout);
    } on AppUpdateException {
      rethrow;
    } catch (error) {
      throw AppUpdateException(AppUpdateError.network, error);
    }

    if (response.statusCode != 200) {
      throw AppUpdateException(AppUpdateError.network, response.statusCode);
    }
    final manifest = AppUpdateManifest.parse(response.body, manifestUri: uri);
    if (manifest == null) {
      throw const AppUpdateException(AppUpdateError.invalidManifest);
    }
    return manifest;
  }

  /// Downloads, verifies the digest, and remembers the path as a pending
  /// install. On a hash mismatch the file is deleted so a retry starts clean.
  Future<String> downloadUpdate(
    AppUpdateInfo info, {
    required void Function(int received, int? total) onProgress,
    required AppUpdateCancelToken cancel,
  }) async {
    final device = await deviceInfo();
    final path = await _files.download(
      url: info.artifact.apkUrl,
      directory: '${device.cacheDir}/updates',
      fileName: 'tarlink-${info.buildNumber}.apk',
      expectedBytes: info.artifact.sizeBytes,
      onProgress: onProgress,
      cancel: cancel,
    );

    final String digest;
    try {
      digest = await _channel.sha256OfFile(path);
    } catch (error) {
      await _deleteQuietly(path);
      if (error is AppUpdateException) rethrow;
      throw AppUpdateException(AppUpdateError.fileMissing, error);
    }
    if (digest.toLowerCase() != info.artifact.sha256.toLowerCase()) {
      await _deleteQuietly(path);
      throw const AppUpdateException(AppUpdateError.hashMismatch);
    }

    _pending = _PendingInstall(path: path);
    return path;
  }

  Future<bool> canInstallPackages() => _channel.canInstallPackages();

  Future<bool> openInstallSettings() => _channel.openInstallSettings();

  /// Opens the system installer for a downloaded APK.
  Future<AppUpdateInstallResult> install(String path) async {
    if (_pending?.path == path) _pending = null;
    return _install(path);
  }

  /// Continues an install that was interrupted by the permission flow. Clears
  /// the pending path first so a resume cannot open the installer twice.
  Future<AppUpdateInstallResult> installPending() async {
    final pending = _pending;
    if (pending == null) {
      return const AppUpdateInstallResult(AppUpdateInstallStatus.fileMissing);
    }
    _pending = null;
    return _install(pending.path);
  }

  Future<AppUpdateInstallResult> _install(String path) async {
    try {
      return await _channel.installApk(path);
    } catch (_) {
      return const AppUpdateInstallResult(AppUpdateInstallStatus.failed);
    }
  }

  Future<void> _deleteQuietly(String path) async {
    try {
      await _files.delete(path);
    } catch (_) {
      // The next attempt overwrites the target file anyway.
    }
  }
}

class _PendingInstall {
  const _PendingInstall({required this.path});

  final String path;
}
