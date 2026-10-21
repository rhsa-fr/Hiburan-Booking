import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/session.dart';

void main() {
  testWidgets('cold start tanpa sesi menampilkan Login', (tester) async {
    final session = Session();
    final api = ApiClient(session: session);
    addTearDown(() {
      api.close();
      session.dispose();
    });

    await tester.pumpWidget(TarlinkApp(session: session, api: api));
    // Halaman Login punya animasi masuk; jangan pakai pumpAndSettle karena
    // skeleton di layar lain bisa berputar terus.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('Masuk'), findsOneWidget);
    expect(find.text('Buat akun baru'), findsOneWidget);
  });

  testWidgets('Login tidak terpotong pada skala teks 1.3x', (tester) async {
    tester.view.physicalSize = const Size(1080, 1920);
    tester.view.devicePixelRatio = 3;
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(() {
      tester.view.reset();
      tester.platformDispatcher.clearTextScaleFactorTestValue();
    });

    final session = Session();
    final api = ApiClient(session: session);
    addTearDown(() {
      api.close();
      session.dispose();
    });

    await tester.pumpWidget(TarlinkApp(session: session, api: api));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('Masuk'), findsOneWidget);
  });
}
