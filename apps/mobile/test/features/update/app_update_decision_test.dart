import 'package:flutter_test/flutter_test.dart';
import 'package:tarlink_customer/features/update/app_update_models.dart';

import '_fixtures.dart';

AppUpdateManifest parse({
  int buildNumber = 4,
  int minSupportedBuild = 0,
  List<Map<String, Object?>>? artifacts,
}) {
  final manifest = AppUpdateManifest.parse(
    manifestJson(
      buildNumber: buildNumber,
      minSupportedBuild: minSupportedBuild,
      artifacts: artifacts,
    ),
    manifestUri: manifestUri,
  );
  expect(manifest, isNotNull, reason: 'fixture harus valid');
  return manifest!;
}

void main() {
  group('keputusan versi', () {
    test('build remote sama dengan terpasang tidak menawarkan apa pun', () {
      final info = decideAppUpdate(
        manifest: parse(buildNumber: 3),
        device: deviceInfo(versionCode: 3),
      );
      expect(info, isNull);
    });

    test('build remote lebih lama tidak menawarkan apa pun', () {
      final info = decideAppUpdate(
        manifest: parse(buildNumber: 2),
        device: deviceInfo(versionCode: 3),
      );
      expect(info, isNull);
    });

    test('build remote lebih baru menawarkan pembaruan opsional', () {
      final info = decideAppUpdate(
        manifest: parse(buildNumber: 4, minSupportedBuild: 0),
        device: deviceInfo(versionCode: 3),
      );
      expect(info, isNotNull);
      expect(info!.forced, isFalse);
      expect(info.buildNumber, 4);
      expect(info.version, '1.0.3');
    });

    test('min_supported_build di atas versi terpasang memaksa pembaruan', () {
      final info = decideAppUpdate(
        manifest: parse(buildNumber: 5, minSupportedBuild: 4),
        device: deviceInfo(versionCode: 3),
      );
      expect(info, isNotNull);
      expect(info!.forced, isTrue);
    });

    // Regresi production 2026-11-26: APK split membawa prefix ABI pada
    // versionCode (1000/2000/4000), sehingga 1.0.3 melaporkan 2004 dan
    // perbandingan langsung dengan build_number 5 selalu "sudah terbaru".
    group('versionCode APK split ber-prefix ABI', () {
      for (final (abi, code) in [
        ('armeabi-v7a', 1004),
        ('arm64-v8a', 2004),
        ('x86_64', 4004),
      ]) {
        test('$abi build 4 melihat build 5 sebagai pembaruan', () {
          final info = decideAppUpdate(
            manifest: parse(
              buildNumber: 5,
              artifacts: [
                artifact(abi: abi),
              ],
            ),
            device: deviceInfo(versionCode: code, abis: [abi]),
          );
          expect(info, isNotNull, reason: '$code harus dinormalkan ke 4');
          expect(info!.buildNumber, 5);
        });
      }

      test('build yang sama setelah dinormalkan tidak menawarkan apa pun', () {
        final info = decideAppUpdate(
          manifest: parse(buildNumber: 5),
          device: deviceInfo(versionCode: 2005),
        );
        expect(info, isNull);
      });

      test('forced memakai build number yang sudah dinormalkan', () {
        final info = decideAppUpdate(
          manifest: parse(buildNumber: 6, minSupportedBuild: 6),
          device: deviceInfo(versionCode: 2005),
        );
        expect(info, isNotNull);
        expect(info!.forced, isTrue);
      });
    });

    test('min_supported_build sama dengan versi terpasang tidak memaksa', () {
      final info = decideAppUpdate(
        manifest: parse(buildNumber: 5, minSupportedBuild: 3),
        device: deviceInfo(versionCode: 3),
      );
      expect(info!.forced, isFalse);
    });

    test('tanpa artefak yang cocok tidak ada tawaran', () {
      final info = decideAppUpdate(
        manifest: parse(artifacts: [artifact(abi: 'x86_64')]),
        device: deviceInfo(abis: const ['arm64-v8a']),
      );
      expect(info, isNull);
    });
  });

  group('pemilihan ABI', () {
    final artifacts = [
      AppUpdateArtifact(
        abi: 'armeabi-v7a',
        apkUrl: Uri.parse('https://abc.supabase.co/v7a.apk'),
        sha256: matchingSha,
        sizeBytes: 10,
      ),
      AppUpdateArtifact(
        abi: 'arm64-v8a',
        apkUrl: Uri.parse('https://abc.supabase.co/v8a.apk'),
        sha256: matchingSha,
        sizeBytes: 10,
      ),
    ];

    test('urutan perangkat dipakai lebih dulu: arm64 menang', () {
      final picked = pickAppUpdateArtifact(artifacts, const [
        'arm64-v8a',
        'armeabi-v7a',
      ]);
      expect(picked?.abi, 'arm64-v8a');
    });

    test('perangkat 32-bit jatuh ke armv7', () {
      final picked = pickAppUpdateArtifact(artifacts, const [
        'armeabi-v7a',
        'armeabi',
      ]);
      expect(picked?.abi, 'armeabi-v7a');
    });

    test('tanpa ABI yang cocok hasilnya null', () {
      expect(pickAppUpdateArtifact(artifacts, const ['x86_64']), isNull);
      expect(pickAppUpdateArtifact(artifacts, const []), isNull);
    });

    test('abi dicocokkan persis, bukan sebagai substring', () {
      expect(pickAppUpdateArtifact(artifacts, const ['arm64']), isNull);
    });
  });
}
