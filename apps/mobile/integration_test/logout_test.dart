import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/main.dart' as app;

import 'e2e_support.dart';

/// Sign-out must clear the UI *and* revoke the server session: after "Keluar",
/// `POST /auth/refresh` with the token the app was using has to answer 401.
///
/// Note: `/auth/logout` revokes exactly the `jti` of the presented token
/// (`revokeSessions(userId, jti)`), so a token from a second, parallel login is
/// a *different* session. The app's own token is read from `AppScope`, not from
/// secure storage.
const _apiBase = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:3001',
);

Uri _refreshUri() => Uri.parse('$_apiBase/v1/auth/refresh');
Uri _loginUri() => Uri.parse('$_apiBase/v1/auth/login');

Future<String> _httpLoginToken(http.Client client) async {
  final response = await client.post(
    _loginUri(),
    headers: {'Content-Type': 'application/json'},
    body: '{"email":"$e2eEmail","password":"$e2ePassword"}',
  );
  expect(response.statusCode, 200, reason: 'login http langsung: ${response.body}');
  final body = jsonDecode(response.body) as Map<String, dynamic>;
  final data = body['data'] as Map<String, dynamic>;
  return data['access_token'] as String;
}

Future<int> _refreshStatus(http.Client client, String token) async {
  final response = await client.post(
    _refreshUri(),
    headers: {'Authorization': 'Bearer $token'},
  );
  return response.statusCode;
}

void main() {
  initE2e();

  testWidgets('logout clears the UI and revokes the server session', (
    tester,
  ) async {
    // A second, independent session, kept to prove what logout does and does
    // not revoke (see the note above).
    final client = http.Client();
    final otherToken = await _httpLoginToken(client);

    app.main();
    await login(tester);
    final uiToken = AppScope.of(
      tester.element(find.text('Vendor di sekitar')),
    ).session.token;
    expect(uiToken, isNotNull, reason: 'sesi aplikasi harus punya token');

    await tester.tap(find.byTooltip('Menu akun'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.widgetWithText(PopupMenuItem<String>, 'Keluar'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.widgetWithText(FilledButton, 'Keluar'));
    await waitFor(tester, find.text('Masuk ke Tarlink'), label: 'Login setelah Keluar');
    await shot(tester, 'mobile-07-logout');

    final otherAfterLogout = await _refreshStatus(client, otherToken);
    final uiAfterLogout = await _refreshStatus(client, uiToken!);
    client.close();
    debugPrint(
      'refresh after logout: ui=$uiAfterLogout other-session=$otherAfterLogout',
    );
    // `/auth/logout` revokes only the presented token's `jti`; a parallel
    // session keeps working. That is why the plain-http token from the brief
    // cannot prove the UI logout — the app's own token can.
    expect(
      otherAfterLogout,
      200,
      reason: 'sesi paralel tidak ikut dicabut oleh logout sesi lain',
    );
    expect(
      uiAfterLogout,
      401,
      reason: 'backend harus mencabut sesi aplikasi yang logout',
    );
  });
}
