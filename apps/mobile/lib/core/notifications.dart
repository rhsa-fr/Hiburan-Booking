import 'dart:async';

import 'api_client.dart';
import 'api_exception.dart';
import 'session.dart';

/// One in-app notification row from `GET /v1/notifications`.
class InAppNotification {
  const InAppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    this.bookingId,
    this.readAt,
    this.createdAt,
  });

  final String id;
  final String type;
  final String title;
  final String body;
  final String? bookingId;

  /// ISO-8601 timestamp, `null` while the row is still unread.
  final String? readAt;
  final String? createdAt;

  bool get unread => readAt == null;

  /// Local optimistic copy used by the center after a successful mark-read.
  InAppNotification markRead(DateTime at) => InAppNotification(
    id: id,
    type: type,
    title: title,
    body: body,
    bookingId: bookingId,
    readAt: at.toUtc().toIso8601String(),
    createdAt: createdAt,
  );

  static InAppNotification? fromJson(Map<String, dynamic> json) {
    final id = json['id'];
    final title = json['title'];
    final body = json['body'];
    if (id is! String || title is! String || body is! String) return null;

    final payload = json['payload'];
    String? bookingId;
    if (payload is Map) {
      final value = payload['booking_id'];
      if (value is String && value.isNotEmpty) bookingId = value;
    }

    return InAppNotification(
      id: id,
      type: json['type'] is String ? json['type'] as String : '',
      title: title,
      body: body,
      bookingId: bookingId,
      readAt: _stringOrNull(json['read_at']),
      createdAt: _stringOrNull(json['created_at']),
    );
  }
}

/// One page of the owner-scoped inbox (`{items, total, page, page_size}`).
class NotificationPage {
  const NotificationPage({
    required this.items,
    required this.total,
    required this.page,
    required this.pageSize,
  });

  final List<InAppNotification> items;
  final int total;
  final int page;
  final int pageSize;

  /// Drops rows the client cannot render instead of failing the whole page.
  static NotificationPage fromJson(Map<String, dynamic> json) {
    final raw = json['items'];
    final items = <InAppNotification>[];
    if (raw is List) {
      for (final item in raw) {
        if (item is! Map) continue;
        final parsed = InAppNotification.fromJson(item.cast<String, dynamic>());
        if (parsed != null) items.add(parsed);
      }
    }
    return NotificationPage(
      items: items,
      total: _intValue(json['total']),
      page: _intValue(json['page']),
      pageSize: _intValue(json['page_size']),
    );
  }
}

/// Notification endpoints shared by the center page and the unread badge, so
/// the query shape and the page parsing live in one place.
class NotificationInbox {
  const NotificationInbox(this.api);

  final ApiClient api;

  Future<NotificationPage> fetch({int page = 1, int pageSize = 50}) async {
    final raw = await api.get(
      '/notifications',
      query: {
        'page': '$page',
        'page_size': '$pageSize',
        'unread_only': 'false',
      },
    );
    if (raw is! Map) {
      throw const ApiException(
        code: 'INTERNAL_ERROR',
        message: 'Daftar notifikasi tidak bisa dibaca.',
      );
    }
    return NotificationPage.fromJson(raw.cast<String, dynamic>());
  }

  Future<int> unreadCount() async {
    final raw = await api.get('/notifications/unread-count');
    return raw is Map ? _intValue(raw['unread']) : 0;
  }

  Future<void> markRead(String id) async {
    await api.post('/notifications/${Uri.encodeComponent(id)}/read');
  }

  Future<int> markAllRead() async {
    final raw = await api.post('/notifications/read-all');
    return raw is Map ? _intValue(raw['updated']) : 0;
  }
}

String? _stringOrNull(dynamic value) {
  if (value is! String) return null;
  final text = value.trim();
  return text.isEmpty ? null : text;
}

int _intValue(dynamic value) {
  if (value is num) return value.toInt();
  return int.tryParse('$value') ?? 0;
}

/// Polls the owner-scoped inbox and reports only notifications that arrived
/// after the poller started. Delivery is in-app: no push/WhatsApp provider.
class NotificationPoller {
  NotificationPoller({
    required this.session,
    required this.api,
    required this.onNotification,
    this.interval = const Duration(seconds: 20),
  });

  final Session session;
  final ApiClient api;
  final void Function(InAppNotification notification) onNotification;
  final Duration interval;

  final Set<String> _seen = <String>{};
  Timer? _timer;
  bool _baselineDone = false;

  bool get running => _timer != null;

  void start() {
    if (_timer != null) return;
    _timer = Timer.periodic(interval, (_) => _poll());
    _poll();
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _poll() async {
    if (!session.authorized) return;
    try {
      final raw = await api.get(
        '/notifications',
        query: const {'unread_only': 'true', 'page_size': '10'},
      );
      final data = raw is Map && raw['data'] is Map ? raw['data'] as Map : raw;
      final items = data is Map && data['items'] is List
          ? data['items'] as List
          : const [];

      for (final item in items) {
        if (item is! Map) continue;
        final notification = InAppNotification.fromJson(
          item.cast<String, dynamic>(),
        );
        if (notification == null || _seen.contains(notification.id)) continue;
        _seen.add(notification.id);
        // First pass only records what was already waiting; the popup is for
        // notifications that arrive while the app is open.
        if (_baselineDone) onNotification(notification);
      }
      _baselineDone = true;
    } catch (_) {
      // Polling is best-effort: a failed tick must never disturb the UI.
    }
  }
}
