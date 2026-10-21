import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

/// Host-side driver for `flutter drive`. On web the screenshot bytes come from
/// the WebDriver `screenshot` command (chromedriver), not from the page itself.
Future<void> main() async {
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
