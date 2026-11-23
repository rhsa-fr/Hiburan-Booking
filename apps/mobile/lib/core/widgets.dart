import 'package:flutter/material.dart';

import '../app/theme.dart';
import 'ui.dart';

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
                margin: const EdgeInsets.only(bottom: Sp.md),
                padding: const EdgeInsets.all(Sp.lg),
                decoration: BoxDecoration(
                  color: AppColors.card,
                  borderRadius: BorderRadius.circular(Radii.xxl),
                  border: Border.all(color: AppColors.line),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (i == 0)
                      Row(
                        children: [
                          _block(48, 48, radius: Radii.lg),
                          const SizedBox(width: Sp.md),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                _bar(0.55, 14),
                                const SizedBox(height: Sp.sm),
                                _bar(0.85, 11),
                              ],
                            ),
                          ),
                        ],
                      )
                    else ...[
                      _bar(0.4, 12),
                      const SizedBox(height: Sp.md),
                      _bar(0.92, 12),
                      const SizedBox(height: Sp.sm),
                      _bar(0.64, 12),
                    ],
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
    child: _block(double.infinity, height),
  );

  Widget _block(double width, double height, {double radius = Sp.xs}) =>
      Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: AppColors.skeleton,
          borderRadius: BorderRadius.circular(radius),
        ),
      );
}

/// Round stage pill used by the empty and error states. The beam wash keeps a
/// blank screen from reading as a broken one.
class _StateArt extends StatelessWidget {
  const _StateArt({
    required this.icon,
    required this.background,
    required this.foreground,
  });

  final IconData icon;
  final List<Color> background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 78,
      height: 78,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: background,
        ),
        borderRadius: BorderRadius.circular(26),
        boxShadow: const [
          BoxShadow(
            color: Color(0x180B1220),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        fit: StackFit.expand,
        children: [
          const StageBeams(intensity: 0.8),
          Center(child: Icon(icon, color: foreground, size: 30)),
        ],
      ),
    );
  }
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
          borderRadius: BorderRadius.circular(Radii.lg),
          border: Border.all(color: AppColors.danger.withValues(alpha: 0.18)),
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
            const _StateArt(
              icon: Icons.cloud_off_outlined,
              background: [Color(0xFF3B1512), Color(0xFF0B1220)],
              foreground: Color(0xFFFF9A8F),
            ),
            const SizedBox(height: Sp.lg),
            Text(
              message,
              textAlign: TextAlign.center,
              style: text.bodyLarge?.copyWith(color: AppColors.inkMuted),
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

/// Empty state: a stage-lit mark, one clear sentence, and one way forward.
class AppEmpty extends StatelessWidget {
  const AppEmpty({
    super.key,
    required this.message,
    this.title,
    this.icon = Icons.inbox_outlined,
    this.action,
  });

  final String message;
  final String? title;
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
            _StateArt(
              icon: icon,
              background: const [Color(0xFF182540), Color(0xFF0B1220)],
              foreground: AppColors.lime,
            ),
            const SizedBox(height: Sp.lg),
            Text(
              title ?? message,
              textAlign: TextAlign.center,
              style: text.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
                letterSpacing: -0.25,
              ),
            ),
            if (title != null) ...[
              const SizedBox(height: Sp.xs),
              Text(
                message,
                textAlign: TextAlign.center,
                style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
              ),
            ],
            if (action != null) ...[const SizedBox(height: Sp.lg), action!],
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
    this.dense = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final IconData? icon;
  final String loadingLabel;

  /// Compact variant for checkout-style screens (46px instead of the 52px theme).
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme.labelLarge;
    final showIcon = icon != null && !loading;
    return FilledButton(
      onPressed: loading ? null : onPressed,
      style: dense
          ? FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(46),
              padding: const EdgeInsets.symmetric(
                horizontal: Sp.lg,
                vertical: 10,
              ),
            )
          : null,
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
              child: Icon(icon, size: dense ? 18 : 20),
            ),
          Flexible(
            child: Text(
              loading ? loadingLabel : label,
              textAlign: TextAlign.center,
              style: text?.copyWith(
                fontSize: dense ? 13.5 : null,
                color: onPressed == null || loading
                    ? AppColors.inkMuted
                    : AppColors.ink,
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
      padding: const EdgeInsets.symmetric(
        horizontal: Sp.sm + 2,
        vertical: Sp.xs + 1,
      ),
      decoration: BoxDecoration(
        color: tone.bg,
        borderRadius: BorderRadius.circular(Radii.pill),
        border: Border.all(color: tone.fg.withValues(alpha: 0.18)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 5,
            height: 5,
            decoration: BoxDecoration(color: tone.fg, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(
            tone.label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: tone.fg,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
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
    'partially_refunded': 'Refund sebagian',
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
    'available' ||
    'confirmed' ||
    'settled' ||
    'fully_paid' ||
    'completed' ||
    'dp_paid' => (label: label, fg: AppColors.accent, bg: AppColors.accentSoft),
    'unconfirmed' ||
    'pending' ||
    'held' ||
    'awaiting_payment' ||
    'waiting_payment' ||
    'in_progress' => (
      label: label,
      fg: AppColors.warning,
      bg: AppColors.warningSoft,
    ),
    'blocked' ||
    'cancelled' ||
    'canceled' ||
    'failed' ||
    'expired' => (label: label, fg: AppColors.danger, bg: AppColors.dangerSoft),
    'booked' => (
      label: label,
      fg: AppColors.primary,
      bg: AppColors.primarySoft,
    ),
    _ => (label: label, fg: AppColors.inkMuted, bg: AppColors.neutralSoft),
  };
}

String _humanize(String value) {
  if (value.isEmpty) return 'Tidak diketahui';
  final words = value.replaceAll('_', ' ');
  return words[0].toUpperCase() + words.substring(1);
}
