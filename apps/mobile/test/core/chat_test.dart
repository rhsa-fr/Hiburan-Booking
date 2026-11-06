import 'package:flutter_test/flutter_test.dart';
import 'package:tarlink_customer/core/chat.dart';

void main() {
  group('ChatMessage.fromJson', () {
    test('parses a stored message and converts the timestamp to local time', () {
      final message = ChatMessage.fromJson({
        'id': 'm1',
        'booking_id': 'b1',
        'sender_id': 'u1',
        'sender_role': 'vendor',
        'body': 'Siap, kami datang pukul 19.00.',
        'created_at': '2026-11-05T10:00:00.000Z',
      });

      expect(message, isNotNull);
      expect(message!.body, 'Siap, kami datang pukul 19.00.');
      expect(message.roleLabel, 'Vendor');
      expect(message.createdAt.isUtc, isFalse);
    });

    test('labels the customer side and degrades unknown roles', () {
      ChatMessage? parse(String role) => ChatMessage.fromJson({
        'id': 'm1',
        'booking_id': 'b1',
        'sender_id': 'u1',
        'sender_role': role,
        'body': 'halo',
        'created_at': '2026-11-05T10:00:00.000Z',
      });

      expect(parse('customer')!.roleLabel, 'Pelanggan');
      expect(parse('admin')!.roleLabel, 'Tarlink');
    });

    test('ignores rows without a parseable timestamp or required fields', () {
      expect(
        ChatMessage.fromJson({
          'id': 'm1',
          'booking_id': 'b1',
          'sender_id': 'u1',
          'sender_role': 'customer',
          'body': 'halo',
          'created_at': 'not-a-date',
        }),
        isNull,
      );
      expect(ChatMessage.fromJson({'id': 'm1'}), isNull);
    });
  });

  test('chatSocketUri keeps the API path and switches http to ws', () {
    expect(
      chatSocketUri('http://localhost:3001/v1', 'abc').toString(),
      'ws://localhost:3001/v1/chat/ws?token=abc',
    );
    expect(
      chatSocketUri('https://api.tarlink.id/v1', 'abc').toString(),
      'wss://api.tarlink.id/v1/chat/ws?token=abc',
    );
  });
}
