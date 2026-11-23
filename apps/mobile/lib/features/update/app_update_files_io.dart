import 'dart:io';

import 'package:http/http.dart' as http;

import 'app_update_files_base.dart';
import 'app_update_models.dart';

/// Native implementation (Android, iOS, desktop, `flutter test`).
AppUpdateFileStore createAppUpdateFileStore(http.Client client) =>
    IoAppUpdateFileStore(client);

class IoAppUpdateFileStore implements AppUpdateFileStore {
  IoAppUpdateFileStore(this._client);

  final http.Client _client;

  @override
  Future<String> download({
    required Uri url,
    required String directory,
    required String fileName,
    required int? expectedBytes,
    required void Function(int received, int? total) onProgress,
    required AppUpdateCancelToken cancel,
  }) async {
    final dir = Directory(directory);
    final file = File('${dir.path}${Platform.pathSeparator}$fileName');
    try {
      await dir.create(recursive: true);
    } on FileSystemException catch (error) {
      throw _mapFileSystemError(error);
    }

    final http.StreamedResponse response;
    try {
      response = await _client.send(http.Request('GET', url));
    } catch (error) {
      throw AppUpdateException(AppUpdateError.network, error);
    }
    if (response.statusCode != 200) {
      throw AppUpdateException(AppUpdateError.network, response.statusCode);
    }

    final total = response.contentLength ?? expectedBytes;
    var received = 0;
    IOSink? sink;
    try {
      sink = file.openWrite();
      await for (final chunk in response.stream) {
        if (cancel.isCancelled) {
          throw const AppUpdateException(AppUpdateError.cancelled);
        }
        sink.add(chunk);
        received += chunk.length;
        onProgress(received, total);
      }
      await sink.flush();
      await sink.close();
      sink = null;
    } on AppUpdateException {
      await _closeQuietly(sink);
      await _deleteQuietly(file);
      rethrow;
    } on FileSystemException catch (error) {
      await _closeQuietly(sink);
      await _deleteQuietly(file);
      throw _mapFileSystemError(error);
    } catch (error) {
      await _closeQuietly(sink);
      await _deleteQuietly(file);
      throw AppUpdateException(AppUpdateError.interrupted, error);
    }

    if (cancel.isCancelled) {
      await _deleteQuietly(file);
      throw const AppUpdateException(AppUpdateError.cancelled);
    }
    // A truncated body would fail the SHA check anyway; catching it here keeps
    // the message honest ("interrupted", not "corrupt").
    if (expectedBytes != null &&
        expectedBytes > 0 &&
        received != expectedBytes) {
      await _deleteQuietly(file);
      throw AppUpdateException(AppUpdateError.interrupted, received);
    }
    return file.path;
  }

  @override
  Future<void> delete(String path) => _deleteQuietly(File(path));

  @override
  Future<bool> exists(String path) => File(path).exists();
}

AppUpdateException _mapFileSystemError(FileSystemException error) {
  // ENOSPC: 28 on Linux/Android/macOS, 112 (ERROR_DISK_FULL) on Windows.
  const diskFullCodes = <int>{28, 39, 112};
  final code = error.osError?.errorCode;
  if (code != null && diskFullCodes.contains(code)) {
    return AppUpdateException(AppUpdateError.diskFull, error);
  }
  return AppUpdateException(AppUpdateError.interrupted, error);
}

Future<void> _closeQuietly(IOSink? sink) async {
  if (sink == null) return;
  try {
    await sink.close();
  } catch (_) {
    // The file is deleted right after this anyway.
  }
}

Future<void> _deleteQuietly(File file) async {
  try {
    if (await file.exists()) await file.delete();
  } catch (_) {
    // Best effort: a locked file is replaced by the next download attempt.
  }
}
