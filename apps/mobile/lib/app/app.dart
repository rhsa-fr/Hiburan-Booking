import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api_client.dart';
import '../core/session.dart';
import 'routes.dart';
import 'theme.dart';

/// Session + API for every screen, without a state-management package.
class AppScope extends InheritedNotifier<Session> {
  const AppScope({
    super.key,
    required Session session,
    required this.api,
    required super.child,
  }) : super(notifier: session);

  final ApiClient api;

  Session get session => notifier!;

  static AppScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope tidak ditemukan di atas widget ini.');
    return scope!;
  }
}

bool _isVendorOwner(Session session) =>
    session.user?.roles.contains('vendor_owner') == true;

class TarlinkApp extends StatelessWidget {
  const TarlinkApp({super.key, required this.session, required this.api});

  final Session session;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      session: session,
      api: api,
      child: MaterialApp(
        title: 'Tarlink',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        initialRoute: session.authorized
            ? (_isVendorOwner(session) ? Routes.vendorHome : Routes.home)
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
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.card,
        border: Border(top: BorderSide(color: AppColors.line)),
      ),
      child: SafeArea(
        top: false,
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
            duration: const Duration(milliseconds: 160),
            height: 2,
            width: selected ? 22 : 0,
            color: AppColors.limeDark,
          ),
          const SizedBox(height: 6),
          Icon(selected ? item.active : item.icon, size: 20, color: color),
          const SizedBox(height: 2),
          Text(
            item.label,
            style: TextStyle(
              fontSize: 11,
              height: 1.2,
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
                borderRadius: BorderRadius.circular(Radii.sm),
                borderSide: const BorderSide(color: AppColors.line),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(Radii.sm),
                borderSide: const BorderSide(color: AppColors.line),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(Radii.sm),
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
