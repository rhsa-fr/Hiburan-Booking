import 'package:flutter/material.dart';

import '../features/auth/login_page.dart';
import '../features/auth/register_page.dart';
import '../features/booking/create_page.dart';
import '../features/booking/list_page.dart';
import '../features/booking/status_page.dart';
import '../features/discovery/home_page.dart';
import '../features/discovery/vendor_page.dart';

/// Arguments for `bookCreate`: the chosen vendor and package.
class BookCreateArgs {
  const BookCreateArgs({required this.vendorIdOrSlug, required this.packageId});

  final String vendorIdOrSlug;
  final String packageId;
}

abstract final class Routes {
  static const login = 'login';
  static const register = 'register';
  static const home = 'home';
  static const vendor = 'vendor';
  static const bookCreate = 'bookCreate';
  static const bookings = 'bookings';
  static const bookingStatus = 'bookingStatus';

  static Route<dynamic> onGenerateRoute(RouteSettings settings) {
    switch (settings.name) {
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
    }
    return _page(const LoginPage(), settings);
  }

  static MaterialPageRoute<dynamic> _page(Widget page, RouteSettings settings) =>
      MaterialPageRoute<dynamic>(builder: (_) => page, settings: settings);
}
