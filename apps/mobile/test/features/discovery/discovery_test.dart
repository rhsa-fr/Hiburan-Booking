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
    String? category,
    double? rating,
    int ratingCount = 0,
    int? responseRateBp,
  }) => {
    'id': id,
    'slug': 'vendor-$id',
    'display_name': name,
    'region_code': '3212',
    'region_name': 'Kabupaten Indramayu',
    'base_address': null,
    'description': null,
    'rating': rating,
    'rating_count': ratingCount,
    'response_rate_bp': responseRateBp,
    'category_slug': category == null ? null : 'tarling',
    'category_name': category,
    'min_dp_bp': 3000,
    'starting_price_idr': startingPrice,
    'package_count': packageCount,
  };

  http.Response payload(Object body, [int status = 200]) => http.Response(
    jsonEncode(body),
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );

  /// Beranda memuat dua endpoint: katalog vendor dan booking milik user.
  MockClient client(List<Map<String, dynamic>> vendors) =>
      MockClient((request) async {
        final path = request.url.path;
        if (path.endsWith('/vendors')) {
          return payload({
            'items': vendors,
            'total': vendors.length,
            'page': 1,
            'page_size': 20,
          });
        }
        if (path.endsWith('/bookings')) {
          return payload({
            'items': <dynamic>[],
            'total': 0,
            'page': 1,
            'page_size': 20,
          });
        }
        return payload({'message': 'unexpected ${request.url}'}, 500);
      });

  Future<void> pumpHome(WidgetTester tester, http.Client api) async {
    tester.view.physicalSize = const Size(390, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(harness(api));
    // Skeleton animasi terus; pumpAndSettle tidak aman di layar ini.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
  }

  testWidgets('beranda merender kartu vendor dari API', (tester) async {
    await pumpHome(
      tester,
      client([
        vendor(
          id: '1',
          name: 'Tarling Dian',
          startingPrice: 5000000,
          packageCount: 2,
        ),
        vendor(id: '2', name: 'Organ Tunggal Sari', startingPrice: 3500000),
      ]),
    );

    expect(find.text('Tarling Dian'), findsOneWidget);
    expect(find.text('Organ Tunggal Sari'), findsOneWidget);
    expect(find.text('Kabupaten Indramayu · 2 paket'), findsOneWidget);
    expect(find.text('Rp5.000.000'), findsOneWidget);
    // Rating dan badge "Baru" tidak boleh dirender: datanya tidak ada.
    expect(find.text('Baru'), findsNothing);
  });

  testWidgets('kartu menampilkan kategori, rating, dan respons dari API', (
    tester,
  ) async {
    await pumpHome(
      tester,
      client([
        vendor(
          id: '4',
          name: 'Tarling Dian',
          startingPrice: 5000000,
          category: 'Tarling & Dangdut',
          rating: 4.8,
          ratingCount: 12,
          responseRateBp: 9200,
        ),
      ]),
    );

    expect(
      find.text('Tarling & Dangdut · Kabupaten Indramayu · 1 paket'),
      findsOneWidget,
    );
    expect(find.text('4.8 (12)'), findsOneWidget);
    expect(find.text('Respons 92%'), findsOneWidget);
  });

  testWidgets('shortcut kategori membuka Jelajah dengan filter kategori', (
    tester,
  ) async {
    final categoryQueries = <String?>[];
    final api = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/categories')) {
        return payload({'items': <dynamic>[]});
      }
      if (path.endsWith('/vendors')) {
        categoryQueries.add(request.url.queryParameters['category']);
        return payload({
          'items': <dynamic>[],
          'total': 0,
          'page': 1,
          'page_size': 20,
        });
      }
      if (path.endsWith('/bookings')) {
        return payload({
          'items': <dynamic>[],
          'total': 0,
          'page': 1,
          'page_size': 20,
        });
      }
      return payload({'message': 'unexpected ${request.url}'}, 500);
    });

    await pumpHome(tester, api);
    await tester.tap(find.text('Seni\nTradisi'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('Jelajah'), findsWidgets);
    expect(categoryQueries, contains('seni-tradisi'));
  });

  testWidgets('shortcut yang sama menerapkan ulang filter kategori', (
    tester,
  ) async {
    final categoryQueries = <String?>[];
    final api = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/categories')) {
        return payload({
          'items': [
            {'slug': 'tarling', 'name': 'Tarling & Dangdut', 'sort_order': 1},
            {'slug': 'seni-tradisi', 'name': 'Seni Tradisi', 'sort_order': 3},
          ],
        });
      }
      if (path.endsWith('/vendors')) {
        categoryQueries.add(request.url.queryParameters['category']);
        return payload({
          'items': <dynamic>[],
          'total': 0,
          'page': 1,
          'page_size': 20,
        });
      }
      if (path.endsWith('/bookings')) {
        return payload({
          'items': <dynamic>[],
          'total': 0,
          'page': 1,
          'page_size': 20,
        });
      }
      return payload({'message': 'unexpected ${request.url}'}, 500);
    });

    Future<void> settle() async {
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(const Duration(milliseconds: 400));
    }

    await pumpHome(tester, api);
    await tester.tap(find.text('Seni\nTradisi'));
    await settle();
    expect(categoryQueries.last, 'seni-tradisi');

    // Ubah filter di dalam Jelajah, lalu buka shortcut yang sama lagi.
    await tester.tap(find.text('Tarling & Dangdut'));
    await settle();
    expect(categoryQueries.last, 'tarling');

    await tester.tap(find.text('Beranda'));
    await tester.pump();
    await tester.tap(find.text('Seni\nTradisi'));
    await settle();

    expect(categoryQueries.last, 'seni-tradisi');
  });

  testWidgets('harga kosong dibaca sebagai belum diisi, bukan Rp0', (
    tester,
  ) async {
    await pumpHome(
      tester,
      client([vendor(id: '3', name: 'Tarling Malam', startingPrice: null)]),
    );

    expect(find.text('Harga belum diisi'), findsOneWidget);
    expect(find.text('Rp0'), findsNothing);
    expect(find.text('Mulai Rp0'), findsNothing);
  });
}
