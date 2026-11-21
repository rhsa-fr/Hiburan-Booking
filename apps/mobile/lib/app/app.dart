import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api_client.dart';
import '../core/notifications.dart';
import '../core/push.dart';
import '../core/session.dart';
import 'routes.dart';
import 'theme.dart';

/// Session + API for every screen, without a state-management package.
class AppScope extends InheritedNotifier<Session> {
  const AppScope({
    super.key,
    required Session session,
    required this.api,
    this.push,
    required super.child,
  }) : super(notifier: session);

  final ApiClient api;

  /// Device-token owner: sign-out must drop the FCM row while the access token
  /// is still valid, otherwise the old account keeps receiving pushes. Null in
  /// widget tests that only exercise screens.
  final PushService? push;

  Session get session => notifier!;

  static AppScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope tidak ditemukan di atas widget ini.');
    return scope!;
  }
}

bool _isVendorOwner(Session session) =>
    session.user?.roles.contains('vendor_owner') == true;

class TarlinkApp extends StatefulWidget {
  const TarlinkApp({super.key, required this.session, required this.api});

  final Session session;
  final ApiClient api;

  @override
  State<TarlinkApp> createState() => _TarlinkAppState();
}

class _TarlinkAppState extends State<TarlinkApp> {
  final _navigatorKey = GlobalKey<NavigatorState>();
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();
  late final NotificationPoller _poller;
  late final PushService _push;

  /// Last popup shown, so a push and the poller do not print the same event
  /// twice inside one poll interval.
  String? _lastPopupKey;
  DateTime? _lastPopupAt;

  @override
  void initState() {
    super.initState();
    _poller = NotificationPoller(
      session: widget.session,
      api: widget.api,
      onNotification: _showPopup,
    );
    _push = PushService(onForeground: _showPushPopup);
    widget.session.addListener(_syncDelivery);
    _syncDelivery();
  }

  /// Deliver only while a session exists: stop polling, drop the device token,
  /// and stop routing pushes the moment the user signs out.
  void _syncDelivery() {
    if (widget.session.authorized) {
      _poller.start();
      unawaited(
        _push.start(
          session: widget.session,
          api: widget.api,
          onOpenBooking: _openBooking,
        ),
      );
    } else {
      _poller.stop();
      unawaited(_push.stop());
    }
  }

  void _openBooking(String bookingId) {
    final navigator = _navigatorKey.currentState;
    final route = _isVendorOwner(widget.session)
        ? Routes.vendorBookingDetail
        : Routes.bookingStatus;
    if (navigator != null) {
      navigator.pushNamed(route, arguments: bookingId);
      return;
    }
    // A tap on the launch notification can arrive before the first frame; retry
    // once instead of dropping the deep link.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _navigatorKey.currentState?.pushNamed(route, arguments: bookingId);
    });
  }

  /// Foreground push reuses the in-app popup, so one code path decides what a
  /// "Lihat" tap does.
  void _showPushPopup(String title, String body, String? bookingId) {
    _showPopup(
      InAppNotification(
        id: 'push',
        type: '',
        title: title,
        body: body,
        bookingId: bookingId,
      ),
    );
  }

  void _showPopup(InAppNotification notification) {
    final messenger = _messengerKey.currentState;
    if (messenger == null) return;
    final key = '${notification.title}|${notification.body}';
    final now = DateTime.now();
    final last = _lastPopupAt;
    if (key == _lastPopupKey &&
        last != null &&
        now.difference(last) < const Duration(seconds: 25)) {
      return;
    }
    _lastPopupKey = key;
    _lastPopupAt = now;
    final bookingId = notification.bookingId;
    messenger.showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 6),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              notification.title,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 2),
            Text(notification.body),
          ],
        ),
        action: bookingId == null
            ? null
            : SnackBarAction(
                label: 'Lihat',
                onPressed: () {
                  messenger.hideCurrentSnackBar();
                  _openBooking(bookingId);
                },
              ),
      ),
    );
  }

  @override
  void dispose() {
    widget.session.removeListener(_syncDelivery);
    _poller.stop();
    unawaited(_push.stop());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      session: widget.session,
      api: widget.api,
      push: _push,
      child: MaterialApp(
        title: 'Tarlink',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        navigatorKey: _navigatorKey,
        scaffoldMessengerKey: _messengerKey,
        initialRoute: widget.session.authorized
            ? (_isVendorOwner(widget.session) ? Routes.vendorHome : Routes.home)
            : Routes.welcome,
        onGenerateRoute: Routes.onGenerateRoute,
      ),
    );
  }
}

/// Four-tab shell. The [IndexedStack] keeps each visited tab alive, so
/// scroll position and loaded data survive switching. No FAB, no badges.
class AppShell extends StatelessWidget {
  const AppShell({
    super.key,
    required this.index,
    required this.onDestinationSelected,
    required this.children,
  });

  final int index;
  final ValueChanged<int> onDestinationSelected;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        body: IndexedStack(
          index: index,
          sizing: StackFit.expand,
          children: children,
        ),
        bottomNavigationBar: _CustomerTabBar(
          index: index,
          onSelected: onDestinationSelected,
        ),
      ),
    );
  }
}

/// OpenDesign bottom navigation: white bar with a lime active marker,
/// ink icons, and a quiet muted label.
class _CustomerTabBar extends StatelessWidget {
  const _CustomerTabBar({required this.index, required this.onSelected});

  final int index;
  final ValueChanged<int> onSelected;

  static const _items = <({IconData icon, IconData active, String label})>[
    (icon: Icons.home_outlined, active: Icons.home, label: 'Beranda'),
    (icon: Icons.explore_outlined, active: Icons.explore, label: 'Jelajah'),
    (
      icon: Icons.receipt_long_outlined,
      active: Icons.receipt_long,
      label: 'Booking',
    ),
    (icon: Icons.person_outline, active: Icons.person, label: 'Profil'),
  ];

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Sp.md, 6, Sp.md, Sp.sm),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(18),
            boxShadow: const [
              BoxShadow(
                color: Color(0x140B1220),
                blurRadius: 18,
                offset: Offset(0, 6),
              ),
            ],
          ),
          child: SizedBox(
            height: 58,
            child: Row(
              children: [
                for (var i = 0; i < _items.length; i++)
                  Expanded(
                    child: _CustomerTabItem(
                      item: _items[i],
                      selected: i == index,
                      onTap: () => onSelected(i),
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

class _CustomerTabItem extends StatelessWidget {
  const _CustomerTabItem({
    required this.item,
    required this.selected,
    required this.onTap,
  });

  final ({IconData icon, IconData active, String label}) item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.ink : AppColors.muted2;
    return InkWell(
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 5),
            decoration: BoxDecoration(
              color: selected ? AppColors.lime : Colors.transparent,
              borderRadius: BorderRadius.circular(Radii.pill),
            ),
            child: Icon(
              selected ? item.active : item.icon,
              size: 19,
              color: color,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            item.label,
            style: TextStyle(
              fontSize: 10.5,
              height: 1.2,
              letterSpacing: 0.1,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

/// White search field that sits on the stage header: 48 dp high, radius 12.
/// Shared by Beranda and Jelajah so the two search entry points match.
class StageSearchField extends StatelessWidget {
  const StageSearchField({
    super.key,
    required this.controller,
    required this.hint,
    required this.onSubmitted,
    this.onClear,
  });

  final TextEditingController controller;
  final String hint;
  final ValueChanged<String> onSubmitted;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, _) {
        return SizedBox(
          height: 52,
          child: TextField(
            controller: controller,
            textInputAction: TextInputAction.search,
            onSubmitted: onSubmitted,
            style: Theme.of(context).textTheme.bodyMedium,
            decoration: InputDecoration(
              hintText: hint,
              isDense: true,
              filled: true,
              fillColor: AppColors.card,
              prefixIcon: const Icon(
                Icons.search,
                size: 20,
                color: AppColors.inkMuted,
              ),
              prefixIconConstraints: const BoxConstraints(
                minWidth: 44,
                minHeight: 52,
              ),
              suffixIcon: value.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Hapus pencarian',
                      onPressed: () {
                        controller.clear();
                        onClear?.call();
                      },
                      icon: const Icon(Icons.close, size: 18),
                      color: AppColors.inkMuted,
                      constraints: const BoxConstraints(
                        minWidth: 44,
                        minHeight: 48,
                      ),
                    ),
              contentPadding: const EdgeInsets.symmetric(vertical: Sp.md),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(Radii.xl),
                borderSide: const BorderSide(color: AppColors.line),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(Radii.xl),
                borderSide: const BorderSide(color: AppColors.line),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(Radii.xl),
                borderSide: const BorderSide(
                  color: AppColors.primary,
                  width: 2,
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
