import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/notifications.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';
import '../booking/booking_support.dart';

/// Anchor for the unread marker, so a test (and the eye) can tell unread from
/// read rows without depending on colour values.
const notificationUnreadDotKey = Key('notification-unread-dot');

/// In-app notification center: the poller and push only surface a popup, this
/// page is where the history lives and where a booking can be reopened.
class NotificationCenterPage extends StatefulWidget {
  const NotificationCenterPage({super.key, this.now});

  /// Injectable clock for deterministic relative timestamps in tests.
  final DateTime Function()? now;

  @override
  State<NotificationCenterPage> createState() => _NotificationCenterPageState();
}

class _NotificationCenterPageState extends State<NotificationCenterPage> {
  List<InAppNotification> _items = const [];
  int _total = 0;
  int _page = 1;
  bool _loading = true;
  bool _loadingMore = false;
  bool _markingAll = false;
  String? _error;
  bool _started = false;

  DateTime get _now => widget.now?.call() ?? DateTime.now();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _load();
  }

  Future<void> _load({bool fromRefresh = false}) async {
    final api = AppScope.of(context).api;
    if (!fromRefresh) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final page = await NotificationInbox(api).fetch();
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _total = page.total;
        _page = page.page <= 0 ? 1 : page.page;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      _fail(apiMessage(error), keepList: fromRefresh && _items.isNotEmpty);
    } catch (_) {
      if (!mounted) return;
      _fail(
        'Notifikasi tidak bisa dimuat. Periksa sinyal, lalu coba lagi.',
        keepList: fromRefresh && _items.isNotEmpty,
      );
    }
  }

  /// A failed refresh keeps the rows already on screen; only an empty page has
  /// room for the full error state.
  void _fail(String message, {required bool keepList}) {
    if (keepList) {
      _showMessage(message);
      setState(() => _loading = false);
      return;
    }
    setState(() {
      _loading = false;
      _error = message;
    });
  }

  Future<void> _loadMore() async {
    if (_loadingMore) return;
    final api = AppScope.of(context).api;
    final nextPage = _page + 1;
    setState(() => _loadingMore = true);
    try {
      final page = await NotificationInbox(api).fetch(page: nextPage);
      if (!mounted) return;
      final known = _items.map((item) => item.id).toSet();
      setState(() {
        _page = page.page <= 0 ? nextPage : page.page;
        _total = page.total;
        _items = [
          ..._items,
          ...page.items.where((item) => !known.contains(item.id)),
        ];
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
      _showMessage('Halaman berikutnya belum bisa dimuat. Coba lagi.');
    }
  }

  Future<void> _markAllRead() async {
    if (_markingAll || !_items.any((item) => item.unread)) return;
    final api = AppScope.of(context).api;
    setState(() => _markingAll = true);
    try {
      await NotificationInbox(api).markAllRead();
      if (!mounted) return;
      final at = _now;
      setState(() {
        _items = [
          for (final item in _items) item.unread ? item.markRead(at) : item,
        ];
        _markingAll = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _markingAll = false);
      _showMessage(
        error is ApiException
            ? apiMessage(error)
            : 'Notifikasi belum bisa ditandai. Coba lagi.',
      );
    }
  }

  /// Marking as read is optimistic: the row goes muted immediately, and a
  /// failed request only means the badge will show it again later.
  void _open(InAppNotification item) {
    final bookingId = item.bookingId;
    final session = AppScope.of(context).session;
    if (item.unread) {
      final at = _now;
      setState(() {
        _items = [
          for (final row in _items) row.id == item.id ? row.markRead(at) : row,
        ];
      });
      unawaited(_markReadRemote(item.id));
    }
    if (bookingId == null) return;
    final vendor = session.user?.roles.contains('vendor_owner') == true;
    Navigator.pushNamed(
      context,
      vendor ? Routes.vendorBookingDetail : Routes.bookingStatus,
      arguments: bookingId,
    );
  }

  Future<void> _markReadRemote(String id) async {
    final api = AppScope.of(context).api;
    try {
      await NotificationInbox(api).markRead(id);
    } catch (_) {
      // The list already rendered the new state; a failed read flag is not
      // worth a modal over the tap that opened this page.
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final hasUnread = _items.any((item) => item.unread);
    return Scaffold(
      body: Column(
        children: [
          StageHeader.back(
            context: context,
            title: 'Notifikasi',
            trailing: _MarkAllButton(
              enabled: !_loading && hasUnread && !_markingAll,
              busy: _markingAll,
              onPressed: _markAllRead,
            ),
          ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading && _items.isEmpty) {
      return const Padding(
        padding: EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, 0),
        child: AppLoading(rows: 4, label: 'Memuat notifikasi'),
      );
    }
    final error = _error;
    if (error != null && _items.isEmpty) {
      return AppError(message: error, onRetry: _load);
    }
    if (_items.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => _load(fromRefresh: true),
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: const AppEmpty(
                title: 'Belum ada notifikasi',
                message:
                    'Pemberitahuan booking, pembayaran, dan laporan akan '
                    'muncul di sini.',
                icon: Icons.notifications_none_rounded,
              ),
            ),
          ),
        ),
      );
    }

    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;
    final now = _now;
    final showMore = _total > _items.length;
    return RefreshIndicator(
      onRefresh: () => _load(fromRefresh: true),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, Sp.xl + bottomInset),
        children: [
          for (final item in _items)
            Padding(
              padding: const EdgeInsets.only(bottom: Sp.sm),
              child: _NotificationRow(
                item: item,
                timeLabel: _relativeTime(item.createdAt, now),
                onTap: () => _open(item),
              ),
            ),
          if (showMore) ...[
            const SizedBox(height: Sp.sm),
            OutlinedButton(
              onPressed: _loadingMore ? null : _loadMore,
              child: _loadingMore
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Muat lebih banyak'),
            ),
          ],
        ],
      ),
    );
  }
}

/// Header action. Disabled while the page is loading or nothing is unread, so
/// the button never promises a change it cannot make.
class _MarkAllButton extends StatelessWidget {
  const _MarkAllButton({
    required this.enabled,
    required this.busy,
    required this.onPressed,
  });

  final bool enabled;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final color = enabled
        ? AppColors.lime
        : Colors.white.withValues(alpha: 0.45);
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 148),
      child: TextButton(
        onPressed: enabled ? onPressed : null,
        style: TextButton.styleFrom(
          foregroundColor: AppColors.lime,
          disabledForegroundColor: color,
          minimumSize: const Size(0, 44),
          padding: const EdgeInsets.symmetric(horizontal: Sp.sm),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          textStyle: const TextStyle(
            fontSize: 11.5,
            height: 1.2,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.1,
          ),
        ),
        child: busy
            ? SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2, color: color),
              )
            : Text(
                'Tandai semua dibaca',
                textAlign: TextAlign.end,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: color),
              ),
      ),
    );
  }
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow({
    required this.item,
    required this.timeLabel,
    required this.onTap,
  });

  final InAppNotification item;
  final String timeLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final unread = item.unread;
    final family = _familyOf(item.type);
    final radius = BorderRadius.circular(Radii.lg);
    return Semantics(
      button: true,
      label: unread ? '${item.title}. Belum dibaca' : item.title,
      child: Material(
        color: AppColors.card,
        borderRadius: radius,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(Sp.md),
            decoration: BoxDecoration(
              borderRadius: radius,
              border: Border.all(
                color: unread ? AppColors.lineStrong : AppColors.line,
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: family.background,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(family.icon, size: 18, color: family.foreground),
                ),
                const SizedBox(width: Sp.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              item.title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 13.5,
                                height: 1.3,
                                fontWeight: unread
                                    ? FontWeight.w800
                                    : FontWeight.w600,
                                color: unread
                                    ? AppColors.ink
                                    : AppColors.inkMuted,
                              ),
                            ),
                          ),
                          if (unread) ...[
                            const SizedBox(width: Sp.sm),
                            Container(
                              key: notificationUnreadDotKey,
                              width: 8,
                              height: 8,
                              margin: const EdgeInsets.only(top: 4),
                              decoration: BoxDecoration(
                                color: AppColors.lime,
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: AppColors.limeDark,
                                  width: 1,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        item.body,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12.5,
                          height: 1.45,
                          color: unread
                              ? AppColors.ink.withValues(alpha: 0.72)
                              : AppColors.muted2,
                        ),
                      ),
                      if (timeLabel.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Icon(
                              Icons.schedule,
                              size: 12,
                              color: AppColors.muted2,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              timeLabel,
                              style: TextStyle(
                                fontSize: 11,
                                height: 1.2,
                                fontWeight: FontWeight.w500,
                                color: AppColors.inkMuted,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Icon family per notification type, using only existing theme colours.
({IconData icon, Color background, Color foreground}) _familyOf(String type) {
  final value = type.toLowerCase();
  if (value.startsWith('booking')) {
    return (
      icon: Icons.confirmation_number_outlined,
      background: AppColors.limeSoft,
      foreground: AppColors.ink,
    );
  }
  if (value.startsWith('payment')) {
    return (
      icon: Icons.payments_outlined,
      background: AppColors.accentSoft,
      foreground: AppColors.accent,
    );
  }
  if (value.startsWith('content_report') || value.contains('report')) {
    return (
      icon: Icons.flag_outlined,
      background: AppColors.warningSoft,
      foreground: AppColors.warning,
    );
  }
  return (
    icon: Icons.notifications_none_rounded,
    background: AppColors.surfaceSoft,
    foreground: AppColors.inkMuted,
  );
}

/// Short age label for the row; older than a week falls back to the date so the
/// list never reads "12 hari lalu" on a month-old notice.
String _relativeTime(String? iso, DateTime now) {
  if (iso == null || iso.isEmpty) return '';
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) return formatDateIso(iso);
  final local = parsed.toLocal();
  final age = now.difference(local);
  if (age.isNegative || age.inMinutes < 1) return 'Baru saja';
  if (age.inMinutes < 60) return '${age.inMinutes} mnt lalu';
  if (age.inHours < 24) return '${age.inHours} jam lalu';
  if (age.inDays < 7) return '${age.inDays} hari lalu';
  return formatDate(local);
}
