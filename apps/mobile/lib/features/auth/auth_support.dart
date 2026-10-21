import '../../core/api_exception.dart';

final _emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]{2,}$');

String? emailError(String? value) {
  final email = value?.trim() ?? '';
  if (email.isEmpty) return 'Email wajib diisi.';
  if (!_emailPattern.hasMatch(email)) {
    return 'Format email belum benar. Contoh: nama@email.com.';
  }
  return null;
}

String? passwordError(String? value) {
  final password = value ?? '';
  if (password.isEmpty) return 'Kata sandi wajib diisi.';
  if (password.length < 8) return 'Kata sandi minimal 8 karakter.';
  return null;
}

/// `0812…` / `812…` / `+62 812…` all become `62812…`; anything else is
/// stripped to digits so the server never sees spaces or dashes.
String normalizePhone(String input) {
  var digits = input.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('0')) {
    digits = '62${digits.substring(1)}';
  } else if (digits.startsWith('8')) {
    digits = '62$digits';
  }
  return digits;
}

String? phoneError(String? value) {
  final raw = value?.trim() ?? '';
  if (raw.isEmpty) return 'Nomor WhatsApp wajib diisi.';
  final digits = normalizePhone(raw);
  if (digits.length < 9 || digits.length > 15) {
    return 'Nomor WhatsApp belum benar. Contoh: 081234567890.';
  }
  return null;
}

/// Server messages are English; these are the only strings a customer sees.
String authErrorMessage(ApiException error, {bool register = false}) {
  return switch (error.code) {
    'UNAUTHENTICATED' => 'Email atau kata sandi salah.',
    'RATE_LIMITED' => register
        ? 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.'
        : 'Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.',
    'CONFLICT' => 'Email atau nomor sudah terdaftar.',
    'VALIDATION_ERROR' => 'Data belum lengkap atau formatnya salah. Periksa lagi.',
    'NETWORK_ERROR' || 'TIMEOUT' =>
      'Sinyal lemah. Periksa koneksi lalu coba lagi.',
    _ => 'Ada masalah di server. Coba lagi sebentar.',
  };
}
