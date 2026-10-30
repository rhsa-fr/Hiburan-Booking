import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/routes.dart';
import 'vendor_calendar_page.dart';
import 'vendor_dashboard_page.dart';
import 'vendor_earnings_page.dart';
import 'vendor_profile_page.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// 4-tab shell for vendor owners, styled after the OpenDesign vendor board.
class VendorShell extends StatefulWidget {
  const VendorShell({super.key});

  @override
  State<VendorShell> createState() => _VendorShellState();
}

class _VendorShellState extends State<VendorShell> {
  static const _dashboard = 0;
  static const _calendar = 1;
  static const _earnings = 2;
  static const _profile = 3;

  int _tab = _dashboard;
  final _visited = <int>{_dashboard};

  void _selectTab(int index) {
    if (index == _tab) return;
    setState(() {
      _tab = index;
      _visited.add(index);
    });
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: VendorColors.canvas,
        body: IndexedStack(
          index: _tab,
          sizing: StackFit.expand,
          children: [
            VendorDashboardPage(
              onOpenBookings: () =>
                  Navigator.pushNamed(context, Routes.vendorBookings),
              onOpenEarnings: () => _selectTab(_earnings),
            ),
            if (_visited.contains(_calendar))
              const VendorCalendarPage()
            else
              const SizedBox.shrink(),
            if (_visited.contains(_earnings))
              const VendorEarningsPage()
            else
              const SizedBox.shrink(),
            if (_visited.contains(_profile))
              VendorProfilePage(onOpenCalendar: () => _selectTab(_calendar))
            else
              const SizedBox.shrink(),
          ],
        ),
        bottomNavigationBar: VendorBottomNav(
          index: _tab,
          onSelected: _selectTab,
        ),
      ),
    );
  }
}
