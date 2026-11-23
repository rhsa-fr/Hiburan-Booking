import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:tarlink_customer/features/update/app_update_channel.dart';
import 'package:tarlink_customer/features/update/app_update_models.dart';
import 'package:tarlink_customer/features/update/app_update_prompt_store.dart';
import 'package:tarlink_customer/features/update/app_update_service.dart';

import '_fixtures.dart';

const _payloadSize = 2048;

class _FakeChannel implements AppUpdateChannel {
  _FakeChannel({this.digest, required this.device});

  String? digest;
  final AppUpdateDeviceInfo device;
  int installCalls = 0;
  String? installedPath;

  @override
  Future<AppUpdateDeviceInfo> deviceInfo() async => device;

  @override
  Future<bool> canInstallPackages() async => true;

  @override
  Future<bool> openInstallSettings() async => true;

  @override
  Future<String> sha256OfFile(String path) async {
    final value = digest;
    if (value == null) {
      throw const AppUpdateException(AppUpdateError.fileMissing);
    }
    return value;
  }

  @override
  Future<AppUpdateInstallResult> installApk(String path) async {
    installCalls++;
    installedPath = path;
    return const AppUpdateInstallResult(AppUpdateInstallStatus.ok);
  }
}

class _MemoryPromptStore implements AppUpdatePromptStore {
  AppUpdatePromptState? state;

  @override
  Future<AppUpdatePromptState?> read() async => state;

  @override
  Future<void> write(AppUpdatePromptState value) async => state = value;
}

class _Harness {
  _Harness({
    required this.dir,
    required this.service,
    required this.channel,
    required this.payload,
  });

  final Directory dir;
  final AppUpdateService service;
  final _FakeChannel channel;
  final List<int> payload;

  /// Mirrors the path the service builds: `<cacheDir>/updates/tarlink-<build>`
  /// (Android cacheDir is POSIX, the file store appends the platform separator).
  String get targetPath => [
    '${dir.path}/updates',
    'tarlink-4.apk',
  ].join(Platform.pathSeparator);

  AppUpdateInfo info() {
    final manifest = AppUpdateManifest.parse(
      manifestJson(
        artifacts: [artifact(sizeBytes: _payloadSize)],
      ),
      manifestUri: manifestUri,
    )!;
    return decideAppUpdate(
      manifest: manifest,
      device: deviceInfo(cacheDir: dir.path),
    )!;
  }
}

Future<_Harness> _harness({String digest = matchingSha, bool truncate = false}) async {
  final dir = await Directory.systemTemp.createTemp('tarlink_update_test');
  addTearDown(() async {
    if (await dir.exists()) await dir.delete(recursive: true);
  });

  final payload = List<int>.generate(_payloadSize, (i) => i % 251);
  final body = truncate ? payload.sublist(0, 1000) : payload;
  final client = MockClient.streaming((request, bodyStream) async {
    return http.StreamedResponse(
      Stream.fromIterable([body.sublist(0, 500), body.sublist(500)]),
      200,
      contentLength: payload.length,
    );
  });

  final channel = _FakeChannel(
    digest: digest,
    device: deviceInfo(cacheDir: dir.path),
  );
  final service = AppUpdateService(
    client: client,
    channel: channel,
    manifestUrl: manifestUrlString,
    promptStore: _MemoryPromptStore(),
    clock: () => DateTime.utc(2026, 11, 23, 3),
  );
  return _Harness(
    dir: dir,
    service: service,
    channel: channel,
    payload: payload,
  );
}

void main() {
  group('unduhan + digest', () {
    test('hash cocok menyimpan berkas di cache/updates', () async {
      final harness = await _harness();
      final progress = <int>[];

      final path = await harness.service.downloadUpdate(
        harness.info(),
        onProgress: (received, total) => progress.add(received),
        cancel: AppUpdateCancelToken(),
      );

      expect(path, harness.targetPath);
      final file = File(path);
      expect(await file.exists(), isTrue);
      expect(await file.length(), _payloadSize);
      expect(progress, isNotEmpty);
      expect(progress.last, _payloadSize);
      expect(harness.service.hasPendingInstall, isTrue);
      expect(harness.service.pendingInstallPath, path);
    });

    test('hash tidak cocok menghapus berkas dan melaporkan hashMismatch', () async {
      final harness = await _harness(digest: otherSha);

      await expectLater(
        harness.service.downloadUpdate(
          harness.info(),
          onProgress: (_, _) {},
          cancel: AppUpdateCancelToken(),
        ),
        throwsA(
          isA<AppUpdateException>().having(
            (error) => error.error,
            'error',
            AppUpdateError.hashMismatch,
          ),
        ),
      );

      expect(await File(harness.targetPath).exists(), isFalse);
      expect(harness.service.hasPendingInstall, isFalse);
    });

    test('isi terpotong dianggap interrupted dan berkas dibuang', () async {
      final harness = await _harness(truncate: true);

      await expectLater(
        harness.service.downloadUpdate(
          harness.info(),
          onProgress: (_, _) {},
          cancel: AppUpdateCancelToken(),
        ),
        throwsA(
          isA<AppUpdateException>().having(
            (error) => error.error,
            'error',
            AppUpdateError.interrupted,
          ),
        ),
      );

      expect(await File(harness.targetPath).exists(), isFalse);
    });

    test('token batal menghentikan unduhan tanpa menyisakan berkas', () async {
      final harness = await _harness();
      final cancel = AppUpdateCancelToken()..cancel();

      await expectLater(
        harness.service.downloadUpdate(
          harness.info(),
          onProgress: (_, _) {},
          cancel: cancel,
        ),
        throwsA(
          isA<AppUpdateException>().having(
            (error) => error.error,
            'error',
            AppUpdateError.cancelled,
          ),
        ),
      );

      expect(await File(harness.targetPath).exists(), isFalse);
    });

    test('pemasangan memakai berkas yang sudah diunduh tanpa unduh ulang', () async {
      final harness = await _harness();
      final path = await harness.service.downloadUpdate(
        harness.info(),
        onProgress: (_, _) {},
        cancel: AppUpdateCancelToken(),
      );

      final result = await harness.service.install(path);

      expect(result.ok, isTrue);
      expect(harness.channel.installCalls, 1);
      expect(harness.channel.installedPath, path);
      expect(harness.service.hasPendingInstall, isFalse);
    });

    test('installPending hanya berjalan sekali', () async {
      final harness = await _harness();
      final path = await harness.service.downloadUpdate(
        harness.info(),
        onProgress: (_, _) {},
        cancel: AppUpdateCancelToken(),
      );

      expect(harness.service.hasPendingInstall, isTrue);
      expect((await harness.service.installPending()).ok, isTrue);
      expect(harness.service.hasPendingInstall, isFalse);
      final second = await harness.service.installPending();
      expect(second.status, AppUpdateInstallStatus.fileMissing);
      expect(harness.channel.installCalls, 1);
      expect(harness.channel.installedPath, path);
    });
  });
}
