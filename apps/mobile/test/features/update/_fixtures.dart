import 'dart:convert';

import 'package:tarlink_customer/features/update/app_update_models.dart';

/// Shared fixtures for the update tests. Not a `_test.dart` file, so the runner
/// ignores it.
const manifestUrlString =
    'https://abc.supabase.co/storage/v1/object/public/app-releases/latest.json';

final manifestUri = Uri.parse(manifestUrlString);

const matchingSha =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const otherSha =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

String manifestJson({
  int schema = 1,
  String version = '1.0.3',
  int buildNumber = 4,
  int minSupportedBuild = 0,
  String? notes = 'Perbaikan chat dan status pembayaran.',
  List<Map<String, Object?>>? artifacts,
}) => jsonEncode({
  'schema': schema,
  'version': version,
  'build_number': buildNumber,
  'min_supported_build': minSupportedBuild,
  'published_at': '2026-11-23T03:00:00Z',
  'notes': notes,
  'artifacts': artifacts ?? [artifact()],
});

Map<String, Object?> artifact({
  String abi = 'arm64-v8a',
  String? apkUrl,
  String sha256 = matchingSha,
  int sizeBytes = 61234567,
}) => {
  'abi': abi,
  'apk_url':
      apkUrl ??
      'https://abc.supabase.co/storage/v1/object/public/app-releases/'
          'tarlink-1.0.3-$abi.apk',
  'sha256': sha256,
  'size_bytes': sizeBytes,
};

AppUpdateDeviceInfo deviceInfo({
  String versionName = '1.0.2',
  int versionCode = 3,
  List<String> abis = const ['arm64-v8a'],
  String cacheDir = '.',
}) => AppUpdateDeviceInfo(
  versionName: versionName,
  versionCode: versionCode,
  abis: abis,
  cacheDir: cacheDir,
);
