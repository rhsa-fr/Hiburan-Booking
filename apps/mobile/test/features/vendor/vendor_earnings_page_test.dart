import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/vendor/vendor_earnings_page.dart';

http.Response _json(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Future<void> _loadFonts() async {
  final loader = FontLoader('Plus Jakarta Sans');
  for (final asset in const [
    'assets/fonts/PlusJakartaSans-Regular.ttf',
    'assets/fonts/PlusJakartaSans-Medium.ttf',
    'assets/fonts/PlusJakartaSans-SemiBold.ttf',
    'assets/fonts/PlusJakartaSans-Bold.ttf',
    'assets/fonts/PlusJakartaSans-ExtraBold.ttf',
  ]) {
    loader.addFont(rootBundle.load(asset));
  }
  await loader.load();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('ekspor CSV menampilkan total ledger dan menyalin isi', (
    tester,
  ) async {
    await _loadFonts();

    Uri? exportUri;
    Map<String, dynamic>? preview;
    final session = Session();
    final api = ApiClient(
      session: session,
      client: MockClient((request) async {
        final path = request.url.path;
        if (path.endsWith('/vendor/earnings/export')) {
          exportUri = request.url;
          preview = {
            'filename': 'pendapatan-vendor-2026-11-01_2026-11-30.csv',
            'period': {'from': '2026-11-01', 'to': '2026-11-30'},
            'row_count': 2,
            'source': 'release_journal',
            'totals': {
              'gmv_idr': 15000000,
              'commission_idr': 750000,
              'service_fee_idr': 300000,
              'vendor_entitlement_idr': 13950000,
              'clawback_idr': 500000,
              'net_vendor_idr': 13450000,
              'payout_idr': 9300000,
            },
            'csv': 'tanggal_lepas,kode_booking\r\n2026-11-15,TL-2611-001\r\n',
          };
          return _json({'data': preview});
        }
        if (path.endsWith('/vendor/earnings')) {
          return _json({
            'data': {
              'held_idr': 2300000,
              'available_idr': 9300000,
              'pending_payout_idr': 0,
              'bank_account': null,
              'settled': {
                'items': [
                  {
                    'id': '33333333-3333-4333-8333-333333333333',
                    'code': 'TL-2611-001',
                    'vendor_entitlement_idr': 9300000,
                    'released_at': '2026-11-15T03:00:00.000Z',
                    'event_title': 'Resepsi Pernikahan',
                    'event_start_date': '2026-11-14',
                  },
                ],
                'total': 2,
                'page': 1,
                'page_size': 20,
              },
            },
          });
        }
        if (path.endsWith('/vendor/dashboard')) {
          return _json({
            'data': {
              'summary': {'this_month_idr': 7000000},
            },
          });
        }
        if (path.endsWith('/vendor/payouts')) {
          return _json({
            'data': {'items': [], 'total': 0, 'page': 1, 'page_size': 10},
          });
        }
        return _json({
          'error': {'code': 'NOT_FOUND', 'message': path},
        }, 404);
      }),
      baseUrl: 'http://localhost:3001',
    );
    tester.view.physicalSize = const Size(390, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(() {
      api.close();
      session.dispose();
    });

    await tester.pumpWidget(
      AppScope(
        session: session,
        api: api,
        child: MaterialApp(theme: buildTheme(), home: const VendorEarningsPage()),
      ),
    );
    await tester.pump();
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }

    expect(find.text('Ekspor CSV bulan ini'), findsOneWidget);
    expect(
      find.textContaining('bukan hanya 20 terbaru'),
      findsOneWidget,
    );

    await tester.tap(find.text('Ekspor CSV bulan ini'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));

    expect(exportUri, isNotNull);
    expect(exportUri!.queryParameters['format'], 'json');
    expect(exportUri!.queryParameters.containsKey('from'), isFalse);
    expect(preview, isNotNull);

    expect(find.text('Laporan pendapatan'), findsOneWidget);
    expect(
      find.textContaining('2026-11-01 – 2026-11-30 · 2 transaksi'),
      findsOneWidget,
    );
    expect(find.text('GMV (nilai transaksi)'), findsOneWidget);
    expect(find.text('Rp15.000.000'), findsOneWidget);
    expect(find.text('Rp13.450.000'), findsOneWidget);
    expect(find.text('Clawback'), findsOneWidget);

    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String?;
        }
        return null;
      },
    );
    addTearDown(() {
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      );
    });

    await tester.tap(find.text('Salin CSV'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(copied, preview!['csv']);
    expect(find.text('CSV disalin ke papan klip.'), findsOneWidget);
  });
}
