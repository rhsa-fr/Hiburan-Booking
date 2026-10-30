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
import 'package:tarlink_customer/core/widgets.dart';
import 'package:tarlink_customer/features/booking/list_page.dart';
import 'package:tarlink_customer/features/booking/status_page.dart';

const _bookingId = '40f3017d-8141-4008-9f95-7829d0c46f26';

Map<String, dynamic> _booking({
  String lifecycle = 'accepted',
  String payment = 'unpaid',
  int outstanding = 3550000,
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
  tester.view.physicalSize = const Size(400, 2400);
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
}
