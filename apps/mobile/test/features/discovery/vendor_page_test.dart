// VendorPage regression: the page once rendered a blank body because its bottom
// bar label was wrapped in an Align, which grew to the full height Scaffold
// offers (600px in tests) and squeezed the ListView body to 0px. The finders
// still matched 'Pilih jadwal' inside the bottom bar, so only a size check
// catches this class of bug.
// ignore_for_file: depend_on_referenced_packages

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/test/test_flutter_secure_storage_platform.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/format.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/discovery/vendor_page.dart';

http.Response _json(Object body) => http.Response(
  jsonEncode(body),
  200,
  headers: {'content-type': 'application/json'},
);

void main() {
  setUp(() {
    FlutterSecureStoragePlatform.instance = TestFlutterSecureStoragePlatform({});
  });

  testWidgets('detail vendor merender isi, bukan layar kosong', (tester) async {
    final session = Session();
    final api = ApiClient(
      session: session,
      baseUrl: 'http://test.local',
      client: MockClient((request) async {
        if (request.url.path.contains('/availability')) {
          return _json({
            'vendor_id': 'v1',
            'from': isoDate(DateTime.now()),
            'to': isoDate(DateTime.now().add(const Duration(days: 44))),
            'calendar_updated_at': null,
            'stale': true,
            'stale_threshold_days': 30,
            'days': [
              {
                'date': isoDate(DateTime.now()),
                'session': 'night',
                'availability_state': 'stale',
                'hold_expires_at': null,
              },
            ],
          });
        }
        return _json({
          'vendor': {
            'id': 'v1',
            'slug': 'v1',
            'display_name': 'Grup Tarling Nada Pantura',
            'region_name': 'Kabupaten Indramayu',
            'min_dp_bp': 3000,
            'whatsapp': '081200000000',
          },
          'packages': [
            {
              'id': 'p1',
              'name': 'Paket Lengkap 6 jam',
              'duration_minutes': 360,
              'base_price_idr': 5000000,
              'addons': [],
            },
          ],
        });
      }),
    );

    await tester.pumpWidget(
      AppScope(
        session: session,
        api: api,
        child: MaterialApp(
          theme: buildTheme(),
          home: const VendorPage(idOrSlug: 'v1'),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(tester.takeException(), isNull);
    expect(find.text('Detail Grup Hiburan'), findsOneWidget);
    expect(find.text('Pilih jadwal'), findsOneWidget);
    expect(tester.getSize(find.byType(ListView)).height, greaterThan(400));

    api.close();
    session.dispose();
  });
}
