// The packet puts this widget check beside the page inside lib/; flutter_test is
// a dev dependency, which the package-boundary lint does not expect here.
// ignore_for_file: depend_on_referenced_packages
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/core/ui.dart';
import 'package:tarlink_customer/core/widgets.dart';
import 'package:tarlink_customer/features/booking/booking_support.dart';
import 'package:tarlink_customer/features/booking/list_page.dart';
import 'package:tarlink_customer/features/booking/status_page.dart';

const _bookingId = '40f3017d-8141-4008-9f95-7829d0c46f26';

Map<String, dynamic> _booking({
  String lifecycle = 'accepted',
  String payment = 'unpaid',
  int outstanding = 3550000,
  String? settlementAvailableAt,
}) => {
  'id': _bookingId,
  'code': 'BK-261021-34E0',
  'lifecycle_status': lifecycle,
  'payment_status': payment,
  'settlement_status': 'not_eligible',
  'slots': [
    {'date': '2026-12-05', 'session': 'day', 'is_blocking': true},
  ],
  'pricing': {
    'currency': 'IDR',
    'price_package_idr': 5000000,
    'service_fee_idr': 50000,
    'total_customer_idr': 5050000,
    'dp_amount_idr': 1500000,
  },
  'outstanding_idr': outstanding,
  'vendor': {
    'id': 'ed0f2d2e-38f4-4c99-adde-b71a1b629127',
    'slug': 'tarling-dian-91769681',
    'display_name': 'Tarling Dangdut Dian',
    'whatsapp': '0812000917696812',
  },
  'package': {'id': 'd6c7a150', 'name': 'Paket Lengkap 6 jam'},
  'event': {
    'title': 'QA B2 Hajatan',
    'region_code': '3209',
    'venue_address': 'Jl. Pantura QA 1',
    'start_date': '2026-12-05',
    'end_date': '2026-12-05',
  },
  'created_at': '2026-10-21T14:24:26.007Z',
  'updated_at': '2026-10-21T14:43:28.659Z',
  if (settlementAvailableAt != null)
    'settlement_available_at': settlementAvailableAt,
};

http.Response _json(Object body, int status) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Future<void> _pumpStatus(
  WidgetTester tester,
  Future<http.Response> Function(http.Request) handler,
) async {
  final session = Session();
  final api = ApiClient(
    session: session,
    client: MockClient(handler),
    baseUrl: 'http://localhost:3001',
  );
  tester.view.physicalSize = const Size(400, 3200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    AppScope(
      session: session,
      api: api,
      child: MaterialApp(
        theme: buildTheme(),
        home: const BookingStatusPage(bookingId: _bookingId),
      ),
    ),
  );
  await tester.pump();
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

Future<void> _dispose(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump();
}

/// The timeline is the `BookingPanel` that holds "Booking dibuat".
Finder _timeline() => find.ancestor(
  of: find.text('Booking dibuat'),
  matching: find.byType(BookingPanel),
);

Finder _timelineStep(String title) =>
    find.descendant(of: _timeline(), matching: find.text(title));

Finder _timelineRow(String title) =>
    find.ancestor(of: _timelineStep(title), matching: find.byType(Row)).last;

/// Colour of the step dot: `accent` done, `primary` active, `neutralSoft` not
/// started. Read from the widget tree because the state is private to the page.
Color _stepDotColor(WidgetTester tester, String title) {
  final dot = find
      .descendant(
        of: _timelineRow(title),
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is Container &&
              widget.decoration is BoxDecoration &&
              (widget.decoration! as BoxDecoration).shape == BoxShape.circle,
        ),
      )
      .first;
  final decoration = tester.widget<Container>(dot).decoration! as BoxDecoration;
  return decoration.color!;
}

/// Booking status handler: no payment invoices, no disputes, no refund.
Future<http.Response> _statusHandler(
  http.Request request,
  Map<String, dynamic> booking,
) async {
  final path = request.url.path;
  if (path.contains('/disputes')) {
    return _json({'data': {'items': []}}, 200);
  }
  if (path.contains('/payments/')) {
    return _json({
      'error': {'code': 'NOT_FOUND', 'message': 'Belum ada tagihan'},
    }, 404);
  }
  return _json({'data': booking}, 200);
}

void main() {
  testWidgets('money block renders total, DP, and sisa from the API', (
    tester,
  ) async {
    await _pumpStatus(tester, (request) async {
      if (request.url.path.endsWith('/payments/by-booking/$_bookingId')) {
        return _json({
          'error': {
            'code': 'NOT_FOUND',
            'message': 'Belum ada tagihan DP untuk booking ini',
          },
        }, 404);
      }
      return _json({'data': _booking()}, 200);
    });

    expect(find.text('Total yang harus dibayar'), findsOneWidget);
    expect(find.text('Rp5.050.000'), findsOneWidget);
    // DP belum dibayar: jangan tampilkan baris potongan DP.
    expect(find.text('-Rp1.500.000'), findsNothing);
    expect(find.widgetWithText(PrimaryButton, 'Bayar DP'), findsOneWidget);

    await _dispose(tester);
  });

  testWidgets('Bayar DP is hidden after the DP is paid', (tester) async {
    await _pumpStatus(tester, (request) async {
      return _json({
        'data': _booking(lifecycle: 'confirmed', payment: 'dp_paid'),
      }, 200);
    });

    expect(find.text('DP diterima'), findsOneWidget);
    expect(find.text('Bayar DP'), findsNothing);

    await _dispose(tester);
  });

  testWidgets('VA instruction shows the virtual account number', (
    tester,
  ) async {
    await _pumpStatus(tester, (request) async {
      final path = request.url.path;
      if (request.method == 'POST' && path.endsWith('/payments/dp')) {
        return _json({
          'data': {
            'id': '11111111-1111-4111-8111-111111111111',
            'status': 'pending',
            'amount_idr': 1500000,
            'method': 'va_bca',
            'expires_at': '2026-12-05T10:00:00.000Z',
            'payment_instruction': {
              'type': 'va',
              'va_number': '8808123456789012',
              'bank': 'bca',
              'expires_at': '2026-12-05T10:00:00.000Z',
            },
          },
        }, 201);
      }
      if (path.endsWith('/payments/by-booking/$_bookingId')) {
        return _json({
          'error': {'code': 'NOT_FOUND', 'message': 'Belum ada tagihan DP'},
        }, 404);
      }
      return _json({'data': _booking()}, 200);
    });

    await tester.tap(find.text('BCA Virtual Account'));
    await tester.pump();
    await tester.tap(find.widgetWithText(PrimaryButton, 'Bayar DP'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('8808123456789012'), findsOneWidget);
    expect(find.text('Salin nomor VA'), findsOneWidget);

    await _dispose(tester);
  });

  testWidgets('fully paid booking shows the settled panel and no pay action', (
    tester,
  ) async {
    await _pumpStatus(tester, (request) async {
      return _json({
        'data': _booking(
          lifecycle: 'confirmed',
          payment: 'fully_paid',
          outstanding: 0,
        ),
      }, 200);
    });

    expect(find.text('Pembayaran lunas'), findsOneWidget);
    expect(find.text('Lunas'), findsWidgets);
    expect(find.text('Bayar DP'), findsNothing);
    expect(find.textContaining('fully_paid'), findsNothing);

    await _dispose(tester);
  });

  testWidgets('changing the payment method abandons the pending charge', (
    tester,
  ) async {
    var abandoned = false;
    await _pumpStatus(tester, (request) async {
      final path = request.url.path;
      if (request.method == 'POST' && path.endsWith('/payments/dp')) {
        return _json({
          'data': {
            'id': '11111111-1111-4111-8111-111111111111',
            'status': 'pending',
            'amount_idr': 1500000,
            'method': 'va_bca',
            'expires_at': '2026-12-05T10:00:00.000Z',
            'payment_instruction': {
              'type': 'va',
              'va_number': '8808123456789012',
              'bank': 'bca',
              'expires_at': '2026-12-05T10:00:00.000Z',
            },
          },
        }, 201);
      }
      if (request.method == 'POST' && path.endsWith('/payments/abandon')) {
        abandoned = true;
        return _json({
          'data': {
            'cancelled': true,
            'payment_id': '11111111-1111-4111-8111-111111111111',
          },
        }, 200);
      }
      if (path.endsWith('/payments/by-booking/$_bookingId')) {
        return _json({
          'error': {'code': 'NOT_FOUND', 'message': 'Belum ada tagihan DP'},
        }, 404);
      }
      return _json({'data': _booking()}, 200);
    });

    await tester.tap(find.text('BCA Virtual Account'));
    await tester.pump();
    await tester.tap(find.widgetWithText(PrimaryButton, 'Bayar DP'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('8808123456789012'), findsOneWidget);

    await tester.tap(find.text('Ganti metode pembayaran'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(abandoned, isTrue);
    expect(find.text('8808123456789012'), findsNothing);
    expect(find.widgetWithText(PrimaryButton, 'Bayar DP'), findsOneWidget);

    await _dispose(tester);
  });

  testWidgets('shows the refund status, including a manual transfer reference', (
    tester,
  ) async {
    await _pumpStatus(tester, (request) async {
      final path = request.url.path;
      if (path.endsWith('/payments/refunds/by-booking/$_bookingId')) {
        return _json({
          'data': {
            'refund': {
              'id': '22222222-2222-4222-8222-222222222222',
              'amount_idr': 1234000,
              'status': 'succeeded',
              'reason_note': 'Pembatalan acara',
              'is_manual': true,
              'transfer_ref': 'TRF-0001',
              'transferred_at': '2026-11-17T10:00:00.000Z',
            },
          },
        }, 200);
      }
      if (path.endsWith('/payments/by-booking/$_bookingId')) {
        return _json({
          'error': {'code': 'NOT_FOUND', 'message': 'Belum ada tagihan DP'},
        }, 404);
      }
      return _json({
        'data': _booking(lifecycle: 'cancelled', payment: 'refunded', outstanding: 0),
      }, 200);
    });
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('Refund'), findsOneWidget);
    expect(find.text('Selesai'), findsOneWidget);
    expect(find.text('Rp1.234.000'), findsOneWidget);
    expect(find.text('Transfer manual · TRF-0001'), findsOneWidget);

    await _dispose(tester);
  });

  testWidgets('list shows Lunas and Sisa Rp 0 for a fully_paid booking', (
    tester,
  ) async {
    final session = Session();
    final api = ApiClient(
      session: session,
      client: MockClient((request) async {
        if (request.url.path.endsWith('/bookings')) {
          return _json({
            'data': {
              'items': [
                {
                  'id': _bookingId,
                  'code': 'BK-261021-34E0',
                  'lifecycle_status': 'confirmed',
                  'payment_status': 'fully_paid',
                  'settlement_status': 'eligible',
                  'vendor': {
                    'id': 'ed0f2d2e-38f4-4c99-adde-b71a1b629127',
                    'slug': 'tarling-dian-91769681',
                    'display_name': 'Tarling Dangdut Dian',
                  },
                  'package': {'id': 'd6c7a150', 'name': 'Paket Lengkap 6 jam'},
                  'total_customer_idr': 5050000,
                  'dp_amount_idr': 1500000,
                  'outstanding_idr': 0,
                  'first_slot': {'date': '2026-12-05', 'session': 'day'},
                  'created_at': '2026-10-21T14:24:26.007Z',
                  'updated_at': '2026-10-21T14:43:28.659Z',
                },
              ],
              'total': 1,
              'page': 1,
              'page_size': 20,
            },
          }, 200);
        }
        return _json({
          'error': {'code': 'NOT_FOUND', 'message': 'Tidak ada'},
        }, 404);
      }),
      baseUrl: 'http://localhost:3001',
    );
    tester.view.physicalSize = const Size(400, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      AppScope(
        session: session,
        api: api,
        child: MaterialApp(
          theme: buildTheme(),
          home: const BookingListPage(),
        ),
      ),
    );
    await tester.pump();
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }

    expect(find.text('Lunas'), findsOneWidget);
    expect(
      find.text('Dibayar Rp 5.050.000 · Sisa Rp 0'),
      findsOneWidget,
    );

    await _dispose(tester);
  });

  testWidgets('accepted + unpaid: vendor accepted, timeline asks for the DP', (
    tester,
  ) async {
    await _pumpStatus(
      tester,
      (request) => _statusHandler(request, _booking(lifecycle: 'accepted')),
    );

    expect(_timelineStep('Vendor menerima'), findsOneWidget);
    expect(_timelineStep('Bayar DP'), findsOneWidget);
    expect(_timelineStep('DP diterima'), findsNothing);
    expect(_timelineStep('Dikonfirmasi vendor'), findsNothing);

    // The vendor already said yes: its step is done, the DP step is the one
    // waiting on the customer.
    expect(_stepDotColor(tester, 'Vendor menerima'), AppColors.accent);
    expect(
      find.descendant(
        of: _timelineRow('Bayar DP'),
        matching: find.text('Sekarang'),
      ),
      findsOneWidget,
    );

    await _dispose(tester);
  });

  testWidgets('requested: vendor step is active, DP step has not started', (
    tester,
  ) async {
    await _pumpStatus(
      tester,
      (request) => _statusHandler(request, _booking(lifecycle: 'requested')),
    );

    expect(
      find.descendant(
        of: _timelineRow('Vendor menerima'),
        matching: find.text('Sekarang'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: _timelineRow('Bayar DP'),
        matching: find.text('Sekarang'),
      ),
      findsNothing,
    );
    expect(_stepDotColor(tester, 'Bayar DP'), AppColors.neutralSoft);

    await _dispose(tester);
  });

  testWidgets('confirmed + dp_paid: DP done, event active, no receipt on open', (
    tester,
  ) async {
    await _pumpStatus(
      tester,
      (request) => _statusHandler(
        request,
        _booking(lifecycle: 'confirmed', payment: 'dp_paid'),
      ),
    );

    expect(_timelineStep('DP diterima'), findsOneWidget);
    expect(_timelineStep('Bayar DP'), findsNothing);
    expect(_stepDotColor(tester, 'DP diterima'), AppColors.accent);
    expect(
      find.descendant(
        of: _timelineRow('Acara'),
        matching: find.text('Sekarang'),
      ),
      findsOneWidget,
    );

    // Reopening an already-paid booking keeps the paid state visible...
    expect(find.textContaining('DP sudah dibayar'), findsOneWidget);
    // ...but the transition receipt must not appear again.
    expect(find.text('Pembayaran DP diterima'), findsNothing);

    await _dispose(tester);
  });

  testWidgets('unpaid -> dp_paid shows the DP receipt, not the methods', (
    tester,
  ) async {
    var paid = false;
    var settlementFetches = 0;
    await _pumpStatus(tester, (request) async {
      final path = request.url.path;
      if (path.endsWith('/payments/settlement/by-booking/$_bookingId')) {
        settlementFetches++;
        return _json({
          'error': {'code': 'NOT_FOUND', 'message': 'Belum ada tagihan'},
        }, 404);
      }
      if (path.endsWith('/payments/by-booking/$_bookingId')) {
        return _json({
          'error': {'code': 'NOT_FOUND', 'message': 'Belum ada tagihan DP'},
        }, 404);
      }
      if (request.method == 'POST' && path.endsWith('/payments/sync')) {
        return _json({'data': <String, dynamic>{}}, 200);
      }
      if (path.contains('/disputes')) {
        return _json({'data': {'items': []}}, 200);
      }
      return _json({
        'data': _booking(payment: paid ? 'dp_paid' : 'unpaid'),
      }, 200);
    });

    expect(find.text('Pembayaran DP diterima'), findsNothing);

    // The 15 s poll is how a payment webhook reaches an open page.
    paid = true;
    await tester.pump(const Duration(seconds: 15));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('Pembayaran DP diterima'), findsOneWidget);
    expect(find.text('Rp1.500.000'), findsWidgets);
    expect(find.textContaining('sudah dikunci'), findsWidgets);
    // No settlement window in the payload: the receipt still offers pelunasan.
    expect(
      find.text(
        'Sisa pelunasan bisa kamu bayar dari kartu pelunasan di bawah.',
      ),
      findsOneWidget,
    );

    // Nothing was asked for and nothing was hidden behind a modal.
    expect(settlementFetches, 0);
    expect(find.text('QRIS'), findsNothing);
    expect(find.text('BCA Virtual Account'), findsNothing);
    // Settlement is present only as its summary card, closed for now.
    expect(find.text('Bayar pelunasan'), findsOneWidget);

    await _dispose(tester);
  });

  testWidgets('after the receipt is dismissed, methods wait for the button', (
    tester,
  ) async {
    var paid = false;
    await _pumpStatus(tester, (request) async {
      final path = request.url.path;
      if (path.endsWith('/payments/settlement/by-booking/$_bookingId')) {
        return _json({
          'error': {'code': 'NOT_FOUND', 'message': 'Belum ada tagihan'},
        }, 404);
      }
      if (path.endsWith('/payments/by-booking/$_bookingId')) {
        return _json({
          'error': {'code': 'NOT_FOUND', 'message': 'Belum ada tagihan DP'},
        }, 404);
      }
      if (path.contains('/disputes')) {
        return _json({'data': {'items': []}}, 200);
      }
      return _json({
        'data': _booking(payment: paid ? 'dp_paid' : 'unpaid'),
      }, 200);
    });

    paid = true;
    await tester.pump(const Duration(seconds: 15));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('Pembayaran DP diterima'), findsOneWidget);

    await tester.tap(find.text('Mengerti'));
    await tester.pump();

    expect(find.text('Pembayaran DP diterima'), findsNothing);
    expect(find.textContaining('DP sudah dibayar'), findsOneWidget);
    expect(find.text('Bayar pelunasan'), findsOneWidget);
    expect(find.text('QRIS'), findsNothing);
    expect(find.text('BCA Virtual Account'), findsNothing);

    await tester.tap(find.text('Bayar pelunasan'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(find.text('QRIS'), findsOneWidget);
    expect(find.text('BCA Virtual Account'), findsOneWidget);

    await _dispose(tester);
  });

  testWidgets('DP receipt says when pelunasan opens while it is locked', (
    tester,
  ) async {
    var paid = false;
    await _pumpStatus(tester, (request) async {
      final path = request.url.path;
      if (path.contains('/payments/')) {
        return _json({
          'error': {'code': 'NOT_FOUND', 'message': 'Belum ada tagihan'},
        }, 404);
      }
      if (path.contains('/disputes')) {
        return _json({'data': {'items': []}}, 200);
      }
      return _json({
        'data': _booking(
          payment: paid ? 'dp_paid' : 'unpaid',
          settlementAvailableAt: '2099-01-01T12:00:00.000Z',
        ),
      }, 200);
    });

    paid = true;
    await tester.pump(const Duration(seconds: 15));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    // 2099-01-01T12:00Z is 19:00 WIB on 1 Jan, so both surfaces quote the WIB
    // day whatever the device zone is.
    expect(find.text('Pembayaran DP diterima'), findsOneWidget);
    // Receipt and settlement card must quote the same date.
    expect(find.text('Sisa pelunasan dibuka 1 Jan 2099.'), findsOneWidget);
    expect(find.text('Pelunasan dibuka 1 Jan 2099.'), findsOneWidget);
    expect(find.textContaining('kapan saja'), findsNothing);

    await _dispose(tester);
  });

  testWidgets('settlement_available_at in the future locks the pay button', (
    tester,
  ) async {
    await _pumpStatus(
      tester,
      (request) => _statusHandler(
        request,
        _booking(
          lifecycle: 'confirmed',
          payment: 'dp_paid',
          settlementAvailableAt: '2099-01-01T00:00:00.000Z',
        ),
      ),
    );

    expect(find.textContaining('Pelunasan dibuka'), findsOneWidget);
    final button = tester.widget<PrimaryButton>(
      find.widgetWithText(PrimaryButton, 'Bayar pelunasan'),
    );
    expect(button.onPressed, isNull);
    expect(find.text('QRIS'), findsNothing);
    expect(find.text('BCA Virtual Account'), findsNothing);

    await _dispose(tester);
  });

  testWidgets('no_show never offers pelunasan and keeps the timeline honest', (
    tester,
  ) async {
    await _pumpStatus(
      tester,
      (request) => _statusHandler(
        request,
        _booking(lifecycle: 'no_show', payment: 'dp_paid'),
      ),
    );

    // POST /payments/settlement rejects `no_show`, so the card must not exist.
    expect(find.text('Bayar pelunasan'), findsNothing);
    expect(find.text('Bayar Sisa Tagihan'), findsNothing);
    expect(find.text('QRIS'), findsNothing);
    expect(find.text('BCA Virtual Account'), findsNothing);
    expect(find.textContaining('kapan saja'), findsNothing);

    // The customer is told why, in Indonesian.
    expect(
      find.text('Vendor tidak hadir. Dana ditahan untuk proses sengketa.'),
      findsOneWidget,
    );

    // `no_show` only originates from `confirmed`: the vendor did accept and the
    // DP was paid, so those two steps stay done.
    expect(
      find.descendant(
        of: _timelineRow('Vendor menerima'),
        matching: find.text('Booking ditutup sebelum vendor menerima'),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: _timelineRow('Vendor menerima'),
        matching: find.text('Vendor menerima permintaan acaramu'),
      ),
      findsOneWidget,
    );
    expect(_stepDotColor(tester, 'Vendor menerima'), AppColors.accent);
    expect(_stepDotColor(tester, 'DP diterima'), AppColors.accent);

    // The event step states what happened instead of "Acara selesai".
    expect(
      find.descendant(
        of: _timelineRow('Acara'),
        matching: find.text('Vendor tidak hadir'),
      ),
      findsOneWidget,
    );
    expect(find.text('Acara selesai'), findsNothing);

    await _dispose(tester);
  });

  testWidgets('no_show reads "Vendor tidak hadir", never the raw code', (
    tester,
  ) async {
    await _pumpStatus(
      tester,
      (request) => _statusHandler(
        request,
        _booking(lifecycle: 'no_show', payment: 'dp_paid'),
      ),
    );

    // The status pill is the one surface that used to fall through to the raw
    // humaniser and print "No show".
    expect(
      find.widgetWithText(StatusPill, 'Vendor tidak hadir'),
      findsOneWidget,
    );
    expect(find.text('No show'), findsNothing);
    // Home and the booking list decide "active" from this helper.
    expect(isTerminalLifecycle('no_show'), isTrue);

    await _dispose(tester);
  });

  testWidgets('payment methods render above the pay action', (tester) async {
    await _pumpStatus(
      tester,
      (request) => _statusHandler(request, _booking()),
    );

    expect(find.text('QRIS'), findsOneWidget);
    expect(find.text('BCA Virtual Account'), findsOneWidget);
    expect(find.text('BNI Virtual Account'), findsOneWidget);
    expect(find.text('BRI Virtual Account'), findsOneWidget);
    expect(find.text('Mandiri Virtual Account'), findsOneWidget);

    final pay = tester.widget<PrimaryButton>(
      find.widgetWithText(PrimaryButton, 'Bayar DP'),
    );
    expect(pay.onPressed, isNotNull);
    expect(pay.dense, isTrue);

    await _dispose(tester);
  });

  testWidgets('settlement unlocks on its own when the window opens', (
    tester,
  ) async {
    final opensAt = DateTime.now().add(const Duration(seconds: 1));
    await _pumpStatus(
      tester,
      (request) => _statusHandler(
        request,
        _booking(
          lifecycle: 'confirmed',
          payment: 'dp_paid',
          settlementAvailableAt: opensAt.toUtc().toIso8601String(),
        ),
      ),
    );

    PrimaryButton settleButton() => tester.widget<PrimaryButton>(
      find.widgetWithText(PrimaryButton, 'Bayar pelunasan'),
    );
    expect(settleButton().onPressed, isNull);

    // `DateTime.now()` is real in widget tests, so let wall time pass; then one
    // pump fires the single one-shot timer the page scheduled.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 1200)),
    );
    await tester.pump(const Duration(seconds: 2));
    await tester.pump();

    expect(settleButton().onPressed, isNotNull);
    expect(find.textContaining('Pelunasan dibuka'), findsNothing);
    expect(
      find.text('Pilih metode dan bayar kapan saja sebelum acara.'),
      findsOneWidget,
    );

    await _dispose(tester);
  });

  testWidgets('settlement date is the WIB day, not the device day', (
    tester,
  ) async {
    // 2099-11-19T17:00Z is midnight WIB on 20 Nov; UTC and every zone west of
    // WIB call it 19 Nov, so the day must come from +07:00.
    await _pumpStatus(
      tester,
      (request) => _statusHandler(
        request,
        _booking(
          lifecycle: 'confirmed',
          payment: 'dp_paid',
          settlementAvailableAt: '2099-11-19T17:00:00.000Z',
        ),
      ),
    );

    expect(find.text('Pelunasan dibuka 20 Nov 2099.'), findsOneWidget);

    // The same helper applied to the instant the server quotes in its 409.
    expect(
      formatWibDate(DateTime.parse('2026-11-19T17:00:00.000Z')),
      '20 Nov 2026',
    );

    await _dispose(tester);
  });
}
