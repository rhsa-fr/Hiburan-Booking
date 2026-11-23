/// One stored chat message from `GET /v1/bookings/:id/chat/messages`.
class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.bookingId,
    required this.senderId,
    required this.senderRole,
    required this.body,
    required this.createdAt,
    this.readAt,
  });

  final String id;
  final String bookingId;
  final String senderId;

  /// `customer`, `vendor`, or `admin` — decided by the API per booking.
  final String senderRole;
  final String body;
  final DateTime createdAt;

  /// When the other party read this message; `null` means it is still unread
  /// (or the row predates read receipts).
  final DateTime? readAt;

  /// Same message with a read receipt attached. Only [readAt] changes.
  ChatMessage withReadAt(DateTime readAt) => ChatMessage(
    id: id,
    bookingId: bookingId,
    senderId: senderId,
    senderRole: senderRole,
    body: body,
    createdAt: createdAt,
    readAt: readAt,
  );

  static ChatMessage? fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final bookingId = json['booking_id'];
    final senderId = json['sender_id'];
    final senderRole = json['sender_role'];
    final body = json['body'];
    if (id is! String ||
        bookingId is! String ||
        senderId is! String ||
        senderRole is! String ||
        body is! String) {
      return null;
    }
    final createdAt = DateTime.tryParse('${json['created_at'] ?? ''}');
    if (createdAt == null) return null;
    // Read receipts are cosmetic here: a missing or malformed `read_at` only
    // means "unread", it must never drop the message itself.
    final readAtRaw = json['read_at'];
    final readAt = readAtRaw is String ? DateTime.tryParse(readAtRaw) : null;
    return ChatMessage(
      id: id,
      bookingId: bookingId,
      senderId: senderId,
      senderRole: senderRole,
      body: body,
      createdAt: createdAt.toLocal(),
      readAt: readAt?.toLocal(),
    );
  }

  String get roleLabel => switch (senderRole) {
    'vendor' => 'Vendor',
    'admin' => 'Tarlink',
    _ => 'Pelanggan',
  };
}

/// `http://host:3001/v1` → `ws://host:3001/v1/chat/ws?token=…`.
Uri chatSocketUri(String baseUrl, String token) {
  final base = Uri.parse(baseUrl);
  return base.replace(
    scheme: base.scheme == 'https' ? 'wss' : 'ws',
    path: '${base.path}/chat/ws',
    queryParameters: {'token': token},
  );
}
