import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/format.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/vendor/vendor_booking_detail_page.dart';
import 'package:tarlink_customer/features/vendor/vendor_dashboard_page.dart';
import 'package:tarlink_customer/features/vendor/vendor_earnings_page.dart';

void main() {
  group('Helper functions', () {
    test('moneyValue handles num, string BIGINT, and null', () {
      expect(moneyValue({'amt': 1500000}, 'amt'), 1500000);
      expect(moneyValue({'amt': 1500000.0}, 'amt'), 1500000);
      expect(moneyValue({'amt': '13500000'}, 'amt'), 13500000);
      expect(moneyValue({'amt': null}, 'amt'), isNull);
      expect(moneyValue({}, 'amt'), isNull);
      expect(moneyValue({'amt': 'invalid'}, 'amt'), isNull);
    });

    test('formatIndonesianPhone formats various formats correctly', () {
      expect(formatIndonesianPhone('6281234567890'), '0812-3456-7890');
      expect(formatIndonesianPhone('081234567890'), '0812-3456-7890');
      expect(formatIndonesianPhone('81234567890'), '0812-3456-7890');
      expect(formatIndonesianPhone(null), '-');
      expect(formatIndonesianPhone(''), '-');
    });
  });

  Future<void> pumpTestWidget(
    WidgetTester tester, {
    required Widget child,
    required http.Client client,
  }) async {
    final session = Session();
    final api = ApiClient(
      session: session,
      client: client,
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
          home: child,
        ),
      ),
    );
    await tester.pump();
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 20));
    }
  }

  group('VendorEarningsPage', () {
    testWidgets(
      'renders escrow balance and settled items from payload.settled.items',
      (tester) async {
        final client = MockClient((request) async {
          if (request.url.path.endsWith('/vendor/earnings')) {
            return http.Response(
              jsonEncode({
                'data': {
                  'held_idr': '13500000',
                  'held_balance_idr': '13500000',
                  'settled': {
                    'items': [
                      {
                        'id': 'b1',
                        'code': 'BK-261027-001',
                        'event_title': 'Pentas Tarling Indramayu',
                        'vendor_entitlement_idr': '4500000',
                        'released_at': '2026-10-25T10:00:00Z',
                      },
                    ],
                    'total': 1,
                    'page': 1,
                    'page_size': 20,
                  },
                },
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          return http.Response('Not Found', 404);
        });

        await pumpTestWidget(
          tester,
          child: const VendorEarningsPage(),
          client: client,
        );

        expect(find.text('Saldo & Laporan'), findsOneWidget);
        expect(find.text('Saldo Tertahan (Escrow PJP)'), findsOneWidget);
        expect(find.text('Rp13.500.000'), findsOneWidget);
        expect(find.textContaining('jendela sengketa 7 hari'), findsOneWidget);
        expect(find.text('BK-261027-001'), findsOneWidget);
        expect(find.text('Pentas Tarling Indramayu'), findsOneWidget);
        expect(find.text('+Rp4.500.000'), findsOneWidget);
      },
    );
  });

  group('VendorDashboardPage', () {
    testWidgets(
      'renders custom obsidian header, stat cards, and booking list',
      (tester) async {
        final client = MockClient((request) async {
          if (request.url.path.endsWith('/vendor/dashboard')) {
            return http.Response(
              jsonEncode({
                'data': {
                  'display_name': 'Grup Tarling Putra Nada',
                  'total_bookings': 42,
                  'pending_count': 3,
                  'this_month_count': 8,
                  'this_month_idr': 24000000,
                },
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.url.path.endsWith('/vendor/bookings')) {
            return http.Response(
              jsonEncode({
                'data': {
                  'items': [
                    {
                      'id': 'b101',
                      'code': 'BK-261027-A99',
                      'lifecycle_status': 'requested',
                      'payment_status': 'unpaid',
                      'event_title': 'Hajatan Sunatan',
                      'event_start_date': '2026-11-01',
                      'event_region_code': '3212',
                      'customer_phone': '081234567890',
                      'respond_deadline': DateTime.now()
                          .add(const Duration(hours: 4))
                          .toIso8601String(),
                    },
                  ],
                },
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          return http.Response('Not Found', 404);
        });

        await pumpTestWidget(
          tester,
          child: const VendorDashboardPage(),
          client: client,
        );

        expect(find.text('Grup Tarling Putra Nada'), findsOneWidget);
        expect(find.text('Mode Vendor · Tarlink'), findsOneWidget);
        expect(find.text('42'), findsOneWidget);
        expect(find.text('3'), findsOneWidget);
        expect(find.text('8'), findsOneWidget);
        expect(find.text('Potensi Penghasilan Bulan Ini'), findsOneWidget);
        expect(find.text('Rp24.000.000'), findsOneWidget);
        expect(find.text('BK-261027-A99'), findsOneWidget);
        expect(find.text('Terima'), findsOneWidget);
        expect(find.text('Tolak'), findsOneWidget);
      },
    );
  });

  group('VendorBookingDetailPage', () {
    testWidgets(
      'renders sections, WhatsApp button, and financial breakdown',
      (tester) async {
        final client = MockClient((request) async {
          if (request.url.path.endsWith('/vendor/bookings/b101')) {
            return http.Response(
              jsonEncode({
                'data': {
                  'id': 'b101',
                  'code': 'BK-261027-A99',
                  'lifecycle_status': 'requested',
                  'payment_status': 'unpaid',
                  'event_title': 'Pesta Pernikahan Putri',
                  'event_start_date': '2026-11-15',
                  'event_region_code': 'Indramayu Barat',
                  'guest_count': 500,
                  'customer_name': 'Haji Sulaeman',
                  'customer_phone': '081987654321',
                  'total_customer_idr': '10000000',
                  'dp_amount_idr': '3000000',
                  'vendor_entitlement_idr': '9500000',
                },
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          return http.Response('Not Found', 404);
        });

        await pumpTestWidget(
          tester,
          child: const VendorBookingDetailPage(bookingId: 'b101'),
          client: client,
        );

        expect(find.text('Detail Pesanan'), findsOneWidget);
        expect(find.text('BK-261027-A99'), findsNWidgets(2));
        expect(find.text('INFORMASI ACARA'), findsOneWidget);
        expect(find.text('Pesta Pernikahan Putri'), findsOneWidget);
        expect(find.text('PELANGGAN'), findsOneWidget);
        expect(find.text('Haji Sulaeman'), findsOneWidget);
        expect(find.text('0819-8765-4321'), findsOneWidget);
        expect(find.text('Hubungi via WhatsApp'), findsOneWidget);
        expect(find.text('RINCIAN BIAYA'), findsOneWidget);
        expect(find.text('Hak Vendor'), findsOneWidget);
        expect(find.text('Rp9.500.000'), findsOneWidget);
        expect(find.text('Terima Booking'), findsOneWidget);
        expect(find.text('Tolak Booking'), findsOneWidget);
      },
    );
  });
}
