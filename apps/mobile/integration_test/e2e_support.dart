import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:tarlink_customer/core/widgets.dart';

/// Shared bits for the live e2e runs: bounded waits, scrolling, screenshots.
late final IntegrationTestWidgetsFlutterBinding e2eBinding;

void initE2e() {
  e2eBinding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
}

/// Bounded wait. `pumpAndSettle` never settles: skeletons repeat forever and
/// the status screen polls on a timer.
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

/// Bounded inverse wait: route popped, banner dismissed, etc.
Future<void> waitForGone(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 20),
  String? label,
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (finder.evaluate().isEmpty) return;
    await tester.pump(const Duration(milliseconds: 150));
  }
  fail('waitForGone: ${label ?? 'target'} masih ada setelah ${timeout.inSeconds}s');
}

/// Pops the route that owns [page]. `tester.pageBack` is unusable here: covered
/// routes stay in the tree, so two \"Back\" tooltips match.
Future<void> popRoute(WidgetTester tester, Finder page) async {
  Navigator.of(tester.element(page)).pop();
  await tester.pump(const Duration(milliseconds: 500));
}

/// Drags the first scroll view until [target] is on screen, then pumps.
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

const e2eEmail = 'qa.b2.520274@tarlink.id';
const e2ePassword = 'Tarlink#2026!';

/// Cold start -> Login -> submit credentials -> Home with live vendor cards.
Future<void> login(WidgetTester tester) async {
  await waitFor(tester, find.text('Masuk ke Tarlink'), label: 'Login');
  await tester.enterText(find.byType(TextFormField).at(0), e2eEmail);
  await tester.enterText(find.byType(TextFormField).at(1), e2ePassword);
  await tester.tap(find.text('Masuk'));
  // Stop early on a visible API error so the failure is capturable.
  final deadline = DateTime.now().add(const Duration(seconds: 40));
  while (DateTime.now().isBefore(deadline) &&
      find.text('Vendor di sekitar').evaluate().isEmpty &&
      find.byType(AppError).evaluate().isEmpty) {
    await tester.pump(const Duration(milliseconds: 150));
  }
  if (find.text('Vendor di sekitar').evaluate().isEmpty) {
    await shot(tester, 'e2e-login-failed');
    fail('Login tidak sampai ke Home (lihat e2e-login-failed.png)');
  }
  await waitFor(tester, find.byType(Card), label: 'Kartu vendor');
}

/// Taps "Booking saya" in the Home bottom navigation.
Future<void> openBookingList(WidgetTester tester) async {
  await tester.tap(find.text('Booking saya'));
  await tester.pump(const Duration(milliseconds: 300));
}
