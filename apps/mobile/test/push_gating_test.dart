import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/models.dart';
import 'package:tarlink_customer/core/push.dart';
import 'package:tarlink_customer/core/session.dart';

const _apiKey = 'AIzaSy-test-key';
const _appId = '1:1234567890:android:abcdef';
const _senderId = '1234567890';
const _projectId = 'tarlink-test';

/// Signed-in session without the device keystore.
class _TestSession extends Session {
  @override
  bool get authorized => true;

  @override
  String? get token => 'test-token';

  @override
  AppUser? get user =>
      AppUser(id: 'user-1', phone: '081200000000', roles: const ['customer']);
}

void main() {
  group('firebaseOptionsFrom', () {
    test('tanpa dart-define tidak ada opsi Firebase', () {
      // The test binary is compiled without the four --dart-define values, so
      // the production defaults must reject the build instead of guessing.
      expect(firebaseOptionsFrom(), isNull);
    });

    test('satu nilai kosong sudah cukup untuk mematikan push', () {
      expect(
        firebaseOptionsFrom(
          apiKey: '',
          appId: _appId,
          messagingSenderId: _senderId,
          projectId: _projectId,
        ),
        isNull,
      );
      expect(
        firebaseOptionsFrom(
          apiKey: _apiKey,
          appId: '   ',
          messagingSenderId: _senderId,
          projectId: _projectId,
        ),
        isNull,
      );
      expect(
        firebaseOptionsFrom(
          apiKey: _apiKey,
          appId: _appId,
          messagingSenderId: '',
          projectId: _projectId,
        ),
        isNull,
      );
      expect(
        firebaseOptionsFrom(
          apiKey: _apiKey,
          appId: _appId,
          messagingSenderId: _senderId,
          projectId: '',
        ),
        isNull,
      );
    });

    test('empat nilai utuh membangun FirebaseOptions', () {
      final options = firebaseOptionsFrom(
        apiKey: _apiKey,
        appId: _appId,
        messagingSenderId: _senderId,
        projectId: _projectId,
      );

      expect(options, isA<FirebaseOptions>());
      expect(options!.apiKey, _apiKey);
      expect(options.appId, _appId);
      expect(options.messagingSenderId, _senderId);
      expect(options.projectId, _projectId);
    });
  });

  test('start tanpa konfigurasi tidak mendaftarkan perangkat', () async {
    final calls = <String>[];
    final session = _TestSession();
    final api = ApiClient(
      session: session,
      baseUrl: 'http://test.local',
      client: MockClient((request) async {
        calls.add('${request.method} ${request.url.path}');
        return http.Response(jsonEncode({'data': <String, dynamic>{}}), 200);
      }),
    );
    addTearDown(() {
      api.close();
      session.dispose();
    });

    final service = PushService();
    var opened = 0;

    // The blank dart-defines must short-circuit before Firebase is touched:
    // no plugin channel, no permission prompt, and no HTTP call.
    await expectLater(
      service.start(
        session: session,
        api: api,
        onOpenBooking: (_) => opened += 1,
      ),
      completes,
    );

    expect(service.started, isFalse);
    expect(calls, isEmpty);
    expect(opened, 0);

    // Stopping a service that never started is also a no-op.
    await expectLater(service.stop(), completes);
    expect(calls, isEmpty);
  });
}
