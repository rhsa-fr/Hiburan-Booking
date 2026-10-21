import 'dart:math';

import 'package:flutter/material.dart';

import '../../app/theme.dart';
import '../../core/api_exception.dart';

/// Reads a money field only when the API actually sent one.
int? moneyValue(Map<String, dynamic> source, String key) {
  final value = source[key];
  if (value is num) return value.toInt();
  return int.tryParse('$value');
}

/// Plain Indonesian API error: server wording for 4xx, safe copy otherwise.
String apiMessage(ApiException error) => switch (error.statusCode) {
  400 || 404 || 409 || 422 => error.message,
  _ => error.userMessage,
};

String sessionText(String session) => switch (session.toLowerCase()) {
  'day' || 'afternoon' => 'Siang',
  'night' || 'evening' => 'Malam',
  'full' || 'full_day' => 'Sehari penuh',
  'morning' => 'Pagi',
  _ => session.replaceAll('_', ' '),
};

String lifecycleText(String status) => switch (status.toLowerCase()) {
  'draft' => 'Draft',
  'requested' => 'Menunggu jawaban',
  'accepted' => 'Diterima vendor',
  'confirmed' => 'Terjadwal',
  'in_progress' => 'Berlangsung',
  'completed' => 'Selesai',
  'cancelled' || 'canceled' => 'Dibatalkan',
  'countered' => 'Ditawar balik',
  'rejected' => 'Ditolak vendor',
  'expired' => 'Kedaluwarsa',
  _ => _humanize(status),
};

/// Backend money states: `fully_paid` means the remainder was settled too.
bool isFullySettled(String? status) => status == 'fully_paid';

bool isDpSettled(String? status) => status == 'dp_paid' || isFullySettled(status);

String paymentText(String status) => switch (status.toLowerCase()) {
  'unpaid' => 'Belum bayar',
  'pending' => 'Menunggu bayar',
  'dp_paid' => 'DP lunas',
  'fully_paid' => 'Lunas',
  'failed' => 'Gagal',
  'refunded' => 'Dikembalikan',
  'expired' => 'Kedaluwarsa',
  _ => _humanize(status),
};

enum BookingChipKind { lifecycle, payment }

/// Status chip for booking pages. The shared chip has no booking-lifecycle
/// labels, and English status names would leak into an Indonesian screen.
class BookingStatusChip extends StatelessWidget {
  const BookingStatusChip(
    this.status, {
    super.key,
    this.kind = BookingChipKind.lifecycle,
  });

  final String status;
  final BookingChipKind kind;

  @override
  Widget build(BuildContext context) {
    final tone = _tone(status);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: Sp.md,
        vertical: Sp.xs + 2,
      ),
      decoration: BoxDecoration(
        color: tone.bg,
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      child: Text(
        kind == BookingChipKind.payment
            ? paymentText(status)
            : lifecycleText(status),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: tone.fg),
      ),
    );
  }
}

({Color fg, Color bg}) _tone(String status) => switch (status.toLowerCase()) {
  'confirmed' ||
  'completed' ||
  'dp_paid' ||
  'fully_paid' ||
  'available' ||
  'settled' => (fg: AppColors.accent, bg: AppColors.accentSoft),
  'unconfirmed' ||
  'pending' ||
  'requested' ||
  'in_progress' ||
  'countered' ||
  'awaiting_payment' ||
  'waiting_payment' => (fg: AppColors.warning, bg: AppColors.warningSoft),
  'cancelled' ||
  'canceled' ||
  'rejected' ||
  'failed' ||
  'expired' => (fg: AppColors.danger, bg: AppColors.dangerSoft),
  'booked' || 'accepted' => (fg: AppColors.primary, bg: AppColors.primarySoft),
  _ => (fg: AppColors.inkMuted, bg: AppColors.neutralSoft),
};

String _humanize(String value) {
  if (value.isEmpty) return 'Tidak diketahui';
  final words = value.replaceAll('_', ' ');
  return words[0].toUpperCase() + words.substring(1);
}

/// Heading + supporting sentence; sections are separated by space, not cards.
class BookingSection extends StatelessWidget {
  const BookingSection({
    super.key,
    required this.title,
    this.hint,
    required this.child,
  });

  final String title;
  final String? hint;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: text.titleLarge),
        if (hint != null) ...[
          const SizedBox(height: Sp.xs),
          Text(hint!, style: text.bodySmall),
        ],
        const SizedBox(height: Sp.md),
        child,
      ],
    );
  }
}

/// One bordered surface per idea. Never nest these.
class BookingPanel extends StatelessWidget {
  const BookingPanel({
    super.key,
    required this.child,
    this.color = AppColors.card,
    this.borderColor = AppColors.line,
  });

  final Widget child;
  final Color color;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(Sp.lg),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(Radii.lg),
        border: Border.all(color: borderColor),
      ),
      child: child,
    );
  }
}

/// Label/value money line. The value is always printed exactly as sent.
class MoneyLine extends StatelessWidget {
  const MoneyLine({
    super.key,
    required this.label,
    required this.value,
    this.emphasis = false,
    this.muted = false,
  });

  final String label;
  final String value;
  final bool emphasis;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final labelStyle = emphasis
        ? text.titleMedium
        : text.bodyMedium?.copyWith(
            color: muted ? AppColors.inkMuted : AppColors.ink,
          );
    final valueStyle = emphasis
        ? text.titleLarge?.copyWith(color: AppColors.accent)
        : text.bodyMedium?.copyWith(
            fontWeight: FontWeight.w600,
            color: muted ? AppColors.inkMuted : AppColors.ink,
            fontFeatures: const [FontFeature.tabularFigures()],
          );
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: Text(label, style: labelStyle)),
        const SizedBox(width: Sp.sm),
        Text(value, style: valueStyle, textAlign: TextAlign.end),
      ],
    );
  }
}

/// `08xx` / `+62…` / `62…` → the digits wa.me expects.
String? whatsappDigits(String? raw) {
  if (raw == null) return null;
  final digits = raw.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.isEmpty) return null;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return '62${digits.substring(1)}';
  if (digits.startsWith('8')) return '62$digits';
  return '62$digits';
}

/// UUID v4 without a dependency; the payment API requires a stable attempt id.
String uuidV4() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
