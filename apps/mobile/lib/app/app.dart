import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

import '../core/api_client.dart';
import '../core/notifications.dart';
import '../core/push.dart';
import '../core/session.dart';
import '../features/update/app_update_channel.dart';
import '../features/update/app_update_models.dart';
import '../features/update/app_update_service.dart';
import '../features/update/update_dialog.dart';
import 'routes.dart';
import 'theme.dart';
import 'theme_controller.dart';

/// Session + API for every screen, without a state-management package.
class AppScope extends InheritedNotifier<Session> {
  const AppScope({
    super.key,
    required Session session,
    required this.api,
    this.push,
    this.update,
    required super.child,
  }) : super(notifier: session);

  final ApiClient api;

  /// Device-token owner: sign-out must drop the FCM row while the access token
  /// is still valid, otherwise the old account keeps receiving pushes. Null in
  /// widget tests that only exercise screens.
  final PushService? push;

  /// In-app APK update. Null on web, iOS, widget tests, and builds without
  /// `APP_UPDATE_MANIFEST_URL`, which keeps every channel call off.
  final AppUpdateService? update;

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

class _TarlinkAppState extends State<TarlinkApp> with WidgetsBindingObserver {
  final _navigatorKey = GlobalKey<NavigatorState>();
  final _messengerKey = GlobalKey<ScaffoldMessengerState>();
  late final NotificationPoller _poller;
  late final PushService _push;
  late final ThemeController _theme;

  /// Update check plumbing. All of it stays null unless the build is Android
  /// and carries a manifest URL, so widget tests never open a socket or a
  /// platform channel.
  AppUpdateService? _updateService;
  http.Client? _updateClient;
  DateTime? _lastUpdateCheck;
  bool _updateCheckRunning = false;
  bool _updateDialogOpen = false;

  /// A foreground return re-checks at most this often: the manifest is static
  /// and a re-check on every resume would just burn data.
  static const _updateRecheckInterval = Duration(hours: 6);

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
    _theme = ThemeController()..addListener(_onThemeChanged);
    unawaited(_theme.restore());
    widget.session.addListener(_syncDelivery);
    _syncDelivery();

    if (_updateSupported) {
      _updateClient = http.Client();
      _updateService = AppUpdateService(
        client: _updateClient!,
        channel: MethodChannelAppUpdateChannel(),
        manifestUrl: appUpdateManifestUrl,
      );
      WidgetsBinding.instance.addObserver(this);
      // After the first frame: a slow manifest must never delay startup.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        unawaited(_checkForUpdate());
      });
    }
  }

  /// Android only. `defaultTargetPlatform` keeps `dart:io` out of the web
  /// bundle, which is why the check is not spelled `Platform.isAndroid`.
  static bool get _updateSupported =>
      !kIsWeb &&
      defaultTargetPlatform == TargetPlatform.android &&
      appUpdateManifestUrl.trim().isNotEmpty;

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

  void _onThemeChanged() {
    if (mounted) setState(() {});
  }

  void _openBooking(String bookingId) {    final navigator = _navigatorKey.currentState;
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

  /// One silent check, or one manual check triggered from the account tab.
  /// Errors stay quiet unless the user asked for the check themselves.
  Future<void> _checkForUpdate({bool manual = false}) async {
    final service = _updateService;
    final context = _navigatorKey.currentContext;
    if (service == null || context == null) return;
    if (_updateCheckRunning || _updateDialogOpen) return;

    _updateCheckRunning = true;
    _updateDialogOpen = true;
    try {
      final outcome = await runAppUpdateCheck(
        context,
        service: service,
        manual: manual,
      );
      if (manual && outcome == AppUpdateCheckOutcome.noUpdate) {
        _messengerKey.currentState?.showSnackBar(
          const SnackBar(content: Text('Tarlink sudah versi terbaru.')),
        );
      }
    } on AppUpdateException catch (error) {
      if (manual) {
        _messengerKey.currentState?.showSnackBar(
          SnackBar(content: Text(error.message)),
        );
      }
    } catch (_) {
      if (manual) {
        _messengerKey.currentState?.showSnackBar(
          const SnackBar(content: Text('Pemeriksaan pembaruan gagal.')),
        );
      }
    } finally {
      _lastUpdateCheck = DateTime.now();
      _updateCheckRunning = false;
      _updateDialogOpen = false;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    unawaited(_resumeUpdate());
  }

  /// A permission flow leaves a verified APK behind: install it instead of
  /// asking again. Otherwise re-check, but only after the cooldown.
  Future<void> _resumeUpdate() async {
    final service = _updateService;
    if (service == null) return;
    if (_updateDialogOpen) return;

    if (service.hasPendingInstall) {
      await service.installPending();
      _lastUpdateCheck = DateTime.now();
      return;
    }

    final last = _lastUpdateCheck;
    if (last != null &&
        DateTime.now().difference(last) < _updateRecheckInterval) {
      return;
    }
    await _checkForUpdate();
  }

  @override
  void dispose() {
    widget.session.removeListener(_syncDelivery);
    _theme
      ..removeListener(_onThemeChanged)
      ..dispose();
    if (_updateService != null) WidgetsBinding.instance.removeObserver(this);
    _updateClient?.close();
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
      update: _updateService,
      child: ThemeScope(
        controller: _theme,
        child: MaterialApp(
          title: 'Tarlink',
          debugShowCheckedModeBanner: false,
          theme: buildTheme(brightness: Brightness.light),
          darkTheme: buildTheme(brightness: Brightness.dark),
          themeMode: _theme.mode,
          navigatorKey: _navigatorKey,
          scaffoldMessengerKey: _messengerKey,
          initialRoute: widget.session.authorized
              ? (_isVendorOwner(widget.session) ? Routes.vendorHome : Routes.home)
              : Routes.welcome,
          onGenerateRoute: Routes.onGenerateRoute,
        ),
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
      value: AppColors.isDark
          ? SystemUiOverlayStyle.light
          : SystemUiOverlayStyle.dark,
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
    final iconColor = selected ? AppColors.onLime : AppColors.muted2;
    final labelColor = selected ? AppColors.ink : AppColors.muted2;
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
              color: iconColor,
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
              color: labelColor,
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
              prefixIcon: Icon(
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
                borderSide: BorderSide(color: AppColors.line),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(Radii.xl),
                borderSide: BorderSide(color: AppColors.line),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(Radii.xl),
                borderSide: const BorderSide(
                  color: AppColors.limeDark,
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
