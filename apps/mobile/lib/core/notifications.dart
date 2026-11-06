import 'dart:async';

import 'api_client.dart';
import 'session.dart';

/// One in-app notification row from `GET /v1/notifications`.
class InAppNotification {
  const InAppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    this.bookingId,
  });

  final String id;
  final String type;
  final String title;
  final String body;
  final String? bookingId;

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
    );
  }
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
