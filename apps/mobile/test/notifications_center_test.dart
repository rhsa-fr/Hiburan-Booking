import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/routes.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/models.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/discovery/home_page.dart';
import 'package:tarlink_customer/features/notifications/notification_center_page.dart';

/// Fixed clock so relative timestamps never depend on wall time.
final _now = DateTime.parse('2026-11-21T10:00:00Z');

/// Signed-in session without the device keystore: the page only reads roles.
class _TestSession extends Session {
  _TestSession(this.roles);

  final List<String> roles;

  @override
  bool get authorized => true;

  @override
  String? get token => 'test-token';

  @override
  AppUser? get user =>
      AppUser(id: 'user-1', phone: '081200000000', roles: roles);
}

http.Response _json(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Map<String, dynamic> _item({
  required String id,
  required String title,
  required String body,
  String type = 'booking.confirmed',
  String? bookingId,
  String? readAt,
  String createdAt = '2026-11-21T09:30:00Z',
}) => {
  'id': id,
  'type': type,
  'title': title,
  'body': body,
  'payload': bookingId == null
      ? <String, dynamic>{}
      : {'booking_id': bookingId},
  'read_at': readAt,
  'created_at': createdAt,
};

Map<String, dynamic> _page(List<Map<String, dynamic>> items, {int? total}) => {
  'items': items,
  'total': total ?? items.length,
  'page': 1,
  'page_size': 50,
};

/// Captures named pushes so a tap can be asserted without building the real
/// booking pages (which would need their own API fixtures).
class _RouteObserver extends NavigatorObserver {
  final List<RouteSettings> pushed = <RouteSettings>[];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pushed.add(route.settings);
    super.didPush(route, previousRoute);
  }
}

Route<dynamic>? _stubRoute(RouteSettings settings) {
  if (settings.name == Routes.bookingStatus ||
      settings.name == Routes.vendorBookingDetail) {
    return MaterialPageRoute<void>(
      builder: (_) => const Scaffold(body: Text('halaman booking')),
      settings: settings,
    );
  }
  return null;
}

Future<_RouteObserver> _pump(
  WidgetTester tester,
  Future<http.Response> Function(http.Request request) handler, {
  List<String> roles = const ['customer'],
  Size size = const Size(390, 844),
}) async {
  final session = _TestSession(roles);
  final api = ApiClient(
    session: session,
    baseUrl: 'http://test.local',
    client: MockClient(handler),
  );
  final observer = _RouteObserver();
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(() {
    api.close();
    session.dispose();
  });

  await tester.pumpWidget(
    AppScope(
      session: session,
      api: api,
      child: MaterialApp(
        theme: buildTheme(),
        navigatorObservers: [observer],
        home: NotificationCenterPage(now: () => _now),
        onGenerateRoute: _stubRoute,
      ),
    ),
  );
  await tester.pump();
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
  return observer;
}

void main() {
  testWidgets('menampilkan daftar dan membedakan baris belum dibaca', (
    tester,
  ) async {
    await _pump(tester, (request) async {
      if (request.url.path.endsWith('/notifications')) {
        return _json({
          'data': _page([
            _item(
              id: 'n1',
              title: 'DP diterima',
              body: 'DP booking TRL-001 sudah masuk.',
              bookingId: 'b-1',
            ),
            _item(
              id: 'n2',
              type: 'payment.settled',
              title: 'Pelunasan diterima',
              body: 'Sisa pembayaran booking TRL-001 lunas.',
              bookingId: 'b-1',
              readAt: '2026-11-21T08:00:00Z',
              createdAt: '2026-11-20T08:00:00Z',
            ),
          ]),
        });
      }
      return _json({
        'data': {'unread': 1},
      });
    });

    expect(find.text('DP diterima'), findsOneWidget);
    expect(find.text('Pelunasan diterima'), findsOneWidget);
    expect(find.text('30 mnt lalu'), findsOneWidget);
    expect(find.byKey(notificationUnreadDotKey), findsOneWidget);

    final unreadTitle = tester.widget<Text>(find.text('DP diterima'));
    final readTitle = tester.widget<Text>(find.text('Pelunasan diterima'));
    expect(unreadTitle.style?.fontWeight, FontWeight.w800);
    expect(unreadTitle.style?.color, AppColors.ink);
    expect(readTitle.style?.fontWeight, FontWeight.w600);
    expect(readTitle.style?.color, AppColors.inkMuted);
    expect(tester.takeException(), isNull);
  });

  testWidgets('kosong menampilkan pesan dan aksi tandai semua nonaktif', (
    tester,
  ) async {
    await _pump(tester, (request) async {
      if (request.url.path.endsWith('/notifications')) {
        return _json({
          'data': _page(const []),
        });
      }
      return _json({
        'data': {'unread': 0},
      });
    });

    expect(find.text('Belum ada notifikasi'), findsOneWidget);
    final action = tester.widget<TextButton>(
      find.widgetWithText(TextButton, 'Tandai semua dibaca'),
    );
    expect(action.onPressed, isNull);
    expect(find.byKey(notificationUnreadDotKey), findsNothing);
  });

  testWidgets('gagal memuat menampilkan Coba lagi lalu memuat ulang', (
    tester,
  ) async {
    var calls = 0;
    await _pump(tester, (request) async {
      if (request.url.path.endsWith('/notifications')) {
        calls += 1;
        if (calls == 1) {
          return _json({
            'error': {'code': 'INTERNAL_ERROR', 'message': 'Server sibuk.'},
          }, 500);
        }
        return _json({
          'data': _page([
            _item(
              id: 'n1',
              title: 'DP diterima',
              body: 'DP booking TRL-001 sudah masuk.',
            ),
          ]),
        });
      }
      return _json({
        'data': {'unread': 1},
      });
    });

    expect(find.text('DP diterima'), findsNothing);
    await tester.tap(find.text('Coba lagi'));
    await tester.pump();
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }

    expect(calls, 2);
    expect(find.text('DP diterima'), findsOneWidget);
  });

  testWidgets('tandai semua dibaca memanggil endpoint dan memadamkan titik', (
    tester,
  ) async {
    final calls = <String>[];
    await _pump(tester, (request) async {
      final path = request.url.path;
      calls.add('${request.method} $path');
      if (path.endsWith('/notifications/read-all')) {
        return _json({
          'data': {'updated': 2},
        });
      }
      if (path.endsWith('/notifications')) {
        return _json({
          'data': _page([
            _item(id: 'n1', title: 'DP diterima', body: 'DP masuk.'),
            _item(id: 'n2', title: 'Booking diterima', body: 'Vendor setuju.'),
          ]),
        });
      }
      return _json({
        'data': {'unread': 0},
      });
    });

    expect(find.byKey(notificationUnreadDotKey), findsNWidgets(2));
    await tester.tap(find.widgetWithText(TextButton, 'Tandai semua dibaca'));
    await tester.pump();
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }

    expect(calls, contains('POST /v1/notifications/read-all'));
    expect(find.byKey(notificationUnreadDotKey), findsNothing);
  });

  testWidgets('mengetuk baris pelanggan menandai dibaca lalu membuka booking', (
    tester,
  ) async {
    final calls = <String>[];
    final observer = await _pump(tester, (request) async {
      final path = request.url.path;
      calls.add('${request.method} $path');
      if (path.endsWith('/notifications')) {
        return _json({
          'data': _page([
            _item(
              id: 'n1',
              title: 'DP diterima',
              body: 'DP booking TRL-001 sudah masuk.',
              bookingId: 'b-1',
            ),
          ]),
        });
      }
      if (path.endsWith('/notifications/unread-count')) {
        return _json({
          'data': {'unread': 1},
        });
      }
      return _json({
        'data': {'id': 'n1', 'read_at': '2026-11-21T10:00:00Z'},
      });
    });

    await tester.tap(find.text('DP diterima'));
    await tester.pump();
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }

    expect(calls, contains('POST /v1/notifications/n1/read'));
    final target = observer.pushed
        .where((settings) => settings.name == Routes.bookingStatus)
        .toList();
    expect(target, hasLength(1));
    expect(target.single.arguments, 'b-1');
    expect(find.byKey(notificationUnreadDotKey), findsNothing);
  });

  testWidgets('pemilik vendor diarahkan ke detail booking vendor', (
    tester,
  ) async {
    final observer = await _pump(
      tester,
      (request) async {
        if (request.url.path.endsWith('/notifications')) {
          return _json({
            'data': _page([
              _item(
                id: 'n9',
                title: 'Booking baru',
                body: 'Ada pesanan masuk.',
                bookingId: 'b-9',
              ),
            ]),
          });
        }
        return _json({
          'data': {'unread': 1},
        });
      },
      roles: const ['vendor_owner'],
    );

    await tester.tap(find.text('Booking baru'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    final target = observer.pushed
        .where((settings) => settings.name == Routes.vendorBookingDetail)
        .toList();
    expect(target, hasLength(1));
    expect(target.single.arguments, 'b-9');
  });

  testWidgets('header tetap utuh pada layar 320dp', (tester) async {
    await _pump(
      tester,
      (request) async {
        if (request.url.path.endsWith('/notifications')) {
          return _json({
            'data': _page([
              _item(
                id: 'n1',
                title: 'Pembayaran pelunasan diterima untuk booking TRL-2026-001',
                body: 'Sisa pembayaran sudah masuk dan booking lunas.',
                type: 'payment.settled',
              ),
            ]),
          });
        }
        return _json({
          'data': {'unread': 1},
        });
      },
      size: const Size(320, 640),
    );

    expect(tester.takeException(), isNull);
    expect(find.text('Notifikasi'), findsOneWidget);
    expect(find.text('Tandai semua dibaca'), findsOneWidget);
    expect(
      find.text('Pembayaran pelunasan diterima untuk booking TRL-2026-001'),
      findsOneWidget,
    );
  });

  // HomePage already overflows by 6 px in a widget test at 320 dp width (with
  // and without this bell), so the entry point is asserted on the 390x844
  // production surface instead.
  testWidgets('bel Beranda menampilkan hitungan 9+ dan membuka pusat', (
    tester,
  ) async {
    final session = _TestSession(const ['customer']);
    final api = ApiClient(
      session: session,
      baseUrl: 'http://test.local',
      client: MockClient((request) async {
        final path = request.url.path;
        if (path.endsWith('/notifications/unread-count')) {
          return _json({
            'data': {'unread': 12},
          });
        }
        if (path.endsWith('/notifications')) {
          return _json({
            'data': _page(const []),
          });
        }
        if (path.endsWith('/vendors')) {
          return _json({
            'data': {'items': [], 'total': 0, 'page': 1, 'page_size': 4},
          });
        }
        if (path.endsWith('/bookings')) {
          return _json({
            'data': {'items': [], 'total': 0, 'page': 1, 'page_size': 10},
          });
        }
        return _json({'data': <String, dynamic>{}});
      }),
    );
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(() {
      api.close();
      session.dispose();
    });

    await tester.pumpWidget(
      AppScope(
        session: session,
        api: api,
        child: MaterialApp(
          theme: buildTheme(),
          home: const HomePage(),
          onGenerateRoute: Routes.onGenerateRoute,
        ),
      ),
    );
    await tester.pump();
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }

    final error = tester.takeException();
    expect(error, isNull);

    await tester.tap(find.byIcon(Icons.notifications_none_rounded));
    await tester.pump();
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }
    expect(find.text('Notifikasi'), findsOneWidget);
    expect(find.text('Belum ada notifikasi'), findsOneWidget);

    // Unmount so the 30 s badge poller cannot outlive the test.
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
