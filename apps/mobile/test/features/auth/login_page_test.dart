// Auth tests run against flutter_secure_storage's in-memory test platform:
// Session._persist() would otherwise await a real platform channel that never
// answers in the test binding, leaving `_loading` stuck and blocking navigation.
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
import 'package:tarlink_customer/features/auth/auth_support.dart';
import 'package:tarlink_customer/features/auth/login_page.dart';
import 'package:tarlink_customer/features/auth/register_page.dart';

({Session session, ApiClient api, List<http.Request> requests}) _setup(
  Future<http.Response> Function(http.Request) handler,
) {
  final requests = <http.Request>[];
  final client = MockClient((request) async {
    requests.add(request);
    return handler(request);
  });
  final session = Session();
  return (
    session: session,
    api: ApiClient(
      session: session,
      client: client,
      baseUrl: 'http://test.local',
    ),
    requests: requests,
  );
}

Widget _app({
  required Session session,
  required ApiClient api,
  required Widget home,
  double textScale = 1,
}) {
  return AppScope(
    session: session,
    api: api,
    child: MaterialApp(
      theme: buildTheme(),
      home: home,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      onGenerateRoute: (settings) => settings.name == Routes.home
          ? MaterialPageRoute<void>(
              builder: (_) => const Scaffold(body: Text('HOME')),
            )
          : null,
    ),
  );
}

http.Response _json(Object body, int status) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

const _sessionPayload = {
  'data': {
    'access_token': 'token-123',
    'token_type': 'Bearer',
    'expires_in': 3600,
    'user': {
      'id': 'u1',
      'phone': '6281234567890',
      'email': 'budi@email.com',
      'roles': ['customer'],
    },
  },
};

void main() {
  setUp(() {
    FlutterSecureStoragePlatform.instance = TestFlutterSecureStoragePlatform({});
  });

  group('LoginPage', () {
    testWidgets('kirim kosong: error field tampil, tanpa panggilan API', (
      tester,
    ) async {
      final h = _setup((_) async => _json({}, 500));

      await tester.pumpWidget(
        _app(session: h.session, api: h.api, home: const LoginPage()),
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Masuk'));
      await tester.pump();

      expect(find.text('Email wajib diisi.'), findsOneWidget);
      expect(find.text('Kata sandi wajib diisi.'), findsOneWidget);
      expect(h.requests, isEmpty);
    });

    testWidgets('kata sandi salah: pesan Indonesia tampil, tetap di login', (
      tester,
    ) async {
      final h = _setup(
        (_) async => _json({
          'error': {
            'code': 'UNAUTHENTICATED',
            'message': 'Email atau kata sandi salah',
          },
        }, 401),
      );

      await tester.pumpWidget(
        _app(session: h.session, api: h.api, home: const LoginPage()),
      );
      await tester.enterText(find.byType(TextFormField).at(0), 'budi@email.com');
      await tester.enterText(
        find.byType(TextFormField).at(1),
        'kata-salah-123',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Masuk'));
      await tester.pumpAndSettle();

      expect(find.text('Email atau kata sandi salah.'), findsOneWidget);
      expect(find.byType(LoginPage), findsOneWidget);
      expect(h.session.authorized, isFalse);
      expect(h.requests, hasLength(1));
    });

    testWidgets('masuk berhasil: signIn terisi dan pindah ke home', (
      tester,
    ) async {
      final h = _setup((_) async => _json(_sessionPayload, 200));

      await tester.pumpWidget(
        _app(session: h.session, api: h.api, home: const LoginPage()),
      );
      await tester.enterText(
        find.byType(TextFormField).at(0),
        '  budi@email.com  ',
      );
      await tester.enterText(find.byType(TextFormField).at(1), 'rahasia123');
      await tester.tap(find.widgetWithText(FilledButton, 'Masuk'));
      // Push happens after the awaited signIn; let the route transition finish.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 600));

      expect(h.session.authorized, isTrue);
      expect(h.session.token, 'token-123');
      expect(find.text('HOME'), findsOneWidget);
      expect(jsonDecode(h.requests.single.body), {
        'email': 'budi@email.com',
        'password': 'rahasia123',
      });
    });
  });

  group('RegisterPage', () {
    testWidgets('muat di layar 320dp dengan teks 1.3x', (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      final h = _setup((_) async => _json({}, 500));
      await tester.pumpWidget(
        _app(
          session: h.session,
          api: h.api,
          home: const RegisterPage(),
          textScale: 1.3,
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Daftar'), findsOneWidget);
    });
  });

  group('validasi', () {
    test('normalisasi nomor WhatsApp', () {
      expect(normalizePhone('0812-3456 7890'), '6281234567890');
      expect(normalizePhone('812 3456 7890'), '6281234567890');
      expect(normalizePhone('+62 812 3456 7890'), '6281234567890');
      expect(normalizePhone('62812 3456 7890'), '6281234567890');
      expect(normalizePhone('   '), '');
      expect(phoneError('0812'), isNotNull);
      expect(phoneError('081234567890'), isNull);
      expect(emailError('bukan-email'), isNotNull);
      expect(emailError('budi@email.com'), isNull);
      expect(passwordError('pendek'), isNotNull);
      expect(passwordError('rahasia123'), isNull);
    });
  });
}
