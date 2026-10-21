import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/discovery/home_page.dart';

void main() {
  Widget harness(http.Client client) {
    final session = Session();
    final api = ApiClient(
      session: session,
      client: client,
      baseUrl: 'http://api.test',
    );
    return AppScope(
      session: session,
      api: api,
      child: MaterialApp(theme: buildTheme(), home: const HomePage()),
    );
  }

  Map<String, dynamic> vendor({
    required String id,
    required String name,
    int? startingPrice,
    int packageCount = 1,
  }) => {
    'id': id,
    'slug': 'vendor-$id',
    'display_name': name,
    'region_code': '3212',
    'region_name': 'Kabupaten Indramayu',
    'base_address': null,
    'description': null,
    'rating': null,
    'rating_count': 0,
    'min_dp_bp': 3000,
    'starting_price_idr': startingPrice,
    'package_count': packageCount,
  };

  Future<void> pumpHome(WidgetTester tester, http.Client client) async {
    tester.view.physicalSize = const Size(420, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(harness(client));
    await tester.pumpAndSettle();
  }

  testWidgets('home renders vendor cards from the API', (tester) async {
    final client = MockClient((request) async {
      expect(request.url.path, '/v1/vendors');
      return http.Response(
        jsonEncode({
          'items': [
            vendor(
              id: '1',
              name: 'Tarling Dian',
              startingPrice: 5000000,
              packageCount: 2,
            ),
            vendor(id: '2', name: 'Organ Tunggal Sari', startingPrice: 3500000),
          ],
          'total': 2,
          'page': 1,
          'page_size': 20,
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });

    await pumpHome(tester, client);

    expect(find.text('Tarling Dian'), findsOneWidget);
    expect(find.text('Organ Tunggal Sari'), findsOneWidget);
    expect(find.text('Mulai Rp 5.000.000'), findsOneWidget);
    expect(find.text('· 2 paket'), findsOneWidget);
    expect(find.text('Baru'), findsNWidgets(2));
  });

  testWidgets('null starting price reads as not filled, never blank', (
    tester,
  ) async {
    final client = MockClient((request) async {
      return http.Response(
        jsonEncode({
          'items': [
            vendor(id: '3', name: 'Tarling Malam', startingPrice: null),
          ],
          'total': 1,
          'page': 1,
          'page_size': 20,
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });

    await pumpHome(tester, client);

    expect(find.text('Harga belum diisi'), findsOneWidget);
    expect(find.text('Mulai Rp 0'), findsNothing);
  });
}
