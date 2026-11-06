import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/ui.dart';
import 'auth_support.dart';

/// Login / daftar, rebuilt from the Stitch "Masuk atau Daftar" screen:
/// lavender canvas, terracotta CTA, 52 px white fields.
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
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  void _clearError() {
    if (_error != null) setState(() => _error = null);
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
      setState(() => _error = authErrorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
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

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final notice = AppScope.of(context).session.notice;
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(20, Sp.md, 20, Sp.xl + bottomInset),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const BrandLockup(),
                      const SizedBox(width: Sp.md),
                      Flexible(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.secondarySoft,
                            borderRadius: BorderRadius.circular(Radii.pill),
                          ),
                          child: Text(
                            'Gerbang Hiburan Pantura',
                            style: text.labelSmall?.copyWith(
                              color: AppColors.onSecondaryContainer,
                              fontWeight: FontWeight.w600,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: Sp.xl),
                  Text(
                    'Masuk atau Daftar',
                    style: text.headlineSmall?.copyWith(
                      fontSize: 26,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: Sp.xs),
                  Text(
                    'Pesan hiburan hajatan & kelola jadwal manggung dengan aman, cepat, dan transparan.',
                    style: text.bodyMedium?.copyWith(
                      color: AppColors.inkMuted,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: Sp.xl),
                  if (notice != null) ...[
                    InfoStrip(
                      message: notice,
                      icon: Icons.info_outline,
                      tone: InfoTone.danger,
                    ),
                    const SizedBox(height: Sp.md),
                  ],
                  _buildEmailForm(text),
                  const SizedBox(height: Sp.xl),
                  Center(
                    child: Wrap(
                      alignment: WrapAlignment.center,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          'Belum punya akun Sahibul Hajat / Seniman? ',
                          style: text.bodyMedium?.copyWith(
                            color: AppColors.inkMuted,
                          ),
                        ),
                        TextButton(
                          onPressed: _loading
                              ? null
                              : () => Navigator.pushNamed(
                                  context,
                                  Routes.register,
                                ),
                          style: TextButton.styleFrom(
                            minimumSize: const Size(0, 40),
                            padding: const EdgeInsets.symmetric(
                              horizontal: Sp.xs,
                            ),
                            textStyle: text.bodyMedium?.copyWith(
                              color: AppColors.primary,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          child: const Text('Daftar Sekarang'),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: Sp.sm),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: Sp.md,
                      vertical: Sp.sm,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceTint,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.verified_user_outlined,
                          size: 16,
                          color: AppColors.secondary,
                        ),
                        const SizedBox(width: Sp.sm),
                        Flexible(
                          child: Text(
                            'Koneksi ke server dienkripsi HTTPS',
                            style: text.labelSmall?.copyWith(
                              color: AppColors.inkMuted,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
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

  Widget _buildEmailForm(TextTheme text) {
    return AutofillGroup(
      key: const ValueKey('email-form'),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _FieldLabel(
              label: 'Alamat Email',
              trailing: 'Wajib diisi',
            ),
            const SizedBox(height: 6),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.email],
              autocorrect: false,
              enableSuggestions: false,
              style: text.bodyMedium,
              decoration: authField(
                hint: 'contoh@tarlink.id',
                prefixIcon: const AuthFieldIcon(Icons.alternate_email),
              ),
              validator: emailError,
              onChanged: (_) => _clearError(),
              onFieldSubmitted: (_) => _passwordFocus.requestFocus(),
            ),
            const SizedBox(height: Sp.lg),
            const _FieldLabel(label: 'Kata Sandi'),
            const SizedBox(height: 6),
            TextFormField(
              controller: _password,
              focusNode: _passwordFocus,
              obscureText: _obscure,
              keyboardType: TextInputType.visiblePassword,
              textInputAction: TextInputAction.done,
              autofillHints: const [AutofillHints.password],
              style: text.bodyMedium,
              decoration: authField(
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
            const SizedBox(height: Sp.lg),
            if (_error != null) AuthInlineError(_error!),
            const SizedBox(height: Sp.md),
            _SubmitButton(
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

class _FieldLabel extends StatelessWidget {
  const _FieldLabel({required this.label, this.trailing});

  final String label;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: text.labelMedium?.copyWith(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
        ),
        if (trailing != null)
          Text(
            trailing!,
            style: text.bodySmall?.copyWith(
              fontSize: 11,
              color: AppColors.inkMuted,
            ),
          ),
      ],
    );
  }
}

class _SubmitButton extends StatelessWidget {
  const _SubmitButton({
    required this.label,
    required this.loadingLabel,
    required this.loading,
    required this.onPressed,
  });

  final String label;
  final String loadingLabel;
  final bool loading;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 52,
      child: FilledButton(
        onPressed: loading ? null : onPressed,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (loading) ...[
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
            Flexible(
              child: Text(
                loading ? loadingLabel : label,
                textAlign: TextAlign.center,
              ),
            ),
            if (!loading) ...[
              const SizedBox(width: Sp.sm),
              const Icon(Icons.arrow_forward, size: 20),
            ],
          ],
        ),
      ),
    );
  }
}
