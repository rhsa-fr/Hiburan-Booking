import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tarlink_customer/features/update/app_update_models.dart';

import '_fixtures.dart';

void main() {
  group('AppUpdateManifest.parse', () {
    test('membaca manifest lengkap', () {
      final manifest = AppUpdateManifest.parse(
        manifestJson(),
        manifestUri: manifestUri,
      );

      expect(manifest, isNotNull);
      expect(manifest!.version, '1.0.3');
      expect(manifest.buildNumber, 4);
      expect(manifest.minSupportedBuild, 0);
      expect(manifest.notes, 'Perbaikan chat dan status pembayaran.');
      expect(manifest.artifacts, hasLength(1));
      expect(manifest.artifacts.single.abi, 'arm64-v8a');
      expect(manifest.artifacts.single.sha256, matchingSha);
      expect(manifest.artifacts.single.sizeBytes, 61234567);
      expect(
        manifest.artifacts.single.apkUrl.scheme,
        'https',
        reason: 'APK wajib https',
      );
    });

    test('JSON rusak ditolak, bukan dianggap pembaruan', () {
      expect(
        AppUpdateManifest.parse('{not json', manifestUri: manifestUri),
        isNull,
      );
      expect(
        AppUpdateManifest.parse('[]', manifestUri: manifestUri),
        isNull,
      );
    });

    test('field wajib yang hilang menolak seluruh manifest', () {
      Map<String, dynamic> base() =>
          jsonDecode(manifestJson()) as Map<String, dynamic>;

      for (final field in [
        'schema',
        'version',
        'build_number',
        'min_supported_build',
        'artifacts',
      ]) {
        final map = base()..remove(field);
        expect(
          AppUpdateManifest.parse(jsonEncode(map), manifestUri: manifestUri),
          isNull,
          reason: 'tanpa $field manifest harus diabaikan',
        );
      }

      final nullBuild = base()..['build_number'] = null;
      expect(
        AppUpdateManifest.parse(jsonEncode(nullBuild), manifestUri: manifestUri),
        isNull,
      );

      final zeroBuild = base()..['build_number'] = 0;
      expect(
        AppUpdateManifest.parse(jsonEncode(zeroBuild), manifestUri: manifestUri),
        isNull,
      );

      final noArtifacts = base()..['artifacts'] = <Object>[];
      expect(
        AppUpdateManifest.parse(
          jsonEncode(noArtifacts),
          manifestUri: manifestUri,
        ),
        isNull,
      );
    });

    test('schema yang tidak dikenal diabaikan', () {
      expect(
        AppUpdateManifest.parse(manifestJson(schema: 2), manifestUri: manifestUri),
        isNull,
      );
    });

    test('apk_url non-https ditolak', () {
      final body = manifestJson(
        artifacts: [
          artifact(
            apkUrl:
                'http://abc.supabase.co/storage/v1/object/public/'
                'app-releases/tarlink.apk',
          ),
        ],
      );
      expect(AppUpdateManifest.parse(body, manifestUri: manifestUri), isNull);
    });

    test('apk_url dengan host lain ditolak', () {
      final body = manifestJson(
        artifacts: [
          artifact(
            apkUrl:
                'https://evil.example.com/storage/v1/object/public/'
                'app-releases/tarlink.apk',
          ),
        ],
      );
      expect(AppUpdateManifest.parse(body, manifestUri: manifestUri), isNull);
    });

    test('sha256 yang bukan 64 hex ditolak', () {
      final body = manifestJson(
        artifacts: [artifact(sha256: 'abc123')],
      );
      expect(AppUpdateManifest.parse(body, manifestUri: manifestUri), isNull);
    });

    test('sha256 huruf besar dinormalkan ke huruf kecil', () {
      final body = manifestJson(
        artifacts: [artifact(sha256: matchingSha.toUpperCase())],
      );
      final manifest = AppUpdateManifest.parse(body, manifestUri: manifestUri);
      expect(manifest?.artifacts.single.sha256, matchingSha);
    });

    test('catatan kosong diterima', () {
      final manifest = AppUpdateManifest.parse(
        manifestJson(notes: null),
        manifestUri: manifestUri,
      );
      expect(manifest?.notes, '');
    });
  });
}
