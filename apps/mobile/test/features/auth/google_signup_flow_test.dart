// ADR 0037: a first-time Google sign-up answers `verification_required` with
// no session, so the app must open the email code screen instead of home.
// Storage needs the in-memory platform, as in login_page_test.dart.
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
import 'package:tarlink_customer/core/api_exception.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/auth/auth_support.dart';
import 'package:tarlink_customer/features/auth/email_otp_page.dart';
import 'package:tarlink_customer/features/auth/google_auth.dart';
import 'package:tarlink_customer/features/auth/login_page.dart';

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

/// Real route table, except `home`: the shell fetches on build and these tests
/// only need to prove which destination was reached.
Route<dynamic>? _routes(RouteSettings settings) {
  if (settings.name == Routes.home) {
    return MaterialPageRoute<void>(
      builder: (_) => const Scaffold(body: Text('HOME')),
    );
  }
  return Routes.onGenerateRoute(settings);
}

Widget _app({
  required Session session,
  required ApiClient api,
  required Widget home,
}) {
  return AppScope(
    session: session,
    api: api,
    child: MaterialApp(
      theme: buildTheme(),
      home: home,
      onGenerateRoute: _routes,
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
      'email': 'budi@email.com',
      'roles': ['customer'],
    },
  },
};

const _pendingGooglePayload = {
  'data': {
    'verification_required': true,
    'email': 'baru@email.com',
    'expires_in': 600,
    'provider': 'google',
  },
};

void _phoneViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

/// Pumps enough frames for the consent dialog, three API round-trips and the
/// route transition, without `pumpAndSettle` (the code screen owns a timer).
Future<void> _settle(WidgetTester tester, {int frames = 8}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Leaves no countdown timer behind for the next test.
Future<void> _disposeTree(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
}

Future<http.Response> Function(http.Request) _authApi({
  required Object googleBody,
  Object? verifyBody,
}) {
  return (request) async {
    final path = request.url.path;
    if (path.endsWith('/policies/tos')) {
      return _json({'id': 'tos-1', 'code': 'tos', 'version': 1}, 200);
    }
    if (path.endsWith('/policies/privacy')) {
      return _json({'id': 'privacy-1', 'code': 'privacy', 'version': 1}, 200);
    }
    if (path.endsWith('/auth/google')) return _json(googleBody, 200);
    if (path.endsWith('/auth/register/verify')) {
      return _json(verifyBody ?? {}, 200);
    }
    return _json({}, 500);
  };
}

void main() {
  setUp(() {
    FlutterSecureStoragePlatform.instance = TestFlutterSecureStoragePlatform(
      {},
    );
    GoogleAuth.tokenOverride = null;
  });

  group('parseGoogleAuthResponse', () {
    test(
      'verification_required menghasilkan pendaftaran tertunda, bukan sesi',
      () {
        final outcome = parseGoogleAuthResponse(_pendingGooglePayload['data']);

        expect(outcome, isA<GoogleVerificationRequired>());
        expect(outcome, isNot(isA<GoogleSession>()));
        final pending = outcome as GoogleVerificationRequired;
        expect(pending.email, 'baru@email.com');
        expect(pending.expiresIn, 600);
        expect(pending.devCode, isNull);
      },
    );

    test('dev_code hanya ikut bila server mengirimnya', () {
      final outcome = parseGoogleAuthResponse({
        'verification_required': true,
        'email': 'baru@email.com',
        'expires_in': 600,
        'provider': 'google',
        'dev_code': '123456',
      });

      expect((outcome as GoogleVerificationRequired).devCode, '123456');
    });

    test('respons token tetap menghasilkan sesi', () {
      final outcome = parseGoogleAuthResponse({
        'access_token': 'token-123',
        'token_type': 'Bearer',
        'expires_in': 3600,
        'user': {
          'id': 'u1',
          'email': 'budi@email.com',
          'roles': ['customer'],
        },
      });

      expect(outcome, isA<GoogleSession>());
      expect((outcome as GoogleSession).payload['access_token'], 'token-123');
    });

    test('respons tanpa token dan tanpa verification_required ditolak', () {
      expect(
        () => parseGoogleAuthResponse({
          'user': {'id': 'u1'},
        }),
        throwsA(
          isA<ApiException>().having(
            (error) => error.code,
            'code',
            'INTERNAL_ERROR',
          ),
        ),
      );
    });
  });

  group('LoginPage dengan Google', () {
    testWidgets('akun baru: membuka layar kode, tanpa sesi dan tanpa beranda', (
      tester,
    ) async {
      _phoneViewport(tester);
      GoogleAuth.tokenOverride = () async => 'google-id-token';
      addTearDown(() => GoogleAuth.tokenOverride = null);

      final h = _setup(_authApi(googleBody: _pendingGooglePayload));

      await tester.pumpWidget(
        _app(session: h.session, api: h.api, home: const LoginPage()),
      );
      await tester.pump();

      final button = find.text('Lanjutkan dengan Google');
      await tester.ensureVisible(button);
      await tester.pump();
      await tester.tap(button);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));

      // FR-103: persetujuan tetap diminta sebelum API dipanggil.
      expect(find.text('Setuju & lanjut'), findsOneWidget);
      await tester.tap(find.text('Setuju & lanjut'));
      await _settle(tester);

      expect(find.byType(EmailOtpPage), findsOneWidget);
      expect(find.text('baru@email.com'), findsOneWidget);
      expect(find.text('HOME'), findsNothing);
      expect(h.session.authorized, isFalse);

      final google = h.requests.firstWhere(
        (request) => request.url.path.endsWith('/auth/google'),
      );
      expect(jsonDecode(google.body), {
        'id_token': 'google-id-token',
        'consent': {
          'tos_version_id': 'tos-1',
          'privacy_version_id': 'privacy-1',
        },
      });

      await _disposeTree(tester);
    });

    testWidgets('akun lama: sesi tersimpan dan beranda terbuka', (
      tester,
    ) async {
      _phoneViewport(tester);
      GoogleAuth.tokenOverride = () async => 'google-id-token';
      addTearDown(() => GoogleAuth.tokenOverride = null);

      final h = _setup(_authApi(googleBody: _sessionPayload));

      await tester.pumpWidget(
        _app(session: h.session, api: h.api, home: const LoginPage()),
      );
      await tester.pump();

      final button = find.text('Lanjutkan dengan Google');
      await tester.ensureVisible(button);
      await tester.pump();
      await tester.tap(button);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      await tester.tap(find.text('Setuju & lanjut'));
      await _settle(tester);

      expect(h.session.authorized, isTrue);
      expect(h.session.token, 'token-123');
      expect(find.text('HOME'), findsOneWidget);
      expect(find.byType(EmailOtpPage), findsNothing);
    });

    testWidgets('kode Google diverifikasi: sesi tersimpan dan masuk aplikasi', (
      tester,
    ) async {
      _phoneViewport(tester);
      GoogleAuth.tokenOverride = () async => 'google-id-token';
      addTearDown(() => GoogleAuth.tokenOverride = null);

      final h = _setup(
        _authApi(
          googleBody: _pendingGooglePayload,
          verifyBody: _sessionPayload,
        ),
      );

      await tester.pumpWidget(
        _app(session: h.session, api: h.api, home: const LoginPage()),
      );
      await tester.pump();

      final button = find.text('Lanjutkan dengan Google');
      await tester.ensureVisible(button);
      await tester.pump();
      await tester.tap(button);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      await tester.tap(find.text('Setuju & lanjut'));
      await _settle(tester);
      expect(find.byType(EmailOtpPage), findsOneWidget);

      await tester.enterText(
        find.descendant(
          of: find.byType(EmailOtpPage),
          matching: find.byType(TextField),
        ),
        '123456',
      );
      await tester.pump();
      await _settle(tester);

      expect(h.session.authorized, isTrue);
      expect(h.session.token, 'token-123');
      expect(find.text('HOME'), findsOneWidget);

      final verify = h.requests.firstWhere(
        (request) => request.url.path.endsWith('/auth/register/verify'),
      );
      expect(jsonDecode(verify.body), {
        'email': 'baru@email.com',
        'code': '123456',
      });
    });
  });
}
