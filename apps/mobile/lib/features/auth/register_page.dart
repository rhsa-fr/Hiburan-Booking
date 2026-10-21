import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/widgets.dart';
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

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final normalizedPhone = normalizePhone(_phone.text);

    return Scaffold(
      appBar: AppBar(title: const Text('Buat akun')),
      body: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: LayoutBuilder(
              builder: (context, constraints) => SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(Sp.xl, Sp.md, Sp.xl, Sp.lg),
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    minHeight: math.max(0, constraints.maxHeight - Sp.lg),
                  ),
                  child: IntrinsicHeight(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text('Daftar akun Tarlink', style: text.displaySmall),
                        const SizedBox(height: Sp.sm),
                        Text(
                          'Cukup satu kali. Nomor WhatsApp dipakai vendor '
                          'untuk konfirmasi hari-H.',
                          style: text.bodyMedium?.copyWith(
                            color: AppColors.inkMuted,
                          ),
                        ),
                        const SizedBox(height: Sp.xl),
                        AutofillGroup(
                          child: Form(
                            key: _formKey,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                TextFormField(
                                  controller: _name,
                                  keyboardType: TextInputType.name,
                                  textInputAction: TextInputAction.next,
                                  textCapitalization: TextCapitalization.words,
                                  autofillHints: const [AutofillHints.name],
                                  decoration: const InputDecoration(
                                    labelText: 'Nama lengkap',
                                    helperText: 'Boleh dikosongkan.',
                                  ),
                                  onFieldSubmitted: (_) =>
                                      _phoneFocus.requestFocus(),
                                ),
                                const SizedBox(height: Sp.md),
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
                                  decoration: InputDecoration(
                                    labelText: 'Nomor WhatsApp',
                                    hintText: '08xx atau 628xx',
                                    helperText: normalizedPhone.isEmpty
                                        ? null
                                        : 'Dikirim sebagai $normalizedPhone',
                                  ),
                                  validator: phoneError,
                                  onChanged: (_) => setState(() {}),
                                  onFieldSubmitted: (_) =>
                                      _emailFocus.requestFocus(),
                                ),
                                const SizedBox(height: Sp.md),
                                TextFormField(
                                  controller: _email,
                                  focusNode: _emailFocus,
                                  keyboardType: TextInputType.emailAddress,
                                  textInputAction: TextInputAction.next,
                                  autofillHints: const [AutofillHints.email],
                                  autocorrect: false,
                                  enableSuggestions: false,
                                  decoration: const InputDecoration(
                                    labelText: 'Email',
                                    hintText: 'nama@email.com',
                                  ),
                                  validator: emailError,
                                  onFieldSubmitted: (_) =>
                                      _passwordFocus.requestFocus(),
                                ),
                                const SizedBox(height: Sp.md),
                                TextFormField(
                                  controller: _password,
                                  focusNode: _passwordFocus,
                                  obscureText: _obscure,
                                  keyboardType: TextInputType.visiblePassword,
                                  textInputAction: TextInputAction.done,
                                  autofillHints: const [
                                    AutofillHints.newPassword,
                                  ],
                                  decoration: InputDecoration(
                                    labelText: 'Kata sandi',
                                    helperText: 'Minimal 8 karakter.',
                                    suffixIcon: IconButton(
                                      onPressed: () => setState(
                                        () => _obscure = !_obscure,
                                      ),
                                      tooltip: _obscure
                                          ? 'Tampilkan kata sandi'
                                          : 'Sembunyikan kata sandi',
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
                                  onFieldSubmitted: (_) => _submit(),
                                ),
                              ],
                            ),
                          ),
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: Sp.lg),
                          Semantics(
                            liveRegion: true,
                            child: AppError(message: _error!, compact: true),
                          ),
                        ],
                        const Spacer(),
                        const SizedBox(height: Sp.xl),
                        PrimaryButton(
                          label: 'Daftar',
                          loading: _loading,
                          loadingLabel: 'Sedang mendaftar…',
                          onPressed: _submit,
                        ),
                        const SizedBox(height: Sp.sm),
                        TextButton(
                          onPressed: _loading ? null : _backToLogin,
                          child: const Text('Sudah punya akun? Masuk'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
