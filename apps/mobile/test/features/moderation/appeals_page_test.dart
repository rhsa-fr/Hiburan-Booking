import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:tarlink_customer/app/app.dart';
import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/core/api_client.dart';
import 'package:tarlink_customer/core/session.dart';
import 'package:tarlink_customer/features/moderation/appeals_page.dart';

const _reportId = '6a0b2711-93cf-4adc-a3e5-8ca44f577d4e';

Map<String, dynamic> _takedown({
  String? appealStatus,
  String? decisionNote,
}) => {
  'report_id': _reportId,
  'target_type': 'review',
  'target_id': '02111620-b1b4-4af5-b06b-77067c93e606',
  'reason': 'copyright',
  'resolved_at': '2026-11-07T03:00:00.000Z',
  'appeal_deadline_at': '2027-01-01T03:00:00.000Z',
  'appeal_id': appealStatus == null ? null : '5abd251c-d5aa-461b-bf9b-e510d38032bd',
  'appeal_status': appealStatus,
  'appeal_created_at': appealStatus == null ? null : '2026-11-08T03:00:00.000Z',
  'appeal_decided_at': appealStatus == null ? null : '2026-11-08T04:00:00.000Z',
  'appeal_decision_note': decisionNote,
};

http.Response _json(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Future<void> _pump(
  WidgetTester tester,
  Future<http.Response> Function(http.Request) handler,
) async {
  final session = Session();
  final api = ApiClient(
    session: session,
    client: MockClient(handler),
    baseUrl: 'http://localhost:3001',
  );
  tester.view.physicalSize = const Size(400, 2400);
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
      child: MaterialApp(theme: buildTheme(), home: const AppealsPage()),
    ),
  );
  await tester.pump();
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

void main() {
  testWidgets('menampilkan takedown dan mengirim banding', (tester) async {
    Map<String, dynamic>? posted;
    await _pump(tester, (request) async {
      if (request.url.path.endsWith('/reports/against-me')) {
        return _json({
          'data': {
            'items': [_takedown()],
            'total': 1,
            'page': 1,
            'page_size': 50,
          },
        });
      }
      if (request.method == 'POST' &&
          request.url.path.endsWith('/reports/$_reportId/appeal')) {
        posted = jsonDecode(request.body) as Map<String, dynamic>;
        return _json({
          'data': {
            'id': '5abd251c-d5aa-461b-bf9b-e510d38032bd',
            'report_id': _reportId,
            'status': 'pending',
          },
        }, 201);
      }
      return _json({'error': {'code': 'NOT_FOUND', 'message': 'x'}}, 404);
    });

    expect(find.text('Banding konten'), findsOneWidget);
    expect(find.text('Ulasan'), findsOneWidget);
    expect(find.text('Ajukan banding'), findsOneWidget);

    await tester.tap(find.text('Ajukan banding'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Ajukan banding'), findsWidgets);
    expect(find.text('Kirim banding'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Alasan banding'),
      'Konten ini pengalaman saya sendiri dan tidak melanggar hak cipta.',
    );
    await tester.tap(find.text('Kirim banding'));
    await tester.pump();
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }

    expect(posted?['reason'], contains('pengalaman saya sendiri'));
    expect(find.textContaining('Banding terkirim'), findsOneWidget);
  });

  testWidgets('banding yang sudah diputuskan menampilkan catatan', (
    tester,
  ) async {
    await _pump(tester, (request) async {
      return _json({
        'data': {
          'items': [
            _takedown(
              appealStatus: 'rejected',
              decisionNote: 'Bukti tidak cukup; takedown dipertahankan.',
            ),
          ],
          'total': 1,
          'page': 1,
          'page_size': 50,
        },
      });
    });

    expect(find.text('Ditolak'), findsOneWidget);
    expect(
      find.textContaining('Bukti tidak cukup'),
      findsOneWidget,
    );
    expect(find.text('Ajukan banding'), findsNothing);
  });
}
