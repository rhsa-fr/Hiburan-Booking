import 'package:flutter/material.dart';

import '../app/theme.dart';

/// Skeleton screen, not a lone spinner: the shell keeps its shape while loading.
class AppLoading extends StatefulWidget {
  const AppLoading({super.key, this.rows = 3, this.label = 'Memuat data'});

  final int rows;
  final String label;

  @override
  State<AppLoading> createState() => _AppLoadingState();
}

class _AppLoadingState extends State<AppLoading>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  );
  late final Animation<double> _opacity = Tween<double>(
    begin: 0.45,
    end: 1,
  ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));

  @override
  void initState() {
    super.initState();
    _controller.repeat(reverse: true);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _controller
        ..stop()
        ..value = 1;
    } else if (!_controller.isAnimating) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: widget.label,
      child: FadeTransition(
        opacity: _opacity,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < widget.rows; i++)
              Container(
                margin: const EdgeInsets.only(bottom: Sp.sm),
                padding: const EdgeInsets.all(Sp.lg),
                decoration: BoxDecoration(
                  color: AppColors.card,
                  borderRadius: BorderRadius.circular(Radii.lg),
                  border: Border.all(color: AppColors.line),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _bar(0.45, 14),
                    const SizedBox(height: Sp.md),
                    _bar(0.85, 12),
                    const SizedBox(height: Sp.sm),
                    _bar(0.6, 12),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _bar(double widthFactor, double height) => FractionallySizedBox(
    widthFactor: widthFactor,
    alignment: Alignment.centerLeft,
    child: Container(
      height: height,
      decoration: BoxDecoration(
        color: AppColors.skeleton,
        borderRadius: BorderRadius.circular(Sp.xs),
      ),
    ),
  );
}

/// Failure state: plain Indonesian + a retry the thumb can reach.
class AppError extends StatelessWidget {
  const AppError({
    super.key,
    required this.message,
    this.onRetry,
    this.retryLabel = 'Coba lagi',
    this.compact = false,
  });

  final String message;
  final VoidCallback? onRetry;
  final String retryLabel;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    if (compact) {
      return Container(
        padding: const EdgeInsets.all(Sp.md),
        decoration: BoxDecoration(
          color: AppColors.dangerSoft,
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.info_outline, size: 20, color: AppColors.danger),
            const SizedBox(width: Sp.sm),
            Expanded(
              child: Text(
                message,
                style: text.bodyMedium?.copyWith(color: AppColors.danger),
              ),
            ),
          ],
        ),
      );
    }

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(Sp.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: const BoxDecoration(
                color: AppColors.dangerSoft,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.cloud_off_outlined,
                color: AppColors.danger,
                size: 26,
              ),
            ),
            const SizedBox(height: Sp.lg),
            Text(
              message,
              textAlign: TextAlign.center,
              style: text.bodyLarge,
            ),
            if (onRetry != null) ...[
              const SizedBox(height: Sp.xl),
              PrimaryButton(
                label: retryLabel,
                onPressed: onRetry,
                icon: Icons.refresh,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Empty state: one sentence, no illustration hunt.
class AppEmpty extends StatelessWidget {
  const AppEmpty({
    super.key,
    required this.message,
    this.icon = Icons.inbox_outlined,
    this.action,
  });

  final String message;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Sp.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: const BoxDecoration(
                color: AppColors.neutralSoft,
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: AppColors.inkMuted, size: 26),
            ),
            const SizedBox(height: Sp.lg),
            Text(
              message,
              textAlign: TextAlign.center,
              style: text.bodyLarge?.copyWith(color: AppColors.inkMuted),
            ),
            if (action != null) ...[
              const SizedBox(height: Sp.lg),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    super.key,
    required this.label,
    this.onPressed,
    this.loading = false,
    this.icon,
    this.loadingLabel = 'Memproses…',
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final IconData? icon;
  final String loadingLabel;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme.labelLarge;
    final showIcon = icon != null && !loading;
    return FilledButton(
      onPressed: loading ? null : onPressed,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (loading)
            const Padding(
              padding: EdgeInsets.only(right: Sp.sm),
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else if (showIcon)
            Padding(
              padding: const EdgeInsets.only(right: Sp.sm),
              child: Icon(icon, size: 20),
            ),
          Flexible(
            child: Text(
              loading ? loadingLabel : label,
              textAlign: TextAlign.center,
              style: text?.copyWith(
                color: onPressed == null || loading
                    ? AppColors.inkMuted
                    : AppColors.onPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

enum StatusKind { lifecycle, payment, settlement, availability }

/// Indonesian status labels. Unknown codes degrade to readable text, never raw.
class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key, this.kind = StatusKind.lifecycle});

  final String status;
  final StatusKind kind;

  @override
  Widget build(BuildContext context) {
    final tone = _tone(status, kind);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Sp.md, vertical: Sp.xs + 2),
      decoration: BoxDecoration(
        color: tone.bg,
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      child: Text(
        tone.label,
        style: Theme.of(
          context,
        ).textTheme.labelSmall?.copyWith(color: tone.fg),
      ),
    );
  }
}

const _labels = <StatusKind, Map<String, String>>{
  StatusKind.lifecycle: {
    'draft': 'Draft',
    'awaiting_payment': 'Menunggu bayar',
    'waiting_payment': 'Menunggu bayar',
    'confirmed': 'Terkonfirmasi',
    'scheduled': 'Terjadwal',
    'in_progress': 'Berlangsung',
    'completed': 'Selesai',
    'cancelled': 'Dibatalkan',
    'canceled': 'Dibatalkan',
    'expired': 'Kedaluwarsa',
  },
  StatusKind.payment: {
    'unpaid': 'Belum bayar',
    'pending': 'Menunggu bayar',
    'fully_paid': 'Lunas',
    'dp_paid': 'DP lunas',
    'failed': 'Gagal',
    'refunded': 'Dikembalikan',
    'expired': 'Kedaluwarsa',
  },
  StatusKind.settlement: {
    'pending': 'Belum cair',
    'settled': 'Cair',
    'held': 'Ditahan',
  },
  StatusKind.availability: {
    'available': 'Tersedia',
    'unconfirmed': 'Belum pasti',
    'stale': 'Data lama',
    'blocked': 'Tutup',
    'held': 'Ditahan',
    'booked': 'Terisi',
  },
};

({String label, Color fg, Color bg}) _tone(String status, StatusKind kind) {
  final key = status.toLowerCase();
  final label = _labels[kind]?[key] ?? _humanize(key);
  return switch (key) {
    'available' || 'confirmed' || 'settled' || 'fully_paid' || 'completed' || 'dp_paid' =>
      (label: label, fg: AppColors.accent, bg: AppColors.accentSoft),
    'unconfirmed' || 'pending' || 'held' || 'awaiting_payment' || 'waiting_payment' ||
    'in_progress' => (label: label, fg: AppColors.warning, bg: AppColors.warningSoft),
    'blocked' || 'cancelled' || 'canceled' || 'failed' || 'expired' =>
      (label: label, fg: AppColors.danger, bg: AppColors.dangerSoft),
    'booked' => (label: label, fg: AppColors.primary, bg: AppColors.primarySoft),
    _ => (label: label, fg: AppColors.inkMuted, bg: AppColors.neutralSoft),
  };
}

String _humanize(String value) {
  if (value.isEmpty) return 'Tidak diketahui';
  final words = value.replaceAll('_', ' ');
  return words[0].toUpperCase() + words.substring(1);
}
