import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';

import '../../app/app.dart';
import '../../core/api_client.dart';
import '../../core/api_exception.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

const int maxVendorImageBytes = 5 * 1024 * 1024;

/// Pick one image from the gallery, ask for a license statement, upload it
/// to `/vendor/media` with multipart fields (`kind`, `license_statement`,
/// optional `package_id`), and return `null`.
///
/// New uploads require admin review before appearing on the public profile.
/// Callers must never write an unapproved upload URL to profile/package fields.
Future<String?> pickAndUploadVendorImage(
  BuildContext context, {
  String kind = 'gallery',
  String? packageId,
}) async {
  final XFile? picked;
  try {
    picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 1600,
      imageQuality: 80,
    );
  } catch (error) {
    if (context.mounted) {
      _notice(context, 'Tidak bisa membuka galeri: $error');
    }
    return null;
  }
  if (picked == null) return null;
  if (!context.mounted) return null;

  final List<int> bytes;
  try {
    bytes = await picked.readAsBytes();
  } catch (error) {
    if (context.mounted) {
      _notice(context, 'Tidak bisa membaca gambar: $error');
    }
    return null;
  }
  if (!context.mounted) return null;
  if (bytes.length > maxVendorImageBytes) {
    _notice(context, 'Ukuran gambar maksimal 5 MB.');
    return null;
  }

  final licenseStatement = await _askLicenseStatement(context);
  if (licenseStatement == null || licenseStatement.trim().length < 10) {
    return null;
  }
  if (!context.mounted) return null;

  try {
    final api = AppScope.of(context).api;
    await _sendMultipartUpload(
      api: api,
      filename: picked.name,
      bytes: bytes,
      kind: kind,
      licenseStatement: licenseStatement.trim(),
      packageId: packageId,
    );
    if (!context.mounted) return null;
    _notice(
      context,
      'Media terkirim. Menunggu tinjauan admin sebelum tampil di profil.',
    );
    return null;
  } on ApiException catch (error) {
    if (context.mounted) _notice(context, _mapApiException(error));
    return null;
  } catch (error) {
    if (context.mounted) {
      _notice(context, 'Gagal mengunggah gambar: $error');
    }
    return null;
  }
}

Future<void> _sendMultipartUpload({
  required ApiClient api,
  required String filename,
  required List<int> bytes,
  required String kind,
  required String licenseStatement,
  String? packageId,
}) async {
  final uri = _resolveUri(api, '/vendor/media');
  final client = http.Client();
  http.Response response;
  try {
    final req1 = _createMultipartRequest(
      uri: uri,
      token: api.session.token,
      filename: filename,
      bytes: bytes,
      kind: kind,
      licenseStatement: licenseStatement,
      packageId: packageId,
    );
    final streamed1 = await client.send(req1).timeout(ApiClient.timeout);
    response = await http.Response.fromStream(streamed1).timeout(ApiClient.timeout);

    if (response.statusCode == 401) {
      final refreshed = await api.refreshSession();
      if (refreshed) {
        final req2 = _createMultipartRequest(
          uri: uri,
          token: api.session.token,
          filename: filename,
          bytes: bytes,
          kind: kind,
          licenseStatement: licenseStatement,
          packageId: packageId,
        );
        final streamed2 = await client.send(req2).timeout(ApiClient.timeout);
        response = await http.Response.fromStream(streamed2).timeout(ApiClient.timeout);
      } else {
        await api.session.clear();
      }
    }
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
      message: 'Tidak bisa terhubung ke server. Periksa sinyal internet, lalu coba lagi.',
    );
  } finally {
    client.close();
  }

  dynamic body;
  if (response.bodyBytes.isNotEmpty) {
    try {
      body = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      body = null;
    }
  }

  if (response.statusCode >= 200 && response.statusCode < 300) {
    return;
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
    code: 'HTTP_${response.statusCode}',
    message: 'Gagal mengunggah gambar (status ${response.statusCode}).',
    statusCode: response.statusCode,
  );
}

http.MultipartRequest _createMultipartRequest({
  required Uri uri,
  required String? token,
  required String filename,
  required List<int> bytes,
  required String kind,
  required String licenseStatement,
  String? packageId,
}) {
  final request = http.MultipartRequest('POST', uri);
  request.headers['Accept'] = 'application/json';
  if (token != null) {
    request.headers['Authorization'] = 'Bearer $token';
  }
  request.fields['kind'] = kind;
  request.fields['license_statement'] = licenseStatement;
  if (packageId != null && packageId.trim().isNotEmpty) {
    request.fields['package_id'] = packageId.trim();
  }
  request.files.add(
    http.MultipartFile.fromBytes('file', bytes, filename: filename),
  );
  return request;
}

Uri _resolveUri(ApiClient api, String path) {
  var base = api.baseUrl.trim();
  while (base.endsWith('/')) {
    base = base.substring(0, base.length - 1);
  }
  final cleanPath = path.startsWith('/') ? path : '/$path';
  return Uri.parse('$base$cleanPath');
}

Future<String?> _askLicenseStatement(BuildContext context) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: VendorColors.card,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(VendorRadii.md)),
    ),
    builder: (sheetContext) => const _LicenseStatementSheet(),
  );
}

class _LicenseStatementSheet extends StatefulWidget {
  const _LicenseStatementSheet();

  @override
  State<_LicenseStatementSheet> createState() => _LicenseStatementSheetState();
}

class _LicenseStatementSheetState extends State<_LicenseStatementSheet> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: 'Saya memiliki hak/lisensi atas media ini',
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = _controller.text.trim();
    final isValid = text.length >= 10;

    return SafeArea(
      child: SingleChildScrollView(
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            VendorSp.lg,
            VendorSp.lg,
            VendorSp.lg,
            VendorSp.lg + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Pernyataan Lisensi Media',
                style: vendorText(size: 15, weight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              Text(
                'Sebelum mengunggah, pastikan Anda memiliki hak cipta atau izin atas foto ini.',
                style: vendorText(size: 12, color: VendorColors.muted, height: 1.4),
              ),
              const SizedBox(height: VendorSp.md),
              VendorTextField(
                label: 'Pernyataan lisensi',
                controller: _controller,
                hint: 'Saya memiliki hak/lisensi atas media ini',
                helper: isValid
                    ? 'Minimal 10 karakter terpenuhi.'
                    : 'Minimal 10 karakter (${text.length}/10).',
                maxLines: 2,
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: VendorSp.lg),
              Row(
                children: [
                  Expanded(
                    child: VendorButton(
                      label: 'Batal',
                      kind: VendorButtonKind.secondary,
                      onPressed: () => Navigator.of(context).pop(null),
                    ),
                  ),
                  const SizedBox(width: VendorSp.sm),
                  Expanded(
                    child: VendorButton(
                      label: 'Unggah',
                      onPressed: isValid
                          ? () => Navigator.of(context).pop(text)
                          : null,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _mapApiException(ApiException error) {
  final details = error.details;
  final reason = details is Map ? details['reason']?.toString() : null;
  if (error.code == 'MEDIA_NOT_APPROVED' || reason == 'MEDIA_NOT_APPROVED') {
    return 'Media belum disetujui admin.';
  }
  if (error.code == 'VALIDATION_ERROR') {
    if (error.message.isNotEmpty) return error.message;
    return 'Data media tidak valid. Periksa format dan pernyataan lisensi.';
  }
  if (error.isAuth) {
    return 'Sesi berakhir. Silakan masuk kembali.';
  }
  if (error.code == 'TIMEOUT' || error.code == 'NETWORK_ERROR') {
    return error.userMessage;
  }
  return error.message.isNotEmpty ? error.message : 'Gagal mengunggah media.';
}

void _notice(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}
