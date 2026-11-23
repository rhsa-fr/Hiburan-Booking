/// Pure data + rules for the in-app APK update: `latest.json` parsing, the
/// version decision, and the ABI pick. No I/O and no platform channel live
/// here, so every rule can be tested without a device.
library;

import 'dart:convert';

/// Why an update step failed. The UI maps each value to one Indonesian line.
enum AppUpdateError {
  /// `APP_UPDATE_MANIFEST_URL` is empty (local dev, tests, web).
  disabled,

  /// The manifest could not be fetched at all.
  network,

  /// The manifest exists but is incomplete or malformed.
  invalidManifest,

  /// The user tapped "Batal" while the APK was downloading.
  cancelled,

  /// The byte stream ended early or the socket died mid-download.
  interrupted,

  /// The device ran out of space while writing the APK.
  diskFull,

  /// The downloaded bytes do not match the manifest digest.
  hashMismatch,

  /// "Install unknown apps" is not granted for Tarlink yet.
  permission,

  /// The cached APK vanished between download and install.
  fileMissing,

  /// No package installer activity can handle the APK on this device.
  noInstaller,

  /// The installer refused the APK (usually a signing key mismatch).
  installFailed,

  /// The feature only exists on Android.
  unsupported,
}

/// One error type for the whole feature so callers handle a single class and
/// show [message] without inventing copy per call site.
class AppUpdateException implements Exception {
  const AppUpdateException(this.error, [this.cause]);

  final AppUpdateError error;
  final Object? cause;

  String get message {
    switch (error) {
      case AppUpdateError.disabled:
        return 'Pembaruan aplikasi belum disiapkan.';
      case AppUpdateError.network:
        return 'Gagal menghubungi server pembaruan. Periksa sambungan internet.';
      case AppUpdateError.invalidManifest:
        return 'Informasi pembaruan tidak bisa dibaca.';
      case AppUpdateError.cancelled:
        return 'Unduhan dibatalkan.';
      case AppUpdateError.interrupted:
        return 'Unduhan terputus. Coba lagi.';
      case AppUpdateError.diskFull:
        return 'Penyimpanan penuh. Kosongkan ruang lalu coba lagi.';
      case AppUpdateError.hashMismatch:
        return 'Berkas unduhan rusak dan sudah dihapus. Coba lagi.';
      case AppUpdateError.permission:
        return 'Tarlink belum diizinkan memasang aplikasi dari sumber ini.';
      case AppUpdateError.fileMissing:
        return 'Berkas pembaruan tidak ditemukan. Unduh ulang.';
      case AppUpdateError.noInstaller:
        return 'Tidak ada aplikasi pemasang di perangkat ini.';
      case AppUpdateError.installFailed:
        return 'Pemasangan ditolak. Bila APK ini ditandatangani dengan kunci '
            'berbeda dari versi terpasang, pasang versi resmi dari kanal '
            'Tarlink.';
      case AppUpdateError.unsupported:
        return 'Pembaruan aplikasi hanya tersedia di Android.';
    }
  }

  @override
  String toString() => 'AppUpdateException($error)';
}

/// Cooperative cancel flag for a running download. One token per attempt.
class AppUpdateCancelToken {
  bool _cancelled = false;

  bool get isCancelled => _cancelled;

  void cancel() => _cancelled = true;
}

/// Result of handing the APK to the system installer. `noPermission` means the
/// file is still valid and the caller should keep it for a retry.
enum AppUpdateInstallStatus {
  ok,
  noPermission,
  fileMissing,
  noActivity,
  failed,
}

class AppUpdateInstallResult {
  const AppUpdateInstallResult(this.status);

  final AppUpdateInstallStatus status;

  bool get ok => status == AppUpdateInstallStatus.ok;
}

/// One APK listed in the manifest.
class AppUpdateArtifact {
  const AppUpdateArtifact({
    required this.abi,
    required this.apkUrl,
    required this.sha256,
    required this.sizeBytes,
  });

  final String abi;
  final Uri apkUrl;

  /// Lowercase hex SHA-256 of the APK bytes.
  final String sha256;
  final int sizeBytes;
}

/// Parsed, validated `latest.json`.
class AppUpdateManifest {
  const AppUpdateManifest({
    required this.version,
    required this.buildNumber,
    required this.minSupportedBuild,
    required this.notes,
    required this.artifacts,
  });

  final String version;
  final int buildNumber;
  final int minSupportedBuild;
  final String notes;
  final List<AppUpdateArtifact> artifacts;

  /// Parses `latest.json` against [manifestUri]. Returns null for anything that
  /// is not a complete, trusted manifest: a partial or malformed file must never
  /// force an update, so the caller simply treats null as "no update".
  static AppUpdateManifest? parse(String body, {required Uri manifestUri}) {
    final Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on FormatException {
      return null;
    }
    if (decoded is! Map) return null;
    final map = <String, Object?>{};
    for (final entry in decoded.entries) {
      final key = entry.key;
      if (key is! String) return null;
      map[key] = entry.value;
    }

    if (_asInt(map['schema']) != 1) return null;

    final version = map['version'];
    if (version is! String || version.trim().isEmpty) return null;

    final buildNumber = _asInt(map['build_number']);
    if (buildNumber == null || buildNumber <= 0) return null;

    final minSupported = _asInt(map['min_supported_build']);
    if (minSupported == null || minSupported < 0) return null;

    final rawArtifacts = map['artifacts'];
    if (rawArtifacts is! List || rawArtifacts.isEmpty) return null;
    final artifacts = <AppUpdateArtifact>[];
    for (final entry in rawArtifacts) {
      final artifact = _parseArtifact(entry, manifestUri);
      if (artifact == null) return null;
      artifacts.add(artifact);
    }

    final notes = map['notes'];
    return AppUpdateManifest(
      version: version.trim(),
      buildNumber: buildNumber,
      minSupportedBuild: minSupported,
      notes: notes is String ? notes.trim() : '',
      artifacts: List<AppUpdateArtifact>.unmodifiable(artifacts),
    );
  }
}

/// Everything the channel reports about the installed app on this device.
class AppUpdateDeviceInfo {
  const AppUpdateDeviceInfo({
    required this.versionName,
    required this.versionCode,
    required this.abis,
    required this.cacheDir,
  });

  final String versionName;
  final int versionCode;
  final List<String> abis;
  final String cacheDir;
}

/// A concrete offer: the newer manifest plus the artifact chosen for this ABI.
class AppUpdateInfo {
  const AppUpdateInfo({
    required this.manifest,
    required this.artifact,
    required this.forced,
  });

  final AppUpdateManifest manifest;
  final AppUpdateArtifact artifact;

  /// `installed.versionCode < min_supported_build`.
  final bool forced;

  int get buildNumber => manifest.buildNumber;
  String get version => manifest.version;
  String get notes => manifest.notes;
  int get sizeBytes => artifact.sizeBytes;
}

/// Decides whether to offer [manifest] to a device running [device].
///
/// `build_number` is the comparison truth; `version` is display only. The
/// result is null when the remote build is not newer or no artifact matches the
/// device ABIs, so an update is never offered without a downloadable APK.
AppUpdateInfo? decideAppUpdate({
  required AppUpdateManifest manifest,
  required AppUpdateDeviceInfo device,
}) {
  if (manifest.buildNumber <= device.versionCode) return null;
  final artifact = pickAppUpdateArtifact(manifest.artifacts, device.abis);
  if (artifact == null) return null;
  return AppUpdateInfo(
    manifest: manifest,
    artifact: artifact,
    forced: device.versionCode < manifest.minSupportedBuild,
  );
}

/// First listed artifact whose ABI matches, walked in the device's own ABI
/// preference order. Null means this device has no compatible APK.
AppUpdateArtifact? pickAppUpdateArtifact(
  List<AppUpdateArtifact> artifacts,
  List<String> abis,
) {
  for (final abi in abis) {
    for (final artifact in artifacts) {
      if (artifact.abi == abi) return artifact;
    }
  }
  return null;
}

AppUpdateArtifact? _parseArtifact(Object? raw, Uri manifestUri) {
  if (raw is! Map) return null;
  final map = <String, Object?>{};
  for (final entry in raw.entries) {
    final key = entry.key;
    if (key is! String) return null;
    map[key] = entry.value;
  }

  final abi = map['abi'];
  if (abi is! String || abi.trim().isEmpty) return null;

  final apkUrl = map['apk_url'];
  if (apkUrl is! String) return null;
  final uri = Uri.tryParse(apkUrl.trim());
  if (uri == null) return null;
  // TLS only, and the APK host must be the manifest host: a tampered manifest
  // cannot redirect the download to another server.
  if (uri.scheme != 'https' || !uri.hasAuthority) return null;
  if (uri.host.toLowerCase() != manifestUri.host.toLowerCase()) return null;

  final sha = map['sha256'];
  if (sha is! String) return null;
  final digest = sha.trim().toLowerCase();
  if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(digest)) return null;

  final size = _asInt(map['size_bytes']);
  if (size == null || size <= 0) return null;

  return AppUpdateArtifact(
    abi: abi.trim(),
    apkUrl: uri,
    sha256: digest,
    sizeBytes: size,
  );
}

int? _asInt(Object? value) {
  if (value is int) return value;
  if (value is double && value == value.roundToDouble()) return value.toInt();
  return null;
}
