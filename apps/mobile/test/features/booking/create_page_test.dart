// Booking form behaviour that the API cannot prove by itself: GPS failure
// states, reverse-geocoding that must not touch a typed address, and the date
// horizon (ten years ahead, booked days selectable but warned).
// ignore_for_file: depend_on_referenced_packages

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/routes.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/format.dart';
import 'package:tarlink_customer/core/geo/geo.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/core/widgets.dart';
import 'package:tarlink_customer/features/booking/create_page.dart';

const _vendorId = '7c1a2b3c-0000-4000-8000-000000000001';
const _packageId = 'd6c7a150-0000-4000-8000-000000000002';
const _addressLabel = 'Jl. Pantura No. 1, Indramayu';
const _bookedWarning = 'Tanggal ini sudah terisi. Booking bisa ditolak vendor.';

http.Response _json(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Map<String, dynamic> _vendorPayload() => {
  'vendor': {
    'id': _vendorId,
    'slug': 'tarling-dian',
    'display_name': 'Tarling Dangdut Dian',
    'region_code': '3209',
    'region_name': 'Kabupaten Indramayu',
    'whatsapp': '081200000000',
    'min_dp_bp': 3000,
  },
  'packages': [
    {
      'id': _packageId,
      'name': 'Paket Lengkap 6 jam',
      'duration_minutes': 360,
      'personnel_count': 8,
      'base_price_idr': 5000000,
      'inclusions': <String>[],
      'addons': <Object>[],
    },
  ],
};

Map<String, dynamic> _policyPayload() => {
  'data': {
    'id': 'pv-1',
    'code': 'cancellation',
    'version': '1',
    'body_hash': 'hash',
    'effective_from': '2026-01-01',
    'body': const {'status': 'draft'},
  },
};

Map<String, dynamic> _availabilityPayload(List<Map<String, dynamic>> days) {
  final today = DateTime.now();
  final from = DateTime(today.year, today.month, today.day);
  return {
    'vendor_id': _vendorId,
    'from': isoDate(from),
    'to': isoDate(from.add(const Duration(days: 44))),
    'calendar_updated_at': null,
    'stale': false,
    'stale_threshold_days': 30,
    'days': days,
  };
}

Map<String, dynamic> _availabilityDay(
  DateTime date,
  String session,
  String state,
) => {
  'date': isoDate(date),
  'session': session,
  'availability_state': state,
  'hold_expires_at': null,
};

DateTime _dayOffset(int days) {
  final now = DateTime.now();
  return DateTime(now.year, now.month, now.day).add(Duration(days: days));
}

class _Posted {
  Map<String, dynamic>? body;
}

Future<_Posted> _pumpCreatePage(
  WidgetTester tester, {
  String? carriedDate,
  List<Map<String, dynamic>> days = const [],
  Future<GeoReading> Function()? locationReader,
  Future<String?> Function(GeoReading reading)? addressResolver,
  Future<bool> Function()? settingsOpener,
}) async {
  final posted = _Posted();
  final session = Session();
  final api = ApiClient(
    session: session,
    baseUrl: 'http://test.local',
    client: MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/availability')) {
        return _json(_availabilityPayload(days));
      }
      if (path.endsWith('/policies/cancellation')) {
        return _json(_policyPayload());
      }
      if (request.method == 'POST' && path.endsWith('/bookings')) {
        posted.body = jsonDecode(request.body) as Map<String, dynamic>;
        return _json({
          'data': {'id': 'b1'},
        }, 201);
      }
      return _json(_vendorPayload());
    }),
  );

  // Real device width keeps the date grid the same as production; the extra
  // height only avoids scrolling the form in the test.
  tester.view.physicalSize = const Size(400, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    AppScope(
      session: session,
      api: api,
      child: MaterialApp(
        theme: buildTheme(),
        routes: {
          Routes.bookingStatus: (_) => const Scaffold(body: Text('status')),
        },
        home: CreateBookingPage(
          args: BookCreateArgs(
            vendorIdOrSlug: 'tarling-dian',
            packageId: _packageId,
            date: carriedDate,
          ),
          locationReader: locationReader,
          addressResolver: addressResolver,
          settingsOpener: settingsOpener,
        ),
      ),
    ),
  );
  await tester.pump();
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
  return posted;
}

Finder _textField(String label) =>
    find.widgetWithText(TextFormField, label).first;

Future<void> _openSlotSheet(WidgetTester tester) async {
  await tester.tap(find.text('Pilih tanggal acara'));
  await tester.pumpAndSettle();
}

Future<void> _useGps(WidgetTester tester) async {
  await tester.tap(find.text('Pakai GPS'));
  await tester.pump();
  await tester.tap(find.text('Gunakan lokasi saat ini'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 20));
}

void main() {
  testWidgets('tanggal lima tahun ke depan bisa dipilih dan dikirim', (
    tester,
  ) async {
    final posted = await _pumpCreatePage(tester);
    final target = DateTime(DateTime.now().year + 5, DateTime.now().month, 15);

    await _openSlotSheet(tester);
    await tester.tap(find.text('Pilih dari kalender'));
    await tester.pumpAndSettle();

    final yearList = find
        .byWidgetPredicate(
          (widget) => widget is ListView && widget.scrollDirection == Axis.horizontal,
        )
        .first;
    await tester.scrollUntilVisible(
      find.text('${target.year}'),
      120,
      scrollable: find.descendant(
        of: yearList,
        matching: find.byType(Scrollable),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('${target.year}'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('15'));
    await tester.pumpAndSettle();
    expect(find.text('Pilih ${formatDate(target)}'), findsOneWidget);
    await tester.tap(
      find.descendant(
        of: find.byType(FilledButton),
        matching: find.textContaining('Pilih '),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Kalender vendor belum mencakup'), findsOneWidget);

    await tester.tap(find.text('Pakai tanggal ini'));
    await tester.pumpAndSettle();
    await tester.enterText(_textField('Alamat & patokan'), _addressLabel);
    await tester.tap(
      find.widgetWithText(PrimaryButton, 'Kirim permintaan booking'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(posted.body, isNotNull);
    final event = posted.body!['event'] as Map<String, dynamic>;
    expect(event['start_date'], isoDate(target));
  });

  testWidgets('tanggal yang sudah terisi tetap bisa dipilih dan diberi '
      'peringatan', (tester) async {
    final booked = _dayOffset(3);
    final posted = await _pumpCreatePage(
      tester,
      days: [
        _availabilityDay(_dayOffset(0), 'day', 'available'),
        _availabilityDay(booked, 'day', 'booked'),
        _availabilityDay(booked, 'night', 'booked'),
      ],
    );

    await _openSlotSheet(tester);
    await tester.tap(find.text(formatDayMonth(booked)));
    await tester.pumpAndSettle();

    expect(find.text(_bookedWarning), findsOneWidget);

    await tester.tap(find.text('Pakai tanggal ini'));
    await tester.pumpAndSettle();
    expect(find.text(_bookedWarning), findsOneWidget);

    await tester.enterText(_textField('Alamat & patokan'), _addressLabel);
    await tester.tap(
      find.widgetWithText(PrimaryButton, 'Kirim permintaan booking'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(posted.body, isNotNull);
    final event = posted.body!['event'] as Map<String, dynamic>;
    expect(event['start_date'], isoDate(booked));
  });

  testWidgets('tanggal lampau tidak dipakai dan booking tidak terkirim', (
    tester,
  ) async {
    final yesterday = _dayOffset(-1);
    final posted = await _pumpCreatePage(
      tester,
      carriedDate: isoDate(yesterday),
    );

    expect(find.text('Pilih tanggal acara'), findsOneWidget);
    expect(find.text(formatDate(yesterday)), findsNothing);

    await tester.enterText(_textField('Nama acara'), 'Hajatan keluarga');
    await tester.enterText(_textField('Alamat & patokan'), _addressLabel);
    await tester.tap(
      find.widgetWithText(PrimaryButton, 'Kirim permintaan booking'),
    );
    await tester.pump();

    expect(find.text('Pilih tanggal acara dulu.'), findsOneWidget);
    expect(posted.body, isNull);
  });

  testWidgets('izin lokasi diblokir: pesan spesifik, tombol pengaturan, form '
      'tetap bisa dipakai', (tester) async {
    var settingsOpened = false;
    await _pumpCreatePage(
      tester,
      locationReader: () async =>
          throw const GeoException(GeoFailure.deniedForever, 'blocked'),
      settingsOpener: () async {
        settingsOpened = true;
        return true;
      },
    );

    await _useGps(tester);

    expect(find.textContaining('Izin lokasi diblokir'), findsOneWidget);
    expect(find.text('Buka pengaturan'), findsOneWidget);

    await tester.tap(find.text('Buka pengaturan'));
    await tester.pump();
    expect(settingsOpened, isTrue);

    await tester.tap(find.text('Ketik alamat'));
    await tester.pump();
    await tester.enterText(_textField('Alamat & patokan'), _addressLabel);
    expect(find.text(_addressLabel), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('GPS mati dan GPS timeout punya pesan masing-masing', (
    tester,
  ) async {
    await _pumpCreatePage(
      tester,
      locationReader: () async =>
          throw const GeoException(GeoFailure.unavailable, 'gps off'),
    );
    await _useGps(tester);
    expect(
      find.text(
        'Titik lokasi tidak ditemukan. Pastikan GPS aktif, lalu coba lagi.',
      ),
      findsOneWidget,
    );
    expect(find.text('Buka pengaturan'), findsNothing);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();

    await _pumpCreatePage(
      tester,
      locationReader: () async =>
          throw const GeoException(GeoFailure.timeout, 'slow'),
    );
    await _useGps(tester);
    expect(
      find.text('Pencarian lokasi terlalu lama. Coba lagi di area terbuka.'),
      findsOneWidget,
    );
  });

  testWidgets('gagal reverse geocode tidak menghapus alamat yang sudah '
      'diketik', (tester) async {
    await _pumpCreatePage(
      tester,
      locationReader: () async => const GeoReading(
        latitude: -6.3271,
        longitude: 108.3242,
        accuracyMeters: 12,
      ),
      addressResolver: (reading) async => null,
    );

    await tester.enterText(_textField('Alamat & patokan'), _addressLabel);
    await _useGps(tester);

    expect(find.text('Pakai alamat ini'), findsNothing);

    await tester.tap(find.text('Ketik alamat'));
    await tester.pump();
    expect(find.text(_addressLabel), findsOneWidget);
  });

  testWidgets('saran alamat hasil geocoding bisa dipakai dan tetap membawa '
      'koordinat', (tester) async {
    final posted = await _pumpCreatePage(
      tester,
      days: [
        _availabilityDay(_dayOffset(0), 'day', 'available'),
      ],
      locationReader: () async => const GeoReading(
        latitude: -6.3271,
        longitude: 108.3242,
        accuracyMeters: 12,
      ),
      addressResolver: (reading) async => 'Jl. Raya Pantura, Indramayu',
    );

    await _useGps(tester);
    expect(find.text('Jl. Raya Pantura, Indramayu'), findsOneWidget);

    await tester.tap(find.text('Pakai alamat ini'));
    await tester.pump();
    expect(find.text('Jl. Raya Pantura, Indramayu'), findsOneWidget);

    await _openSlotSheet(tester);
    await tester.tap(find.text(formatDayMonth(_dayOffset(0))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pakai tanggal ini'));
    await tester.pumpAndSettle();

    await tester.tap(
      find.widgetWithText(PrimaryButton, 'Kirim permintaan booking'),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(posted.body, isNotNull);
    final event = posted.body!['event'] as Map<String, dynamic>;
    expect(event['venue_address'], 'Jl. Raya Pantura, Indramayu');
    expect(event['venue_location'], {'lat': -6.3271, 'lng': 108.3242});
  });

  testWidgets('label wajib dan opsional dibedakan tanpa legenda', (
    tester,
  ) async {
    await _pumpCreatePage(tester);

    // Each requirement marker lives inside its own field's decoration, so the
    // required path (nama acara, tanggal, alamat) reads first and the optional
    // fields stay visibly secondary.
    Finder markOf(String label, String mark) => find.descendant(
      of: find.ancestor(
        of: find.text(label),
        matching: find.byType(TextFormField),
      ),
      matching: find.text(mark),
    );

    expect(markOf('Nama acara', 'Wajib'), findsOneWidget);
    expect(markOf('Alamat & patokan', 'Wajib'), findsOneWidget);
    expect(markOf('Perkiraan jumlah tamu', 'Opsional'), findsOneWidget);
    expect(markOf('Catatan untuk vendor', 'Opsional'), findsOneWidget);
    expect(markOf('Nama tempat', 'Opsional'), findsOneWidget);
    expect(find.text('Jenis acara'), findsOneWidget);
  });

  testWidgets('label berpenanda tidak memutus validasi dan pesan galat', (
    tester,
  ) async {
    final posted = await _pumpCreatePage(tester);

    await tester.enterText(_textField('Alamat & patokan'), 'pendek');
    await tester.tap(
      find.widgetWithText(PrimaryButton, 'Kirim permintaan booking'),
    );
    await tester.pump();

    expect(find.text('Nama acara wajib diisi.'), findsOneWidget);
    expect(find.text('Alamat minimal 10 karakter.'), findsOneWidget);
    expect(posted.body, isNull);
  });
}
