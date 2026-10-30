// The refresh-token path must survive a cold start: the access token can be
// expired, but the stored refresh token still renews the session.
// ignore_for_file: depend_on_referenced_packages

import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_secure_storage/test/test_flutter_secure_storage_platform.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/session.dart';

void main() {
  setUp(() {
    FlutterSecureStoragePlatform.instance = TestFlutterSecureStoragePlatform({});
  });

  test('cold start memakai refresh token saat access token kedaluwarsa', () async {
    const storage = FlutterSecureStorage();
    await storage.write(key: 'access_token', value: 'token-lama');
    await storage.write(key: 'refresh_token', value: 'refresh-lama');
    await storage.write(
      key: 'expires_at',
      value: DateTime.now().toUtc().subtract(const Duration(minutes: 1)).toIso8601String(),
    );
    await storage.write(key: 'user', value: jsonEncode({'id': 'user-1'}));

    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      if (request.url.path.endsWith('/auth/refresh')) {
        return http.Response(
          jsonEncode({
            'data': {
              'access_token': 'token-baru',
              'refresh_token': 'refresh-baru',
              'expires_in': 900,
              'user': {'id': 'user-1'},
            },
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response('{}', 200);
    });

    final session = Session();
    final api = ApiClient(
      session: session,
      client: client,
      baseUrl: 'http://test.local',
    );
    session.attachRefresh(() => api.refreshSession());

    await session.restore();

    expect(session.authorized, isTrue);
    expect(session.token, 'token-baru');
    expect(session.refreshToken, 'refresh-baru');
    expect(requests, hasLength(1));
    expect(requests.single.method, 'POST');
    expect(requests.single.url.path, endsWith('/auth/refresh'));
    expect(
      (jsonDecode(requests.single.body) as Map<String, dynamic>)['refresh_token'],
      'refresh-lama',
    );

    api.close();
    session.dispose();
  });

  test('cold start menghapus sesi bila refresh ditolak', () async {
    const storage = FlutterSecureStorage();
    await storage.write(key: 'access_token', value: 'token-lama');
    await storage.write(key: 'refresh_token', value: 'refresh-ditolak');
    await storage.write(
      key: 'expires_at',
      value: DateTime.now().toUtc().subtract(const Duration(minutes: 1)).toIso8601String(),
    );

    final client = MockClient((request) async {
      return http.Response(
        jsonEncode({
          'error': {'code': 'UNAUTHENTICATED', 'message': 'Sesi berakhir'},
        }),
        401,
        headers: {'content-type': 'application/json'},
      );
    });

    final session = Session();
    final api = ApiClient(
      session: session,
      client: client,
      baseUrl: 'http://test.local',
    );
    session.attachRefresh(() => api.refreshSession());

    await session.restore();

    expect(session.authorized, isFalse);
    expect(session.token, isNull);
    expect(session.refreshToken, isNull);
    expect(session.notice, isNotNull);

    api.close();
    session.dispose();
  });
}
