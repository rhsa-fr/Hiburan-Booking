import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/ui.dart';
import 'auth_support.dart';
import 'email_otp_page.dart';
import 'google_auth.dart';
import 'google_button.dart';

/// Login / daftar, rebuilt from the Stitch "Masuk atau Daftar" screen:
/// lavender canvas, terracotta CTA, 52 px white fields.
class LoginPage extends StatefulWidget {
  const LoginPage({super.key, this.initialEmail});

  /// Prefilled after a password reset so the customer only types the new
  /// password. Optional: every existing caller keeps `const LoginPage()`.
  final String? initialEmail;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _passwordFocus = FocusNode();

  bool _obscure = true;
  bool _loading = false;
  bool _googleLoading = false;

  /// Set when the API answers `403 EMAIL_NOT_VERIFIED`, so the error carries a
  /// second action instead of reading like a wrong password.
  bool _emailNotVerified = false;

  /// Persetujuan S&K untuk jalur web: diambil sebelum popup Google supaya
  /// popup tidak terputus dialog.
  bool _webConsent = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final email = widget.initialEmail?.trim();
    if (email != null && email.isNotEmpty) _email.text = email;
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  void _clearError() {
    if (_error != null) {
      setState(() {
        _error = null;
        _emailNotVerified = false;
      });
    }
  }

  Future<void> _submit() async {
    if (_loading) return;
    setState(() => _error = null);
    if (!(_formKey.currentState?.validate() ?? false)) return;

    FocusScope.of(context).unfocus();
    final scope = AppScope.of(context);
    setState(() => _loading = true);

    try {
      final payload = await scope.api.post(
        '/auth/login',
        auth: false,
        body: {'email': _email.text.trim(), 'password': _password.text},
      );
      final data = payload is Map ? payload.cast<String, dynamic>() : null;
      if (data == null || data['access_token'] is! String) {
        throw const ApiException(
          code: 'INTERNAL_ERROR',
          message: 'Respons masuk tidak lengkap.',
        );
      }
      await scope.session.signIn(data);
      if (!mounted) return;
      _goHome();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = authErrorMessage(error);
        _emailNotVerified = error.code == 'EMAIL_NOT_VERIFIED';
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openVerifyEmail() {
    final email = _email.text.trim();
    if (email.isEmpty || _loading) return;
    Navigator.pushNamed(
      context,
      Routes.emailOtp,
      arguments: EmailOtpArgs(email: email, mode: EmailOtpMode.register),
    );
  }

  void _openForgotPassword() {
    if (_loading) return;
    final email = _email.text.trim();
    Navigator.pushNamed(
      context,
      Routes.forgotPassword,
      arguments: email.isEmpty ? null : email,
    );
  }

  void _goHome() {
    final session = AppScope.of(context).session;
    if (session.user?.roles.contains('vendor_owner') == true) {
      Navigator.pushNamedAndRemoveUntil(
        context,
        Routes.vendorHome,
        (_) => false,
      );
    } else {
      Navigator.pushNamedAndRemoveUntil(context, Routes.home, (_) => false);
    }
  }

  /// FR-103: akun Google pertama kali adalah pendaftaran, jadi versi kebijakan
  /// aktif harus disetujui. Akun yang sudah ada tidak terpengaruh.
  Future<bool> _confirmGoogleConsent() async {
    final agreed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Masuk dengan Google'),
        content: const Text(
          'Dengan melanjutkan, kamu menyetujui Syarat & Ketentuan serta '
          'Kebijakan Privasi Tarlink yang berlaku.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Setuju & lanjut'),
          ),
        ],
      ),
    );
    return agreed ?? false;
  }

  Future<void> _signInWithGoogle() async {
    if (_loading || _googleLoading) return;
    setState(() => _error = null);

    if (!GoogleAuth.isConfigured) {
      setState(
        () => _error =
            'Login Google belum dikonfigurasi pada build ini '
            '(GOOGLE_CLIENT_ID kosong).',
      );
      return;
    }

    if (!await _confirmGoogleConsent()) return;
    if (!mounted) return;
    setState(() => _googleLoading = true);

    try {
      final idToken = await GoogleAuth.idToken();
      if (idToken == null || idToken.isEmpty) {
        throw const ApiException(
          code: 'UNAUTHENTICATED',
          message: 'Google tidak mengirim ID token.',
        );
      }
      await _finishGoogleSignIn(idToken);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = authErrorMessage(error));
    } catch (error) {
      // Jangan telan penyebabnya: kode GoogleSignInException menentukan apakah
      // ini konfigurasi client, origin, atau pengguna menutup popup.
      debugPrint('google sign-in gagal: $error');
      if (!mounted) return;
      setState(() => _error = _googleErrorMessage(error));
    } finally {
      if (mounted) setState(() => _googleLoading = false);
    }
  }

  /// Jalur web: token datang dari tombol GIS resmi yang dirender browser,
  /// karena `authenticate()` tidak didukung di platform web.
  ///
  /// Persetujuan S&K diambil sebelum tombol Google ditekan (lihat checkbox di
  /// UI). Jangan menampilkan dialog di sini: dialog saat popup GIS menutup
  /// memutus postMessage dan membuat pengguna harus klik dua kali.
  Future<void> _handleWebGoogleToken(String? idToken) async {
    if (_googleLoading) return;
    if (idToken == null || idToken.isEmpty) {
      setState(() => _error = 'Google tidak mengirim ID token.');
      return;
    }
    if (!mounted) return;
    setState(() {
      _error = null;
      _googleLoading = true;
    });
    try {
      await _finishGoogleSignIn(idToken);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = authErrorMessage(error));
    } catch (error) {
      debugPrint('google sign-in gagal: $error');
      if (!mounted) return;
      setState(() => _error = _googleErrorMessage(error));
    } finally {
      if (mounted) setState(() => _googleLoading = false);
    }
  }

  /// Menukar ID token Google menjadi sesi Tarlink. Dipakai web dan mobile.
  ///
  /// Akun Google baru tidak mendapat sesi (ADR 0037): server hanya mengirim
  /// kode ke email, jadi yang dibuka adalah layar kode — bukan beranda.
  Future<void> _finishGoogleSignIn(String idToken) async {
    final outcome = await finishGoogleSignIn(context, idToken);
    if (!mounted) return;
    switch (outcome) {
      case GoogleSession():
        _goHome();
      case GoogleVerificationRequired(:final email, :final devCode):
        Navigator.pushNamed(
          context,
          Routes.emailOtp,
          arguments: EmailOtpArgs(
            email: email,
            mode: EmailOtpMode.register,
            devCode: devCode,
          ),
        );
    }
  }

  String _googleErrorMessage(Object error) => googleAuthErrorMessage(error);

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final notice = AppScope.of(context).session.notice;

    return Scaffold(
      backgroundColor: AppColors.stage,
      body: Column(
        children: [
          const AuthStage(
            title: 'Masuk atau Daftar',
            subtitle: 'Lanjutkan booking, pantau jadwal, dan chat vendor.',
          ),
          Expanded(
            child: AuthBody(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (notice != null) ...[
                    InfoStrip(
                      message: notice,
                      icon: Icons.info_outline,
                      tone: InfoTone.danger,
                    ),
                    const SizedBox(height: Sp.md),
                  ],
                  AuthCard(children: [_buildEmailForm(text)]),
                  if (GoogleAuth.isConfigured) ...[
                    const SizedBox(height: 18),
                    if (kIsWeb) ...[
                      AuthConsentBox(
                        value: _webConsent,
                        onChanged: (_loading || _googleLoading)
                            ? null
                            : (value) =>
                                  setState(() => _webConsent = value ?? false),
                      ),
                      const SizedBox(height: 12),
                    ],
                    _googleButton(text),
                  ],
                  const SizedBox(height: 18),
                  _registerLink(text),
                  const SizedBox(height: 14),
                  _securityNote(text),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _registerLink(TextTheme text) {
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(
          'Belum punya akun?',
          style: text.bodyMedium?.copyWith(
            color: Colors.white.withValues(alpha: 0.60),
          ),
        ),
        TextButton(
          onPressed: _loading
              ? null
              : () => Navigator.pushNamed(context, Routes.register),
          style: TextButton.styleFrom(
            minimumSize: const Size(0, 44),
            padding: const EdgeInsets.symmetric(horizontal: Sp.sm),
            foregroundColor: AppColors.lime,
            disabledForegroundColor: Colors.white.withValues(alpha: 0.38),
            textStyle: text.bodyMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          child: const Text('Daftar sekarang'),
        ),
      ],
    );
  }

  Widget _securityNote(TextTheme text) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          Icons.lock_outline,
          size: 13,
          color: Colors.white.withValues(alpha: 0.32),
        ),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            'Koneksi ke server dienkripsi HTTPS',
            textAlign: TextAlign.center,
            style: text.labelSmall?.copyWith(
              fontSize: 10.5,
              color: Colors.white.withValues(alpha: 0.32),
            ),
          ),
        ),
      ],
    );
  }

  Widget _googleButton(TextTheme text) {
    if (kIsWeb) {
      if (!_webConsent) {
        return SizedBox(
          height: 52,
          child: OutlinedButton(
            onPressed: null,
            style: OutlinedButton.styleFrom(
              side: BorderSide(color: Colors.white.withValues(alpha: 0.18)),
              foregroundColor: Colors.white,
              disabledForegroundColor: Colors.white.withValues(alpha: 0.55),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
            ),
            child: const Text('Centang persetujuan dulu'),
          ),
        );
      }
      return IgnorePointer(
        ignoring: _loading || _googleLoading,
        child: Opacity(
          opacity: (_loading || _googleLoading) ? 0.5 : 1,
          child: GoogleSignInWebButton(onIdToken: _handleWebGoogleToken),
        ),
      );
    }
    return SizedBox(
      height: 52,
      child: OutlinedButton(
        onPressed: (_loading || _googleLoading) ? null : _signInWithGoogle,
        style: OutlinedButton.styleFrom(
          backgroundColor: Colors.white,
          foregroundColor: AppColors.ink,
          side: const BorderSide(color: Colors.white),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
        child: _googleLoading
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Image.asset(
                    'assets/images/google_g.png',
                    width: 18,
                    height: 18,
                  ),
                  const SizedBox(width: 10),
                  // Flexible: a fixed-height button must not clip the label when
                  // the customer runs a large text scale.
                  const Flexible(
                    child: Text(
                      'Lanjutkan dengan Google',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _buildEmailForm(TextTheme text) {
    return AutofillGroup(
      key: const ValueKey('email-form'),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const AuthFieldLabel('Alamat email'),
            const SizedBox(height: 4),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.email],
              autocorrect: false,
              enableSuggestions: false,
              style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w500),
              decoration: authLineField(
                hint: 'contoh@tarlink.id',
                prefixIcon: const AuthFieldIcon(Icons.alternate_email),
              ),
              validator: emailError,
              onChanged: (_) => _clearError(),
              onFieldSubmitted: (_) => _passwordFocus.requestFocus(),
            ),
            const SizedBox(height: Sp.lg),
            const AuthFieldLabel('Kata sandi'),
            const SizedBox(height: 4),
            TextFormField(
              controller: _password,
              focusNode: _passwordFocus,
              obscureText: _obscure,
              keyboardType: TextInputType.visiblePassword,
              textInputAction: TextInputAction.done,
              autofillHints: const [AutofillHints.password],
              style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w500),
              decoration: authLineField(
                hint: 'Minimal 8 karakter',
                prefixIcon: const AuthFieldIcon(Icons.lock_outline),
                suffixIcon: IconButton(
                  onPressed: () => setState(() => _obscure = !_obscure),
                  tooltip: _obscure
                      ? 'Tampilkan kata sandi'
                      : 'Sembunyikan kata sandi',
                  color: AppColors.inkMuted,
                  icon: Icon(
                    _obscure
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                    size: 20,
                  ),
                ),
              ),
              validator: passwordError,
              onChanged: (_) => _clearError(),
              onFieldSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: Sp.sm),
            Row(
              children: [
                Icon(
                  Icons.info_outline,
                  size: 14,
                  color: AppColors.muted2,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Gunakan kombinasi minimal huruf dan angka.',
                    style: text.labelSmall?.copyWith(
                      fontSize: 11,
                      color: AppColors.muted2,
                    ),
                  ),
                ),
              ],
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: _loading ? null : _openForgotPassword,
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, 48),
                  padding: const EdgeInsets.symmetric(horizontal: Sp.xs),
                  foregroundColor: AppColors.ink,
                  disabledForegroundColor: AppColors.muted2,
                  textStyle: text.labelMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    decoration: TextDecoration.underline,
                  ),
                ),
                child: const Text('Lupa kata sandi?'),
              ),
            ),
            if (_error != null) ...[
              AuthInlineError(_error!),
              if (_emailNotVerified)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: _openVerifyEmail,
                    style: TextButton.styleFrom(
                      minimumSize: const Size(0, 48),
                      padding: const EdgeInsets.symmetric(horizontal: Sp.xs),
                      foregroundColor: AppColors.ink,
                    ),
                    icon: const Icon(Icons.mark_email_read_outlined, size: 16),
                    label: const Text('Kirim ulang kode verifikasi'),
                  ),
                ),
            ],
            const SizedBox(height: Sp.lg),
            AuthSubmitButton(
              label: 'Masuk ke Akun',
              loadingLabel: 'Sedang masuk…',
              loading: _loading,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }
}
