import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:tarlink_customer/features/update/app_update_channel.dart';
import 'package:tarlink_customer/features/update/app_update_models.dart';
import 'package:tarlink_customer/features/update/app_update_prompt_store.dart';
import 'package:tarlink_customer/features/update/app_update_service.dart';

import '_fixtures.dart';

class _FakeChannel implements AppUpdateChannel {
  _FakeChannel(this.device);

  final AppUpdateDeviceInfo device;

  @override
  Future<AppUpdateDeviceInfo> deviceInfo() async => device;

  @override
  Future<bool> canInstallPackages() async => true;

  @override
  Future<bool> openInstallSettings() async => true;

  @override
  Future<String> sha256OfFile(String path) async => matchingSha;

  @override
  Future<AppUpdateInstallResult> installApk(String path) async =>
      const AppUpdateInstallResult(AppUpdateInstallStatus.ok);
}

class _MemoryPromptStore implements AppUpdatePromptStore {
  _MemoryPromptStore([this.state]);

  AppUpdatePromptState? state;

  @override
  Future<AppUpdatePromptState?> read() async => state;

  @override
  Future<void> write(AppUpdatePromptState value) async => state = value;
}

void main() {
  final device = deviceInfo(versionCode: 3);

  AppUpdateService build({
    required http.Client client,
    required AppUpdatePromptStore store,
    DateTime? now,
  }) => AppUpdateService(
    client: client,
    channel: _FakeChannel(device),
    manifestUrl: manifestUrlString,
    promptStore: store,
    clock: () => now ?? DateTime.utc(2026, 11, 23, 3),
  );

  test('build lebih baru ditawarkan dan dicatat per sesi', () async {
    final store = _MemoryPromptStore();
    final service = build(
      client: MockClient((_) async => http.Response(manifestJson(), 200)),
      store: store,
    );

    final info = await service.checkForUpdate();
    expect(info, isNotNull);
    expect(info!.buildNumber, 4);

    service.markPrompted(info);
    expect(await service.checkForUpdate(), isNull);
  });

  test('menolak menyimpan snooze 24 jam di storage', () async {
    final store = _MemoryPromptStore();
    final service = build(
      client: MockClient((_) async => http.Response(manifestJson(), 200)),
      store: store,
      now: DateTime.utc(2026, 11, 23, 3),
    );
    final info = await service.checkForUpdate();
    await service.markDeclined(info!);

    expect(store.state?.buildNumber, 4);
    expect(store.state?.promptedAt, DateTime.utc(2026, 11, 23, 3));
  });

  test('snooze berlaku lintas proses selama belum 24 jam', () async {
    final store = _MemoryPromptStore(
      AppUpdatePromptState(
        buildNumber: 4,
        promptedAt: DateTime.utc(2026, 11, 23, 0),
      ),
    );
    final service = build(
      client: MockClient((_) async => http.Response(manifestJson(), 200)),
      store: store,
      now: DateTime.utc(2026, 11, 23, 12),
    );

    expect(await service.checkForUpdate(), isNull);
  });

  test('setelah 24 jam build yang sama ditawarkan lagi', () async {
    final store = _MemoryPromptStore(
      AppUpdatePromptState(
        buildNumber: 4,
        promptedAt: DateTime.utc(2026, 11, 22, 0),
      ),
    );
    final service = build(
      client: MockClient((_) async => http.Response(manifestJson(), 200)),
      store: store,
      now: DateTime.utc(2026, 11, 23, 3),
    );

    expect(await service.checkForUpdate(), isNotNull);
  });

  test('snooze hanya untuk build yang sama', () async {
    final store = _MemoryPromptStore(
      AppUpdatePromptState(
        buildNumber: 3,
        promptedAt: DateTime.utc(2026, 11, 23, 2),
      ),
    );
    final service = build(
      client: MockClient((_) async => http.Response(manifestJson(), 200)),
      store: store,
      now: DateTime.utc(2026, 11, 23, 3),
    );

    expect(await service.checkForUpdate(), isNotNull);
  });

  test('pembaruan wajib mengabaikan snooze', () async {
    final store = _MemoryPromptStore(
      AppUpdatePromptState(
        buildNumber: 4,
        promptedAt: DateTime.utc(2026, 11, 23, 2),
      ),
    );
    final service = build(
      client: MockClient(
        (_) async => http.Response(
          manifestJson(buildNumber: 4, minSupportedBuild: 4),
          200,
        ),
      ),
      store: store,
      now: DateTime.utc(2026, 11, 23, 3),
    );

    final info = await service.checkForUpdate();
    expect(info?.forced, isTrue);
  });

  test('cek manual melewati snooze dan mengirim no-cache', () async {
    String? cacheControl;
    final store = _MemoryPromptStore(
      AppUpdatePromptState(
        buildNumber: 4,
        promptedAt: DateTime.utc(2026, 11, 23, 2),
      ),
    );
    final service = build(
      client: MockClient((request) async {
        cacheControl = request.headers['Cache-Control'];
        return http.Response(manifestJson(), 200);
      }),
      store: store,
      now: DateTime.utc(2026, 11, 23, 3),
    );

    expect(await service.checkForUpdate(manual: true), isNotNull);
    expect(cacheControl, 'no-cache');
  });

  test('manifest URL kosong mematikan fitur tanpa panggilan jaringan', () async {
    var calls = 0;
    final service = AppUpdateService(
      client: MockClient((_) async {
        calls++;
        return http.Response(manifestJson(), 200);
      }),
      channel: _FakeChannel(device),
      manifestUrl: '',
      promptStore: _MemoryPromptStore(),
    );

    expect(service.enabled, isFalse);
    expect(await service.checkForUpdate(manual: true), isNull);
    expect(calls, 0);
  });

  test('server 500 dilaporkan sebagai error jaringan', () async {
    final service = build(
      client: MockClient((_) async => http.Response('oops', 500)),
      store: _MemoryPromptStore(),
    );

    await expectLater(
      service.checkForUpdate(),
      throwsA(
        isA<AppUpdateException>().having(
          (error) => error.error,
          'error',
          AppUpdateError.network,
        ),
      ),
    );
  });

  test('manifest rusak dilaporkan sebagai invalidManifest', () async {
    final service = build(
      client: MockClient((_) async => http.Response('{not json', 200)),
      store: _MemoryPromptStore(),
    );

    await expectLater(
      service.checkForUpdate(),
      throwsA(
        isA<AppUpdateException>().having(
          (error) => error.error,
          'error',
          AppUpdateError.invalidManifest,
        ),
      ),
    );
  });
}
