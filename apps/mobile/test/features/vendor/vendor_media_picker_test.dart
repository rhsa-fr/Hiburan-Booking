import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/api_exception.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/vendor/vendor_manage_profile_page.dart';
import 'package:tarlink_customer/features/vendor/vendor_media_picker.dart';
import 'package:tarlink_customer/features/vendor/vendor_package_edit_page.dart';

void main() {
  group('VendorMediaPicker result mapping', () {
    test('VendorMediaUpload.fromJson parses full media payload', () {
      final json = {
        'id': 'med-101',
        'url': 'https://storage.tarlink.test/media/pic1.jpg',
        'status': 'pending',
        'kind': 'gallery',
        'package_id': 'pkg-5',
        'review_note': null,
      };

      final upload = VendorMediaUpload.fromJson(json);
      expect(upload.id, 'med-101');
      expect(upload.url, 'https://storage.tarlink.test/media/pic1.jpg');
      expect(upload.status, 'pending');
      expect(upload.isPending, isTrue);
      expect(upload.isApproved, isFalse);
      expect(upload.kind, 'gallery');
      expect(upload.packageId, 'pkg-5');
    });

    test('sendMultipartUploadForTesting parses 200 response with data.media', () async {
      final session = Session();
      final mockClient = MockClient((request) async {
        expect(request.url.path, endsWith('/vendor/media'));
        return http.Response(
          jsonEncode({
            'data': {
              'media': {
                'id': 'med-202',
                'url': 'https://storage.tarlink.test/media/uploaded.jpg',
                'status': 'pending',
                'kind': 'avatar',
              },
            },
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final api = ApiClient(
        session: session,
        client: mockClient,
        baseUrl: 'http://localhost:3001',
      );

      final result = await sendMultipartUploadForTesting(
        api: api,
        filename: 'test.jpg',
        bytes: [1, 2, 3],
        kind: 'avatar',
        licenseStatement: 'Pernyataan lisensi media sah',
        httpClient: mockClient,
      );

      expect(result.id, 'med-202');
      expect(result.url, 'https://storage.tarlink.test/media/uploaded.jpg');
      expect(result.status, 'pending');
    });

    test('sendMultipartUploadForTesting throws ApiException on error response', () async {
      final session = Session();
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {
              'code': 'MEDIA_NOT_APPROVED',
              'message': 'Media belum disetujui admin.',
            },
          }),
          400,
          headers: {'content-type': 'application/json'},
        );
      });

      final api = ApiClient(
        session: session,
        client: mockClient,
        baseUrl: 'http://localhost:3001',
      );

      expect(
        () => sendMultipartUploadForTesting(
          api: api,
          filename: 'test.jpg',
          bytes: [1, 2, 3],
          kind: 'avatar',
          licenseStatement: 'Pernyataan lisensi media sah',
          httpClient: mockClient,
        ),
        throwsA(isA<ApiException>().having(
          (e) => e.code,
          'code',
          'MEDIA_NOT_APPROVED',
        )),
      );
    });
  });

  group('VendorManageProfilePage media state & verification', () {
    late Session session;
    late Map<String, dynamic> initialVendorMe;
    Map<String, dynamic>? patchedBody;

    setUp(() {
      session = Session();
      patchedBody = null;
      initialVendorMe = {
        'display_name': 'Grup Tarling Asik',
        'legal_name': 'PT Tarling Asik',
        'description': 'Kesenian tradisional pantura',
        'base_address': 'Kec. Lohbener, Indramayu',
        'service_radius_km': 30,
        'free_radius_km': 10,
        'transport_fee_per_km_idr': 12000,
        'min_dp_bp': 3000,
        'avatar_url': 'https://example.com/current_avatar.jpg',
        'banner_url': 'https://example.com/current_banner.jpg',
        'photo_urls': ['https://example.com/current_photo1.jpg'],
        'video_url': 'https://youtube.com/watch?v=abcdef',
      };
    });

    tearDown(() {
      session.dispose();
    });

    Future<void> pumpProfileWithPicker(
      WidgetTester tester, {
      required VendorMediaPickerFn picker,
    }) async {
      final mockClient = MockClient((request) async {
        if (request.method == 'GET' && request.url.path.endsWith('/vendor/me')) {
          return http.Response(
            jsonEncode(initialVendorMe),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (request.method == 'PATCH' && request.url.path.endsWith('/vendor/me')) {
          patchedBody = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            jsonEncode({'data': {'updated': true}}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        return http.Response('Not Found', 404);
      });

      final api = ApiClient(
        session: session,
        client: mockClient,
        baseUrl: 'http://localhost:3001',
      );

      tester.view.physicalSize = const Size(500, 3000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        AppScope(
          session: session,
          api: api,
          child: MaterialApp(
            theme: buildTheme(),
            home: VendorManageProfilePage(picker: picker),
          ),
        ),
      );

      await tester.pump();
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 20));
      }
    }

    testWidgets('cancelled result produces no change in state or UI', (tester) async {
      await pumpProfileWithPicker(
        tester,
        picker: (context, {kind = 'gallery', packageId}) async {
          return const VendorMediaPickResult.cancelled();
        },
      );

      // Verify initial UI loaded
      expect(find.text('Grup Tarling Asik'), findsOneWidget);
      expect(find.text('Menunggu tinjauan'), findsNothing);

      // Tap 'Ganti' on avatar tile (first Ganti button)
      final gantiButtons = find.text('Ganti');
      expect(gantiButtons, findsWidgets);
      await tester.tap(gantiButtons.first);
      await tester.pumpAndSettle();

      // Cancelled result produces no change: no SnackBar, no badge
      expect(find.byType(SnackBar), findsNothing);
      expect(find.text('Menunggu tinjauan'), findsNothing);
    });

    testWidgets('failed result surfaces a message in SnackBar', (tester) async {
      const errorMessage = 'Ukuran gambar maksimal 5 MB.';
      await pumpProfileWithPicker(
        tester,
        picker: (context, {kind = 'gallery', packageId}) async {
          return const VendorMediaPickResult.failed(errorMessage);
        },
      );

      // Tap 'Ganti' on avatar tile
      final gantiButtons = find.text('Ganti');
      await tester.tap(gantiButtons.first);
      await tester.pumpAndSettle();

      // SnackBar surfaces the message
      expect(find.text(errorMessage), findsOneWidget);
      expect(find.text('Menunggu tinjauan'), findsNothing);
    });

    testWidgets(
      'uploaded pending media is not written into public URL fields when saving',
      (tester) async {
        const pendingAvatarUrl = 'https://storage.tarlink.test/media/new_pending_avatar.jpg';

        await pumpProfileWithPicker(
          tester,
          picker: (context, {kind = 'gallery', packageId}) async {
            return const VendorMediaPickResult.uploaded(
              VendorMediaUpload(
                id: 'med-pending-avatar',
                url: pendingAvatarUrl,
                status: 'pending',
                kind: 'avatar',
              ),
            );
          },
        );

        // Tap 'Ganti' on avatar tile
        final gantiButtons = find.text('Ganti');
        await tester.tap(gantiButtons.first);
        await tester.pumpAndSettle();

        // Pending media renders as tile with 'Menunggu tinjauan' badge
        expect(find.text('Menunggu tinjauan'), findsOneWidget);

        // Tap 'Simpan perubahan'
        final simpanButton = find.text('Simpan perubahan');
        await tester.tap(simpanButton);
        await tester.pumpAndSettle();

        // Verify that PATCH body did NOT receive the pending media URL
        expect(patchedBody, isNotNull);
        expect(
          patchedBody!['avatar_url'],
          'https://example.com/current_avatar.jpg',
          reason: 'avatar_url must retain approved URL, not pending URL',
        );
        expect(patchedBody!['avatar_url'], isNot(equals(pendingAvatarUrl)));
        expect(patchedBody!['banner_url'], 'https://example.com/current_banner.jpg');
        expect(patchedBody!['photo_urls'], ['https://example.com/current_photo1.jpg']);
      },
    );

    testWidgets(
      'uploaded pending gallery photo renders badge and is not written to photo_urls',
      (tester) async {
        const pendingGalleryUrl = 'https://storage.tarlink.test/media/pending_gal.jpg';

        await pumpProfileWithPicker(
          tester,
          picker: (context, {kind = 'gallery', packageId}) async {
            return const VendorMediaPickResult.uploaded(
              VendorMediaUpload(
                id: 'med-gal-1',
                url: pendingGalleryUrl,
                status: 'pending',
                kind: 'gallery',
              ),
            );
          },
        );

        // Tap 'Tambah foto'
        final tambahFotoButton = find.text('Pilih dari galeri');
        expect(tambahFotoButton, findsOneWidget);
        await tester.tap(tambahFotoButton);
        await tester.pumpAndSettle();

        // Badge shows for pending gallery photo
        expect(find.text('Menunggu tinjauan'), findsOneWidget);

        // Tap 'Simpan perubahan'
        final simpanButton = find.text('Simpan perubahan');
        await tester.tap(simpanButton);
        await tester.pumpAndSettle();

        expect(patchedBody, isNotNull);
        expect(
          patchedBody!['photo_urls'],
          ['https://example.com/current_photo1.jpg'],
          reason: 'photo_urls must not include pending media',
        );
      },
    );

    testWidgets(
      'replacePhoto at specific index with pending media shows badge and keeps public urls intact',
      (tester) async {
        initialVendorMe['photo_urls'] = [
          'https://example.com/photo_slot_0.jpg',
          'https://example.com/photo_slot_1.jpg',
        ];
        const pendingUrl = 'https://storage.tarlink.test/media/pending_replacement.jpg';

        await pumpProfileWithPicker(
          tester,
          picker: (context, {kind = 'gallery', packageId}) async {
            return const VendorMediaPickResult.uploaded(
              VendorMediaUpload(
                id: 'med-rep-1',
                url: pendingUrl,
                status: 'pending',
                kind: 'gallery',
              ),
            );
          },
        );

        // Tap 'Ganti' for Galeri 2 (index 1)
        // Order of Ganti buttons: Avatar, Banner, Galeri 1, Galeri 2
        final gantiButtons = find.text('Ganti');
        expect(gantiButtons, findsNWidgets(4));
        await tester.tap(gantiButtons.at(3));
        await tester.pumpAndSettle();

        expect(find.text('Menunggu tinjauan'), findsOneWidget);

        // Save
        final simpanButton = find.text('Simpan perubahan');
        await tester.tap(simpanButton);
        await tester.pumpAndSettle();

        expect(patchedBody, isNotNull);
        expect(
          patchedBody!['photo_urls'],
          [
            'https://example.com/photo_slot_0.jpg',
            'https://example.com/photo_slot_1.jpg',
          ],
          reason: 'public photo_urls must retain approved URLs at both slots',
        );
      },
    );

    testWidgets(
      'replacePhoto at specific index with approved media replaces exactly that slot',
      (tester) async {
        initialVendorMe['photo_urls'] = [
          'https://example.com/photo_slot_0.jpg',
          'https://example.com/photo_slot_1.jpg',
        ];
        const newApprovedUrl = 'https://storage.tarlink.test/media/approved_replacement.jpg';

        await pumpProfileWithPicker(
          tester,
          picker: (context, {kind = 'gallery', packageId}) async {
            return const VendorMediaPickResult.uploaded(
              VendorMediaUpload(
                id: 'med-rep-approved',
                url: newApprovedUrl,
                status: 'approved',
                kind: 'gallery',
              ),
            );
          },
        );

        // Tap 'Ganti' for Galeri 2 (index 1)
        final gantiButtons = find.text('Ganti');
        expect(gantiButtons, findsNWidgets(4));
        await tester.tap(gantiButtons.at(3));
        await tester.pumpAndSettle();

        // Approved media: no 'Menunggu tinjauan' badge
        expect(find.text('Menunggu tinjauan'), findsNothing);

        // Save
        final simpanButton = find.text('Simpan perubahan');
        await tester.tap(simpanButton);
        await tester.pumpAndSettle();

        expect(patchedBody, isNotNull);
        expect(
          patchedBody!['photo_urls'],
          [
            'https://example.com/photo_slot_0.jpg',
            newApprovedUrl,
          ],
          reason: 'photo_urls slot 1 should be updated with new approved URL',
        );
      },
    );
  });

  group('VendorPackageEditPage media state & verification', () {
    late Session session;
    Map<String, dynamic>? patchedPackageBody;

    setUp(() {
      session = Session();
      patchedPackageBody = null;
    });

    tearDown(() {
      session.dispose();
    });

    Future<void> pumpPackageEditWithPicker(
      WidgetTester tester, {
      required VendorMediaPickerFn picker,
    }) async {
      final mockClient = MockClient((request) async {
        if (request.method == 'PATCH' && request.url.path.contains('/vendor/packages/pkg-123')) {
          patchedPackageBody = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            jsonEncode({'data': {'updated': true}}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        return http.Response('Not Found', 404);
      });

      final api = ApiClient(
        session: session,
        client: mockClient,
        baseUrl: 'http://localhost:3001',
      );

      tester.view.physicalSize = const Size(500, 3000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        AppScope(
          session: session,
          api: api,
          child: MaterialApp(
            theme: buildTheme(),
            home: VendorPackageEditPage(
              initial: {
                'id': 'pkg-123',
                'name': 'Paket Lengkap Campursari',
                'duration_minutes': 240,
                'personnel_count': 12,
                'base_price_idr': 5000000,
                'description': 'Deskripsi paket lengkap',
                'inclusions': ['Sound system', 'Panggung'],
                'photo_url': 'https://example.com/current_pkg.jpg',
                'is_active': true,
              },
              picker: picker,
            ),
          ),
        ),
      );

      await tester.pump();
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 20));
      }
    }

    testWidgets(
      'uploaded pending package photo shows badge and does not overwrite photo_url on save',
      (tester) async {
        const pendingPkgPhotoUrl = 'https://storage.tarlink.test/media/pending_pkg.jpg';

        await pumpPackageEditWithPicker(
          tester,
          picker: (context, {kind = 'gallery', packageId}) async {
            expect(kind, 'package_photo');
            expect(packageId, 'pkg-123');
            return const VendorMediaPickResult.uploaded(
              VendorMediaUpload(
                id: 'med-pkg-1',
                url: pendingPkgPhotoUrl,
                status: 'pending',
                kind: 'package_photo',
                packageId: 'pkg-123',
              ),
            );
          },
        );

        final gantiButtons = find.text('Ganti');
        expect(gantiButtons, findsOneWidget);
        await tester.tap(gantiButtons);
        await tester.pumpAndSettle();

        expect(find.text('Menunggu tinjauan'), findsOneWidget);

        final simpanButton = find.text('Simpan perubahan');
        await tester.tap(simpanButton);
        await tester.pumpAndSettle();

        expect(patchedPackageBody, isNotNull);
        expect(
          patchedPackageBody!['photo_url'],
          'https://example.com/current_pkg.jpg',
          reason: 'photo_url must retain approved URL and not write pending URL',
        );
      },
    );
  });
}
