
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tarlink_customer/core/ui.dart';
import 'package:tarlink_customer/core/widgets.dart';
import 'package:tarlink_customer/features/booking/status_page.dart';
import 'package:tarlink_customer/features/discovery/vendor_page.dart';
import 'package:tarlink_customer/main.dart' as app;

import 'e2e_support.dart';

/// Pass visual saja: login -> 5 layar utama, tanpa mengubah data apa pun.
/// Booking yang dibuka adalah booking demo yang sudah DP (bukan hasil test ini).
const _demoBooking = 'BK-261028-33D9';

Future<void> _waitForAny(
  WidgetTester tester,
  List<Finder> finders, {
  Duration timeout = const Duration(seconds: 40),
  String? label,
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (finders.any((f) => f.evaluate().isNotEmpty)) return;
    await tester.pump(const Duration(milliseconds: 150));
  }
  fail('waitForAny: ${label ?? 'target'} tidak muncul dalam ${timeout.inSeconds}s');
}

int _starts = 0;

void main() {
  initE2e();

  testWidgets('visual review pass', (tester) async {
    final previousOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      debugPrint('E2E FLUTTER ERROR: ${details.exceptionAsString()}');
      previousOnError?.call(details);
    };
    addTearDown(() => FlutterError.onError = previousOnError);
    _starts += 1;
    debugPrint('E2E START #$_starts');
    app.main();
    // `flutter drive` di web menjalankan body ini lebih dari sekali, dan run
    // berikutnya hidup di isolate baru (flag statis tidak menolong). Run itu
    // mulai ketika run pertama sudah login dan berada di rute lain, sehingga
    // Welcome/Beranda tidak pernah muncul. Tunggu shell apa pun dulu, lalu
    // keluar bila ternyata bukan layar awal.
    await _waitForAny(tester, [
      find.text('Mulai cari hiburan'),
      find.text('Vendor Siap Tanggap'),
      find.byType(Scaffold),
    ], label: 'shell aplikasi');
    if (find.text('Mulai cari hiburan').evaluate().isEmpty &&
        find.text('Vendor Siap Tanggap').evaluate().isEmpty) {
      return;
    }
    if (find.text('Mulai cari hiburan').evaluate().isNotEmpty) {
      await shot(tester, 'ui-00-welcome');
      await tester.tap(find.byType(TextButton));
      await tester.pump(const Duration(milliseconds: 500));
      await waitFor(tester, find.text('Masuk atau Daftar'), label: 'Login');
      await shot(tester, 'ui-00-login');
      await login(tester);
    } else {
      await loginIfNeeded(tester);
    }
    await shot(tester, 'ui-01-beranda');

    // Beranda -> detail vendor pertama.
    final card = find.byType(VendorCard).first;
    await tester.ensureVisible(card);
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(card);
    await waitFor(tester, find.byType(VendorPage), label: 'detail vendor');
    // The bottom bar only appears once the vendor payload has arrived.
    final deadline = DateTime.now().add(const Duration(seconds: 30));
    while (DateTime.now().isBefore(deadline) &&
        find.text('Pilih jadwal').evaluate().isEmpty &&
        find.byType(AppError).evaluate().isEmpty) {
      await tester.pump(const Duration(milliseconds: 150));
    }
    // Transisi rute di web butuh beberapa frame nyata sebelum screenshot.
    await tester.pump(const Duration(milliseconds: 1200));
    await tester.pump(const Duration(milliseconds: 800));
    await waitFor(
      tester,
      find.text('Detail Grup Hiburan'),
      label: 'header vendor',
    );
    // Penanda ISI yang sudah terlihat di viewport pertama (nama grup + jumlah
    // paket). Judul section "Paket" ada di bawah lipatan, jadi tidak dipakai.
    final isiDeadline = DateTime.now().add(const Duration(seconds: 40));
    while (DateTime.now().isBefore(isiDeadline) &&
        find.textContaining('paket').evaluate().isEmpty) {
      await tester.pump(const Duration(milliseconds: 150));
    }
    if (find.textContaining('paket').evaluate().isEmpty) {
      await shot(tester, 'ui-02-vendor-empty');
      fail('Isi vendor tidak termuat — lihat ui-02-vendor-empty.png');
    }
    // Regresi yang pernah terjadi: bottom bar membesar sampai body 0 px.
    // `'Pilih jadwal'` tetap ketemu di bottom bar, jadi hanya ukuran yang
    // membedakan layar kosong dari layar terisi.
    final vendorBody = find.byType(ListView);
    if (vendorBody.evaluate().isNotEmpty) {
      final height = tester.getSize(vendorBody.first).height;
      if (height <= 400) {
        fail('Body detail vendor kolaps (${height.toStringAsFixed(1)} px) — lihat ui-02-vendor.png');
      }
    }
    await shot(tester, 'ui-02-vendor');
    if (find.text('Pilih jadwal').evaluate().isEmpty) {
      fail('Detail vendor tidak termuat (lihat ui-02-vendor.png)');
    }
    // Gulir ke daftar paket + tombol pesan untuk bukti visual.
    await tester.drag(find.byType(ListView).first, const Offset(0, -900));
    await tester.pump(const Duration(milliseconds: 600));
    await shot(tester, 'ui-02b-vendor-paket');
    await popRoute(tester, find.byType(VendorPage));
    await tester.pump(const Duration(milliseconds: 500));
    await waitFor(tester, find.text('Beranda'), label: 'kembali');

    // Tab Jelajah.
    await tester.tap(find.text('Jelajah'));
    await tester.pump(const Duration(milliseconds: 600));
    await waitFor(tester, find.byType(SelectChip), label: 'chip wilayah');
    await shot(tester, 'ui-03-jelajah');

    // Tab Booking.
    await tester.tap(find.text('Booking'));
    await tester.pump(const Duration(milliseconds: 600));
    final demo = find.text(_demoBooking);
    await waitFor(tester, demo, label: 'daftar booking');
    await shot(tester, 'ui-04-booking');

    await tester.tap(demo);
    await waitFor(tester, find.byType(BookingStatusPage), label: 'status');
    await tester.pump(const Duration(milliseconds: 1200));
    await shot(tester, 'ui-05-status');
    await popRoute(tester, find.byType(BookingStatusPage));
    await tester.pump(const Duration(milliseconds: 400));

    // Tab Profil.
    await tester.tap(find.text('Profil'));
    await tester.pump(const Duration(milliseconds: 600));
    await waitFor(tester, find.text('Bantuan & kebijakan'), label: 'profil');
    await shot(tester, 'ui-06-profil');
  });
}
