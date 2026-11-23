import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/chat.dart';
import 'package:tarlink_customer/core/models.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/chat/chat_page.dart';

const _bookingId = '40f3017d-8141-4008-9f95-7829d0c46f26';
const _selfId = '11111111-1111-4111-8111-111111111111';
const _otherId = '22222222-2222-4222-8222-222222222222';

http.Response _json(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Map<String, dynamic> _message({
  required String id,
  required String senderId,
  required String senderRole,
  required String body,
  String createdAt = '2026-11-22T09:00:00.000Z',
  Object? readAt,
}) => {
  'id': id,
  'booking_id': _bookingId,
  'sender_id': senderId,
  'sender_role': senderRole,
  'body': body,
  'created_at': createdAt,
  'read_at': readAt,
};

/// History + read receipt fake. Counts the calls the page makes so the test can
/// prove a thread open marks read exactly once and never polls.
class _ChatBackend {
  _ChatBackend(this.messages);

  final List<Map<String, dynamic>> messages;
  int historyCalls = 0;
  int readCalls = 0;

  MockClient get client => MockClient((request) async {
    final path = request.url.path;
    if (request.method == 'POST' && path.endsWith('/chat/messages/read')) {
      readCalls++;
      return _json({
        'data': {'read_ids': <String>[], 'read_at': '2026-11-22T09:05:00.000Z'},
      });
    }
    if (request.method == 'GET' && path.endsWith('/chat/messages')) {
      historyCalls++;
      return _json({
        'data': {'items': messages, 'next_before': null},
      });
    }
    return _json({
      'error': {'code': 'NOT_FOUND', 'message': path},
    }, 404);
  });
}

/// A signed-in identity without a token: `ChatPage` skips the WebSocket when the
/// session carries no access token, so the widget test never opens a real socket.
class _TestSession extends Session {
  _TestSession();

  @override
  AppUser? get user =>
      const AppUser(id: _selfId, phone: '6281234567890', roles: ['customer']);
}

Future<void> _pumpChat(WidgetTester tester, _ChatBackend backend) async {
  final session = _TestSession();
  final api = ApiClient(
    session: session,
    client: backend.client,
    baseUrl: 'http://localhost:3001',
  );
  addTearDown(() {
    api.close();
    session.dispose();
  });

  // 390×844 is the reference phone.
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    AppScope(
      session: session,
      api: api,
      child: MaterialApp(
        theme: buildTheme(),
        home: const ChatPage(bookingId: _bookingId, title: 'Chat vendor'),
      ),
    ),
  );
  await tester.pump();
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> _disposeChat(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump();
}

void main() {
  group('ChatMessage.fromJson read_at', () {
    test('parses an ISO timestamp and keeps the message', () {
      final message = ChatMessage.fromJson(
        _message(
          id: 'm1',
          senderId: _selfId,
          senderRole: 'customer',
          body: 'halo',
          readAt: '2026-11-22T09:10:00.000Z',
        ),
      );

      expect(message, isNotNull);
      expect(message!.readAt, isNotNull);
      expect(
        message.readAt!.toUtc(),
        DateTime.utc(2026, 11, 22, 9, 10),
      );
      expect(message.readAt!.isUtc, isFalse);
    });

    test('null and absent read_at both mean unread', () {
      for (final remove in [false, true]) {
        final json = _message(
          id: 'm1',
          senderId: _selfId,
          senderRole: 'customer',
          body: 'halo',
        );
        if (remove) json.remove('read_at');
        final message = ChatMessage.fromJson(json);
        expect(message, isNotNull);
        expect(message!.readAt, isNull);
      }
    });

    test('a malformed read_at degrades to unread, not a dropped message', () {
      final message = ChatMessage.fromJson(
        _message(
          id: 'm1',
          senderId: _selfId,
          senderRole: 'customer',
          body: 'halo',
          readAt: 'kemarin sore',
        ),
      );

      expect(message, isNotNull);
      expect(message!.body, 'halo');
      expect(message.readAt, isNull);
    });
  });

  testWidgets('own bubbles show one tick when sent and two when read', (
    tester,
  ) async {
    final backend = _ChatBackend([
      _message(
        id: 'm1',
        senderId: _selfId,
        senderRole: 'customer',
        body: 'Pesan terkirim',
        createdAt: '2026-11-22T09:00:00.000Z',
      ),
      _message(
        id: 'm2',
        senderId: _otherId,
        senderRole: 'vendor',
        body: 'Balasan vendor',
        createdAt: '2026-11-22T09:01:00.000Z',
      ),
      _message(
        id: 'm3',
        senderId: _selfId,
        senderRole: 'customer',
        body: 'Pesan dibaca',
        createdAt: '2026-11-22T09:02:00.000Z',
        readAt: '2026-11-22T09:03:00.000Z',
      ),
    ]);

    await _pumpChat(tester, backend);

    expect(find.text('Pesan terkirim'), findsOneWidget);
    expect(find.text('Pesan dibaca'), findsOneWidget);
    expect(find.text('Balasan vendor'), findsOneWidget);

    // Exactly one tick per own message: the incoming bubble has none.
    expect(find.byIcon(Icons.done), findsOneWidget);
    expect(find.byIcon(Icons.done_all), findsOneWidget);

    // Accessibility: the tick announces its state, not just a glyph.
    expect(
      find.byWidgetPredicate(
        (widget) => widget is Icon && widget.semanticLabel == 'terkirim',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is Icon && widget.semanticLabel == 'dibaca',
      ),
      findsOneWidget,
    );

    await _disposeChat(tester);
  });

  testWidgets('opening the thread marks it read exactly once', (tester) async {
    final backend = _ChatBackend([
      _message(
        id: 'm1',
        senderId: _otherId,
        senderRole: 'vendor',
        body: 'Halo, ada yang bisa dibantu?',
      ),
    ]);

    await _pumpChat(tester, backend);

    expect(backend.historyCalls, 1);
    expect(backend.readCalls, 1);

    // No polling loop: a couple of seconds later the counter has not moved.
    await tester.pump(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));
    expect(backend.readCalls, 1);

    await _disposeChat(tester);
  });
}
