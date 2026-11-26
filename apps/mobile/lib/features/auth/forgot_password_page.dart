import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import 'auth_support.dart';
import 'email_otp_page.dart';

/// Asks for the account email and always moves on to the code screen. The API
/// answer is deliberately not used to reveal whether an account exists.
class ForgotPasswordPage extends StatefulWidget {
  const ForgotPasswordPage({super.key, this.initialEmail});

  /// Prefilled from Login so the user does not retype an address already typed.
  final String? initialEmail;

  @override
  State<ForgotPasswordPage> createState() => _ForgotPasswordPageState();
}

class _ForgotPasswordPageState extends State<ForgotPasswordPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _email;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _email = TextEditingController(text: widget.initialEmail ?? '');
  }

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading) return;
    setState(() => _error = null);
    if (!(_formKey.currentState?.validate() ?? false)) return;

    FocusScope.of(context).unfocus();
    final scope = AppScope.of(context);
    final email = _email.text.trim();
    setState(() => _loading = true);

    try {
      final payload = await scope.api.post(
        '/auth/password/forgot',
        auth: false,
        body: {'email': email},
      );
      final data = payload is Map ? payload.cast<String, dynamic>() : null;
      if (data == null || data['sent'] != true) {
        throw const ApiException(
          code: 'UNEXPECTED_RESPONSE',
          message: 'Respons permintaan kode tidak lengkap.',
        );
      }
      if (!mounted) return;
      Navigator.pushNamed(
        context,
        Routes.emailOtp,
        arguments: EmailOtpArgs(email: email, mode: EmailOtpMode.reset),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(
        () => _error = error.code == 'UNEXPECTED_RESPONSE'
            ? 'Permintaan kode belum bisa diproses. Coba lagi sebentar.'
            : authErrorMessage(error),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _back() {
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
      backgroundColor: AppColors.stage,
      body: Column(
        children: [
          AuthStage(
            onBack: _back,
            title: 'Lupa kata sandi',
            subtitle: 'Masukkan email akunmu. Kami kirim kode untuk membuat '
                'kata sandi baru.',
          ),
          Expanded(
            child: AuthBody(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AuthCard(children: [_buildForm(text)]),
                  const SizedBox(height: Sp.lg),
                  _googleNote(text),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildForm(TextTheme text) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const AuthFieldLabel('Alamat email'),
          const SizedBox(height: 4),
          TextFormField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.email],
            autocorrect: false,
            enableSuggestions: false,
            style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w500),
            decoration: authLineField(
              hint: 'contoh@tarlink.id',
              prefixIcon: const AuthFieldIcon(Icons.alternate_email),
            ),
            validator: emailError,
            onChanged: (_) {
              if (_error != null) setState(() => _error = null);
            },
            onFieldSubmitted: (_) => _submit(),
          ),
          if (_error != null) AuthInlineError(_error!),
          const SizedBox(height: Sp.lg),
          AuthSubmitButton(
            label: 'Kirim kode',
            loadingLabel: 'Mengirim kode…',
            loading: _loading,
            onPressed: _submit,
          ),
          const SizedBox(height: Sp.sm),
          Text(
            'Kalau email terdaftar, kode akan segera dikirim. Alamat yang tidak '
            'terdaftar tidak menerima kode apa pun.',
            style: text.labelSmall?.copyWith(
              fontSize: 11,
              height: 1.45,
              color: AppColors.inkMuted,
            ),
          ),
        ],
      ),
    );
  }

  /// Static note, not a control: Google accounts have no password to reset.
  Widget _googleNote(TextTheme text) {
    return Container(
      padding: const EdgeInsets.all(Sp.md),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(Radii.lg),
        border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(
              Icons.info_outline,
              size: 16,
              color: AppColors.lime.withValues(alpha: 0.85),
            ),
          ),
          const SizedBox(width: Sp.sm),
          Expanded(
            child: Text(
              'Akun yang dibuat dengan Google belum punya kata sandi. Masuk '
              'lewat tombol Lanjutkan dengan Google di halaman masuk.',
              style: text.labelSmall?.copyWith(
                fontSize: 11,
                height: 1.5,
                color: Colors.white.withValues(alpha: 0.62),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
