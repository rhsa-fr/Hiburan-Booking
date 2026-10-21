import 'package:flutter_test/flutter_test.dart';
import 'package:tarlink_customer/features/booking/status_page.dart';
import 'package:tarlink_customer/main.dart' as app;

import 'e2e_support.dart';

/// After the PJP webhook, `BK-261021-34E0` must read as confirmed / DP paid,
/// with the payment picker gone.
const _bookingCode = 'BK-261021-34E0';

void main() {
  initE2e();

  testWidgets('settled booking shows paid state', (tester) async {
    app.main();
    await login(tester);

    await openBookingList(tester);
    await waitFor(tester, find.text(_bookingCode), label: 'Daftar booking');
    await tester.tap(find.text(_bookingCode));

    await waitFor(
      tester,
      find.text('Jadwalmu sudah dikunci'),
      label: 'Headline confirmed',
    );
    // The covered booking list stays in the widget tree, so chips like
    // "Terjadwal" also match there. Scope the state assertions to this page.
    final statusPage = find.byType(BookingStatusPage);
    expect(
      find.descendant(of: statusPage, matching: find.text('Terjadwal')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: statusPage, matching: find.text('DP lunas')),
      findsOneWidget,
    );

    await scrollTo(tester, find.text('Rp 3.550.000'));
    expect(find.text('Rp 5.050.000'), findsOneWidget);
    expect(find.text('Rp 1.500.000'), findsOneWidget);
    expect(find.text('Rp 3.550.000'), findsOneWidget);
    expect(find.text('DP sudah dibayar'), findsOneWidget);
    expect(find.text('DP diterima'), findsOneWidget);

    // Payment picker must be gone for dp_paid.
    expect(find.text('Bayar DP'), findsNothing);
    expect(find.text('QRIS'), findsNothing);
    expect(find.text('BCA Virtual Account'), findsNothing);
    expect(find.text('Salin nomor VA'), findsNothing);

    await shot(tester, 'mobile-05-settled');
  });
}
