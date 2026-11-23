import 'package:flutter/services.dart';

import 'app_update_models.dart';

/// Platform channel name implemented by `MainActivity.kt`.
const appUpdateChannelName = 'id.tarlink.tarlink_customer/app_update';

/// The five native calls the update feature needs. Abstract so tests inject a
/// fake instead of touching a real device.
abstract class AppUpdateChannel {
  Future<AppUpdateDeviceInfo> deviceInfo();

  Future<bool> canInstallPackages();

  Future<bool> openInstallSettings();

  /// Lowercase hex SHA-256 of the file at [path].
  Future<String> sha256OfFile(String path);

  Future<AppUpdateInstallResult> installApk(String path);
}

class MethodChannelAppUpdateChannel implements AppUpdateChannel {
  MethodChannelAppUpdateChannel([MethodChannel? channel])
    : _channel = channel ?? const MethodChannel(appUpdateChannelName);

  final MethodChannel _channel;

  @override
  Future<AppUpdateDeviceInfo> deviceInfo() async {
    final raw = await _invoke<Object?>('deviceInfo');
    if (raw is! Map) {
      throw const AppUpdateException(AppUpdateError.unsupported);
    }
    final versionName = raw['versionName'];
    final versionCode = raw['versionCode'];
    final abis = raw['abis'];
    final cacheDir = raw['cacheDir'];
    if (versionName is! String ||
        versionCode is! int ||
        abis is! List ||
        cacheDir is! String) {
      throw const AppUpdateException(AppUpdateError.unsupported);
    }
    return AppUpdateDeviceInfo(
      versionName: versionName,
      versionCode: versionCode,
      abis: abis.whereType<String>().toList(growable: false),
      cacheDir: cacheDir,
    );
  }

  @override
  Future<bool> canInstallPackages() async =>
      await _invoke<bool>('canInstallPackages') ?? false;

  @override
  Future<bool> openInstallSettings() async =>
      await _invoke<bool>('openInstallSettings') ?? false;

  @override
  Future<String> sha256OfFile(String path) async {
    final digest = await _invoke<String>('sha256OfFile', {'path': path});
    if (digest == null || digest.isEmpty) {
      throw const AppUpdateException(AppUpdateError.fileMissing);
    }
    return digest;
  }

  @override
  Future<AppUpdateInstallResult> installApk(String path) async {
    final String? code;
    try {
      code = await _invoke<String>('installApk', {'path': path});
    } on AppUpdateException {
      return const AppUpdateInstallResult(AppUpdateInstallStatus.failed);
    }
    switch (code) {
      case 'OK':
        return const AppUpdateInstallResult(AppUpdateInstallStatus.ok);
      case 'NO_PERMISSION':
        return const AppUpdateInstallResult(
          AppUpdateInstallStatus.noPermission,
        );
      case 'FILE_MISSING':
        return const AppUpdateInstallResult(AppUpdateInstallStatus.fileMissing);
      case 'NO_ACTIVITY':
        return const AppUpdateInstallResult(AppUpdateInstallStatus.noActivity);
      default:
        return const AppUpdateInstallResult(AppUpdateInstallStatus.failed);
    }
  }

  Future<T?> _invoke<T>(String method, [Object? arguments]) async {
    try {
      return await _channel.invokeMethod<T>(method, arguments);
    } on MissingPluginException catch (error) {
      throw AppUpdateException(AppUpdateError.unsupported, error);
    } on PlatformException catch (error) {
      throw AppUpdateException(AppUpdateError.unsupported, error);
    }
  }
}
