import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tarlink_customer/features/booking/status_page.dart';
import 'package:tarlink_customer/features/chat/chat_page.dart';
import 'package:tarlink_customer/main.dart' as app;

import 'e2e_support.dart';

/// Read-only visual pass for the chat screen: it opens a thread but never sends
/// a message, so the demo data stays deterministic.
const _demoBooking = 'BK-261028-33D9';

Future<void> _waitForAny(
  WidgetTester tester,
  List<Finder> finders, {
  Duration timeout = const Duration(seconds: 40),
  String? label,
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (finders.any((finder) => finder.evaluate().isNotEmpty)) return;
    await tester.pump(const Duration(milliseconds: 150));
  }
  fail('waitForAny: ${label ?? 'target'} tidak muncul dalam ${timeout.inSeconds}s');
}

void main() {
  initE2e();

  testWidgets('chat visual pass', (tester) async {
    app.main();
    await _waitForAny(tester, [
      find.text('Mulai cari hiburan'),
      find.text('Vendor Siap Tanggap'),
      find.byType(Scaffold),
    ], label: 'shell aplikasi');

    // A second drive pass can start on another route; do not fail on it.
    if (find.text('Tulis pesan…').evaluate().isNotEmpty) return;

    if (find.text('Mulai cari hiburan').evaluate().isNotEmpty) {
      await tester.tap(find.byType(TextButton));
      await tester.pump(const Duration(milliseconds: 500));
    }
    await loginIfNeeded(tester);

    await openBookingList(tester);
    final demo = find.text(_demoBooking);
    await waitFor(tester, demo, label: 'daftar booking');
    await tester.tap(demo);
    await waitFor(tester, find.byType(BookingStatusPage), label: 'status');
    await tester.pump(const Duration(milliseconds: 1200));

    await waitFor(tester, find.text('Chat dengan vendor'), label: 'tombol chat');
    await tester.tap(find.text('Chat dengan vendor'));
    await waitFor(tester, find.byType(ChatPage), label: 'layar chat');
    await waitFor(tester, find.text('Tulis pesan…'), label: 'composer chat');
    // The reconnect strip is expected until `subscribed` arrives; never gate on
    // it. Give the thread one real frame so the history/empty state settles.
    await tester.pump(const Duration(milliseconds: 1200));
    await shot(tester, 'ui-05b-chat');

    await popRoute(tester, find.byType(ChatPage));
  });
}
