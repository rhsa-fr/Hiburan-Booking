import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import 'auth_support.dart';

/// Final step of the reset flow: the code has already been exchanged for a
/// short-lived reset token, so this screen only stores the new password.
class ResetPasswordPage extends StatefulWidget {
  const ResetPasswordPage({
    super.key,
    required this.email,
    required this.token,
  });

  final String email;
  final String token;

  @override
  State<ResetPasswordPage> createState() => _ResetPasswordPageState();
}

class _ResetPasswordPageState extends State<ResetPasswordPage> {
  final _formKey = GlobalKey<FormState>();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  final _confirmFocus = FocusNode();

  bool _obscure = true;
  bool _obscureConfirm = true;
  bool _loading = false;
  bool _tokenExpired = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _confirmPassword.dispose();
    _confirmFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading) return;
    setState(() {
      _error = null;
      _tokenExpired = false;
    });
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_password.text != _confirmPassword.text) {
      setState(() => _error = 'Konfirmasi kata sandi tidak cocok.');
      return;
    }

    FocusScope.of(context).unfocus();
    final scope = AppScope.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() => _loading = true);

    try {
      final payload = await scope.api.post(
        '/auth/password/reset',
        auth: false,
        body: {'reset_token': widget.token, 'password': _password.text},
      );
      final data = payload is Map ? payload.cast<String, dynamic>() : null;
      if (data == null || data['reset'] != true) {
        throw const ApiException(
          code: 'UNEXPECTED_RESPONSE',
          message: 'Respons atur ulang tidak lengkap.',
        );
      }
      TextInput.finishAutofillContext();
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(content: Text('Kata sandi diperbarui. Silakan masuk.')),
      );
      navigator.pushNamedAndRemoveUntil(
        Routes.login,
        (_) => false,
        arguments: widget.email,
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _resetErrorMessage(error);
        _tokenExpired = _isTokenFailure(error);
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// The reset token is short-lived and single-use. The API answers an unknown,
  /// expired or already-used token with `VALIDATION_ERROR` (the password itself
  /// is validated locally at 8 characters), so that code means "token bad".
  bool _isTokenFailure(ApiException error) {
    final code = error.code.toUpperCase();
    return code.contains('TOKEN') ||
        code.contains('EXPIRED') ||
        code == 'VALIDATION_ERROR' ||
        code == 'UNAUTHENTICATED' ||
        code == 'FORBIDDEN';
  }

  String _resetErrorMessage(ApiException error) {
    final code = error.code.toUpperCase();
    if (code == 'RATE_LIMITED') {
      return 'Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.';
    }
    if (_isTokenFailure(error)) {
      return 'Tautan atur ulang sudah kedaluwarsa atau tidak berlaku lagi. '
          'Minta kode baru untuk melanjutkan.';
    }
    if (code == 'UNEXPECTED_RESPONSE') {
      return 'Server tidak mengonfirmasi perubahan kata sandi. Coba lagi.';
    }
    return authErrorMessage(error);
  }

  void _requestNewCode() {
    Navigator.pushReplacementNamed(
      context,
      Routes.forgotPassword,
      arguments: widget.email,
    );
  }

  void _backToLogin() {
    Navigator.pushNamedAndRemoveUntil(
      context,
      Routes.login,
      (_) => false,
      arguments: widget.email,
    );
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
            title: 'Buat kata sandi baru',
            subtitle: 'Pilih kata sandi baru untuk akunmu, lalu masuk lagi.',
          ),
          Expanded(
            child: AuthBody(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AuthCard(children: [_buildForm(text)]),
                  const SizedBox(height: Sp.lg),
                  _footNote(text),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildForm(TextTheme text) {
    return AutofillGroup(
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const AuthFieldLabel('Akun'),
            const SizedBox(height: 6),
            Row(
              children: [
                const Icon(
                  Icons.alternate_email,
                  size: 17,
                  color: AppColors.inkMuted,
                ),
                const SizedBox(width: Sp.sm),
                Expanded(
                  child: Text(
                    widget.email,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: Sp.lg),
            const AuthFieldLabel('Kata sandi baru'),
            const SizedBox(height: 4),
            TextFormField(
              controller: _password,
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
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
              onFieldSubmitted: (_) => _confirmFocus.requestFocus(),
            ),
            const SizedBox(height: Sp.lg),
            const AuthFieldLabel('Ulangi kata sandi'),
            const SizedBox(height: 4),
            TextFormField(
              controller: _confirmPassword,
              focusNode: _confirmFocus,
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
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
              onFieldSubmitted: (_) => _submit(),
            ),
            if (_error != null) ...[
              AuthInlineError(_error!),
              if (_tokenExpired)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: _requestNewCode,
                    style: TextButton.styleFrom(
                      minimumSize: const Size(0, 48),
                      padding: const EdgeInsets.symmetric(horizontal: Sp.xs),
                      foregroundColor: AppColors.ink,
                    ),
                    icon: const Icon(Icons.mark_email_read_outlined, size: 16),
                    label: const Text('Minta kode baru'),
                  ),
                ),
            ],
            const SizedBox(height: Sp.lg),
            AuthSubmitButton(
              label: 'Simpan kata sandi',
              loadingLabel: 'Menyimpan…',
              loading: _loading,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }

  Widget _footNote(TextTheme text) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          Icons.shield_outlined,
          size: 14,
          color: Colors.white.withValues(alpha: 0.45),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            'Gunakan kombinasi minimal huruf dan angka. Kata sandi lama tidak '
            'bisa dipakai lagi setelah tersimpan.',
            style: text.labelSmall?.copyWith(
              fontSize: 11,
              height: 1.45,
              color: Colors.white.withValues(alpha: 0.45),
            ),
          ),
        ),
      ],
    );
  }
}
