import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/notifications.dart';

/// Bell for the dark stage header. Polls `/notifications/unread-count` every
/// 30 s while mounted and caps the count at "9+" so the dot never grows.
class NotificationBell extends StatefulWidget {
  const NotificationBell({super.key});

  static const Duration interval = Duration(seconds: 30);

  @override
  State<NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends State<NotificationBell> {
  Timer? _timer;
  int _unread = 0;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _timer = Timer.periodic(NotificationBell.interval, (_) => _poll());
    _poll();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _timer = null;
    super.dispose();
  }

  Future<void> _poll() async {
    if (!mounted) return;
    final scope = AppScope.of(context);
    if (!scope.session.authorized) return;
    try {
      final unread = await NotificationInbox(scope.api).unreadCount();
      if (!mounted || unread == _unread) return;
      setState(() => _unread = unread);
    } catch (_) {
      // Badge polling is best effort: a stale count beats a broken header.
    }
  }

  Future<void> _openCenter() async {
    await Navigator.pushNamed(context, Routes.notifications);
    if (!mounted) return;
    // The center can mark rows read, so re-read the count on the way back.
    await _poll();
  }

  @override
  Widget build(BuildContext context) {
    final count = _unread;
    final label = count > 9 ? '9+' : '$count';
    return Semantics(
      button: true,
      label: count == 0
          ? 'Buka notifikasi'
          : 'Buka notifikasi, $count belum dibaca',
      child: SizedBox(
        width: 44,
        height: 44,
        child: Stack(
          alignment: Alignment.center,
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.14),
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white.withValues(alpha: 0.22)),
              ),
              child: const Center(
                child: Icon(
                  Icons.notifications_none_rounded,
                  size: 19,
                  color: AppColors.onPrimary,
                ),
              ),
            ),
            Positioned.fill(
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: _openCenter,
                ),
              ),
            ),
            if (count > 0)
              Positioned(
                top: 0,
                right: 0,
                child: Container(
                  constraints: const BoxConstraints(minWidth: 18),
                  height: 18,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.lime,
                    borderRadius: BorderRadius.circular(Radii.pill),
                    border: Border.all(color: AppColors.primary, width: 1.5),
                  ),
                  child: Text(
                    label,
                    style: const TextStyle(
                      fontSize: 10,
                      height: 1,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
