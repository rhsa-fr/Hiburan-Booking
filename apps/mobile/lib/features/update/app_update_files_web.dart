import 'package:http/http.dart' as http;

import 'app_update_files_base.dart';
import 'app_update_models.dart';

/// Web build: the in-app APK install does not exist there, so every call fails
/// with a clear error instead of pretending to download.
AppUpdateFileStore createAppUpdateFileStore(http.Client client) =>
    const UnsupportedAppUpdateFileStore();

class UnsupportedAppUpdateFileStore implements AppUpdateFileStore {
  const UnsupportedAppUpdateFileStore();

  @override
  Future<String> download({
    required Uri url,
    required String directory,
    required String fileName,
    required int? expectedBytes,
    required void Function(int received, int? total) onProgress,
    required AppUpdateCancelToken cancel,
  }) async {
    throw const AppUpdateException(AppUpdateError.unsupported);
  }

  @override
  Future<void> delete(String path) async {}

  @override
  Future<bool> exists(String path) async => false;
}
