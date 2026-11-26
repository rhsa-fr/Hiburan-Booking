import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:image_picker/image_picker.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/api_exception.dart';
import 'package:tarlink_customer/core/models.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/profile/policy_sheet.dart';
import 'package:tarlink_customer/features/profile/vendor_apply_page.dart';
import 'package:tarlink_customer/features/profile/vendor_apply_support.dart';

/// 1×1 transparent PNG: a real image so the KTP preview decodes in tests.
final _tinyPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQ'
  'DwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
);

const _description =
    'Grup tarling dengan formasi lengkap dan wilayah layanan Pantura.';
const _equipment =
    'Dua set sound 2.000 watt, enam lampu par, dan satu genset cadangan.';

Map<String, dynamic> _policy({String version = '3'}) => {
  'id': 'policy-vendor-3',
  'code': 'vendor_terms',
  'version': version,
  'body_hash': 'hash-vendor-terms',
  'effective_from': '2026-10-01',
  'body': {
    'ringkasan': 'Ketentuan singkat kemitraan Tarlink.',
    'sections': [
      {
        'heading': 'Kewajiban vendor',
        'body': 'Vendor hadir tepat waktu dan menjaga peralatan sendiri.',
      },
    ],
  },
};

Map<String, dynamic> _eligibility({
  bool canSubmit = true,
  bool emailVerified = true,
  List<Map<String, dynamic>> blockers = const [],
  Map<String, dynamic>? application,
  Map<String, dynamic>? policy,
}) => {
  'can_submit': canSubmit,
  'blockers': blockers,
  'account': {
    'name': 'Budi Santoso',
    'phone': '6281234567890',
    'email': 'budi@example.com',
    'email_verified': emailVerified,
  },
  'application': application,
  'policy': policy ?? _policy(),
  'categories': [
    {'slug': 'tarling', 'name': 'Tarling'},
    {'slug': 'sound-system', 'name': 'Sound System'},
  ],
};

const _regions = [
  {'code': 'PB', 'name': 'Pemalang', 'level': 'kabupaten'},
  {'code': 'TK', 'name': 'Tegal', 'level': 'kota'},
];

Map<String, dynamic> _submittedView() => {
  'id': 'app-1',
  'status': 'submitted',
  'display_name': 'Grup Nada',
  'legal_name': 'Budi Santoso',
  'nik': '3200**********12',
  'region_code': 'PB',
  'base_address': 'Jl. Merdeka 10, Pemalang',
  'review_note': null,
};

Map<String, dynamic> _rejectedApplication({
  String categorySlug = 'tarling',
  String? reviewNote = 'Foto KTP buram. Unggah ulang.',
}) => {
  'id': 'app-1',
  'status': 'rejected',
  'display_name': 'Grup Lama',
  'legal_name': 'Budi Santoso',
  'nik': '3200**********12',
  'region_code': 'PB',
  'base_address': 'Jl. Merdeka 10, Pemalang',
  'category_slug': categorySlug,
  'category_name': 'Kategori lama',
  'years_active': 4,
  'description': _description,
  'personnel_count': 9,
  'equipment_summary': _equipment,
  'portfolio_url': null,
  'form_version': 2,
  'agreement_version': 7,
  'review_note': reviewNote,
};

http.Response _json(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

http.Response _notFound() =>
    _json({'error': {'code': 'NOT_FOUND', 'message': 'x'}}, 404);

Future<void> _pump(
  WidgetTester tester,
  Future<http.Response> Function(http.Request) handler, {
  Future<XFile?> Function()? pickKtp,
  double width = 400,
  bool dark = false,
}) async {
  final session = Session();
  final api = ApiClient(
    session: session,
    client: MockClient(handler),
    baseUrl: 'http://localhost:3001',
  );
  tester.view.physicalSize = Size(width, 2600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  if (dark) {
    AppColors.forced = Brightness.dark;
    addTearDown(() => AppColors.forced = null);
  }
  addTearDown(() {
    api.close();
    session.dispose();
  });
  await tester.pumpWidget(
    AppScope(
      session: session,
      api: api,
      child: MaterialApp(
        theme: buildTheme(brightness: dark ? Brightness.dark : null),
        home: VendorApplyPage(
          pickKtp: pickKtp ?? () async => null,
        ),
      ),
    ),
  );
  await tester.pump();
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<XFile?> _fakeKtp() async => XFile.fromData(
  _tinyPng,
  name: 'ktp.png',
  mimeType: 'image/png',
);

Future<void> _tapAndSettle(WidgetTester tester, Finder finder) async {
  await tester.tap(finder);
  await tester.pump();
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> _startWizard(WidgetTester tester) async {
  await tester.tap(find.byType(Checkbox));
  await tester.pump();
  await _tapAndSettle(tester, find.text('Lanjut'));
}

Future<void> _fillProfileAndContinue(WidgetTester tester) async {
  await tester.enterText(
    find.widgetWithText(TextField, 'Nama grup / vendor'),
    'Grup Nada',
  );
  await tester.tap(find.text('Tarling'));
  await tester.pump();
  await tester.enterText(
    find.widgetWithText(TextField, 'Deskripsi singkat'),
    _description,
  );
  await tester.enterText(
    find.widgetWithText(TextField, 'Tahun aktif'),
    '5',
  );
  await tester.enterText(
    find.widgetWithText(TextField, 'Jumlah personel'),
    '12',
  );
  await tester.pump();
  await _tapAndSettle(tester, find.text('Lanjut'));
}

Future<void> _fillLegalityAndContinue(
  WidgetTester tester, {
  String nik = '1234567890123456',
}) async {
  await tester.enterText(
    find.widgetWithText(TextField, 'Nama legal (sesuai KTP)'),
    'Budi Santoso',
  );
  await tester.enterText(
    find.widgetWithText(TextField, 'NIK pimpinan'),
    nik,
  );
  await tester.enterText(
    find.widgetWithText(TextField, 'Alamat basis'),
    'Jl. Merdeka 10, Pemalang',
  );
  await _tapAndSettle(tester, find.text('Pilih foto KTP'));
  await _tapAndSettle(tester, find.text('Lanjut'));
}

Future<void> _fillOperationsAndContinue(
  WidgetTester tester, {
  String portfolio = '',
}) async {
  await tester.enterText(
    find.widgetWithText(TextField, 'Peralatan yang dimiliki'),
    _equipment,
  );
  if (portfolio.isNotEmpty) {
    await tester.enterText(
      find.widgetWithText(TextField, 'Tautan portofolio (opsional)'),
      portfolio,
    );
  }
  await tester.pump();
  await _tapAndSettle(tester, find.text('Lanjut'));
}

/// eligibility + regions for handlers that only need the gate.
Future<http.Response> Function(http.Request) _gate(
  Map<String, dynamic> eligibility,
) {
  return (request) async {
    final path = request.url.path;
    if (path.endsWith('/vendor-applications/eligibility')) {
      return _json({'data': eligibility});
    }
    if (path.endsWith('/regions')) return _json({'items': _regions});
    return _notFound();
  };
}

void main() {
  testWidgets('blocker EMAIL_NOT_VERIFIED menonaktifkan Lanjut', (
    tester,
  ) async {
    await _pump(
      tester,
      _gate(
        _eligibility(
          canSubmit: false,
          emailVerified: false,
          blockers: [
            {
              'code': 'EMAIL_NOT_VERIFIED',
              'message': 'Verifikasi email kamu dulu sebelum mengajukan.',
            },
          ],
        ),
      ),
    );

    expect(find.text('Langkah 1 dari 5 · Ketentuan Mitra'), findsOneWidget);
    expect(find.textContaining('Verifikasi email kamu dulu'), findsOneWidget);
    final lanjut = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Lanjut'),
    );
    expect(lanjut.onPressed, isNull);
  });

  testWidgets('checkbox Ketentuan Mitra wajib sebelum Lanjut', (tester) async {
    await _pump(tester, _gate(_eligibility()));

    FilledButton lanjut() => tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Lanjut'),
    );
    expect(lanjut().onPressed, isNull);

    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    expect(lanjut().onPressed, isNotNull);
  });

  testWidgets('deskripsi 39 karakter ditolak dan tetap di langkah 2', (
    tester,
  ) async {
    await _pump(tester, _gate(_eligibility()));
    await _startWizard(tester);
    expect(find.text('Langkah 2 dari 5 · Profil grup'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Nama grup / vendor'),
      'Grup Nada',
    );
    await tester.tap(find.text('Tarling'));
    await tester.pump();
    await tester.enterText(
      find.widgetWithText(TextField, 'Deskripsi singkat'),
      'a' * 39,
    );
    await tester.enterText(find.widgetWithText(TextField, 'Tahun aktif'), '5');
    await tester.enterText(
      find.widgetWithText(TextField, 'Jumlah personel'),
      '12',
    );
    await tester.pump();
    await _tapAndSettle(tester, find.text('Lanjut'));

    expect(find.text('Deskripsi minimal 40 karakter.'), findsOneWidget);
    expect(find.text('Langkah 2 dari 5 · Profil grup'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Deskripsi singkat'),
      _description,
    );
    await tester.pump();
    await _tapAndSettle(tester, find.text('Lanjut'));
    expect(find.text('Langkah 3 dari 5 · Legalitas'), findsOneWidget);
  });

  testWidgets('NIK 15 digit ditolak; data valid lanjut ke operasional', (
    tester,
  ) async {
    await _pump(tester, _gate(_eligibility()), pickKtp: _fakeKtp);
    await _startWizard(tester);
    await _fillProfileAndContinue(tester);
    expect(find.text('Langkah 3 dari 5 · Legalitas'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Nama legal (sesuai KTP)'),
      'Budi Santoso',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'NIK pimpinan'),
      '123456789012345',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Alamat basis'),
      'Jl. Merdeka 10, Pemalang',
    );
    await _tapAndSettle(tester, find.text('Lanjut'));
    expect(find.text('NIK harus 16 digit angka.'), findsOneWidget);
    expect(find.text('Langkah 3 dari 5 · Legalitas'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'NIK pimpinan'),
      '1234567890123456',
    );
    await tester.pump();
    await _tapAndSettle(tester, find.text('Pilih foto KTP'));
    expect(find.text('Ganti foto KTP'), findsOneWidget);

    await _tapAndSettle(tester, find.text('Lanjut'));
    expect(find.text('Langkah 4 dari 5 · Operasional'), findsOneWidget);
  });

  testWidgets('portofolio http:// ditolak, kosong lolos', (tester) async {
    await _pump(tester, _gate(_eligibility()), pickKtp: _fakeKtp);
    await _startWizard(tester);
    await _fillProfileAndContinue(tester);
    await _fillLegalityAndContinue(tester);
    expect(find.text('Langkah 4 dari 5 · Operasional'), findsOneWidget);

    await _fillOperationsAndContinue(
      tester,
      portfolio: 'http://portofolio.example.com',
    );
    expect(
      find.text('Tautan harus berupa alamat https:// yang valid.'),
      findsOneWidget,
    );
    expect(find.text('Langkah 4 dari 5 · Operasional'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Tautan portofolio (opsional)'),
      '',
    );
    await tester.pump();
    await _tapAndSettle(tester, find.text('Lanjut'));
    expect(find.text('Langkah 5 dari 5 · Ringkasan'), findsOneWidget);
  });

  testWidgets('kirim: unggah KTP lalu POST dengan integer dan policy id', (
    tester,
  ) async {
    final calls = <String>[];
    Map<String, dynamic>? posted;
    await _pump(tester, (request) async {
      final path = request.url.path;
      if (path.endsWith('/vendor-applications/eligibility')) {
        return _json({'data': _eligibility()});
      }
      if (path.endsWith('/regions')) return _json({'items': _regions});
      if (request.method == 'POST' &&
          path.endsWith('/vendor-applications/ktp')) {
        calls.add(path);
        return _json({
          'data': {'ktp_object_key': 'private/ktp/app-1.jpg'},
        }, 201);
      }
      if (request.method == 'POST' &&
          path.endsWith('/vendor-applications')) {
        calls.add(path);
        posted = jsonDecode(request.body) as Map<String, dynamic>;
        return _json({'data': _submittedView()}, 201);
      }
      return _notFound();
    }, pickKtp: _fakeKtp);

    await _startWizard(tester);
    await _fillProfileAndContinue(tester);
    await _fillLegalityAndContinue(tester);
    await _fillOperationsAndContinue(tester);
    expect(find.text('Disetujui: Ketentuan Mitra v3'), findsOneWidget);

    await _tapAndSettle(tester, find.text('Kirim pengajuan'));

    expect(calls, [
      '/v1/vendor-applications/ktp',
      '/v1/vendor-applications',
    ]);
    expect(posted?['agreement_policy_version_id'], 'policy-vendor-3');
    expect(posted?['ktp_object_key'], 'private/ktp/app-1.jpg');
    expect(posted?['years_active'], isA<int>());
    expect(posted?['years_active'], 5);
    expect(posted?['personnel_count'], isA<int>());
    expect(posted?['personnel_count'], 12);
    expect(posted?['portfolio_url'], isNull);
    expect(find.text('Menunggu pemeriksaan admin'), findsOneWidget);
    expect(find.text('Lanjut'), findsNothing);
  });

  testWidgets('409 POLICY_VERSION_STALE kembali ke langkah 1 dan reload', (
    tester,
  ) async {
    var eligibilityCalls = 0;
    await _pump(tester, (request) async {
      final path = request.url.path;
      if (path.endsWith('/vendor-applications/eligibility')) {
        eligibilityCalls += 1;
        return _json({
          'data': _eligibility(
            policy: _policy(version: eligibilityCalls == 1 ? '3' : '4'),
          ),
        });
      }
      if (path.endsWith('/regions')) return _json({'items': _regions});
      if (request.method == 'POST' &&
          path.endsWith('/vendor-applications/ktp')) {
        return _json({
          'data': {'ktp_object_key': 'private/ktp/app-1.jpg'},
        }, 201);
      }
      if (request.method == 'POST' &&
          path.endsWith('/vendor-applications')) {
        return _json({
          'error': {
            'code': 'CONFLICT',
            'message': 'Ketentuan Mitra sudah diperbarui.',
            'details': {'reason': 'POLICY_VERSION_STALE'},
          },
        }, 409);
      }
      return _notFound();
    }, pickKtp: _fakeKtp);

    await _startWizard(tester);
    await _fillProfileAndContinue(tester);
    await _fillLegalityAndContinue(tester);
    await _fillOperationsAndContinue(tester);
    await _tapAndSettle(tester, find.text('Kirim pengajuan'));

    expect(eligibilityCalls, 2);
    expect(find.text('Langkah 1 dari 5 · Ketentuan Mitra'), findsOneWidget);
    expect(
      find.textContaining('Ketentuan Mitra diperbarui'),
      findsOneWidget,
    );
    final checkbox = tester.widget<Checkbox>(find.byType(Checkbox));
    expect(checkbox.value, isFalse);
  });

  testWidgets('pengajuan ditolak: prefill tanpa NIK/KTP dan tampilkan catatan', (
    tester,
  ) async {
    await _pump(
      tester,
      _gate(_eligibility(application: _rejectedApplication())),
    );

    expect(find.text('Ditolak'), findsOneWidget);
    expect(find.textContaining('Foto KTP buram'), findsOneWidget);

    await _tapAndSettle(tester, find.text('Ajukan ulang'));
    expect(find.text('Langkah 1 dari 5 · Ketentuan Mitra'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Lanjut'))
          .onPressed,
      isNull,
    );

    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await _tapAndSettle(tester, find.text('Lanjut'));
    expect(find.text('Grup Lama'), findsOneWidget);

    await _tapAndSettle(tester, find.text('Lanjut'));
    expect(find.text('Langkah 3 dari 5 · Legalitas'), findsOneWidget);
    final nikField = tester.widget<TextField>(
      find.widgetWithText(TextField, 'NIK pimpinan'),
    );
    expect(nikField.controller?.text, isEmpty);
    expect(find.text('Pilih foto KTP'), findsOneWidget);
  });

  testWidgets('system back di langkah 3 kembali ke langkah 2', (tester) async {
    await _pump(tester, _gate(_eligibility()), pickKtp: _fakeKtp);
    await _startWizard(tester);
    await _fillProfileAndContinue(tester);
    expect(find.text('Langkah 3 dari 5 · Legalitas'), findsOneWidget);

    await tester.binding.handlePopRoute();
    await tester.pump();
    expect(find.text('Langkah 2 dari 5 · Profil grup'), findsOneWidget);
  });

  testWidgets('retry setelah gagal jaringan tidak mengunggah KTP dua kali', (
    tester,
  ) async {
    var ktpUploads = 0;
    var posts = 0;
    await _pump(tester, (request) async {
      final path = request.url.path;
      if (path.endsWith('/vendor-applications/eligibility')) {
        return _json({'data': _eligibility()});
      }
      if (path.endsWith('/regions')) return _json({'items': _regions});
      if (request.method == 'POST' &&
          path.endsWith('/vendor-applications/ktp')) {
        ktpUploads += 1;
        return _json({
          'data': {'ktp_object_key': 'private/ktp/app-1.jpg'},
        }, 201);
      }
      if (request.method == 'POST' &&
          path.endsWith('/vendor-applications')) {
        posts += 1;
        if (posts == 1) throw http.ClientException('offline');
        return _json({'data': _submittedView()}, 201);
      }
      return _notFound();
    }, pickKtp: _fakeKtp);

    await _startWizard(tester);
    await _fillProfileAndContinue(tester);
    await _fillLegalityAndContinue(tester);
    await _fillOperationsAndContinue(tester);

    await _tapAndSettle(tester, find.text('Kirim pengajuan'));
    expect(ktpUploads, 1);
    expect(posts, 1);
    expect(find.textContaining('Koneksi ke server gagal'), findsOneWidget);

    await _tapAndSettle(tester, find.text('Kirim pengajuan'));
    expect(ktpUploads, 1);
    expect(posts, 2);
    expect(find.text('Menunggu pemeriksaan admin'), findsOneWidget);
  });

  testWidgets('400 CATEGORY_INACTIVE kembali ke langkah 2 dengan error', (
    tester,
  ) async {
    await _pump(tester, (request) async {
      final path = request.url.path;
      if (path.endsWith('/vendor-applications/eligibility')) {
        return _json({'data': _eligibility()});
      }
      if (path.endsWith('/regions')) return _json({'items': _regions});
      if (request.method == 'POST' &&
          path.endsWith('/vendor-applications/ktp')) {
        return _json({
          'data': {'ktp_object_key': 'private/ktp/app-1.jpg'},
        }, 201);
      }
      if (request.method == 'POST' &&
          path.endsWith('/vendor-applications')) {
        return _json({
          'error': {
            'code': 'VALIDATION_ERROR',
            'message': 'Kategori tidak aktif.',
            'details': {'reason': 'CATEGORY_INACTIVE'},
          },
        }, 400);
      }
      return _notFound();
    }, pickKtp: _fakeKtp);

    await _startWizard(tester);
    await _fillProfileAndContinue(tester);
    await _fillLegalityAndContinue(tester);
    await _fillOperationsAndContinue(tester);
    await _tapAndSettle(tester, find.text('Kirim pengajuan'));

    expect(find.text('Langkah 2 dari 5 · Profil grup'), findsOneWidget);
    expect(
      find.text('Kategori ini sudah tidak aktif. Pilih kategori lain.'),
      findsOneWidget,
    );
  });

  testWidgets('kategori yang sudah hilang tidak diprefill', (tester) async {
    await _pump(
      tester,
      _gate(
        _eligibility(
          application: _rejectedApplication(categorySlug: 'legacy-orkes'),
        ),
      ),
    );

    await _tapAndSettle(tester, find.text('Ajukan ulang'));
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await _tapAndSettle(tester, find.text('Lanjut'));
    expect(find.text('Langkah 2 dari 5 · Profil grup'), findsOneWidget);

    await _tapAndSettle(tester, find.text('Lanjut'));
    expect(find.text('Pilih kategori vendor.'), findsOneWidget);
    expect(find.text('Langkah 2 dari 5 · Profil grup'), findsOneWidget);
  });

  testWidgets('alur 5 langkah muat di 360 px mode gelap', (tester) async {
    await _pump(tester, (request) async {
      final path = request.url.path;
      if (path.endsWith('/vendor-applications/eligibility')) {
        return _json({'data': _eligibility()});
      }
      if (path.endsWith('/regions')) return _json({'items': _regions});
      if (request.method == 'POST' &&
          path.endsWith('/vendor-applications/ktp')) {
        return _json({
          'data': {'ktp_object_key': 'private/ktp/app-1.jpg'},
        }, 201);
      }
      if (request.method == 'POST' &&
          path.endsWith('/vendor-applications')) {
        return _json({'data': _submittedView()}, 201);
      }
      return _notFound();
    }, pickKtp: _fakeKtp, width: 360, dark: true);

    await _startWizard(tester);
    await _fillProfileAndContinue(tester);
    await _fillLegalityAndContinue(tester);
    await _fillOperationsAndContinue(tester);
    expect(find.text('Langkah 5 dari 5 · Ringkasan'), findsOneWidget);

    await _tapAndSettle(tester, find.text('Kirim pengajuan'));
    expect(find.text('Menunggu pemeriksaan admin'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('PolicySheet panjang merender sections tanpa fetch', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Scaffold(
          body: PolicySheet(
            code: 'vendor_terms',
            title: 'Ketentuan Mitra',
            preloaded: Policy.fromJson(_policy()),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.textContaining('Ketentuan singkat'), findsOneWidget);
    expect(find.text('Kewajiban vendor'), findsOneWidget);
    expect(
      find.textContaining('Vendor hadir tepat waktu'),
      findsOneWidget,
    );
    expect(find.text('Ringkasan'), findsNothing);
  });

  test('toJson mengirim integer dan portfolio null', () {
    const draft = VendorApplicationDraft(
      displayName: ' Grup Nada ',
      legalName: 'Budi Santoso',
      nik: '1234567890123456',
      regionCode: 'PB',
      baseAddress: 'Jl. Merdeka 10, Pemalang',
      categorySlug: 'tarling',
      description: _description,
      yearsActive: '5',
      personnelCount: '12',
      equipmentSummary: _equipment,
      portfolioUrl: '',
    );

    final body = draft.toJson('policy-vendor-3');

    expect(body['display_name'], 'Grup Nada');
    expect(body['years_active'], isA<int>());
    expect(body['years_active'], 5);
    expect(body['personnel_count'], isA<int>());
    expect(body['personnel_count'], 12);
    expect(body['portfolio_url'], isNull);
    expect(body['agreement_policy_version_id'], 'policy-vendor-3');
    expect(draft.validateAll(), isEmpty);
  });

  test('validator portofolio: https wajib, kosong boleh', () {
    expect(validatePortfolioUrl(''), isNull);
    expect(validatePortfolioUrl('http://contoh.id'), isNotNull);
    expect(validatePortfolioUrl('https://contoh.id/portofolio'), isNull);
    expect(validatePortfolioUrl('https://${'a' * 300}'), isNotNull);
  });

  test('retry_after_seconds dibaca lebih dulu, retry_after jadi cadangan', () {
    const current = ApiException(
      code: 'RESUBMIT_LIMIT',
      message: 'x',
      statusCode: 429,
      details: {'retry_after_seconds': 7200},
    );
    expect(vendorRetryAfterText(current), 'Coba lagi dalam 2 jam.');

    const legacy = ApiException(
      code: 'RESUBMIT_LIMIT',
      message: 'x',
      statusCode: 429,
      details: {'retry_after': 3600},
    );
    expect(vendorRetryAfterText(legacy), 'Coba lagi dalam 1 jam.');

    const withoutWait = ApiException(
      code: 'RESUBMIT_LIMIT',
      message: 'x',
      statusCode: 429,
    );
    expect(vendorRetryAfterText(withoutWait), isNull);
  });

  test('403 tanpa reason tidak dianggap email belum terverifikasi', () {
    const forbidden = ApiException(
      code: 'FORBIDDEN',
      message: 'x',
      statusCode: 403,
    );
    expect(classifyVendorSubmitError(forbidden), VendorSubmitFailure.other);

    const email = ApiException(
      code: 'EMAIL_NOT_VERIFIED',
      message: 'x',
      statusCode: 403,
    );
    expect(
      classifyVendorSubmitError(email),
      VendorSubmitFailure.emailNotVerified,
    );

    const category = ApiException(
      code: 'VALIDATION_ERROR',
      message: 'x',
      statusCode: 400,
      details: {'reason': 'CATEGORY_INACTIVE'},
    );
    expect(
      classifyVendorSubmitError(category),
      VendorSubmitFailure.categoryInvalid,
    );

    const region = ApiException(
      code: 'VALIDATION_ERROR',
      message: 'x',
      statusCode: 400,
      details: {'reason': 'REGION_UNKNOWN'},
    );
    expect(
      classifyVendorSubmitError(region),
      VendorSubmitFailure.regionInvalid,
    );
  });

  test('form_version dan agreement_version dibaca sebagai int', () {
    final view = VendorApplicationView.fromJson({
      'id': 'app-1',
      'status': 'rejected',
      'form_version': 2,
      'agreement_version': 7,
    });

    expect(view.formVersion, 2);
    expect(view.agreementVersion, 7);
  });
}
