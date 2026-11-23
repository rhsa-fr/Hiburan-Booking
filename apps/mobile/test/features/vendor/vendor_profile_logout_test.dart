// Sign-out touches the session store, so the secure-storage platform is faked
// with the package's in-memory test platform (same setup as session_refresh_test).
// ignore_for_file: depend_on_referenced_packages

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/test/test_flutter_secure_storage_platform.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/routes.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/vendor/vendor_profile_page.dart';

http.Response _json(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

/// Fakes the three reads the profile screen needs, and counts logout calls.
class _VendorBackend {
  int logoutCalls = 0;

  MockClient get client => MockClient((request) async {
    final path = request.url.path;
    if (path.endsWith('/auth/logout')) {
      logoutCalls++;
      return http.Response('', 204);
    }
    if (path.endsWith('/vendor/me')) {
      return _json({
        'data': {
          'id': '11111111-1111-4111-8111-111111111111',
          'display_name': 'Grup Tarling Putra Nada',
          'slug': 'grup-tarling-putra-nada',
          'verification_status': 'approved',
          'region_code': '3212',
          'is_active': true,
        },
      });
    }
    if (path.endsWith('/vendor/bookings')) {
      return _json({
        'data': {'items': [], 'total': 0, 'page': 1, 'page_size': 1},
      });
    }
    return _json({
      'error': {'code': 'NOT_FOUND', 'message': path},
    }, 404);
  });
}

void main() {
  setUp(() {
    FlutterSecureStoragePlatform.instance = TestFlutterSecureStoragePlatform(
      {},
    );
  });

  testWidgets('baris Keluar akun meminta konfirmasi lalu keluar ke Login', (
    tester,
  ) async {
    final session = Session();
    await session.applySession({
      'access_token': 'access-token-uji',
      'refresh_token': 'refresh-token-uji',
      'expires_in': 3600,
      'user': {
        'id': '11111111-1111-4111-8111-111111111111',
        'phone': '6281234567890',
        'roles': ['vendor_owner'],
      },
    });
    expect(session.authorized, isTrue);

    final backend = _VendorBackend();
    final api = ApiClient(
      session: session,
      client: backend.client,
      baseUrl: 'http://localhost:3001',
    );
    tester.view.physicalSize = const Size(400, 1400);
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
        child: MaterialApp(
          theme: buildTheme(),
          routes: {
            Routes.login: (_) => const Scaffold(body: Text('Halaman masuk')),
          },
          home: const VendorProfilePage(),
        ),
      ),
    );
    await tester.pump();
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }

    // The existing vendor-mode row keeps its place above the new action.
    expect(find.text('Keluar mode vendor'), findsOneWidget);
    expect(find.text('Keluar akun'), findsOneWidget);

    await tester.tap(find.text('Keluar akun'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));

    // Destructive action: nothing leaves the device before confirmation.
    expect(find.text('Keluar dari akun?'), findsOneWidget);
    expect(backend.logoutCalls, 0);
    expect(session.authorized, isTrue);

    await tester.tap(find.text('Ya, keluar akun'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));

    expect(backend.logoutCalls, 1);
    expect(session.authorized, isFalse);
    expect(find.text('Halaman masuk'), findsOneWidget);
    expect(find.text('Keluar akun'), findsNothing);
  });

  testWidgets('Batal pada sheet konfirmasi tidak mengakhiri sesi', (
    tester,
  ) async {
    final session = Session();
    await session.applySession({
      'access_token': 'access-token-uji',
      'refresh_token': 'refresh-token-uji',
      'expires_in': 3600,
      'user': {
        'id': '11111111-1111-4111-8111-111111111111',
        'phone': '6281234567890',
        'roles': ['vendor_owner'],
      },
    });

    final backend = _VendorBackend();
    final api = ApiClient(
      session: session,
      client: backend.client,
      baseUrl: 'http://localhost:3001',
    );
    tester.view.physicalSize = const Size(400, 1400);
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
        child: MaterialApp(
          theme: buildTheme(),
          routes: {
            Routes.login: (_) => const Scaffold(body: Text('Halaman masuk')),
          },
          home: const VendorProfilePage(),
        ),
      ),
    );
    await tester.pump();
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }

    await tester.tap(find.text('Keluar akun'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('Keluar dari akun?'), findsOneWidget);

    await tester.tap(find.text('Batal'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));

    expect(backend.logoutCalls, 0);
    expect(session.authorized, isTrue);
    expect(find.text('Keluar akun'), findsOneWidget);
    expect(find.text('Halaman masuk'), findsNothing);
  });
}
