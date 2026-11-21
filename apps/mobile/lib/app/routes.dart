import 'package:flutter/material.dart';

import '../features/auth/email_otp_page.dart';
import '../features/auth/forgot_password_page.dart';
import '../features/auth/login_page.dart';
import '../features/auth/register_page.dart';
import '../features/auth/reset_password_page.dart';
import '../features/auth/welcome_page.dart';
import '../features/booking/create_page.dart';
import '../features/booking/list_page.dart';
import '../features/booking/status_page.dart';
import '../features/chat/chat_page.dart';
import '../features/discovery/favorites_page.dart';
import '../features/discovery/home_page.dart';
import '../features/discovery/vendor_page.dart';
import '../features/moderation/appeals_page.dart';
import '../features/notifications/notification_center_page.dart';
import '../features/vendor/vendor_bank_account_page.dart';
import '../features/vendor/vendor_booking_detail_page.dart';
import '../features/vendor/vendor_bookings_page.dart';
import '../features/vendor/vendor_manage_packages_page.dart';
import '../features/vendor/vendor_manage_profile_page.dart';
import '../features/vendor/vendor_shell.dart';

/// Arguments for `bookCreate`: the chosen vendor, package, and date.
/// The date is chosen on the vendor page and carried into checkout so the
/// customer never has to pick it twice.
class BookCreateArgs {
  const BookCreateArgs({
    required this.vendorIdOrSlug,
    required this.packageId,
    this.date,
  });

  final String vendorIdOrSlug;
  final String packageId;
  final String? date;
}

/// Arguments for `bookingChat`: one thread per booking, with a display title.
class ChatArgs {
  const ChatArgs({required this.bookingId, required this.title, this.subtitle});

  final String bookingId;
  final String title;
  final String? subtitle;
}

/// Arguments for `emailOtp`: the address the code went to, which flow owns it,
/// and the server's dev code when a development server returned one.
class EmailOtpArgs {
  const EmailOtpArgs({required this.email, required this.mode, this.devCode});

  final String email;
  final EmailOtpMode mode;
  final String? devCode;
}

/// Arguments for `resetPassword`: carried from the code screen so the new
/// password can be stored against the right account.
class ResetPasswordArgs {
  const ResetPasswordArgs({required this.email, required this.token});

  final String email;
  final String token;
}

abstract final class Routes {
  static const welcome = 'welcome';
  static const login = 'login';
  static const register = 'register';
  static const emailOtp = 'emailOtp';
  static const forgotPassword = 'forgotPassword';
  static const resetPassword = 'resetPassword';
  static const home = 'home';
  static const vendor = 'vendor';
  static const bookCreate = 'bookCreate';
  static const bookings = 'bookings';
  static const bookingStatus = 'bookingStatus';
  static const bookingChat = 'bookingChat';
  static const vendorHome = 'vendorHome';
  static const vendorBookingDetail = 'vendorBookingDetail';
  static const vendorBookings = 'vendorBookings';
  static const vendorManageProfile = 'vendorManageProfile';
  static const vendorManagePackages = 'vendorManagePackages';
  static const vendorBankAccount = 'vendorBankAccount';
  static const favorites = 'favorites';
  static const appeals = 'appeals';
  static const notifications = 'notifications';

  static Route<dynamic> onGenerateRoute(RouteSettings settings) {
    switch (settings.name) {
      case Routes.welcome:
        return _page(const WelcomePage(), settings);
      case Routes.login:
        final arg = settings.arguments;
        return _page(
          LoginPage(
            initialEmail: arg is String && arg.isNotEmpty ? arg : null,
          ),
          settings,
        );
      case Routes.register:
        return _page(const RegisterPage(), settings);
      case Routes.emailOtp:
        final arg = settings.arguments;
        if (arg is EmailOtpArgs && arg.email.isNotEmpty) {
          return _page(
            EmailOtpPage(
              email: arg.email,
              mode: arg.mode,
              devCode: arg.devCode,
            ),
            settings,
          );
        }
        return _page(const LoginPage(), settings);
      case Routes.forgotPassword:
        final arg = settings.arguments;
        return _page(
          ForgotPasswordPage(
            initialEmail: arg is String && arg.isNotEmpty ? arg : null,
          ),
          settings,
        );
      case Routes.resetPassword:
        final arg = settings.arguments;
        if (arg is ResetPasswordArgs && arg.token.isNotEmpty) {
          return _page(
            ResetPasswordPage(email: arg.email, token: arg.token),
            settings,
          );
        }
        return _page(const LoginPage(), settings);
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
      case Routes.bookingChat:
        final arg = settings.arguments;
        if (arg is ChatArgs) {
          return _page(
            ChatPage(
              bookingId: arg.bookingId,
              title: arg.title,
              subtitle: arg.subtitle,
            ),
            settings,
          );
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
      case Routes.vendorBankAccount:
        return _page(const VendorBankAccountPage(), settings);
      case Routes.favorites:
        return _page(const FavoritesPage(), settings);
      case Routes.appeals:
        return _page(const AppealsPage(), settings);
      case Routes.notifications:
        return _page(const NotificationCenterPage(), settings);
    }
    return _page(const LoginPage(), settings);
  }

  static MaterialPageRoute<dynamic> _page(
    Widget page,
    RouteSettings settings,
  ) => MaterialPageRoute<dynamic>(builder: (_) => page, settings: settings);
}
