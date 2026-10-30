import 'package:flutter/material.dart';

import '../../app/theme.dart';
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
    'RATE_LIMITED' =>
      register
          ? 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.'
          : 'Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.',
    'CONFLICT' => 'Email atau nomor sudah terdaftar.',
    'VALIDATION_ERROR' =>
      'Data belum lengkap atau formatnya salah. Periksa lagi.',
    'NETWORK_ERROR' ||
    'TIMEOUT' => 'Sinyal lemah. Periksa koneksi lalu coba lagi.',
    _ => 'Ada masalah di server. Coba lagi sebentar.',
  };
}

/// One field skin for both auth screens: white fill on warm paper, 1px line,
/// 12 radius, primary focus. Validation errors stay under the field at 12px.
InputDecoration authField({
  String? hint,
  String? helper,
  Widget? prefixIcon,
  Widget? suffixIcon,
  BoxConstraints? prefixIconConstraints,
}) {
  OutlineInputBorder border(Color color, [double width = 1]) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.sm),
        borderSide: BorderSide(color: color, width: width),
      );
  final none = OutlineInputBorder(
    borderRadius: BorderRadius.circular(Radii.sm),
    borderSide: BorderSide.none,
  );

  return InputDecoration(
    hintText: hint,
    helperText: helper,
    hintMaxLines: 1,
    helperMaxLines: 2,
    errorMaxLines: 2,
    filled: true,
    fillColor: AppColors.card,
    contentPadding: const EdgeInsets.symmetric(
      horizontal: Sp.lg,
      vertical: Sp.lg - 2,
    ),
    prefixIcon: prefixIcon,
    prefixIconConstraints:
        prefixIconConstraints ??
        const BoxConstraints(minWidth: 48, minHeight: 48),
    suffixIcon: suffixIcon,
    border: none,
    enabledBorder: none,
    focusedBorder: border(AppColors.secondary, 2),
    errorBorder: border(AppColors.danger),
    focusedErrorBorder: border(AppColors.danger, 2),
    hintStyle: const TextStyle(
      fontSize: 14,
      height: 1.5,
      color: AppColors.inkMuted,
    ),
    helperStyle: const TextStyle(
      fontSize: 12,
      height: 1.45,
      color: AppColors.inkMuted,
    ),
    errorStyle: const TextStyle(
      fontSize: 12,
      height: 1.45,
      color: AppColors.danger,
    ),
  );
}

/// Small label that sits above a field, as in the Stitch reference.
class AuthFieldLabel extends StatelessWidget {
  const AuthFieldLabel(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      style: Theme.of(context).textTheme.labelMedium?.copyWith(
        fontWeight: FontWeight.w700,
        color: AppColors.ink,
      ),
    );
  }
}

/// Leading glyph inside a field. Muted, never a decorative illustration.
class AuthFieldIcon extends StatelessWidget {
  const AuthFieldIcon(this.icon, {super.key});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Icon(icon, size: 20, color: AppColors.inkMuted);
  }
}

/// The wordmark tagline on the stage-gradient block.
class AuthTagline extends StatelessWidget {
  const AuthTagline({super.key});

  @override
  Widget build(BuildContext context) {
    return Text(
      'Panggung hiburan Pantura',
      style: TextStyle(
        fontSize: 14,
        height: 1.3,
        color: AppColors.onPrimary.withValues(alpha: 0.7),
      ),
    );
  }
}

/// Inline server error: 12px danger under the field, announced to readers.
class AuthInlineError extends StatelessWidget {
  const AuthInlineError(this.message, {super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.only(top: Sp.sm),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.only(top: 1),
              child: Icon(
                Icons.error_outline,
                size: 16,
                color: AppColors.danger,
              ),
            ),
            const SizedBox(width: Sp.sm),
            Expanded(
              child: Text(
                message,
                style: const TextStyle(
                  fontSize: 12,
                  height: 1.45,
                  color: AppColors.danger,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
