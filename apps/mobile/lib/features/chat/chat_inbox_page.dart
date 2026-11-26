import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';

/// Inbox of every booking thread the signed-in user has ever chatted in.
/// For a customer the counterpart is the vendor; for a vendor it is the customer.
class ChatInboxPage extends StatefulWidget {
  const ChatInboxPage({super.key});

  @override
  State<ChatInboxPage> createState() => _ChatInboxPageState();
}

class _ChatInboxPageState extends State<ChatInboxPage> {
  List<_ChatThread> _items = const [];
  bool _loading = true;
  String? _error;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final raw = await AppScope.of(context).api.get('/chats');
      final payload = raw is Map
          ? raw.cast<String, dynamic>()
          : const <String, dynamic>{};
      final items = payload['items'] is List
          ? (payload['items'] as List)
                .whereType<Map>()
                .map((item) => _ChatThread.fromJson(item.cast<String, dynamic>()))
                .toList()
          : <_ChatThread>[];
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.userMessage;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Chat tidak bisa dimuat. Periksa sinyal lalu coba lagi.';
      });
    }
  }

  Future<void> _openThread(_ChatThread thread) async {
    await Navigator.pushNamed(
      context,
      Routes.bookingChat,
      arguments: ChatArgs(
        bookingId: thread.bookingId,
        title: thread.counterpartName,
        subtitle: thread.bookingCode,
      ),
    );
    if (mounted) _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const StageHeader(
          title: 'Chat',
          subtitle: 'Semua vendor yang pernah kamu hubungi',
        ),
        Expanded(
          child: RefreshIndicator(
            color: AppColors.limeDark,
            onRefresh: () => _load(silent: true),
            child: _loading
                ? const AppLoading(rows: 4, label: 'Memuat chat')
                : _error != null
                ? AppError(message: _error!, onRetry: () => _load())
                : _items.isEmpty
                ? const AppEmpty(
                    icon: Icons.forum_outlined,
                    title: 'Belum ada chat',
                    message:
                        'Chat terbuka setelah booking dibuat. Semua percakapan '
                        'dengan vendor akan muncul di sini.',
                  )
                : ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(
                      Sp.lg,
                      Sp.md,
                      Sp.lg,
                      Sp.xl,
                    ),
                    itemCount: _items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: Sp.sm),
                    itemBuilder: (context, index) {
                      final thread = _items[index];
                      return _ChatThreadCard(
                        thread: thread,
                        onTap: () => _openThread(thread),
                      );
                    },
                  ),
          ),
        ),
      ],
    );
  }
}

class _ChatThread {
  const _ChatThread({
    required this.bookingId,
    required this.bookingCode,
    required this.counterpartName,
    required this.counterpartRole,
    required this.lastMessage,
    required this.lastAt,
    required this.unreadCount,
  });

  factory _ChatThread.fromJson(Map<String, dynamic> json) => _ChatThread(
    bookingId: '${json['booking_id'] ?? ''}',
    bookingCode: '${json['booking_code'] ?? ''}',
    counterpartName: '${json['counterpart_name'] ?? 'Vendor'}',
    counterpartRole: '${json['counterpart_role'] ?? 'vendor'}',
    lastMessage: '${json['last_message'] ?? ''}',
    lastAt: DateTime.tryParse('${json['last_at'] ?? ''}'),
    unreadCount: (json['unread_count'] as num?)?.toInt() ?? 0,
  );

  final String bookingId;
  final String bookingCode;
  final String counterpartName;
  final String counterpartRole;
  final String lastMessage;
  final DateTime? lastAt;
  final int unreadCount;
}

class _ChatThreadCard extends StatelessWidget {
  const _ChatThreadCard({required this.thread, required this.onTap});

  final _ChatThread thread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final unread = thread.unreadCount > 0;
    return Material(
      color: AppColors.card,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        side: BorderSide(color: AppColors.line),
      ),
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(Sp.md),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.stage,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  _initials(thread.counterpartName),
                  style: const TextStyle(
                    color: AppColors.lime,
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                  ),
                ),
              ),
              const SizedBox(width: Sp.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            thread.counterpartName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: text.titleMedium?.copyWith(
                              fontSize: 14,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(width: Sp.sm),
                        Text(
                          _timeLabel(thread.lastAt),
                          style: text.bodySmall?.copyWith(
                            fontSize: 10.5,
                            color: AppColors.inkMuted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            thread.lastMessage,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: text.bodySmall?.copyWith(
                              fontSize: 12,
                              color: unread
                                  ? AppColors.ink
                                  : AppColors.inkMuted,
                              fontWeight: unread
                                  ? FontWeight.w600
                                  : FontWeight.w400,
                            ),
                          ),
                        ),
                        if (unread) ...[
                          const SizedBox(width: Sp.sm),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 1,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.lime,
                              borderRadius: BorderRadius.circular(Radii.pill),
                            ),
                            child: Text(
                              thread.unreadCount > 9
                                  ? '9+'
                                  : '${thread.unreadCount}',
                              style: const TextStyle(
                                color: AppColors.onLime,
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    if (thread.bookingCode.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        thread.bookingCode,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.bodySmall?.copyWith(
                          fontSize: 10,
                          color: AppColors.muted2,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  String first(String value) =>
      value.substring(0, value.length >= 2 ? 2 : 1).toUpperCase();
  if (parts.length == 1) return first(parts.first);
  return '${parts.first.substring(0, 1)}${parts.last.substring(0, 1)}'
      .toUpperCase();
}

String _timeLabel(DateTime? timestamp) {
  if (timestamp == null) return '';
  final local = timestamp.toLocal();
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(local.year, local.month, local.day);
  final diff = today.difference(day).inDays;
  if (diff == 0) return formatTime(local);
  if (diff == 1) return 'Kemarin';
  return formatDayMonth(local);
}
