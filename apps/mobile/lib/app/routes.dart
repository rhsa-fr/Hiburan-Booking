import 'package:flutter/material.dart';

import '../features/auth/login_page.dart';
import '../features/auth/register_page.dart';
import '../features/auth/welcome_page.dart';
import '../features/booking/create_page.dart';
import '../features/booking/list_page.dart';
import '../features/booking/status_page.dart';
import '../features/discovery/home_page.dart';
import '../features/discovery/vendor_page.dart';
import '../features/vendor/vendor_booking_detail_page.dart';
import '../features/vendor/vendor_bookings_page.dart';
import '../features/vendor/vendor_manage_packages_page.dart';
import '../features/vendor/vendor_manage_profile_page.dart';
import '../features/vendor/vendor_shell.dart';

/// Arguments for `bookCreate`: the chosen vendor and package.
class BookCreateArgs {
  const BookCreateArgs({required this.vendorIdOrSlug, required this.packageId});

  final String vendorIdOrSlug;
  final String packageId;
}

abstract final class Routes {
  static const welcome = 'welcome';
  static const login = 'login';
  static const register = 'register';
  static const home = 'home';
  static const vendor = 'vendor';
  static const bookCreate = 'bookCreate';
  static const bookings = 'bookings';
  static const bookingStatus = 'bookingStatus';
  static const vendorHome = 'vendorHome';
  static const vendorBookingDetail = 'vendorBookingDetail';
  static const vendorBookings = 'vendorBookings';
  static const vendorManageProfile = 'vendorManageProfile';
  static const vendorManagePackages = 'vendorManagePackages';

  static Route<dynamic> onGenerateRoute(RouteSettings settings) {
    switch (settings.name) {
      case Routes.welcome:
        return _page(const WelcomePage(), settings);
      case Routes.login:
        return _page(const LoginPage(), settings);
      case Routes.register:
        return _page(const RegisterPage(), settings);
      case Routes.home:
        return _page(const HomePage(), settings);
      case Routes.vendor:
        final arg = settings.arguments;
        if (arg is String && arg.isNotEmpty) {
          return _page(VendorPage(idOrSlug: arg), settings);
        }
        return _page(const LoginPage(), settings);
      case Routes.bookCreate:
        final arg = settings.arguments;
        if (arg is BookCreateArgs) {
          return _page(CreateBookingPage(args: arg), settings);
        }
        return _page(const LoginPage(), settings);
      case Routes.bookings:
        return _page(const BookingListPage(), settings);
      case Routes.bookingStatus:
        final arg = settings.arguments;
        if (arg is String && arg.isNotEmpty) {
          return _page(BookingStatusPage(bookingId: arg), settings);
        }
        return _page(const LoginPage(), settings);
      case Routes.vendorHome:
        return _page(const VendorShell(), settings);
      case Routes.vendorBookingDetail:
        final arg = settings.arguments;
        if (arg is String && arg.isNotEmpty) {
          return _page(VendorBookingDetailPage(bookingId: arg), settings);
        }
        return _page(const VendorShell(), settings);
      case Routes.vendorBookings:
        return _page(const VendorBookingsPage(), settings);
      case Routes.vendorManageProfile:
        return _page(const VendorManageProfilePage(), settings);
      case Routes.vendorManagePackages:
        return _page(const VendorManagePackagesPage(), settings);
    }
    return _page(const LoginPage(), settings);
  }

  static MaterialPageRoute<dynamic> _page(
    Widget page,
    RouteSettings settings,
  ) => MaterialPageRoute<dynamic>(builder: (_) => page, settings: settings);
}
