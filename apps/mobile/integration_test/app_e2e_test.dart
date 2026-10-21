import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:tarlink_customer/core/widgets.dart';
import 'package:tarlink_customer/main.dart' as app;

/// Live end-to-end run: real API at `--dart-define=API_BASE_URL`, real
/// customer account, real (pending) DP payment. Nothing is mocked and no
/// payment is settled here.
const _email = 'qa.b2.520274@tarlink.id';
const _password = 'Tarlink#2026!';
const _bookingCode = 'BK-261021-34E0';

late final IntegrationTestWidgetsFlutterBinding e2eBinding;

/// Bounded wait. `pumpAndSettle` never settles here: the skeletons repeat
/// forever and the status screen polls on a timer.
Future<void> waitFor(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 40),
  String? label,
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (finder.evaluate().isNotEmpty) return;
    await tester.pump(const Duration(milliseconds: 150));
  }
  fail(
    'waitFor: ${label ?? 'target'} tidak muncul dalam '
    '${timeout.inSeconds}s',
  );
}

Future<void> scrollTo(WidgetTester tester, Finder target) async {
  await tester.dragUntilVisible(
    target,
    find.byType(Scrollable).first,
    const Offset(0, -220),
  );
  await tester.pump(const Duration(milliseconds: 250));
}

Future<void> shot(WidgetTester tester, String name) async {
  await tester.pump(const Duration(milliseconds: 350));
  await e2eBinding.takeScreenshot(name);
}

void main() {
  e2eBinding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('customer flow against the live API', (tester) async {
    app.main();

    // (a) Cold start lands on Login.
    await waitFor(tester, find.text('Masuk ke Tarlink'), label: 'Login');
    expect(find.text('Gunakan email dan kata sandi akunmu.'), findsOneWidget);
    await shot(tester, 'e2e-01-login');

    // (b) Login with the existing customer, Home loads live vendor cards.
    await tester.enterText(find.byType(TextFormField).at(0), _email);
    await tester.enterText(find.byType(TextFormField).at(1), _password);
    await tester.tap(find.text('Masuk'));
    // Wait for Home, but stop early on a visible API error so the failure is
    // captured instead of a blind 40s timeout.
    final loginDeadline = DateTime.now().add(const Duration(seconds: 40));
    while (DateTime.now().isBefore(loginDeadline) &&
        find.text('Vendor di sekitar').evaluate().isEmpty &&
        find.byType(AppError).evaluate().isEmpty) {
      await tester.pump(const Duration(milliseconds: 150));
    }
    if (find.text('Vendor di sekitar').evaluate().isEmpty) {
      await shot(tester, 'e2e-02-login-failed');
      fail('Login tidak sampai ke Home (lihat e2e-02-login-failed.png)');
    }
    await waitFor(tester, find.byType(Card), label: 'Kartu vendor');
    expect(find.textContaining('vendor'), findsWidgets);
    await shot(tester, 'e2e-02-home');

    // (c) First vendor: packages + 45-day schedule (45 dates > 14 shown, so
    // the "Lihat tanggal lain" affordance must be there).
    await tester.tap(find.byType(Card).first);
    await waitFor(tester, find.text('Paket'), label: 'Detail vendor');
    await waitFor(tester, find.text('Lihat tanggal lain'), label: 'Jadwal 45 hari');
    expect(find.textContaining(' paket'), findsWidgets);
    await tester.drag(find.byType(ListView).first, const Offset(0, -420));
    await tester.pump(const Duration(milliseconds: 250));
    await shot(tester, 'e2e-03-vendor');

    // (d) Booking saya -> BK-261021-34E0 -> accepted + the three money lines.
    await tester.pageBack();
    await waitFor(tester, find.text('Vendor di sekitar'), label: 'Home lagi');
    await tester.tap(find.text('Booking saya'));
    await waitFor(tester, find.text(_bookingCode), label: 'Daftar booking');
    await tester.tap(find.text(_bookingCode));
    await waitFor(tester, find.text('Diterima vendor'), label: 'Status booking');
    await scrollTo(tester, find.text('Rp 5.050.000'));
    expect(find.text('Rp 5.050.000'), findsOneWidget);
    expect(find.text('Rp 1.500.000'), findsOneWidget);
    expect(find.text('Rp 3.550.000'), findsOneWidget);
    await shot(tester, 'e2e-04-status');

    // (e) Pay DP via BCA virtual account. Creates a pending payment only.
    await scrollTo(tester, find.text('BCA Virtual Account'));
    await tester.tap(find.text('BCA Virtual Account'));
    await tester.pump(const Duration(milliseconds: 200));
    final payButton = find.widgetWithText(PrimaryButton, 'Bayar DP');
    await scrollTo(tester, payButton);
    await tester.tap(payButton);
    await waitFor(
      tester,
      find.text('Salin nomor VA'),
      label: 'Nomor VA BCA',
    );
    expect(find.text('Bayar Rp 1.500.000'), findsOneWidget);
    await shot(tester, 'e2e-05-va');

    // (f) One full 15s poll cycle: screen must stay on the waiting state.
    final pollDeadline = DateTime.now().add(const Duration(seconds: 17));
    while (DateTime.now().isBefore(pollDeadline)) {
      await tester.pump(const Duration(milliseconds: 500));
    }
    expect(tester.takeException(), isNull);
    expect(find.text('Salin nomor VA'), findsOneWidget);
    expect(find.text('Bayar Rp 1.500.000'), findsOneWidget);
    await shot(tester, 'e2e-06-polling');
  });
}
