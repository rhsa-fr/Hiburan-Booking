import 'app_update_models.dart';

/// Disk access for the downloader, implemented per platform
/// (`dart:io` on mobile, a throwing stub on web) so the dependency list stays
/// unchanged and the web build keeps compiling.
abstract class AppUpdateFileStore {
  /// Streams [url] into `<directory>/<fileName>` and returns the absolute path.
  ///
  /// [expectedBytes] is the size declared by the manifest; a short file is
  /// treated as an interrupted download. [cancel] is checked between chunks.
  Future<String> download({
    required Uri url,
    required String directory,
    required String fileName,
    required int? expectedBytes,
    required void Function(int received, int? total) onProgress,
    required AppUpdateCancelToken cancel,
  });

  Future<void> delete(String path);

  Future<bool> exists(String path);
}
