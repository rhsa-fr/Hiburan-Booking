import 'dart:math';

import 'package:flutter/material.dart';

import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/ui.dart';

export '../../core/format.dart' show moneyValue;

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

bool isDpSettled(String? status) =>
    status == 'dp_paid' || isFullySettled(status);

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

/// Maps any booking/lifecycle/payment code onto the shared [StatusPill] tones.
PillTone bookingPillTone(String status) => switch (status.toLowerCase()) {
  'confirmed' ||
  'completed' ||
  'dp_paid' ||
  'fully_paid' ||
  'available' ||
  'settled' => PillTone.success,
  'unconfirmed' ||
  'pending' ||
  'requested' ||
  'in_progress' ||
  'countered' ||
  'awaiting_payment' ||
  'waiting_payment' => PillTone.warning,
  'cancelled' ||
  'canceled' ||
  'rejected' ||
  'failed' ||
  'expired' => PillTone.danger,
  'booked' || 'accepted' => PillTone.brand,
  _ => PillTone.neutral,
};

String _humanize(String value) {
  if (value.isEmpty) return 'Tidak diketahui';
  final words = value.replaceAll('_', ' ');
  return words[0].toUpperCase() + words.substring(1);
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
        boxShadow: const [
          BoxShadow(
            color: Color(0x060F172A),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: child,
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
