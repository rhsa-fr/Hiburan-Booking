import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../app/app.dart';
import '../../core/api_exception.dart';

const int maxVendorImageBytes = 5 * 1024 * 1024;

/// Pick one image from the gallery, upload it to `/vendor/media`, and return
/// the public URL. Returns `null` when the user cancels or the upload fails.
Future<String?> pickAndUploadVendorImage(BuildContext context) async {
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

  try {
    final api = AppScope.of(context).api;
    final payload = await api.uploadFile(
      '/vendor/media',
      filename: picked.name,
      bytes: bytes,
    );
    if (payload is Map && payload['url'] is String) {
      return (payload['url'] as String).trim();
    }
    throw const ApiException(
      code: 'UPLOAD_FAILED',
      message: 'Server tidak mengembalikan URL gambar.',
    );
  } on ApiException catch (error) {
    if (context.mounted) _notice(context, error.message);
    return null;
  } catch (error) {
    if (context.mounted) {
      _notice(context, 'Gagal mengunggah gambar: $error');
    }
    return null;
  }
}

void _notice(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}
