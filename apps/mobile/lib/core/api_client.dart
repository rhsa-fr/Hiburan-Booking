import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_exception.dart';
import 'session.dart';

/// One HTTP door to the API: /v1 prefix, bearer auth, one refresh-and-retry on
/// 401, error-envelope mapping, 20s timeout.
class ApiClient {
  ApiClient({required this.session, http.Client? client, String? baseUrl})
    : _client = client ?? http.Client(),
      baseUrl = _normalize(
        baseUrl ??
            const String.fromEnvironment(
              'API_BASE_URL',
              defaultValue: 'http://localhost:3001',
            ),
      );

  static const Duration timeout = Duration(seconds: 20);
  static const String _refreshPath = '/auth/refresh';

  final Session session;
  final http.Client _client;

  /// Full base incl. `/v1` (e.g. `http://localhost:3001/v1`).
  final String baseUrl;

  Future<bool>? _refreshing;

  Future<dynamic> get(
    String path, {
    Map<String, String?>? query,
    Map<String, String>? headers,
    bool auth = true,
  }) => _send('GET', path, query: query, headers: headers, auth: auth);

  Future<dynamic> post(
    String path, {
    Map<String, String?>? query,
    Object? body,
    Map<String, String>? headers,
    bool auth = true,
  }) => _send(
    'POST',
    path,
    query: query,
    body: body,
    headers: headers,
    auth: auth,
  );

  Future<dynamic> patch(
    String path, {
    Map<String, String?>? query,
    Object? body,
    Map<String, String>? headers,
    bool auth = true,
  }) => _send(
    'PATCH',
    path,
    query: query,
    body: body,
    headers: headers,
    auth: auth,
  );

  Future<dynamic> put(
    String path, {
    Map<String, String?>? query,
    Object? body,
    Map<String, String>? headers,
    bool auth = true,
  }) => _send(
    'PUT',
    path,
    query: query,
    body: body,
    headers: headers,
    auth: auth,
  );

  Future<dynamic> delete(
    String path, {
    Map<String, String?>? query,
    Map<String, String>? headers,
    bool auth = true,
  }) => _send('DELETE', path, query: query, headers: headers, auth: auth);

  /// Multipart upload (vendor media). Rebuilds the request on a 401 retry
  /// because a sent multipart stream cannot be reused.
  Future<dynamic> uploadFile(
    String path, {
    required String filename,
    required List<int> bytes,
    bool auth = true,
  }) async {
    var response = await _attemptUpload(
      path,
      filename: filename,
      bytes: bytes,
      auth: auth,
    );

    if (response.statusCode == 401 && auth) {
      final refreshed = await refreshSession();
      if (refreshed) {
        response = await _attemptUpload(
          path,
          filename: filename,
          bytes: bytes,
          auth: auth,
        );
      } else {
        await session.clear();
      }
    }

    return _decode(response);
  }

  /// Refreshes once and shares the in-flight attempt between callers.
  Future<bool> refreshSession() {
    final running = _refreshing;
    if (running != null) return running;
    final future = _refresh().whenComplete(() => _refreshing = null);
    _refreshing = future;
    return future;
  }

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, String?>? query,
    Object? body,
    Map<String, String>? headers,
    required bool auth,
  }) async {
    var response = await _attempt(
      method,
      path,
      query: query,
      body: body,
      headers: headers,
      auth: auth,
    );

    if (response.statusCode == 401 && auth) {
      final refreshed = await refreshSession();
      if (refreshed) {
        response = await _attempt(
          method,
          path,
          query: query,
          body: body,
          headers: headers,
          auth: auth,
        );
      } else {
        await session.clear();
      }
    }

    return _decode(response);
  }

  Future<bool> _refresh() async {
    final refreshToken = session.refreshToken;
    // Legacy clients with only an access token still use the Bearer path.
    if (refreshToken == null && session.token == null) return false;
    try {
      final response = await _attempt(
        'POST',
        _refreshPath,
        body: refreshToken == null ? null : {'refresh_token': refreshToken},
        auth: refreshToken == null,
      );
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final decoded = _decode(response);
        if (decoded is Map && decoded['access_token'] is String) {
          await session.applySession(decoded.cast<String, dynamic>());
          return true;
        }
        return false;
      }
      if (response.statusCode == 401 || response.statusCode == 403) {
        await session.clear();
      }
    } on ApiException catch (error) {
      if (error.isAuth) await session.clear();
    } catch (_) {
      // Refresh is best effort; the caller falls back to the original 401.
    }
    return false;
  }

  Future<http.Response> _attempt(
    String method,
    String path, {
    Map<String, String?>? query,
    Object? body,
    Map<String, String>? headers,
    bool auth = true,
  }) async {
    final request = http.Request(method, _uri(path, query));
    request.headers.addAll(_jsonHeaders);
    if (headers != null) request.headers.addAll(headers);
    final token = session.token;
    if (auth && token != null && !request.headers.containsKey('Authorization')) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    if (body != null) request.body = jsonEncode(body);

    try {
      final streamed = await _client.send(request).timeout(timeout);
      return await http.Response.fromStream(streamed).timeout(timeout);
    } on TimeoutException {
      throw const ApiException(
        code: 'TIMEOUT',
        message: 'Server tidak menjawab. Periksa sinyal, lalu coba lagi.',
      );
    } on ApiException {
      rethrow;
    } catch (_) {
      throw const ApiException(
        code: 'NETWORK_ERROR',
        message:
            'Tidak bisa terhubung ke server. Periksa sinyal internet, lalu coba lagi.',
      );
    }
  }

  Future<http.Response> _attemptUpload(
    String path, {
    required String filename,
    required List<int> bytes,
    required bool auth,
  }) async {
    final request = http.MultipartRequest('POST', _uri(path, null));
    request.headers['Accept'] = 'application/json';
    final token = session.token;
    if (auth && token != null) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    request.files.add(
      http.MultipartFile.fromBytes('file', bytes, filename: filename),
    );

    try {
      final streamed = await _client.send(request).timeout(timeout);
      return await http.Response.fromStream(streamed).timeout(timeout);
    } on TimeoutException {
      throw const ApiException(
        code: 'TIMEOUT',
        message: 'Server tidak menjawab. Periksa sinyal, lalu coba lagi.',
      );
    } on ApiException {
      rethrow;
    } catch (_) {
      throw const ApiException(
        code: 'NETWORK_ERROR',
        message:
            'Tidak bisa terhubung ke server. Periksa sinyal internet, lalu coba lagi.',
      );
    }
  }

  dynamic _decode(http.Response response) {
    dynamic body;
    if (response.bodyBytes.isNotEmpty) {
      try {
        body = jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {
        body = null;
      }
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (body is Map && body.containsKey('data')) return body['data'];
      return body;
    }

    final error = body is Map ? body['error'] : null;
    if (error is Map) {
      throw ApiException(
        code: '${error['code'] ?? 'INTERNAL_ERROR'}',
        message: '${error['message'] ?? 'Permintaan gagal diproses.'}',
        details: error['details'],
        statusCode: response.statusCode,
      );
    }
    throw ApiException(
      code: response.statusCode == 401 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR',
      message: 'Permintaan gagal (${response.statusCode}).',
      statusCode: response.statusCode,
    );
  }

  Uri _uri(String path, Map<String, String?>? query) {
    final uri = Uri.parse('$baseUrl$path');
    if (query == null || query.isEmpty) return uri;
    final params = <String, String>{
      for (final entry in query.entries)
        if (entry.value != null) entry.key: entry.value!,
    };
    if (params.isEmpty) return uri;
    return uri.replace(queryParameters: params);
  }

  static const Map<String, String> _jsonHeaders = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  static String _normalize(String base) {
    var value = base.trim();
    while (value.endsWith('/')) {
      value = value.substring(0, value.length - 1);
    }
    return value.endsWith('/v1') ? value : '$value/v1';
  }

  void close() => _client.close();
}
