import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import 'auth_support.dart';
import 'email_otp_page.dart';
import 'google_auth.dart';
import 'google_button.dart';

class RegisterPage extends StatefulWidget {
  const RegisterPage({super.key});

  @override
  State<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends State<RegisterPage> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  final _emailFocus = FocusNode();
  final _passwordFocus = FocusNode();
  final _confirmPasswordFocus = FocusNode();
  bool _obscure = true;
  bool _obscureConfirm = true;
  bool _loading = false;
  bool _googleLoading = false;
  bool _consent = false;
  bool _policiesLoading = true;
  String? _policiesError;
  String? _tosVersionId;
  String? _privacyVersionId;
  String? _tosVersion;
  String? _privacyVersion;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _loadPolicies();
    });
  }

  /// FR-103: the user must see which policy versions they accept. The ids are
  /// sent again on submit; the API rejects a stale version.
  Future<void> _loadPolicies() async {
    final api = AppScope.of(context).api;
    setState(() {
      _policiesLoading = true;
      _policiesError = null;
    });
    try {
      final results = await Future.wait([
        api.get('/policies/tos', auth: false),
        api.get('/policies/privacy', auth: false),
      ]);
      final tos = _policy(results[0]);
      final privacy = _policy(results[1]);
      final tosId = tos?['id'];
      final privacyId = privacy?['id'];
      if (!mounted) return;
      if (tosId is! String || privacyId is! String) {
        setState(() {
          _policiesLoading = false;
          _policiesError = 'Kebijakan belum bisa dimuat.';
        });
        return;
      }
      setState(() {
        _tosVersionId = tosId;
        _privacyVersionId = privacyId;
        _tosVersion = tos?['version']?.toString();
        _privacyVersion = privacy?['version']?.toString();
        _policiesLoading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _policiesLoading = false;
        _policiesError = authErrorMessage(error, register: true);
      });
    }
  }

  Map<String, dynamic>? _policy(dynamic raw) =>
      raw is Map ? raw.cast<String, dynamic>() : null;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    _emailFocus.dispose();
    _passwordFocus.dispose();
    _confirmPasswordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading) return;
    setState(() => _error = null);
    if (!(_formKey.currentState?.validate() ?? false)) return;

    if (_password.text != _confirmPassword.text) {
      setState(() => _error = 'Konfirmasi kata sandi tidak cocok.');
      return;
    }

    final tosVersionId = _tosVersionId;
    final privacyVersionId = _privacyVersionId;
    if (_policiesLoading || tosVersionId == null || privacyVersionId == null) {
      setState(() => _error = 'Kebijakan belum bisa dimuat. Coba lagi.');
      return;
    }
    if (!_consent) {
      setState(() => _error = 'Centang persetujuan Syarat & Ketentuan dulu.');
      return;
    }

    FocusScope.of(context).unfocus();
    final scope = AppScope.of(context);
    final name = _name.text.trim();
    final body = <String, dynamic>{
      'email': _email.text.trim(),
      'password': _password.text,
      if (name.isNotEmpty) 'full_name': name,
      'consent': {
        'tos_version_id': tosVersionId,
        'privacy_version_id': privacyVersionId,
      },
    };

    setState(() => _loading = true);
    try {
      final payload = await scope.api.post(
        '/auth/register',
        auth: false,
        body: body,
      );
      final data = payload is Map ? payload.cast<String, dynamic>() : null;
      final email = data?['email'];
      if (data == null ||
          data['verification_required'] != true ||
          email is! String ||
          email.isEmpty) {
        throw const ApiException(
          code: 'UNEXPECTED_RESPONSE',
          message: 'Respons pendaftaran tidak meminta verifikasi email.',
        );
      }
      if (!mounted) return;
      final devCode = data['dev_code'];
      // No session yet: the account only becomes usable after the email code.
      Navigator.pushNamed(
        context,
        Routes.emailOtp,
        arguments: EmailOtpArgs(
          email: email,
          mode: EmailOtpMode.register,
          devCode: devCode is String && devCode.isNotEmpty ? devCode : null,
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.code == 'UNEXPECTED_RESPONSE'
            ? 'Respons pendaftaran tidak sesuai. Coba lagi atau hubungi bantuan.'
            : authErrorMessage(error, register: true);
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _signUpWithGoogle() async {
    if (_loading || _googleLoading) return;
    if (!_consent) {
      setState(() => _error = 'Centang persetujuan Syarat & Ketentuan dulu.');
      return;
    }
    setState(() {
      _error = null;
      _googleLoading = true;
    });
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
      setState(() => _error = authErrorMessage(error, register: true));
    } catch (error) {
      debugPrint('google sign-up gagal: $error');
      if (!mounted) return;
      setState(() => _error = googleAuthErrorMessage(error));
    } finally {
      if (mounted) setState(() => _googleLoading = false);
    }
  }

  Future<void> _handleWebGoogleToken(String? idToken) async {
    if (_googleLoading) return;
    if (idToken == null || idToken.isEmpty) {
      setState(() => _error = 'Google tidak mengirim ID token.');
      return;
    }
    setState(() {
      _error = null;
      _googleLoading = true;
    });
    try {
      await _finishGoogleSignIn(idToken);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = authErrorMessage(error, register: true));
    } catch (error) {
      debugPrint('google sign-up gagal: $error');
      if (!mounted) return;
      setState(() => _error = googleAuthErrorMessage(error));
    } finally {
      if (mounted) setState(() => _googleLoading = false);
    }
  }

  /// Akun Google baru melewati layar kode email lebih dulu (ADR 0037): tanpa
  /// sesi, `Routes.home` akan menampilkan akun yang belum ada.
  Future<void> _finishGoogleSignIn(String idToken) async {
    final outcome = await finishGoogleSignIn(context, idToken);
    if (!mounted) return;
    switch (outcome) {
      case GoogleSession():
        Navigator.pushNamedAndRemoveUntil(context, Routes.home, (_) => false);
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

  Widget _googleOption(TextTheme text) {
    if (kIsWeb) {
      if (!_consent) {
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
        onPressed: (_loading || _googleLoading) ? null : _signUpWithGoogle,
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
                      'Daftar dengan Google',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  void _backToLogin() {
    final navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
    } else {
      navigator.pushReplacementNamed(Routes.login);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Scaffold(
      backgroundColor: AppColors.ink,
      body: Column(
        children: [
          AuthStage(
            onBack: _backToLogin,
            title: 'Daftar akun',
            subtitle: 'Satu akun untuk memesan hiburan dan mengelola jadwal.',
          ),
          Expanded(
            child: AuthBody(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AuthCard(children: [_buildForm(text)]),
                  const SizedBox(height: 16),
                  AuthConsentBox(
                    value: _consent,
                    tosVersion: _tosVersion,
                    privacyVersion: _privacyVersion,
                    onChanged: (value) => setState(() {
                      _consent = value ?? false;
                      _error = null;
                    }),
                  ),
                  if (_policiesLoading)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        'Memuat versi kebijakan…',
                        style: text.labelSmall?.copyWith(
                          color: Colors.white.withValues(alpha: 0.45),
                        ),
                      ),
                    ),
                  if (_policiesError != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(
                        children: [
                          Expanded(
                            child: AuthInlineError(
                              _policiesError!,
                              onDark: true,
                            ),
                          ),
                          TextButton(
                            onPressed: _policiesLoading ? null : _loadPolicies,
                            style: TextButton.styleFrom(
                              minimumSize: const Size(0, 44),
                              foregroundColor: AppColors.lime,
                            ),
                            child: const Text('Muat ulang'),
                          ),
                        ],
                      ),
                    ),
                  if (GoogleAuth.isConfigured) ...[
                    const SizedBox(height: 14),
                    _googleOption(text),
                  ],
                  const SizedBox(height: 18),
                  _switchToLogin(text),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _switchToLogin(TextTheme text) {
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(
          'Sudah punya akun?',
          style: text.bodyMedium?.copyWith(
            color: Colors.white.withValues(alpha: 0.60),
          ),
        ),
        TextButton(
          onPressed: _loading ? null : _backToLogin,
          style: TextButton.styleFrom(
            minimumSize: const Size(0, 44),
            padding: const EdgeInsets.symmetric(horizontal: Sp.sm),
            foregroundColor: AppColors.lime,
            disabledForegroundColor: Colors.white.withValues(alpha: 0.38),
            textStyle: text.bodyMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          child: const Text('Masuk'),
        ),
      ],
    );
  }

  void _clearError() {
    if (_error != null) setState(() => _error = null);
  }

  Widget _buildForm(TextTheme text) {
    return AutofillGroup(
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const AuthFieldLabel('Nama lengkap'),
            const SizedBox(height: 4),
            TextFormField(
              controller: _name,
              keyboardType: TextInputType.name,
              textInputAction: TextInputAction.next,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.name],
              style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w500),
              decoration: authLineField(hint: 'Nama sesuai panggilan'),
              onFieldSubmitted: (_) => _emailFocus.requestFocus(),
            ),
            const SizedBox(height: Sp.lg),
            const AuthFieldLabel('Email'),
            const SizedBox(height: 4),
            TextFormField(
              controller: _email,
              focusNode: _emailFocus,
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
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.newPassword],
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
              onFieldSubmitted: (_) => _confirmPasswordFocus.requestFocus(),
            ),
            const SizedBox(height: Sp.sm),
            Row(
              children: [
                const Icon(
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
            const SizedBox(height: Sp.lg),
            const AuthFieldLabel('Konfirmasi kata sandi'),
            const SizedBox(height: 4),
            TextFormField(
              controller: _confirmPassword,
              focusNode: _confirmPasswordFocus,
              obscureText: _obscureConfirm,
              keyboardType: TextInputType.visiblePassword,
              textInputAction: TextInputAction.done,
              autofillHints: const [AutofillHints.newPassword],
              style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w500),
              decoration: authLineField(
                hint: 'Ulangi kata sandi',
                prefixIcon: const AuthFieldIcon(Icons.lock_outline),
                suffixIcon: IconButton(
                  onPressed: () =>
                      setState(() => _obscureConfirm = !_obscureConfirm),
                  tooltip: _obscureConfirm
                      ? 'Tampilkan kata sandi'
                      : 'Sembunyikan kata sandi',
                  color: AppColors.inkMuted,
                  icon: Icon(
                    _obscureConfirm
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                    size: 20,
                  ),
                ),
              ),
              validator: (value) {
                final confirm = value ?? '';
                if (confirm.isEmpty) {
                  return 'Konfirmasi kata sandi wajib diisi';
                }
                if (confirm != _password.text) {
                  return 'Konfirmasi kata sandi tidak cocok';
                }
                return null;
              },
              onChanged: (_) => _clearError(),
              onFieldSubmitted: (_) => _submit(),
            ),
            if (_error != null) AuthInlineError(_error!),
            const SizedBox(height: Sp.lg),
            AuthSubmitButton(
              label: 'Buat akun',
              loadingLabel: 'Sedang mendaftar…',
              loading: _loading || _policiesLoading,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }
}
