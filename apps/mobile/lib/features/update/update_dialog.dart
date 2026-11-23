import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/theme.dart';
import 'app_update_models.dart';
import 'app_update_service.dart';

/// What the user did with the offer.
enum AppUpdateDialogResult {
  /// "Nanti", back, or a barrier tap: snooze this build for a day.
  declined,

  /// The system installer was opened; the file stays in the cache directory.
  installing,
}

/// Outcome of one check, so callers can add their own feedback (the account tab
/// shows a snackbar only for an explicit check).
enum AppUpdateCheckOutcome { noUpdate, prompted }

/// Runs one check and shows the dialog when an update should be offered.
///
/// This is the single place that applies the prompt policy, so no call site can
/// forget to record a decline and re-prompt in a loop.
Future<AppUpdateCheckOutcome> runAppUpdateCheck(
  BuildContext context, {
  required AppUpdateService service,
  bool manual = false,
}) async {
  final info = await service.checkForUpdate(manual: manual);
  if (info == null) return AppUpdateCheckOutcome.noUpdate;
  if (!context.mounted) return AppUpdateCheckOutcome.noUpdate;
  service.markPrompted(info);
  final result = await showAppUpdateDialog(
    context,
    service: service,
    info: info,
  );
  if (result != AppUpdateDialogResult.installing) {
    await service.markDeclined(info);
  }
  return AppUpdateCheckOutcome.prompted;
}

Future<AppUpdateDialogResult?> showAppUpdateDialog(
  BuildContext context, {
  required AppUpdateService service,
  required AppUpdateInfo info,
}) {
  return showDialog<AppUpdateDialogResult>(
    context: context,
    barrierDismissible: !info.forced,
    builder: (_) => AppUpdateDialog(service: service, info: info),
  );
}

/// Compact update sheet: version + notes, a live progress bar while the APK
/// downloads, and one honest line per failure. A forced update hides "Nanti".
class AppUpdateDialog extends StatefulWidget {
  const AppUpdateDialog({
    super.key,
    required this.service,
    required this.info,
  });

  final AppUpdateService service;
  final AppUpdateInfo info;

  @override
  State<AppUpdateDialog> createState() => _AppUpdateDialogState();
}

enum _Stage { offer, downloading, installing, permission, error }

class _AppUpdateDialogState extends State<AppUpdateDialog>
    with WidgetsBindingObserver {
  _Stage _stage = _Stage.offer;
  int _received = 0;
  int? _total;
  String? _error;
  String? _path;
  AppUpdateCancelToken? _cancel;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _total = widget.info.sizeBytes;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _cancel?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Back from the "install unknown apps" screen: keep the dialog open and
    // continue with the bytes already on disk.
    if (state == AppLifecycleState.resumed && _stage == _Stage.permission) {
      unawaited(_resumeAfterPermission());
    }
  }

  Future<bool> _canInstall() async {
    try {
      return await widget.service.canInstallPackages();
    } catch (_) {
      return false;
    }
  }

  Future<void> _start() async {
    final path = _path;
    if (path != null) {
      await _install(path);
      return;
    }
    if (!await _canInstall()) {
      if (!mounted) return;
      setState(() => _stage = _Stage.permission);
      return;
    }
    await _download();
  }

  Future<void> _resumeAfterPermission() async {
    if (!await _canInstall() || !mounted) return;
    await _start();
  }

  Future<void> _download() async {
    final cancel = AppUpdateCancelToken();
    setState(() {
      _cancel = cancel;
      _stage = _Stage.downloading;
      _error = null;
      _received = 0;
    });
    try {
      final path = await widget.service.downloadUpdate(
        widget.info,
        onProgress: (received, total) {
          if (!mounted || !identical(cancel, _cancel)) return;
          setState(() {
            _received = received;
            if (total != null && total > 0) _total = total;
          });
        },
        cancel: cancel,
      );
      if (!mounted || !identical(cancel, _cancel)) return;
      _path = path;
      if (!await _canInstall()) {
        if (!mounted || !identical(cancel, _cancel)) return;
        setState(() => _stage = _Stage.permission);
        return;
      }
      if (!mounted) return;
      await _install(path);
    } on AppUpdateException catch (error) {
      if (!mounted || !identical(cancel, _cancel)) return;
      if (error.error == AppUpdateError.cancelled) {
        setState(() {
          _stage = _Stage.offer;
          _received = 0;
        });
        return;
      }
      setState(() {
        _stage = _Stage.error;
        _error = error.message;
      });
    }
  }

  Future<void> _install(String path) async {
    setState(() => _stage = _Stage.installing);
    final result = await widget.service.install(path);
    if (!mounted) return;
    switch (result.status) {
      case AppUpdateInstallStatus.ok:
        Navigator.of(context).pop(AppUpdateDialogResult.installing);
      case AppUpdateInstallStatus.noPermission:
        setState(() => _stage = _Stage.permission);
      case AppUpdateInstallStatus.fileMissing:
        _path = null;
        setState(() {
          _stage = _Stage.error;
          _error = const AppUpdateException(AppUpdateError.fileMissing).message;
        });
      case AppUpdateInstallStatus.noActivity:
        setState(() {
          _stage = _Stage.error;
          _error = const AppUpdateException(AppUpdateError.noInstaller).message;
        });
      case AppUpdateInstallStatus.failed:
        setState(() {
          _stage = _Stage.error;
          _error = const AppUpdateException(AppUpdateError.installFailed).message;
        });
    }
  }

  void _cancelDownload() {
    _cancel?.cancel();
    if (!mounted) return;
    setState(() {
      _stage = _Stage.offer;
      _received = 0;
    });
  }

  void _retry() {
    final path = _path;
    if (path != null) {
      unawaited(_install(path));
      return;
    }
    unawaited(_start());
  }

  void _openSettings() {
    // The dialog stays open; the lifecycle observer continues when the user
    // comes back with the permission granted.
    unawaited(widget.service.openInstallSettings());
  }

  void _decline() => Navigator.of(context).pop(AppUpdateDialogResult.declined);

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return PopScope(
      canPop: !widget.info.forced,
      child: Dialog(
        insetPadding: const EdgeInsets.symmetric(
          horizontal: Sp.xl,
          vertical: Sp.xl,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.xxl),
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, Sp.md),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _header(text),
                const SizedBox(height: Sp.md),
                _body(text),
                const SizedBox(height: Sp.lg),
                _actions(text),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _header(TextTheme text) {
    final title = widget.info.forced
        ? 'Pembaruan wajib'
        : 'Pembaruan tersedia';
    final subtitle =
        'Versi ${widget.info.version} · ${_megabytes(widget.info.sizeBytes)}';
    return Row(
      children: [
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: AppColors.lime,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Icon(
            Icons.system_update_alt_rounded,
            size: 20,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(width: Sp.md),
        Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: text.titleMedium?.copyWith(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.2,
                ),
              ),
              Text(
                subtitle,
                style: text.bodySmall?.copyWith(
                  fontSize: 12,
                  color: AppColors.inkMuted,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _body(TextTheme text) {
    switch (_stage) {
      case _Stage.offer:
        return _offerBody(text);
      case _Stage.downloading:
        final total = _total;
        final progress = total != null && total > 0
            ? (_received / total).clamp(0.0, 1.0)
            : null;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(Radii.pill),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 6,
                backgroundColor: AppColors.surfaceHigh,
                color: AppColors.limeDark,
              ),
            ),
            const SizedBox(height: Sp.sm),
            Row(
              children: [
                Text(
                  progress == null
                      ? 'Mengunduh…'
                      : '${(progress * 100).round()}%',
                  style: text.labelMedium?.copyWith(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const Spacer(),
                Text(
                  '${_megabytes(_received)}'
                  '${total == null ? '' : ' / ${_megabytes(total)}'}',
                  style: text.bodySmall?.copyWith(fontSize: 12),
                ),
              ],
            ),
          ],
        );
      case _Stage.installing:
        return Row(
          children: [
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: Sp.sm),
            Expanded(
              child: Text(
                'Membuka pemasang…',
                style: text.bodySmall?.copyWith(fontSize: 12.5),
              ),
            ),
          ],
        );
      case _Stage.permission:
        return Text(
          _path == null
              ? 'Izinkan Tarlink memasang aplikasi dari sumber ini, lalu '
                    'kembali ke sini untuk melanjutkan.'
              : 'Berkas sudah diunduh. Beri izin pemasangan, lalu kembali ke '
                    'sini untuk melanjutkan tanpa mengunduh ulang.',
          style: text.bodySmall?.copyWith(
            fontSize: 12.5,
            height: 1.45,
            color: AppColors.ink,
          ),
        );
      case _Stage.error:
        return Text(
          _error ?? const AppUpdateException(AppUpdateError.installFailed).message,
          style: text.bodySmall?.copyWith(
            fontSize: 12.5,
            height: 1.45,
            color: AppColors.danger,
          ),
        );
    }
  }

  Widget _offerBody(TextTheme text) {
    final notes = widget.info.notes;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.info.forced) ...[
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: 10,
              vertical: Sp.sm,
            ),
            decoration: BoxDecoration(
              color: AppColors.warningSoft,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.priority_high_rounded,
                  size: 14,
                  color: AppColors.warning,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Versi ini wajib dipasang untuk melanjutkan.',
                    style: text.bodySmall?.copyWith(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.warning,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: Sp.md),
        ],
        if (notes.isNotEmpty)
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 96),
            child: SingleChildScrollView(
              child: Text(
                notes,
                style: text.bodySmall?.copyWith(
                  fontSize: 12.5,
                  height: 1.45,
                  color: AppColors.ink,
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _actions(TextTheme text) {
    switch (_stage) {
      case _Stage.offer:
        if (widget.info.forced) {
          return _primaryButton('Perbarui', _start);
        }
        return Row(
          children: [
            Expanded(child: _secondaryButton('Nanti', _decline)),
            const SizedBox(width: Sp.md),
            Expanded(child: _primaryButton('Perbarui', _start)),
          ],
        );
      case _Stage.downloading:
        return _textButton('Batal', _cancelDownload);
      case _Stage.installing:
        return const SizedBox.shrink();
      case _Stage.permission:
        return Row(
          children: [
            Expanded(child: _secondaryButton('Nanti', _decline)),
            const SizedBox(width: Sp.md),
            Expanded(child: _primaryButton('Buka pengaturan', _openSettings)),
          ],
        );
      case _Stage.error:
        return Row(
          children: [
            Expanded(child: _secondaryButton('Tutup', _decline)),
            const SizedBox(width: Sp.md),
            Expanded(child: _primaryButton('Coba lagi', _retry)),
          ],
        );
    }
  }

  Widget _primaryButton(String label, VoidCallback onPressed) {
    return FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(44),
        padding: const EdgeInsets.symmetric(horizontal: Sp.md),
        textStyle: Theme.of(context).textTheme.labelLarge?.copyWith(
          fontSize: 13.5,
          fontWeight: FontWeight.w800,
          color: AppColors.ink,
        ),
      ),
      child: Text(label),
    );
  }

  Widget _secondaryButton(String label, VoidCallback onPressed) {
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(44),
        padding: const EdgeInsets.symmetric(horizontal: Sp.md),
        textStyle: Theme.of(context).textTheme.labelLarge?.copyWith(
          fontSize: 13.5,
          fontWeight: FontWeight.w700,
          color: AppColors.ink,
        ),
      ),
      child: Text(label),
    );
  }

  Widget _textButton(String label, VoidCallback onPressed) {
    return TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(minimumSize: const Size.fromHeight(44)),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelLarge?.copyWith(
          fontSize: 13.5,
          fontWeight: FontWeight.w700,
          color: AppColors.inkMuted,
        ),
      ),
    );
  }
}

String _megabytes(int bytes) {
  final value = bytes / (1024 * 1024);
  return '${value.toStringAsFixed(1).replaceAll('.', ',')} MB';
}
