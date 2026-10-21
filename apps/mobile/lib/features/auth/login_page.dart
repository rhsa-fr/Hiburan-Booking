import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/widgets.dart';
import 'auth_support.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

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
  bool _noticeDismissed = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
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
      Navigator.pushNamedAndRemoveUntil(context, Routes.home, (_) => false);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = authErrorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final notice = AppScope.of(context).session.notice;
    final showNotice = notice != null && !_noticeDismissed;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: LayoutBuilder(
              builder: (context, constraints) => SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(Sp.xl, Sp.lg, Sp.xl, Sp.lg),
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    minHeight: math.max(0, constraints.maxHeight - Sp.xxl),
                  ),
                  child: IntrinsicHeight(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 44,
                              height: 44,
                              decoration: BoxDecoration(
                                color: AppColors.primary,
                                borderRadius: BorderRadius.circular(Radii.sm),
                              ),
                              child: const Icon(
                                Icons.light_mode_outlined,
                                color: AppColors.onPrimary,
                                size: 24,
                              ),
                            ),
                            const SizedBox(width: Sp.md),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Tarlink', style: text.titleLarge),
                                  Text(
                                    'Tarling terhubung',
                                    style: text.bodySmall,
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: Sp.xl),
                        Text('Masuk ke Tarlink', style: text.displaySmall),
                        const SizedBox(height: Sp.sm),
                        Text(
                          'Gunakan email dan kata sandi akunmu.',
                          style: text.bodyLarge?.copyWith(
                            color: AppColors.inkMuted,
                          ),
                        ),
                        if (showNotice) ...[
                          const SizedBox(height: Sp.lg),
                          _Notice(
                            message: notice,
                            onClose: () =>
                                setState(() => _noticeDismissed = true),
                          ),
                        ],
                        const SizedBox(height: Sp.xl),
                        AutofillGroup(
                          child: Form(
                            key: _formKey,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                TextFormField(
                                  controller: _email,
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
                                  autofillHints: const [AutofillHints.password],
                                  decoration: InputDecoration(
                                    labelText: 'Kata sandi',
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
                          label: 'Masuk',
                          loading: _loading,
                          loadingLabel: 'Sedang masuk…',
                          onPressed: _submit,
                        ),
                        const SizedBox(height: Sp.sm),
                        TextButton(
                          onPressed: _loading
                              ? null
                              : () => Navigator.pushNamed(
                                  context,
                                  Routes.register,
                                ),
                          child: const Text('Buat akun baru'),
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

class _Notice extends StatelessWidget {
  const _Notice({required this.message, required this.onClose});

  final String message;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.fromLTRB(Sp.md, Sp.xs, Sp.xs, Sp.xs),
        decoration: BoxDecoration(
          color: AppColors.dangerSoft,
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.only(top: Sp.sm),
              child: Icon(
                Icons.info_outline,
                size: 20,
                color: AppColors.danger,
              ),
            ),
            const SizedBox(width: Sp.sm),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: Sp.sm),
                child: Text(
                  message,
                  style: text.bodyMedium?.copyWith(color: AppColors.danger),
                ),
              ),
            ),
            IconButton(
              onPressed: onClose,
              tooltip: 'Tutup pemberitahuan',
              icon: const Icon(Icons.close, size: 20),
              color: AppColors.danger,
              constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            ),
          ],
        ),
      ),
    );
  }
}
