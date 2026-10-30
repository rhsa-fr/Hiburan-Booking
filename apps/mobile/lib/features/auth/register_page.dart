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
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _phoneFocus = FocusNode();
  final _emailFocus = FocusNode();
  final _passwordFocus = FocusNode();
  bool _obscure = true;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _password.dispose();
    _phoneFocus.dispose();
    _emailFocus.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading) return;
    setState(() => _error = null);
    if (!(_formKey.currentState?.validate() ?? false)) return;

    FocusScope.of(context).unfocus();
    final scope = AppScope.of(context);
    final name = _name.text.trim();
    final body = <String, dynamic>{
      'email': _email.text.trim(),
      'password': _password.text,
      'phone': normalizePhone(_phone.text),
      if (name.isNotEmpty) 'full_name': name,
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
    final normalizedPhone = normalizePhone(_phone.text);
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
                    'Cukup satu kali. Nomor WhatsApp dipakai vendor untuk konfirmasi hari-H.',
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
                            onFieldSubmitted: (_) => _phoneFocus.requestFocus(),
                          ),
                          const SizedBox(height: Sp.lg),
                          const AuthFieldLabel('Nomor WhatsApp'),
                          const SizedBox(height: 6),
                          TextFormField(
                            controller: _phone,
                            focusNode: _phoneFocus,
                            keyboardType: TextInputType.phone,
                            textInputAction: TextInputAction.next,
                            autofillHints: const [
                              AutofillHints.telephoneNumber,
                            ],
                            inputFormatters: [
                              FilteringTextInputFormatter.allow(
                                RegExp(r'[0-9+\s-]'),
                              ),
                            ],
                            style: text.bodyMedium,
                            decoration: authField(
                              hint: '081234567890',
                              prefixIcon: const _PhonePrefix(),
                              prefixIconConstraints: const BoxConstraints(
                                minWidth: 0,
                                minHeight: 48,
                              ),
                            ),
                            validator: phoneError,
                            onChanged: (_) => setState(() => _error = null),
                            onFieldSubmitted: (_) => _emailFocus.requestFocus(),
                          ),
                          if (normalizedPhone.isNotEmpty) ...[
                            const SizedBox(height: Sp.xs),
                            Text(
                              'Dikirim sebagai $normalizedPhone',
                              style: text.bodySmall,
                            ),
                          ],
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
                            textInputAction: TextInputAction.done,
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
                            onFieldSubmitted: (_) => _submit(),
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
                          if (_error != null) AuthInlineError(_error!),
                          const SizedBox(height: Sp.lg),
                          SizedBox(
                            height: 52,
                            child: FilledButton(
                              onPressed: _loading ? null : _submit,
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

/// Locked country segment inside the WhatsApp field.
class _PhonePrefix extends StatelessWidget {
  const _PhonePrefix();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 9),
      padding: const EdgeInsets.symmetric(horizontal: Sp.lg),
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        border: Border(right: BorderSide(color: AppColors.line)),
      ),
      child: const Text(
        '+62',
        style: TextStyle(
          fontSize: 15,
          height: 1.2,
          fontWeight: FontWeight.w600,
          color: AppColors.ink,
        ),
      ),
    );
  }
}
