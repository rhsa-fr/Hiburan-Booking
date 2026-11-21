// VendorPage regression: the page once rendered a blank body because its bottom
// bar label was wrapped in an Align, which grew to the full height Scaffold
// offers (600px in tests) and squeezed the ListView body to 0px. The finders
// still matched 'Pilih jadwal' inside the bottom bar, so only a size check
// catches this class of bug.
// ignore_for_file: depend_on_referenced_packages

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/test/test_flutter_secure_storage_platform.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/format.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/discovery/vendor_page.dart';

http.Response _json(Object body) => http.Response(
  jsonEncode(body),
  200,
  headers: {'content-type': 'application/json'},
);

DateTime _dayOffset(int days) {
  final now = DateTime.now();
  return DateTime(now.year, now.month, now.day).add(Duration(days: days));
}

Map<String, dynamic> _availabilityDay(DateTime date, String state) => {
  'date': isoDate(date),
  'session': 'day',
  'availability_state': state,
  'hold_expires_at': null,
};

Map<String, dynamic> _vendorPayload() => {
  'vendor': {
    'id': 'v1',
    'slug': 'v1',
    'display_name': 'Grup Tarling Nada Pantura',
    'region_name': 'Kabupaten Indramayu',
    'min_dp_bp': 3000,
    'whatsapp': '081200000000',
  },
  'packages': [
    {
      'id': 'p1',
      'name': 'Paket Lengkap 6 jam',
      'duration_minutes': 360,
      'base_price_idr': 5000000,
      'addons': <Object>[],
    },
  ],
};

/// Pumps the vendor page on a phone-width surface so the date grid keeps the
/// same cell height as production.
Future<void> _pumpVendor(
  WidgetTester tester,
  List<Map<String, dynamic>> days,
) async {
  final session = Session();
  final api = ApiClient(
    session: session,
    baseUrl: 'http://test.local',
    client: MockClient((request) async {
      if (request.url.path.contains('/availability')) {
        final today = DateTime.now();
        final start = DateTime(today.year, today.month, today.day);
        return _json({
          'vendor_id': 'v1',
          'from': isoDate(start),
          'to': isoDate(start.add(const Duration(days: 44))),
          'calendar_updated_at': null,
          'stale': false,
          'stale_threshold_days': 30,
          'days': days,
        });
      }
      return _json(_vendorPayload());
    }),
  );

  tester.view.physicalSize = const Size(400, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    AppScope(
      session: session,
      api: api,
      child: MaterialApp(
        theme: buildTheme(),
        home: const VendorPage(idOrSlug: 'v1'),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

Future<void> _openCalendar(WidgetTester tester) async {
  await tester.scrollUntilVisible(
    find.text('Kalender'),
    260,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.tap(find.text('Kalender'));
  await tester.pumpAndSettle();
}

/// The picker grid is the only GridView on screen; the schedule rail behind it
/// also prints day numbers, so day taps are scoped to the grid.
Finder _gridDay(int day) =>
    find.descendant(of: find.byType(GridView), matching: find.text('$day'));

Future<void> _confirmPicker(WidgetTester tester) async {
  // The page bottom bar may wrap its own button, so take the last one: the
  // modal sheet is painted after the page.
  await tester.tap(find.byType(FilledButton).last);
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    FlutterSecureStoragePlatform.instance = TestFlutterSecureStoragePlatform({});
  });

  testWidgets('detail vendor merender isi, bukan layar kosong', (tester) async {
    final session = Session();
    final api = ApiClient(
      session: session,
      baseUrl: 'http://test.local',
      client: MockClient((request) async {
        if (request.url.path.contains('/availability')) {
          return _json({
            'vendor_id': 'v1',
            'from': isoDate(DateTime.now()),
            'to': isoDate(DateTime.now().add(const Duration(days: 44))),
            'calendar_updated_at': null,
            'stale': true,
            'stale_threshold_days': 30,
            'days': [
              {
                'date': isoDate(DateTime.now()),
                'session': 'night',
                'availability_state': 'stale',
                'hold_expires_at': null,
              },
            ],
          });
        }
        return _json({
          'vendor': {
            'id': 'v1',
            'slug': 'v1',
            'display_name': 'Grup Tarling Nada Pantura',
            'region_name': 'Kabupaten Indramayu',
            'min_dp_bp': 3000,
            'whatsapp': '081200000000',
          },
          'packages': [
            {
              'id': 'p1',
              'name': 'Paket Lengkap 6 jam',
              'duration_minutes': 360,
              'base_price_idr': 5000000,
              'addons': [],
            },
          ],
        });
      }),
    );

    await tester.pumpWidget(
      AppScope(
        session: session,
        api: api,
        child: MaterialApp(
          theme: buildTheme(),
          home: const VendorPage(idOrSlug: 'v1'),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(tester.takeException(), isNull);
    expect(find.text('Detail Grup Hiburan'), findsOneWidget);
    expect(find.text('Pilih jadwal'), findsOneWidget);
    expect(tester.getSize(find.byType(ListView)).height, greaterThan(400));

    api.close();
    session.dispose();
  });

  testWidgets('tanggal terisi tetap bisa dipilih dan diberi peringatan', (
    tester,
  ) async {
    final booked = _dayOffset(3);
    final today = _dayOffset(0);
    await _pumpVendor(tester, [
      _availabilityDay(today, 'available'),
      _availabilityDay(booked, 'blocked'),
    ]);

    await _openCalendar(tester);
    if (booked.month != today.month) {
      await tester.tap(
        find
            .text(
              const [
                'Jan',
                'Feb',
                'Mar',
                'Apr',
                'Mei',
                'Jun',
                'Jul',
                'Agu',
                'Sep',
                'Okt',
                'Nov',
                'Des',
              ][booked.month - 1],
            )
            .last,
      );
      await tester.pumpAndSettle();
    }
    await tester.tap(_gridDay(booked.day));
    await tester.pumpAndSettle();
    await _confirmPicker(tester);

    expect(
      find.text('Tanggal ini sudah terisi. Booking bisa ditolak vendor.'),
      findsOneWidget,
    );
    expect(find.text('Lanjut · ${formatDayMonth(booked)}'), findsOneWidget);
  });

  testWidgets('tanggal di luar kalender tetap dipakai dengan peringatan', (
    tester,
  ) async {
    final today = _dayOffset(0);
    final later = DateTime(today.year + 1, today.month, 10);
    await _pumpVendor(tester, [_availabilityDay(today, 'available')]);

    await _openCalendar(tester);
    // A year ahead is already past the 45-day calendar; the month stays the
    // same, so only the year chip has to change.
    await tester.tap(find.text('${later.year}').last);
    await tester.pumpAndSettle();
    await tester.tap(_gridDay(later.day));
    await tester.pumpAndSettle();
    await _confirmPicker(tester);

    expect(
      find.text('Kalender vendor belum mencakup tanggal ini.'),
      findsOneWidget,
    );
    expect(find.text('Lanjut · ${formatDayMonth(later)}'), findsOneWidget);
  });
}
