import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/booking/status_page.dart';

const _bookingId = '40f3017d-8141-4008-9f95-7829d0c46f26';

Map<String, dynamic> _booking({
  String lifecycle = 'completed',
  String payment = 'fully_paid',
  String settlement = 'held',
  int outstanding = 0,
}) => {
  'id': _bookingId,
  'code': 'BK-261021-34E0',
  'lifecycle_status': lifecycle,
  'payment_status': payment,
  'settlement_status': settlement,
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

Map<String, dynamic> _dispute({
  String status = 'resolved',
  String reason = 'quality',
  String? resolutionNote = 'Vendor memberi kompensasi.',
}) => {
  'dispute_id': '9d1f5c1e-1111-4222-8333-444455556666',
  'booking_id': _bookingId,
  'status': status,
  'reason_code': reason,
  'description': 'Vendor datang tanpa sound system yang dijanjikan.',
  'opened_at': '2026-11-05T09:00:00.000Z',
  'sla_due_at': '2026-11-08T09:00:00.000Z',
  'resolved_at': status == 'resolved' ? '2026-11-06T10:00:00.000Z' : null,
  'resolution': status == 'resolved' ? 'refund_partial' : null,
  'resolution_note': status == 'resolved' ? resolutionNote : null,
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
  testWidgets('Sengketa section lists the disputes the API returns', (
    tester,
  ) async {
    await _pumpStatus(tester, (request) async {
      if (request.url.path.endsWith('/disputes')) {
        return _json({
          'data': {
            'items': [_dispute()],
          },
        }, 200);
      }
      return _json({
        'data': _booking(lifecycle: 'in_progress'),
      }, 200);
    });

    expect(find.text('Sengketa'), findsOneWidget);
    expect(find.text('Kualitas tidak sesuai'), findsOneWidget);
    expect(find.text('Selesai'), findsOneWidget);
    expect(find.textContaining('Dibuka '), findsOneWidget);
    expect(
      find.text('Catatan penyelesaian: Vendor memberi kompensasi.'),
      findsOneWidget,
    );

    await _dispose(tester);
  });

  testWidgets('Ajukan sengketa is hidden before the money is held', (
    tester,
  ) async {
    await _pumpStatus(tester, (request) async {
      if (request.url.path.endsWith('/disputes')) {
        return _json({
          'data': {'items': <Object>[]},
        }, 200);
      }
      return _json({
        'data': _booking(
          lifecycle: 'requested',
          payment: 'unpaid',
          settlement: 'not_eligible',
          outstanding: 5050000,
        ),
      }, 200);
    });

    expect(find.text('Sengketa'), findsOneWidget);
    expect(find.text('Ajukan sengketa'), findsNothing);
    expect(
      find.text(
        'Belum ada sengketa. Dana diteruskan ke vendor setelah jendela '
        'sengketa.',
      ),
      findsOneWidget,
    );

    await _dispose(tester);
  });

  testWidgets('a failed disputes request leaves the booking page intact', (
    tester,
  ) async {
    await _pumpStatus(tester, (request) async {
      if (request.url.path.endsWith('/disputes')) {
        return http.Response('', 500);
      }
      return _json({'data': _booking()}, 200);
    });

    expect(find.text('Detail acara'), findsOneWidget);
    expect(
      find.text('Ada masalah di server. Coba lagi sebentar.'),
      findsOneWidget,
    );
    expect(find.text('Daftar sengketa belum bisa dimuat.'), findsOneWidget);

    await _dispose(tester);
  });

  testWidgets('submitting the sheet posts the reason and description', (
    tester,
  ) async {
    const description = 'Vendor datang 3 jam terlambat dari jadwal.';
    final posts = <http.Request>[];

    await _pumpStatus(tester, (request) async {
      final path = request.url.path;
      if (path.endsWith('/disputes')) {
        if (request.method == 'POST') {
          posts.add(request);
          return _json({
            'data': {
              'dispute_id': '9d1f5c1e-1111-4222-8333-444455556666',
              'booking_id': _bookingId,
              'status': 'open',
              'reason_code': 'quality',
              'description': description,
              'opened_at': '2026-11-05T09:00:00.000Z',
              'sla_due_at': '2026-11-08T09:00:00.000Z',
            },
          }, 201);
        }
        return _json({
          'data': {'items': <Object>[]},
        }, 200);
      }
      return _json({'data': _booking()}, 200);
    });

    await tester.ensureVisible(find.text('Ajukan sengketa'));
    await tester.pump();
    await tester.tap(find.text('Ajukan sengketa'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Kirim sengketa'), findsOneWidget);

    await tester.tap(find.text('Kualitas tidak sesuai'));
    await tester.pump();
    await tester.enterText(find.byType(TextField), description);
    await tester.pump();
    await tester.tap(find.text('Kirim sengketa'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 50));

    expect(posts, hasLength(1));
    expect(posts.single.url.path, '/v1/bookings/$_bookingId/disputes');
    expect(jsonDecode(posts.single.body), {
      'reason_code': 'quality',
      'description': description,
    });
    expect(
      find.text('Sengketa dikirim. Tim Tarlink akan meninjaunya.'),
      findsOneWidget,
    );

    await _dispose(tester);
  });
}
