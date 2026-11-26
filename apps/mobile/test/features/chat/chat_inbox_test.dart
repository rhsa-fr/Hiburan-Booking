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
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/chat/chat_inbox_page.dart';

http.Response _json(Object body) => http.Response(
  jsonEncode(body),
  200,
  headers: {'content-type': 'application/json'},
);

void main() {
  setUp(() {
    FlutterSecureStoragePlatform.instance = TestFlutterSecureStoragePlatform({});
  });

  testWidgets('menampilkan semua vendor yang pernah dichat', (tester) async {
    final session = Session();
    await session.applySession({
      'access_token': 'token',
      'expires_in': 3600,
      'user': {
        'id': 'u1',
        'phone': '6281200000001',
        'roles': ['customer'],
      },
    });
    final uri = Uri.parse('http://test.local');
    final api = ApiClient(
      session: session,
      baseUrl: uri.toString(),
      client: MockClient((request) async {
        expect(request.url.path, endsWith('/chats'));
        return _json({
          'items': [
            {
              'booking_id': 'b1',
              'booking_code': 'TRL-2611-0001',
              'vendor_id': 'v1',
              'vendor_name': 'Organ Tarling DWS',
              'counterpart_name': 'Organ Tarling DWS',
              'counterpart_role': 'vendor',
              'last_message': 'Halo, masih tersedia?',
              'last_at': '2026-11-26T08:00:00.000Z',
              'unread_count': 2,
            },
            {
              'booking_id': 'b2',
              'booking_code': 'TRL-2611-0002',
              'vendor_id': 'v2',
              'vendor_name': 'Rolani Electone',
              'counterpart_name': 'Rolani Electone',
              'counterpart_role': 'vendor',
              'last_message': 'Terima kasih.',
              'last_at': '2026-11-25T08:00:00.000Z',
              'unread_count': 0,
            }
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
          home: const Scaffold(body: SafeArea(child: ChatInboxPage())),
        ),
      ),
    );
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }

    expect(find.text('Chat'), findsOneWidget);
    expect(find.text('Organ Tarling DWS'), findsOneWidget);
    expect(find.text('Rolani Electone'), findsOneWidget);
    expect(find.text('Halo, masih tersedia?'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);
  });
}
