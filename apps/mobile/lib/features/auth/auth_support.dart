import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../../app/app.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/ui.dart';

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
    'EMAIL_NOT_VERIFIED' =>
      'Email belum diverifikasi. Kirim ulang kode verifikasi.',
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

/// Underline field for the auth card: the label above carries the meaning, so
/// the field itself is a line, not another white box on a white card.
InputDecoration authLineField({
  String? hint,
  Widget? prefixIcon,
  Widget? suffixIcon,
}) {
  const base = UnderlineInputBorder(
    borderSide: BorderSide(color: AppColors.lineStrong),
  );
  return InputDecoration(
    hintText: hint,
    filled: false,
    isDense: true,
    contentPadding: const EdgeInsets.fromLTRB(0, 12, 0, 12),
    prefixIcon: prefixIcon,
    prefixIconConstraints: const BoxConstraints(minWidth: 32, minHeight: 44),
    suffixIcon: suffixIcon,
    suffixIconConstraints: const BoxConstraints(minWidth: 44, minHeight: 44),
    border: base,
    enabledBorder: base,
    focusedBorder: const UnderlineInputBorder(
      borderSide: BorderSide(color: AppColors.ink, width: 2),
    ),
    errorBorder: const UnderlineInputBorder(
      borderSide: BorderSide(color: AppColors.danger),
    ),
    focusedErrorBorder: const UnderlineInputBorder(
      borderSide: BorderSide(color: AppColors.danger, width: 2),
    ),
    hintStyle: const TextStyle(
      fontSize: 15,
      height: 1.4,
      color: AppColors.muted2,
    ),
    errorStyle: const TextStyle(
      fontSize: 11.5,
      height: 1.4,
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
      label.toUpperCase(),
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
        fontSize: 10,
        letterSpacing: 1.15,
        fontWeight: FontWeight.w800,
        color: AppColors.inkMuted,
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

/// FR-103 consent checkbox. Shown on registration only; the accepted version
/// ids are sent to `POST /auth/register`.
class AuthConsentBox extends StatelessWidget {
  const AuthConsentBox({
    super.key,
    required this.value,
    required this.onChanged,
    this.tosVersion,
    this.privacyVersion,
  });

  final bool value;
  final ValueChanged<bool?>? onChanged;
  final String? tosVersion;
  final String? privacyVersion;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final versionSuffix = <String>[
      if (tosVersion != null) 'S&K v$tosVersion',
      if (privacyVersion != null) 'Privasi v$privacyVersion',
    ].join(' · ');

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 40,
          height: 40,
          child: Checkbox(
            value: value,
            onChanged: onChanged,
            activeColor: AppColors.lime,
            checkColor: AppColors.ink,
            side: BorderSide(
              color: Colors.white.withValues(alpha: 0.38),
              width: 1.4,
            ),
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 9),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(
                    style: text.bodySmall?.copyWith(
                      color: Colors.white.withValues(alpha: 0.66),
                      height: 1.45,
                    ),
                    children: const [
                      TextSpan(text: 'Saya menyetujui '),
                      TextSpan(
                        text: 'Syarat & Ketentuan',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      TextSpan(text: ' serta '),
                      TextSpan(
                        text: 'Kebijakan Privasi',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      TextSpan(text: ' Tarlink.'),
                    ],
                  ),
                ),
                if (versionSuffix.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    versionSuffix,
                    style: text.labelSmall?.copyWith(
                      color: Colors.white.withValues(alpha: 0.38),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Lime CTA with the label on the left and the arrow in an ink disc on the
/// right. Same shape on both auth screens; the label is a verb and an object.
class AuthSubmitButton extends StatelessWidget {
  const AuthSubmitButton({
    super.key,
    required this.label,
    required this.loadingLabel,
    required this.loading,
    required this.onPressed,
  });

  final String label;
  final String loadingLabel;
  final bool loading;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SizedBox(
      height: 54,
      child: FilledButton(
        onPressed: loading ? null : onPressed,
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 18),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.lg),
          ),
          side: const BorderSide(color: AppColors.limeDark),
          textStyle: text.labelLarge?.copyWith(
            fontWeight: FontWeight.w800,
            letterSpacing: -0.1,
          ),
        ),
        child: Row(
          children: [
            if (loading) ...[
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Text(
                loading ? loadingLabel : label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 10),
            if (!loading)
              Container(
                width: 28,
                height: 28,
                decoration: const BoxDecoration(
                  color: AppColors.ink,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.arrow_forward,
                  size: 15,
                  color: AppColors.lime,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Inline server error: 12px danger under the field, announced to readers.
class AuthInlineError extends StatelessWidget {
  const AuthInlineError(this.message, {super.key, this.onDark = false});

  final String message;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final color = onDark ? const Color(0xFFFF9A8F) : AppColors.danger;
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.only(top: Sp.sm),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Icon(Icons.error_outline, size: 16, color: color),
            ),
            const SizedBox(width: Sp.sm),
            Expanded(
              child: Text(
                message,
                style: TextStyle(fontSize: 12, height: 1.45, color: color),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Dark stage header shared by Masuk and Daftar. The page itself stays dark;
/// the form is a light ticket card below, so the screen reads as a show poster
/// with one job, not as a white form on a white page.
class AuthStage extends StatelessWidget {
  const AuthStage({
    super.key,
    required this.title,
    required this.subtitle,
    this.onBack,
  });

  final String title;
  final String subtitle;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final topInset = MediaQuery.paddingOf(context).top;
    return Container(
      color: AppColors.ink,
      child: Stack(
        children: [
          const Positioned.fill(
            child: IgnorePointer(
              child: CustomPaint(painter: _AuthBeamsPainter()),
            ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(22, topInset + 10, 22, 26),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (onBack != null) ...[
                      _AuthBackChip(onTap: onBack!),
                      const SizedBox(width: 10),
                    ],
                    const BrandLockup(light: true),
                  ],
                ),
                const SizedBox(height: 26),
                Container(
                  width: 34,
                  height: 3,
                  decoration: BoxDecoration(
                    color: AppColors.lime,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 31,
                    height: 1.04,
                    letterSpacing: -1.3,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 8),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 320),
                  child: Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 13,
                      height: 1.5,
                      color: Colors.white.withValues(alpha: 0.60),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One static light rig behind the header: three lime beams from the top-right
/// and a soft source. Flat paint, no animation, so it costs nothing to scroll.
class _AuthBeamsPainter extends CustomPainter {
  const _AuthBeamsPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final source = Offset(size.width * 0.86, -size.height * 0.18);
    for (var i = 0; i < 3; i++) {
      final t = i / 2;
      final footX = size.width * (0.20 + 0.58 * t);
      final path = Path()
        ..moveTo(footX - 30, size.height)
        ..lineTo(footX + 30, size.height)
        ..lineTo(source.dx, source.dy)
        ..close();
      canvas.drawPath(
        path,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              AppColors.lime.withValues(alpha: 0.10),
              AppColors.lime.withValues(alpha: 0),
            ],
          ).createShader(Rect.fromLTWH(0, 0, size.width, size.height)),
      );
    }
    canvas.drawCircle(
      source,
      size.width * 0.55,
      Paint()
        ..shader =
            RadialGradient(
              colors: [
                AppColors.lime.withValues(alpha: 0.13),
                AppColors.lime.withValues(alpha: 0),
              ],
            ).createShader(
              Rect.fromCircle(center: source, radius: size.width * 0.55),
            ),
    );
  }

  @override
  bool shouldRepaint(_AuthBeamsPainter oldDelegate) => false;
}

/// Scroll body under [AuthStage]: the dark page keeps going, so the light card
/// floats instead of turning the whole lower half into a white sheet.
class AuthBody extends StatelessWidget {
  const AuthBody({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(20, 18, 20, 22 + bottomInset),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: child,
        ),
      ),
    );
  }
}

/// The form ticket: a warm card with one lime edge, flat (no shadow), so the
/// fields are the only raised thing on the screen.
class AuthCard extends StatelessWidget {
  const AuthCard({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(Radii.xxl),
        border: Border.all(color: AppColors.line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1F000000),
            blurRadius: 30,
            offset: Offset(0, 14),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(height: 3, color: AppColors.lime),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 20, 18, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}

class _AuthBackChip extends StatelessWidget {
  const _AuthBackChip({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Kembali',
      child: Material(
        color: Colors.white.withValues(alpha: 0.12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.lg),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.18)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: const SizedBox(
            width: 40,
            height: 40,
            child: Icon(Icons.arrow_back, size: 20, color: Colors.white),
          ),
        ),
      ),
    );
  }
}

/// Exchanges a Google ID token for a Tarlink session. Both auth screens use it;
/// the caller decides where to navigate once it returns.
Future<void> finishGoogleSignIn(BuildContext context, String idToken) async {
  final scope = AppScope.of(context);
  final policies = await Future.wait([
    scope.api.get('/policies/tos', auth: false),
    scope.api.get('/policies/privacy', auth: false),
  ]);
  final tosId = (policies[0] as Map?)?['id'];
  final privacyId = (policies[1] as Map?)?['id'];
  if (tosId is! String || privacyId is! String) {
    throw const ApiException(
      code: 'INTERNAL_ERROR',
      message: 'Kebijakan belum bisa dimuat.',
    );
  }

  final payload = await scope.api.post(
    '/auth/google',
    auth: false,
    body: {
      'id_token': idToken,
      'consent': {'tos_version_id': tosId, 'privacy_version_id': privacyId},
    },
  );
  final data = payload is Map ? payload.cast<String, dynamic>() : null;
  if (data == null || data['access_token'] is! String) {
    throw const ApiException(
      code: 'INTERNAL_ERROR',
      message: 'Respons masuk tidak lengkap.',
    );
  }
  await scope.session.signIn(data);
}

/// Keeps the provider's failure code visible during QA instead of hiding every
/// Google failure behind the same sentence.
String googleAuthErrorMessage(Object error) {
  if (error is GoogleSignInException) {
    final detail = error.description?.trim();
    if ((detail?.toLowerCase().contains('reauth') ?? false)) {
      return 'Akun Google perlu verifikasi ulang. Buka akun Google di HP, '
          'selesaikan verifikasi, lalu coba lagi.';
    }
    return 'Google gagal (${error.code.name})'
        '${detail == null || detail.isEmpty ? '' : ': $detail'}';
  }
  return 'Login Google gagal: $error';
}
