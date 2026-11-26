import 'dart:async';

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/ui.dart';
import 'auth_support.dart';

/// Which flow owns the code: account verification or password reset. The
/// endpoints differ, so the page must know before the first submit.
enum EmailOtpMode { register, reset }

/// One 6-digit code screen for both flows. It never signs in on reset and
/// never keeps a code around after the token/password handoff.
class EmailOtpPage extends StatefulWidget {
  const EmailOtpPage({
    super.key,
    required this.email,
    required this.mode,
    this.devCode,
  });

  final String email;
  final EmailOtpMode mode;

  /// Only present on a development server (`OTP_DEV_MODE`). Prefills the field
  /// and shows a hint in debug builds; production copy never mentions it.
  final String? devCode;

  @override
  State<EmailOtpPage> createState() => _EmailOtpPageState();
}

class _EmailOtpPageState extends State<EmailOtpPage> {
  static const _resendSeconds = 60;

  final _code = TextEditingController();

  Timer? _timer;
  int _secondsLeft = _resendSeconds;
  bool _submitting = false;
  bool _resending = false;
  bool _canRetry = false;
  String? _error;
  String? _resendInfo;
  String? _devCode;

  bool get _isRegister => widget.mode == EmailOtpMode.register;

  bool get _canResend => _secondsLeft == 0 && !_submitting && !_resending;

  @override
  void initState() {
    super.initState();
    final devCode = widget.devCode;
    if (kDebugMode && devCode != null && devCode.isNotEmpty) {
      _devCode = devCode;
      _code.text = devCode;
    }
    _startCountdown();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _code.dispose();
    super.dispose();
  }

  void _startCountdown() {
    _timer?.cancel();
    _secondsLeft = _resendSeconds;
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      setState(() {
        _secondsLeft -= 1;
        if (_secondsLeft <= 0) {
          _secondsLeft = 0;
          timer.cancel();
        }
      });
    });
  }

  String get _countdownLabel {
    final minutes = _secondsLeft ~/ 60;
    final seconds = (_secondsLeft % 60).toString().padLeft(2, '0');
    return 'Tunggu $minutes:$seconds';
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final code = _code.text.trim();
    if (code.length != 6) {
      setState(() {
        _error = 'Masukkan 6 digit kode dari email.';
        _canRetry = false;
      });
      return;
    }

    FocusScope.of(context).unfocus();
    final scope = AppScope.of(context);
    setState(() {
      _submitting = true;
      _error = null;
      _resendInfo = null;
      _canRetry = false;
    });

    try {
      if (_isRegister) {
        final payload = await scope.api.post(
          '/auth/register/verify',
          auth: false,
          body: {'email': widget.email, 'code': code},
        );
        final data = payload is Map ? payload.cast<String, dynamic>() : null;
        if (data == null || data['access_token'] is! String) {
          throw const ApiException(
            code: 'UNEXPECTED_RESPONSE',
            message: 'Respons verifikasi tidak lengkap.',
          );
        }
        await scope.session.signIn(data);
        TextInput.finishAutofillContext();
        if (!mounted) return;
        Navigator.pushNamedAndRemoveUntil(context, Routes.home, (_) => false);
      } else {
        final payload = await scope.api.post(
          '/auth/password/verify',
          auth: false,
          body: {'email': widget.email, 'code': code},
        );
        final data = payload is Map ? payload.cast<String, dynamic>() : null;
        final token = data?['reset_token'];
        if (token is! String || token.isEmpty) {
          throw const ApiException(
            code: 'UNEXPECTED_RESPONSE',
            message: 'Respons verifikasi tidak lengkap.',
          );
        }
        if (!mounted) return;
        Navigator.pushReplacementNamed(
          context,
          Routes.resetPassword,
          arguments: ResetPasswordArgs(email: widget.email, token: token),
        );
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _codeErrorMessage(error);
        _canRetry = _retryable(error);
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// Register mode asks the register endpoint; reset mode re-requests the
  /// reset code with the same address, so the user stays on one screen.
  Future<void> _resend() async {
    if (!_canResend) return;
    final scope = AppScope.of(context);
    setState(() {
      _resending = true;
      _error = null;
      _resendInfo = null;
    });

    try {
      final payload = await scope.api.post(
        _isRegister ? '/auth/register/resend' : '/auth/password/forgot',
        auth: false,
        body: {'email': widget.email},
      );
      final data = payload is Map ? payload.cast<String, dynamic>() : null;
      if (data == null) {
        throw const ApiException(
          code: 'UNEXPECTED_RESPONSE',
          message: 'Respons pengiriman kode tidak lengkap.',
        );
      }
      final devCode = data['dev_code'];
      if (!mounted) return;
      setState(() {
        _resendInfo = 'Kode baru sudah dikirim ke ${widget.email}.';
        if (kDebugMode) {
          _devCode = devCode is String && devCode.isNotEmpty ? devCode : null;
        }
      });
      _startCountdown();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _resendErrorMessage(error);
        _canRetry = false;
      });
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  /// A resend is not a code attempt: a rejected resend means the pending
  /// registration is gone, not that the customer typed the wrong digits.
  String _resendErrorMessage(ApiException error) {
    final code = error.code.toUpperCase();
    if (code == 'RATE_LIMITED') {
      return 'Terlalu banyak permintaan kode. Tunggu beberapa menit, lalu coba lagi.';
    }
    if (code == 'VALIDATION_ERROR' || code == 'NOT_FOUND') {
      return _isRegister
          ? 'Sesi pendaftaran sudah berakhir. Kembali dan daftar ulang, atau hubungi bantuan.'
          : 'Kode sudah tidak berlaku. Mulai ulang dari halaman lupa kata sandi.';
    }
    return authErrorMessage(error, register: _isRegister);
  }

  bool _retryable(ApiException error) => switch (error.code) {
    'NETWORK_ERROR' || 'TIMEOUT' || 'INTERNAL_ERROR' || 'UPSTREAM_ERROR' =>
      true,
    _ => false,
  };

  /// The API answers a wrong or already-used code with `VALIDATION_ERROR` and
  /// an attempt-limit hit with `RATE_LIMITED`. Keep the older expiry shapes
  /// readable too, and never show the server's English message.
  String _codeErrorMessage(ApiException error) {
    final code = error.code.toUpperCase();
    if (code == 'RATE_LIMITED') {
      return 'Terlalu banyak percobaan. Tunggu beberapa menit, lalu minta kode baru.';
    }
    if (code.contains('EXPIRED')) {
      return 'Kode sudah kedaluwarsa. Minta kode baru lewat tombol di bawah.';
    }
    if (code.contains('INVALID') ||
        code.contains('MISMATCH') ||
        code.contains('VALIDATION') ||
        code == 'NOT_FOUND') {
      return 'Kode tidak cocok atau sudah kedaluwarsa. Periksa 6 digit di email, atau minta kode baru.';
    }
    if (code == 'UNEXPECTED_RESPONSE') {
      return 'Server tidak mengirim kode yang benar. Coba lagi sebentar.';
    }
    return authErrorMessage(error, register: _isRegister);
  }

  void _back() {
    final navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
    } else {
      navigator.pushReplacementNamed(Routes.login);
    }
  }

  void _onCodeChanged(String value) {
    if (_error != null || _canRetry) {
      setState(() {
        _error = null;
        _canRetry = false;
      });
    }
    if (value.length == 6) _submit();
  }

  /// One tap instead of long-press + paste in the field. An explicit tap wins,
  /// so the clipboard code replaces whatever is already typed; the same
  /// `_submit` guard keeps a pending verification from running twice.
  Future<void> _pasteCode() async {
    if (_submitting) return;
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    if (!mounted) return;
    // Typing the sixth digit can start a verification while the clipboard
    // answers; leave the field alone under a request already in flight.
    if (_submitting) return;

    final text = data?.text ?? '';
    if (text.trim().isEmpty) {
      setState(() {
        _error = 'Clipboard kosong. Salin kode dari email dulu.';
        _canRetry = false;
        _resendInfo = null;
      });
      return;
    }

    final match = RegExp(r'\d{6}').firstMatch(text);
    if (match == null) {
      setState(() {
        _error = 'Clipboard tidak berisi kode 6 digit.';
        _canRetry = false;
        _resendInfo = null;
      });
      return;
    }

    final code = match.group(0)!;
    _code.value = TextEditingValue(
      text: code,
      selection: TextSelection.collapsed(offset: code.length),
    );
    setState(() {
      _error = null;
      _canRetry = false;
      _resendInfo = null;
    });
    await _submit();
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
            title: _isRegister ? 'Verifikasi email' : 'Atur ulang sandi',
            subtitle: _isRegister
                ? 'Masukkan kode 6 digit yang kami kirim ke emailmu.'
                : 'Kalau email terdaftar, kode sudah dikirim ke emailmu.',
          ),
          Expanded(
            child: AuthBody(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AuthCard(children: [_buildCodeForm(text)]),
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

  Widget _buildCodeForm(TextTheme text) {
    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const AuthFieldLabel('Kode dikirim ke'),
          const SizedBox(height: 6),
          Row(
            children: [
              Icon(
                Icons.mark_email_read_outlined,
                size: 18,
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
          const AuthFieldLabel('Kode verifikasi'),
          const SizedBox(height: 4),
          TextField(
            controller: _code,
            autofocus: true,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.oneTimeCode],
            maxLength: 6,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            textAlign: TextAlign.center,
            style: text.headlineSmall?.copyWith(
              fontSize: 26,
              letterSpacing: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
            decoration: authLineField(
              hint: '000000',
            ).copyWith(counterText: ''),
            onChanged: _onCodeChanged,
            onSubmitted: (_) => _submit(),
          ),
          if (_devCode != null)
            Padding(
              padding: const EdgeInsets.only(top: Sp.sm),
              child: Text(
                'Mode uji: kode $_devCode',
                style: text.labelSmall?.copyWith(
                  fontSize: 11,
                  color: AppColors.inkMuted,
                ),
              ),
            ),
          if (_resendInfo != null)
            Padding(
              padding: const EdgeInsets.only(top: Sp.md),
              child: InfoStrip(
                message: _resendInfo!,
                icon: Icons.mark_email_read_outlined,
                tone: InfoTone.success,
              ),
            ),
          if (_error != null) ...[
            AuthInlineError(_error!),
            if (_canRetry)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _submitting ? null : _submit,
                  style: TextButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    padding: const EdgeInsets.symmetric(horizontal: Sp.xs),
                    foregroundColor: AppColors.ink,
                  ),
                  icon: const Icon(Icons.refresh, size: 16),
                  label: const Text('Coba lagi'),
                ),
              ),
          ],
          const SizedBox(height: Sp.xs),
          Align(
            alignment: Alignment.centerLeft,
            child: Tooltip(
              message: 'Tempel kode 6 digit dari papan klip',
              child: TextButton.icon(
                onPressed: _submitting ? null : _pasteCode,
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, 48),
                  padding: const EdgeInsets.symmetric(horizontal: Sp.xs),
                  foregroundColor: AppColors.ink,
                  disabledForegroundColor: AppColors.inkMuted,
                ),
                icon: const Icon(Icons.content_paste_go, size: 18),
                label: const Text('Tempel kode'),
              ),
            ),
          ),
          const SizedBox(height: Sp.lg),
          AuthSubmitButton(
            label: 'Verifikasi kode',
            loadingLabel: 'Memeriksa kode…',
            loading: _submitting,
            onPressed: _submit,
          ),
          const SizedBox(height: Sp.sm),
          Row(
            children: [
              Expanded(
                child: Text(
                  _resendInfo == null
                      ? 'Belum menerima kode?'
                      : 'Sudah meminta kode baru.',
                  style: text.labelSmall?.copyWith(
                    fontSize: 11.5,
                    color: AppColors.inkMuted,
                  ),
                ),
              ),
              TextButton(
                onPressed: _canResend ? _resend : null,
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, 44),
                  padding: const EdgeInsets.symmetric(horizontal: Sp.sm),
                  foregroundColor: AppColors.ink,
                  disabledForegroundColor: AppColors.inkMuted,
                  textStyle: text.labelSmall?.copyWith(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                child: Text(_canResend ? 'Kirim ulang kode' : _countdownLabel),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _footNote(TextTheme text) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          Icons.schedule,
          size: 14,
          color: Colors.white.withValues(alpha: 0.45),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            _isRegister
                ? 'Kode berlaku beberapa menit. Kalau tidak masuk, cek folder Spam sebelum meminta kode baru.'
                : 'Kode hanya berlaku sekali. Kata sandi lama tetap aktif sampai kata sandi baru tersimpan.',
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
