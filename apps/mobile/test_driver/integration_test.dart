import 'dart:convert';
import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

/// Host-side driver for `flutter drive`. On web the screenshot bytes come from
/// the WebDriver `screenshot` command (chromedriver), not from the page itself.
///
/// `--web-browser-flag=--window-size=…` is ignored: chromedriver re-applies its
/// own window size when the session starts, so the viewport is resized through
/// the WebDriver session here, before the app connects.
Future<void> main() async {
  await _resizeToPhone();
  await integrationDriver(
    onScreenshot: (
      String name,
      List<int> bytes, [
      Map<String, Object?>? args,
    ]) async {
      final dir = Directory(
        Platform.environment['E2E_SHOTS_DIR'] ?? 'e2e_shots',
      );
      await dir.create(recursive: true);
      final file = File('${dir.path}/$name.png');
      await file.writeAsBytes(bytes);
      stdout.writeln('screenshot ${file.path} (${bytes.length} bytes)');
      return bytes.isNotEmpty;
    },
  );
}

Future<void> _resizeToPhone() async {
  final base = Uri.parse(
    'http://localhost:${Platform.environment['WEBDRIVER_PORT'] ?? '4444'}',
  );
  final client = HttpClient();
  try {
    for (var attempt = 0; attempt < 240; attempt++) {
      final sessionId = await _firstSessionId(client, base);
      if (sessionId != null) {
        await _postJson(
          client,
          base.replace(path: '/session/$sessionId/window/rect'),
          {'x': 0, 'y': 0, 'width': 390, 'height': 844},
          'window rect',
        );
        // Chrome clamps the OS window to its minimum width (~500), so the exact
        // 390x844 device viewport comes from CDP device-metrics emulation.
        await _postJson(
          client,
          base.replace(path: '/session/$sessionId/goog/cdp/execute'),
          {
            'cmd': 'Emulation.setDeviceMetricsOverride',
            'params': {
              'width': 390,
              'height': 844,
              'deviceScaleFactor': 2,
              'mobile': true,
            },
          },
          'device metrics',
        );
        return;
      }
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    stdout.writeln('window rect: no WebDriver session found, viewport unchanged');
  } on Object catch (error) {
    stdout.writeln('window rect failed: $error');
  } finally {
    client.close(force: true);
  }
}

Future<void> _postJson(
  HttpClient client,
  Uri uri,
  Map<String, Object?> payload,
  String label,
) async {
  final request = await client.postUrl(uri);
  final bytes = utf8.encode(jsonEncode(payload));
  request.headers.contentType = ContentType.json;
  request.contentLength = bytes.length;
  request.add(bytes);
  final response = await request.close();
  final body = await response.transform(utf8.decoder).join();
  stdout.writeln('$label -> ${response.statusCode} $body');
}

Future<String?> _firstSessionId(HttpClient client, Uri base) async {
  final request = await client.getUrl(base.replace(path: '/sessions'));
  final response = await request.close();
  final body = await response.transform(utf8.decoder).join();
  final sessions = (jsonDecode(body) as Map<String, dynamic>)['value'] as List;
  if (sessions.isEmpty) return null;
  return (sessions.first as Map<String, dynamic>)['id'] as String;
}
