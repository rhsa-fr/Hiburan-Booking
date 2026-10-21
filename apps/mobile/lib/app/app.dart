import 'package:flutter/material.dart';

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
        initialRoute: session.authorized ? Routes.home : Routes.login,
        onGenerateRoute: Routes.onGenerateRoute,
      ),
    );
  }
}
