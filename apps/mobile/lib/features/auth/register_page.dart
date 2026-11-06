import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/ui.dart';
import 'auth_support.dart';

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
      setState(
        () => _error = 'Centang persetujuan Syarat & Ketentuan dulu.',
      );
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
      if (data == null || data['access_token'] is! String) {
        throw const ApiException(
          code: 'INTERNAL_ERROR',
          message: 'Respons pendaftaran tidak lengkap.',
        );
      }
      await scope.session.signIn(data);
      TextInput.finishAutofillContext();
      if (!mounted) return;
      Navigator.pushNamedAndRemoveUntil(context, Routes.home, (_) => false);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = authErrorMessage(error, register: true));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _backToLogin() {
    final navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
    } else {
      navigator.pushReplacementNamed(Routes.login);
    }
  }

  void _clearError() {
    if (_error != null) setState(() => _error = null);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(20, Sp.sm, 20, Sp.xl + bottomInset),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      IconButton(
                        onPressed: _backToLogin,
                        tooltip: 'Kembali',
                        icon: const Icon(Icons.arrow_back),
                      ),
                      const SizedBox(width: Sp.xs),
                      const BrandLockup(),
                    ],
                  ),
                  const SizedBox(height: Sp.xl),
                  Text(
                    'Daftar akun',
                    style: text.headlineSmall?.copyWith(
                      fontSize: 26,
                      letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: Sp.xs),
                  Text(
                    'Cukup satu kali untuk mulai memesan hiburan Pantura.',
                    style: text.bodyMedium?.copyWith(
                      color: AppColors.inkMuted,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: Sp.xl),
                  AutofillGroup(
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const AuthFieldLabel('Nama lengkap'),
                          const SizedBox(height: 6),
                          TextFormField(
                            controller: _name,
                            keyboardType: TextInputType.name,
                            textInputAction: TextInputAction.next,
                            textCapitalization: TextCapitalization.words,
                            autofillHints: const [AutofillHints.name],
                            style: text.bodyMedium,
                            decoration: authField(
                              hint: 'Nama sesuai panggilan',
                            ),
                            onFieldSubmitted: (_) =>
                                _emailFocus.requestFocus(),
                          ),
                          const SizedBox(height: Sp.lg),
                          const AuthFieldLabel('Email'),
                          const SizedBox(height: 6),
                          TextFormField(
                            controller: _email,
                            focusNode: _emailFocus,
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            autofillHints: const [AutofillHints.email],
                            autocorrect: false,
                            enableSuggestions: false,
                            style: text.bodyMedium,
                            decoration: authField(
                              hint: 'contoh@tarlink.id',
                              prefixIcon: const AuthFieldIcon(
                                Icons.alternate_email,
                              ),
                            ),
                            validator: emailError,
                            onChanged: (_) => _clearError(),
                            onFieldSubmitted: (_) =>
                                _passwordFocus.requestFocus(),
                          ),
                          const SizedBox(height: Sp.lg),
                          const AuthFieldLabel('Kata sandi'),
                          const SizedBox(height: 6),
                          TextFormField(
                            controller: _password,
                            focusNode: _passwordFocus,
                            obscureText: _obscure,
                            keyboardType: TextInputType.visiblePassword,
                            textInputAction: TextInputAction.next,
                            autofillHints: const [AutofillHints.newPassword],
                            style: text.bodyMedium,
                            decoration: authField(
                              hint: 'Minimal 8 karakter',
                              prefixIcon: const AuthFieldIcon(
                                Icons.lock_outline,
                              ),
                              suffixIcon: IconButton(
                                onPressed: () =>
                                    setState(() => _obscure = !_obscure),
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
                                constraints: const BoxConstraints(
                                  minWidth: 48,
                                  minHeight: 48,
                                ),
                              ),
                            ),
                            validator: passwordError,
                            onChanged: (_) => _clearError(),
                            onFieldSubmitted: (_) =>
                                _confirmPasswordFocus.requestFocus(),
                          ),
                          const SizedBox(height: Sp.sm),
                          Row(
                            children: [
                              const Icon(
                                Icons.info_outline,
                                size: 15,
                                color: AppColors.inkMuted,
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  'Gunakan kombinasi minimal huruf dan angka.',
                                  style: text.bodySmall,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: Sp.lg),
                          const AuthFieldLabel('Konfirmasi kata sandi'),
                          const SizedBox(height: 6),
                          TextFormField(
                            controller: _confirmPassword,
                            focusNode: _confirmPasswordFocus,
                            obscureText: _obscureConfirm,
                            keyboardType: TextInputType.visiblePassword,
                            textInputAction: TextInputAction.done,
                            autofillHints: const [AutofillHints.newPassword],
                            style: text.bodyMedium,
                            decoration: authField(
                              hint: 'Ulangi kata sandi',
                              prefixIcon: const AuthFieldIcon(
                                Icons.lock_outline,
                              ),
                              suffixIcon: IconButton(
                                onPressed: () => setState(
                                  () => _obscureConfirm = !_obscureConfirm,
                                ),
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
                                constraints: const BoxConstraints(
                                  minWidth: 48,
                                  minHeight: 48,
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
                          const SizedBox(height: Sp.lg),
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
                              padding: const EdgeInsets.only(top: Sp.sm),
                              child: Text(
                                'Memuat versi kebijakan…',
                                style: text.bodySmall,
                              ),
                            ),
                          if (_policiesError != null)
                            Padding(
                              padding: const EdgeInsets.only(top: Sp.sm),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: AuthInlineError(_policiesError!),
                                  ),
                                  TextButton(
                                    onPressed: _policiesLoading
                                        ? null
                                        : _loadPolicies,
                                    child: const Text('Muat ulang'),
                                  ),
                                ],
                              ),
                            ),
                          if (_error != null) AuthInlineError(_error!),
                          const SizedBox(height: Sp.lg),
                          SizedBox(
                            height: 52,
                            child: FilledButton(
                              onPressed: _loading || _policiesLoading
                                  ? null
                                  : _submit,
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  if (_loading) ...[
                                    const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: AppColors.onPrimary,
                                      ),
                                    ),
                                    const SizedBox(width: Sp.sm),
                                  ],
                                  Text(
                                    _loading
                                        ? 'Sedang mendaftar…'
                                        : 'Buat akun',
                                  ),
                                  if (!_loading) ...[
                                    const SizedBox(width: Sp.sm),
                                    const Icon(Icons.arrow_forward, size: 20),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: Sp.md),
                  Center(
                    child: TextButton(
                      onPressed: _loading ? null : _backToLogin,
                      child: const Text('Sudah punya akun? Masuk'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
