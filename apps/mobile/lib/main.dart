import 'package:flutter/material.dart';

import 'app/app.dart';
import 'core/api_client.dart';
import 'core/session.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final session = Session();
  final api = ApiClient(session: session);
  session.attachRefresh(() async {
    await api.refreshSession();
  });

  // Never blocks the first frame on a dead network: restore catches its own
  // failures and leaves a readable notice for Login.
  await session.restore();

  runApp(TarlinkApp(session: session, api: api));
}
