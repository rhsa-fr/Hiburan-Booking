import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/features/update/app_update_channel.dart';
import 'package:tarlink_customer/features/update/app_update_models.dart';
import 'package:tarlink_customer/features/update/app_update_prompt_store.dart';
import 'package:tarlink_customer/features/update/app_update_service.dart';
import 'package:tarlink_customer/features/update/update_dialog.dart';

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
  AppUpdatePromptState? state;

  @override
  Future<AppUpdatePromptState?> read() async => state;

  @override
  Future<void> write(AppUpdatePromptState value) async => state = value;
}

AppUpdateInfo _info({required bool forced}) {
  final manifest = AppUpdateManifest.parse(
    manifestJson(minSupportedBuild: forced ? 4 : 0),
    manifestUri: manifestUri,
  )!;
  return decideAppUpdate(
    manifest: manifest,
    device: deviceInfo(versionCode: 3),
  )!;
}

Future<void> _pumpDialog(
  WidgetTester tester,
  AppUpdateInfo info,
) async {
  final service = AppUpdateService(
    client: MockClient((_) async => http.Response(manifestJson(), 200)),
    channel: _FakeChannel(deviceInfo(versionCode: 3)),
    manifestUrl: manifestUrlString,
    promptStore: _MemoryPromptStore(),
  );
  await tester.pumpWidget(
    MaterialApp(
      theme: buildTheme(),
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => showAppUpdateDialog(
                context,
                service: service,
                info: info,
              ),
              child: const Text('buka'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('buka'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('dialog menampilkan versi, catatan, dan dua pilihan', (
    tester,
  ) async {
    await _pumpDialog(tester, _info(forced: false));

    expect(find.text('Pembaruan tersedia'), findsOneWidget);
    expect(find.textContaining('Versi 1.0.3'), findsOneWidget);
    expect(find.textContaining('58,4 MB'), findsOneWidget);
    expect(find.text('Perbaikan chat dan status pembayaran.'), findsOneWidget);
    expect(find.text('Nanti'), findsOneWidget);
    expect(find.text('Perbarui'), findsOneWidget);
  });

  testWidgets('pembaruan wajib menyembunyikan Nanti', (tester) async {
    await _pumpDialog(tester, _info(forced: true));

    expect(find.text('Pembaruan wajib'), findsOneWidget);
    expect(find.textContaining('wajib dipasang'), findsOneWidget);
    expect(find.text('Nanti'), findsNothing);
    expect(find.text('Perbarui'), findsOneWidget);
  });

  testWidgets('Nanti menutup dialog dengan hasil declined', (tester) async {
    final service = AppUpdateService(
      client: MockClient((_) async => http.Response(manifestJson(), 200)),
      channel: _FakeChannel(deviceInfo(versionCode: 3)),
      manifestUrl: manifestUrlString,
      promptStore: _MemoryPromptStore(),
    );
    AppUpdateDialogResult? result;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () async {
                  result = await showAppUpdateDialog(
                    context,
                    service: service,
                    info: _info(forced: false),
                  );
                },
                child: const Text('buka'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('buka'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Nanti'));
    await tester.pumpAndSettle();

    expect(result, AppUpdateDialogResult.declined);
    expect(find.text('Pembaruan tersedia'), findsNothing);
  });
}
