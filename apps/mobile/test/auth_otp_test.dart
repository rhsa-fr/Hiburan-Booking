// Auth OTP/reset tests share login_page_test's storage setup: Session._persist()
// awaits a platform channel that never answers without the in-memory platform.
// ignore_for_file: depend_on_referenced_packages

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
import 'package:tarlink_customer/features/auth/email_otp_page.dart';
import 'package:tarlink_customer/features/auth/forgot_password_page.dart';
import 'package:tarlink_customer/features/auth/login_page.dart';
import 'package:tarlink_customer/features/auth/register_page.dart';
import 'package:tarlink_customer/features/auth/reset_password_page.dart';

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

/// Real route table, except `home`: the shell fetches on build and the auth
/// tests only need to prove the destination was reached.
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
  double textScale = 1,
}) {
  return AppScope(
    session: session,
    api: api,
    child: MaterialApp(
      theme: buildTheme(),
      home: home,
      onGenerateRoute: _routes,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
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

const _policies = {
  'tos': {'id': 'tos-1', 'code': 'tos', 'version': 1},
  'privacy': {'id': 'privacy-1', 'code': 'privacy', 'version': 1},
};

void _phoneViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

/// Leaves the countdown timer nothing to leak into the next test.
Future<void> _disposeTree(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
}

/// Clipboard reads travel over `SystemChannels.platform`; answer them without
/// a real platform clipboard. `null` means "nothing in the clipboard".
void _mockClipboard(WidgetTester tester, String? text) {
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
    SystemChannels.platform,
    (call) async {
      if (call.method == 'Clipboard.getData') {
        return text == null ? null : <String, dynamic>{'text': text};
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
}

/// `TextButton.icon` builds a private `_TextButtonWithIcon` subclass, so the
/// exact-type `find.byType(TextButton)` misses it; match by predicate instead.
TextButton _pasteButton(WidgetTester tester) {
  return tester.widget<TextButton>(
    find.ancestor(
      of: find.text('Tempel kode'),
      matching: find.byWidgetPredicate((widget) => widget is TextButton),
    ),
  );
}

void main() {
  setUp(() {
    FlutterSecureStoragePlatform.instance = TestFlutterSecureStoragePlatform({});
  });

  testWidgets('daftar sukses membawa email ke layar kode, tanpa sesi', (
    tester,
  ) async {
    _phoneViewport(tester);
    final h = _setup((request) async {
      if (request.url.path.endsWith('/policies/tos')) {
        return _json(_policies['tos']!, 200);
      }
      if (request.url.path.endsWith('/policies/privacy')) {
        return _json(_policies['privacy']!, 200);
      }
      if (request.url.path.endsWith('/auth/register')) {
        return _json({
          'data': {
            'verification_required': true,
            'email': 'budi@email.com',
            'expires_in': 600,
          },
        }, 201);
      }
      return _json({}, 500);
    });

    await tester.pumpWidget(
      _app(session: h.session, api: h.api, home: const RegisterPage()),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField).at(0), 'Budi');
    await tester.enterText(find.byType(TextFormField).at(1), 'budi@email.com');
    await tester.enterText(find.byType(TextFormField).at(2), 'rahasia123');
    await tester.enterText(find.byType(TextFormField).at(3), 'rahasia123');
    await tester.tap(find.byType(Checkbox));
    await tester.pump();

    final submit = find.widgetWithText(FilledButton, 'Buat akun');
    await tester.ensureVisible(submit);
    await tester.pumpAndSettle();
    await tester.tap(submit);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.byType(EmailOtpPage), findsOneWidget);
    expect(find.text('budi@email.com'), findsOneWidget);
    expect(h.session.authorized, isFalse);

    final body = jsonDecode(
      h.requests.firstWhere((r) => r.url.path.endsWith('/auth/register')).body,
    );
    expect(body['email'], 'budi@email.com');
    expect(body['consent'], {
      'tos_version_id': 'tos-1',
      'privacy_version_id': 'privacy-1',
    });

    await _disposeTree(tester);
  });

  testWidgets('kode salah: pesan Indonesia tampil dan tetap di layar kode', (
    tester,
  ) async {
    _phoneViewport(tester);
    final h = _setup(
      (_) async => _json({
        'error': {'code': 'CODE_INVALID', 'message': 'invalid code'},
      }, 400),
    );

    await tester.pumpWidget(
      _app(
        session: h.session,
        api: h.api,
        home: const EmailOtpPage(
          email: 'budi@email.com',
          mode: EmailOtpMode.register,
        ),
      ),
    );
    await tester.pump();

    await tester.enterText(find.byType(TextField), '123456');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.textContaining('Kode tidak cocok'), findsOneWidget);
    expect(find.byType(EmailOtpPage), findsOneWidget);
    expect(h.session.authorized, isFalse);
    expect(
      h.requests.single.url.path.endsWith('/auth/register/verify'),
      isTrue,
    );

    await _disposeTree(tester);
  });

  testWidgets('kode benar: sesi terisi dan pindah ke beranda', (tester) async {
    _phoneViewport(tester);
    final h = _setup((_) async => _json(_sessionPayload, 200));

    await tester.pumpWidget(
      _app(
        session: h.session,
        api: h.api,
        home: const EmailOtpPage(
          email: 'budi@email.com',
          mode: EmailOtpMode.register,
        ),
      ),
    );
    await tester.pump();

    await tester.enterText(find.byType(TextField), '123456');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));

    expect(h.session.authorized, isTrue);
    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('kirim ulang terkunci 60 detik, lalu memanggil endpoint resend', (
    tester,
  ) async {
    _phoneViewport(tester);
    final h = _setup(
      (_) async => _json({'sent': true, 'expires_in': 600}, 200),
    );

    await tester.pumpWidget(
      _app(
        session: h.session,
        api: h.api,
        home: const EmailOtpPage(
          email: 'budi@email.com',
          mode: EmailOtpMode.register,
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Tunggu 1:00'), findsOneWidget);
    await tester.tap(find.text('Tunggu 1:00'));
    await tester.pump();
    expect(h.requests, isEmpty);

    await tester.pump(const Duration(seconds: 60));
    expect(find.text('Kirim ulang kode'), findsOneWidget);

    await tester.tap(find.text('Kirim ulang kode'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(
      h.requests.single.url.path.endsWith('/auth/register/resend'),
      isTrue,
    );
    expect(find.textContaining('Kode baru sudah dikirim'), findsOneWidget);

    await _disposeTree(tester);
  });

  testWidgets('lupa kata sandi selalu maju ke layar kode', (tester) async {
    _phoneViewport(tester);
    final h = _setup(
      (request) async => request.url.path.endsWith('/auth/password/forgot')
          ? _json({'sent': true}, 200)
          : _json({}, 500),
    );

    await tester.pumpWidget(
      _app(
        session: h.session,
        api: h.api,
        home: const ForgotPasswordPage(initialEmail: 'budi@email.com'),
      ),
    );
    await tester.pump();

    expect(
      find.widgetWithText(TextFormField, 'budi@email.com'),
      findsOneWidget,
    );

    await tester.tap(find.widgetWithText(FilledButton, 'Kirim kode'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.byType(EmailOtpPage), findsOneWidget);
    expect(find.textContaining('Kalau email terdaftar'), findsOneWidget);
    expect(jsonDecode(h.requests.single.body), {'email': 'budi@email.com'});

    await _disposeTree(tester);
  });

  testWidgets('kode reset membawa token ke layar kata sandi baru', (
    tester,
  ) async {
    _phoneViewport(tester);
    final h = _setup(
      (_) async => _json({'reset_token': 'rt-1', 'expires_in': 600}, 200),
    );

    await tester.pumpWidget(
      _app(
        session: h.session,
        api: h.api,
        home: const EmailOtpPage(
          email: 'budi@email.com',
          mode: EmailOtpMode.reset,
        ),
      ),
    );
    await tester.pump();

    await tester.enterText(find.byType(TextField), '123456');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.byType(ResetPasswordPage), findsOneWidget);
    expect(find.text('Buat kata sandi baru'), findsOneWidget);
    expect(h.session.authorized, isFalse);
  });

  testWidgets('kata sandi baru tersimpan: kembali ke masuk dengan pesan', (
    tester,
  ) async {
    _phoneViewport(tester);
    final h = _setup(
      (_) async => _json({'reset': true}, 200),
    );

    await tester.pumpWidget(
      _app(
        session: h.session,
        api: h.api,
        home: const ResetPasswordPage(
          email: 'budi@email.com',
          token: 'rt-1',
        ),
      ),
    );
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).at(0), 'rahasia456');
    await tester.enterText(find.byType(TextFormField).at(1), 'rahasia456');
    await tester.tap(find.widgetWithText(FilledButton, 'Simpan kata sandi'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.byType(LoginPage), findsOneWidget);
    expect(
      find.text('Kata sandi diperbarui. Silakan masuk.'),
      findsOneWidget,
    );
    expect(find.text('budi@email.com'), findsOneWidget);
    expect(jsonDecode(h.requests.single.body), {
      'reset_token': 'rt-1',
      'password': 'rahasia456',
    });
  });

  testWidgets('token reset kedaluwarsa: pesan jelas dan jalan minta kode baru', (
    tester,
  ) async {
    _phoneViewport(tester);
    final h = _setup(
      (_) async => _json({
        'error': {
          'code': 'VALIDATION_ERROR',
          'message': 'Token reset tidak valid atau kedaluwarsa',
        },
      }, 400),
    );

    await tester.pumpWidget(
      _app(
        session: h.session,
        api: h.api,
        home: const ResetPasswordPage(
          email: 'budi@email.com',
          token: 'rt-lama',
        ),
      ),
    );
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).at(0), 'rahasia456');
    await tester.enterText(find.byType(TextFormField).at(1), 'rahasia456');
    await tester.tap(find.widgetWithText(FilledButton, 'Simpan kata sandi'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.textContaining('kedaluwarsa'), findsOneWidget);
    expect(find.text('Minta kode baru'), findsOneWidget);

    await tester.tap(find.text('Minta kode baru'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.byType(ForgotPasswordPage), findsOneWidget);
  });

  testWidgets('layar kode, lupa sandi, dan sandi baru utuh di 320dp teks 1.3x', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final h = _setup((_) async => _json({'sent': true}, 200));

    Future<void> pumpPage(Widget page) async {
      await tester.pumpWidget(
        _app(session: h.session, api: h.api, home: page, textScale: 1.3),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
    }

    await pumpPage(
      const EmailOtpPage(
        email: 'budi@email.com',
        mode: EmailOtpMode.register,
      ),
    );
    expect(find.text('Verifikasi kode'), findsOneWidget);
    expect(find.text('Tempel kode'), findsOneWidget);
    await _disposeTree(tester);

    await pumpPage(const ForgotPasswordPage());
    expect(find.text('Kirim kode'), findsOneWidget);

    await pumpPage(
      const ResetPasswordPage(email: 'budi@email.com', token: 'rt-1'),
    );
    expect(find.text('Simpan kata sandi'), findsOneWidget);
  });

  testWidgets('login email belum verifikasi menawarkan kirim ulang kode', (
    tester,
  ) async {
    _phoneViewport(tester);
    final h = _setup(
      (_) async => _json({
        'error': {'code': 'EMAIL_NOT_VERIFIED', 'message': 'not verified'},
      }, 403),
    );

    await tester.pumpWidget(
      _app(session: h.session, api: h.api, home: const LoginPage()),
    );
    await tester.pump();

    await tester.enterText(find.byType(TextFormField).at(0), 'budi@email.com');
    await tester.enterText(find.byType(TextFormField).at(1), 'rahasia123');
    await tester.tap(find.widgetWithText(FilledButton, 'Masuk ke Akun'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(
      find.text('Email belum diverifikasi. Kirim ulang kode verifikasi.'),
      findsOneWidget,
    );
    expect(find.text('Email atau kata sandi salah.'), findsNothing);

    await tester.tap(find.text('Kirim ulang kode verifikasi'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.byType(EmailOtpPage), findsOneWidget);

    await _disposeTree(tester);
  });

  testWidgets('tempel kode mengisi field dan memverifikasi sekali', (
    tester,
  ) async {
    _phoneViewport(tester);
    final h = _setup(
      (_) async => _json({
        'error': {'code': 'CODE_INVALID', 'message': 'invalid code'},
      }, 400),
    );
    _mockClipboard(tester, 'Kode kamu: 123456');

    await tester.pumpWidget(
      _app(
        session: h.session,
        api: h.api,
        home: const EmailOtpPage(
          email: 'budi@email.com',
          mode: EmailOtpMode.register,
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.text('Tempel kode'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller!.text, '123456');

    final verify = h.requests
        .where((r) => r.url.path.endsWith('/auth/register/verify'))
        .toList();
    expect(verify, hasLength(1));
    expect(jsonDecode(verify.single.body), {
      'email': 'budi@email.com',
      'code': '123456',
    });

    await _disposeTree(tester);
  });

  testWidgets('tempel teks tanpa 6 digit: pesan tampil, tanpa panggilan API', (
    tester,
  ) async {
    _phoneViewport(tester);
    final h = _setup((_) async => _json(_sessionPayload, 200));
    _mockClipboard(tester, 'Halo, kodenya menyusul ya');

    await tester.pumpWidget(
      _app(
        session: h.session,
        api: h.api,
        home: const EmailOtpPage(
          email: 'budi@email.com',
          mode: EmailOtpMode.register,
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.text('Tempel kode'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Clipboard tidak berisi kode 6 digit.'), findsOneWidget);
    expect(h.requests, isEmpty);
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, '');

    await _disposeTree(tester);
  });

  testWidgets('tempel clipboard kosong: pesan salin dulu, tanpa panggilan API', (
    tester,
  ) async {
    _phoneViewport(tester);
    final h = _setup((_) async => _json(_sessionPayload, 200));
    _mockClipboard(tester, null);

    await tester.pumpWidget(
      _app(
        session: h.session,
        api: h.api,
        home: const EmailOtpPage(
          email: 'budi@email.com',
          mode: EmailOtpMode.register,
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.text('Tempel kode'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(
      find.text('Clipboard kosong. Salin kode dari email dulu.'),
      findsOneWidget,
    );
    expect(h.requests, isEmpty);

    await _disposeTree(tester);
  });

  testWidgets('tombol tempel nonaktif selama kode diverifikasi', (
    tester,
  ) async {
    _phoneViewport(tester);
    final pending = Completer<http.Response>();
    final h = _setup((_) => pending.future);

    await tester.pumpWidget(
      _app(
        session: h.session,
        api: h.api,
        home: const EmailOtpPage(
          email: 'budi@email.com',
          mode: EmailOtpMode.register,
        ),
      ),
    );
    await tester.pump();

    await tester.enterText(find.byType(TextField), '123456');
    await tester.pump();

    expect(h.requests, hasLength(1));
    expect(_pasteButton(tester).onPressed, isNull);

    pending.complete(
      _json({
        'error': {'code': 'CODE_INVALID', 'message': 'invalid code'},
      }, 400),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(_pasteButton(tester).onPressed, isNotNull);

    await _disposeTree(tester);
  });
}
