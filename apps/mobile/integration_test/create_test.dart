import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tarlink_customer/core/widgets.dart';
import 'package:tarlink_customer/features/booking/status_page.dart';
import 'package:tarlink_customer/features/discovery/vendor_page.dart';
import 'package:tarlink_customer/main.dart' as app;

import 'e2e_support.dart';

/// A real customer booking, end to end: vendor -> package -> date/session ->
/// create form -> status (requested) -> booking list. Nothing is accepted or
/// paid here.
final _bookingCodePattern = RegExp(r'BK-\d{6}-[A-Z0-9]{4}');
final _dateChipText = RegExp(r'^(Sen|Sel|Rab|Kam|Jum|Sab|Min) \d');

void main() {
  initE2e();

  testWidgets('customer creates a booking through the UI', (tester) async {
    app.main();
    await login(tester);
    await shot(tester, 'mobile-01-home');

    // Home -> first vendor.
    await tester.tap(find.byType(Card).first);
    await waitFor(tester, find.text('Paket'), label: 'Detail vendor');
    await waitFor(
      tester,
      find.text('Lihat tanggal lain'),
      label: 'Jadwal 45 hari',
    );
    await shot(tester, 'mobile-02-vendor');

    // Choose the first package, then an allowed session on the default date.
    final choosePackage = find.text('Pesan paket ini').first;
    await scrollTo(tester, choosePackage);
    await tester.tap(choosePackage);
    await tester.pump(const Duration(milliseconds: 400));

    final session = find.text('Siang');
    await scrollTo(tester, session);
    await tester.tap(session);
    await tester.pump(const Duration(milliseconds: 250));
    expect(find.textContaining(' · '), findsOneWidget);

    await tester.tap(find.byType(PrimaryButton));
    await waitFor(tester, find.text('Buat booking'), label: 'Halaman create');
    await waitFor(tester, find.text('Tanggal acara'), label: 'Form create');

    // Pick the first date button; it also preselects a session and fills the
    // event title from vendor + date.
    final dateChip = find.byWidgetPredicate(
      (w) => w is Text && _dateChipText.hasMatch(w.data ?? ''),
    );
    await scrollTo(tester, dateChip.first);
    await tester.tap(dateChip.first);
    await waitFor(tester, find.textContaining('Sesi ·'), label: 'Sesi terpilih');

    // Fill the event details. Title comes from the date pick; notes stay empty.
    await scrollTo(tester, find.text('Detail acara'));
    await tester.enterText(find.byType(TextFormField).at(1), '50');
    await tester.enterText(
      find.byType(TextFormField).at(2),
      'Jl. Raya Indramayu No. 12, rumah pagar hijau',
    );
    await tester.pump(const Duration(milliseconds: 200));
    await shot(tester, 'mobile-03-create');

    await tester.tap(find.text('Kirim permintaan booking'));

    final codeFinder = find.byWidgetPredicate(
      (w) => w is Text && _bookingCodePattern.hasMatch(w.data ?? ''),
    );
    await waitFor(
      tester,
      codeFinder,
      label: 'Kode booking baru',
      timeout: const Duration(seconds: 60),
    );
    final code = _bookingCodePattern
        .firstMatch(tester.widget<Text>(codeFinder.first).data!)!
        .group(0)!;

    expect(find.text('Menunggu vendor menerima'), findsWidgets);
    expect(find.text('Menunggu jawaban'), findsOneWidget);
    expect(find.text('Belum bayar'), findsOneWidget);
    expect(find.textContaining(code), findsWidgets);

    // Let the "Booking terkirim" snackbar go before the screenshot.
    final snackDeadline = DateTime.now().add(const Duration(seconds: 6));
    while (DateTime.now().isBefore(snackDeadline) &&
        find.byType(SnackBar).evaluate().isNotEmpty) {
      await tester.pump(const Duration(milliseconds: 300));
    }
    await shot(tester, 'mobile-04-status-unpaid');

    // Back to Home (status replaced create, so two pops), then the list.
    await popRoute(tester, find.byType(BookingStatusPage));
    await waitForGone(
      tester,
      find.byType(BookingStatusPage),
      label: 'Status booking',
    );
    await popRoute(tester, find.byType(VendorPage));
    await waitForGone(tester, find.byType(VendorPage), label: 'Detail vendor');
    await waitFor(tester, find.text('Vendor di sekitar'), label: 'Home');
    await openBookingList(tester);
    await waitFor(tester, find.text(code), label: 'Booking baru di daftar');
    // The fixed client must render unpaid as paid 0 / remaining full total.
    final newCard = find.ancestor(
      of: find.text(code),
      matching: find.byType(Card),
    );
    expect(
      find.descendant(
        of: newCard,
        matching: find.textContaining('Dibayar Rp 0'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: newCard,
        matching: find.textContaining('Sisa Rp 5.050.000'),
      ),
      findsOneWidget,
    );
    await shot(tester, 'mobile-06-list');
  });
}
