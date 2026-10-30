import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _loadFont(String family, List<(String, int)> variants) async {
  final loader = FontLoader(family);
  for (final (asset, _) in variants) {
    loader.addFont(rootBundle.load(asset));
  }
  await loader.load();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('PlusJakartaSans and RobotoFlex render different widths for bold vs regular', (tester) async {
    await _loadFont('PlusJakartaSans', [
      ('assets/fonts/PlusJakartaSans-Regular.ttf', 400),
      ('assets/fonts/PlusJakartaSans-Bold.ttf', 700),
    ]);
    await _loadFont('Plus Jakarta Sans', [
      ('assets/fonts/PlusJakartaSans-Regular.ttf', 400),
      ('assets/fonts/PlusJakartaSans-Bold.ttf', 700),
    ]);
    await _loadFont('RobotoFlex', [
      ('assets/fonts/RobotoFlex-Regular.ttf', 400),
      ('assets/fonts/RobotoFlex-Bold.ttf', 700),
    ]);

    double width(String family, FontWeight weight) {
      final painter = TextPainter(
        text: TextSpan(
          text: 'Hamburgan Panggung 2026',
          style: TextStyle(
            fontFamily: family,
            fontSize: 24,
            fontWeight: weight,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      return painter.width;
    }

    final pjsRegular = width('PlusJakartaSans', FontWeight.w400);
    final pjsBold = width('PlusJakartaSans', FontWeight.w700);
    final rbfRegular = width('RobotoFlex', FontWeight.w400);
    final rbfBold = width('RobotoFlex', FontWeight.w700);

    // ignore: avoid_print
    print('PJS: reg=$pjsRegular bold=$pjsBold');
    // ignore: avoid_print
    print('RBF: reg=$rbfRegular bold=$rbfBold');

    expect(pjsBold, greaterThan(pjsRegular));
    expect(rbfBold, greaterThan(rbfRegular));
  });
}
