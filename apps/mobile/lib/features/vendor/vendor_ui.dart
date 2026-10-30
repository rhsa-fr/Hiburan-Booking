import 'package:flutter/material.dart';

import 'vendor_theme.dart';

const _shortDays = <String>['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const _shortMonths = <String>[
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];
const _fullDays = <String>[
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
  'Minggu',
];
const _fullMonths = <String>[
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/// `GET /vendors/:idOrSlug` returns `{ vendor, packages }`. Flatten it into
/// one vendor map (with `packages`) so screens can read fields directly.
Map<String, dynamic>? vendorPublicPayload(dynamic raw) {
  if (raw is! Map) return null;
  final map = raw.cast<String, dynamic>();
  final vendor = map['vendor'];
  if (vendor is Map) {
    final flattened = vendor.cast<String, dynamic>();
    flattened['packages'] = map['packages'];
    return flattened;
  }
  return map;
}

String vendorInitials(String name) {
  final words = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .toList(growable: false);
  if (words.isEmpty) return 'TL';
  if (words.length == 1) {
    final word = words.first;
    return (word.length >= 2 ? word.substring(0, 2) : word).toUpperCase();
  }
  return words.take(2).map((word) => word.substring(0, 1)).join().toUpperCase();
}

({String dow, String dom, String mon}) vendorDateParts(String? iso) {
  final parsed = iso == null ? null : DateTime.tryParse(iso);
  if (parsed == null) return (dow: '-', dom: '-', mon: '-');
  return (
    dow: _shortDays[parsed.weekday - 1],
    dom: parsed.day.toString().padLeft(2, '0'),
    mon: _shortMonths[parsed.month - 1],
  );
}

String vendorFullDay(DateTime date) => _fullDays[date.weekday - 1];

String vendorMonthName(int month) => _fullMonths[month - 1];

String vendorShortMonth(int month) => _shortMonths[month - 1];

String vendorWeekdayShort(int weekday) => _shortDays[weekday - 1];

enum VendorPillTone { wait, ok, done, no }

VendorPillTone vendorToneForStatus(String status) {
  switch (status.toLowerCase()) {
    case 'requested':
    case 'pending':
    case 'unconfirmed':
    case 'awaiting_payment':
    case 'waiting_payment':
      return VendorPillTone.wait;
    case 'accepted':
    case 'confirmed':
    case 'in_progress':
    case 'dp_paid':
    case 'fully_paid':
    case 'released':
      return VendorPillTone.ok;
    case 'completed':
      return VendorPillTone.done;
    case 'declined':
    case 'rejected':
    case 'cancelled':
    case 'canceled':
    case 'expired':
    case 'no_show':
    case 'failed':
      return VendorPillTone.no;
    default:
      return VendorPillTone.done;
  }
}

/// Hairline card used across the vendor board.
class VendorCard extends StatelessWidget {
  const VendorCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(VendorSp.md),
    this.color = VendorColors.cardWhite,
    this.onTap,
    this.margin,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color color;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry? margin;

  @override
  Widget build(BuildContext context) {
    final surface = Container(
      margin: margin,
      padding: padding,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(VendorRadii.md),
        border: Border.all(color: VendorColors.line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x140B1220),
            blurRadius: 10,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: child,
    );
    if (onTap == null) return surface;
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(VendorRadii.md),
      clipBehavior: Clip.antiAlias,
      child: InkWell(onTap: onTap, child: surface),
    );
  }
}

/// Small uppercase section label with an optional right-side caption.
class VendorSectionTitle extends StatelessWidget {
  const VendorSectionTitle({super.key, required this.label, this.trailing});

  final String label;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: VendorSp.xl, bottom: 9),
      child: Row(
        children: [
          Expanded(child: Text(label, style: vendorKicker)),
          if (trailing != null) ...[
            const SizedBox(width: VendorSp.sm),
            Text(
              trailing!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: vendorHint,
            ),
          ],
        ],
      ),
    );
  }
}

class VendorPill extends StatelessWidget {
  const VendorPill({
    super.key,
    required this.label,
    this.tone = VendorPillTone.done,
  });

  final String label;
  final VendorPillTone tone;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      VendorPillTone.wait => (VendorColors.waitBg, VendorColors.waitFg),
      VendorPillTone.ok => (VendorColors.okBg, VendorColors.okFg),
      VendorPillTone.done => (VendorColors.doneBg, VendorColors.doneFg),
      VendorPillTone.no => (VendorColors.noBg, VendorColors.noFg),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 4,
            height: 4,
            decoration: BoxDecoration(color: fg, shape: BoxShape.circle),
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: vendorText(size: 10.5, weight: FontWeight.w700, color: fg),
          ),
        ],
      ),
    );
  }
}

enum VendorButtonKind { primary, secondary, outlineOnDark }

class VendorButton extends StatelessWidget {
  const VendorButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.kind = VendorButtonKind.primary,
    this.icon,
    this.small = false,
    this.expand = false,
    this.maxLines = 1,
  });

  final String label;
  final VoidCallback? onPressed;
  final VendorButtonKind kind;
  final IconData? icon;
  final bool small;
  final bool expand;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    final (bg, border, fg) = switch (kind) {
      VendorButtonKind.primary => (
        VendorColors.lime,
        VendorColors.limeDark,
        VendorColors.ink,
      ),
      VendorButtonKind.secondary => (
        VendorColors.cardWhite,
        const Color(0xFFD4D6D0),
        VendorColors.ink,
      ),
      VendorButtonKind.outlineOnDark => (
        Colors.transparent,
        Colors.white24,
        Colors.white,
      ),
    };
    final height = small ? 32.0 : 42.0;
    final content = Padding(
      padding: EdgeInsets.symmetric(horizontal: small ? 10 : 14),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (icon != null) ...[
            Icon(icon, size: small ? 14 : 16, color: fg),
            const SizedBox(width: 5),
          ],
          Flexible(
            child: Text(
              label,
              maxLines: maxLines,
              textAlign: TextAlign.center,
              overflow: TextOverflow.ellipsis,
              style: vendorText(
                size: small ? 12 : 13,
                weight: FontWeight.w700,
                color: fg,
                height: maxLines > 1 ? 1.1 : null,
              ),
            ),
          ),
        ],
      ),
    );

    final button = SizedBox(
      height: height,
      width: expand ? double.infinity : null,
      child: Material(
        color: onPressed == null ? bg.withValues(alpha: 0.45) : bg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(VendorRadii.sm),
          side: BorderSide(
            color: onPressed == null ? border.withValues(alpha: 0.4) : border,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          child: Center(child: content),
        ),
      ),
    );
    return button;
  }
}

class VendorStatCell extends StatelessWidget {
  const VendorStatCell({
    super.key,
    required this.value,
    required this.label,
    this.showDivider = true,
  });

  final String value;
  final String label;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: VendorSp.md, horizontal: 6),
      decoration: BoxDecoration(
        border: showDivider
            ? const Border(right: BorderSide(color: VendorColors.lineSoft))
            : null,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: vendorText(size: 16, weight: FontWeight.w800),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: vendorText(
              size: 10.5,
              color: VendorColors.muted,
              height: 1.3,
            ),
          ),
        ],
      ),
    );
  }
}

/// Subtle dot grid used by the dark header and the page canvas.
class VendorDotGridPainter extends CustomPainter {
  const VendorDotGridPainter({required this.color, this.spacing = 9});

  final Color color;
  final double spacing;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    for (var y = 0.0; y <= size.height; y += spacing) {
      for (var x = 0.0; x <= size.width; x += spacing) {
        canvas.drawCircle(Offset(x, y), 1, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant VendorDotGridPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.spacing != spacing;
}

class VendorBottomNav extends StatelessWidget {
  const VendorBottomNav({
    super.key,
    required this.index,
    required this.onSelected,
  });

  final int index;
  final ValueChanged<int> onSelected;

  static const _items = <({IconData icon, IconData active, String label})>[
    (icon: Icons.home_outlined, active: Icons.home, label: 'Beranda'),
    (
      icon: Icons.calendar_today_outlined,
      active: Icons.calendar_today,
      label: 'Kalender',
    ),
    (
      icon: Icons.account_balance_wallet_outlined,
      active: Icons.account_balance_wallet,
      label: 'Saldo',
    ),
    (icon: Icons.person_outline, active: Icons.person, label: 'Profil'),
  ];

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewPaddingOf(context).bottom;
    return Container(
      color: VendorColors.cardWhite,
      padding: EdgeInsets.only(bottom: bottom),
      child: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: VendorColors.line)),
        ),
        child: Row(
          children: [
            for (var i = 0; i < _items.length; i++)
              Expanded(
                child: _VendorNavItem(
                  item: _items[i],
                  active: i == index,
                  onTap: () => onSelected(i),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _VendorNavItem extends StatelessWidget {
  const _VendorNavItem({
    required this.item,
    required this.active,
    required this.onTap,
  });

  final ({IconData icon, IconData active, String label}) item;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = active ? VendorColors.ink : VendorColors.mutedSoft;
    return Semantics(
      selected: active,
      button: true,
      label: item.label,
      child: InkWell(
        onTap: onTap,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 20,
              height: 2,
              color: active ? VendorColors.limeDark : Colors.transparent,
            ),
            const SizedBox(height: 7),
            Icon(active ? item.active : item.icon, size: 20, color: color),
            const SizedBox(height: 4),
            Text(
              item.label,
              style: vendorText(
                size: 11,
                weight: active ? FontWeight.w700 : FontWeight.w600,
                color: color,
              ),
            ),
            const SizedBox(height: 7),
          ],
        ),
      ),
    );
  }
}

class VendorLoading extends StatelessWidget {
  const VendorLoading({super.key, this.rows = 4});

  final int rows;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(VendorSp.lg),
      children: [
        for (var i = 0; i < rows; i++)
          Container(
            height: i == 0 ? 26 : 78,
            margin: const EdgeInsets.only(bottom: VendorSp.md),
            decoration: BoxDecoration(
              color: VendorColors.lineSoft,
              borderRadius: BorderRadius.circular(VendorRadii.md),
            ),
          ),
      ],
    );
  }
}

class VendorError extends StatelessWidget {
  const VendorError({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(VendorSp.lg),
      children: [
        VendorCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.error_outline,
                    size: 18,
                    color: VendorColors.amber,
                  ),
                  const SizedBox(width: VendorSp.sm),
                  Expanded(
                    child: Text(
                      'Data belum bisa dimuat',
                      style: vendorText(size: 14, weight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: VendorSp.sm),
              Text(
                message,
                style: vendorText(
                  size: 12.5,
                  color: VendorColors.muted,
                  height: 1.45,
                ),
              ),
              if (onRetry != null) ...[
                const SizedBox(height: VendorSp.md),
                Align(
                  alignment: Alignment.centerLeft,
                  child: VendorButton(
                    label: 'Coba lagi',
                    onPressed: onRetry,
                    small: true,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class VendorEmpty extends StatelessWidget {
  const VendorEmpty({super.key, required this.title, this.message});

  final String title;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return VendorCard(
      padding: const EdgeInsets.all(VendorSp.lg),
      child: Column(
        children: [
          Text(
            title,
            textAlign: TextAlign.center,
            style: vendorText(size: 12.5, weight: FontWeight.w700),
          ),
          if (message != null) ...[
            const SizedBox(height: VendorSp.xs),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: vendorText(
                size: 11.5,
                color: VendorColors.muted,
                height: 1.5,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Shared money row for the vendor ledger panels.
class VendorLedgerRow extends StatelessWidget {
  const VendorLedgerRow({
    super.key,
    required this.label,
    required this.value,
    this.valueColor = VendorColors.ink,
    this.emphasize = false,
    this.showDivider = true,
  });

  final String label;
  final String value;
  final Color valueColor;
  final bool emphasize;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        border: showDivider
            ? const Border(bottom: BorderSide(color: VendorColors.lineSoft))
            : null,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          Expanded(
            child: Text(
              label,
              style: vendorText(
                size: emphasize ? 13 : 12.5,
                weight: emphasize ? FontWeight.w600 : FontWeight.w500,
                color: emphasize ? VendorColors.ink : VendorColors.muted,
              ),
            ),
          ),
          const SizedBox(width: VendorSp.md),
          Text(
            value,
            style: vendorText(
              size: emphasize ? 14.5 : 13,
              weight: FontWeight.w700,
              color: valueColor,
            ),
          ),
        ],
      ),
    );
  }
}

/// Form input in the vendor visual language (used by the management pages).
class VendorTextField extends StatelessWidget {
  const VendorTextField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.helper,
    this.keyboardType,
    this.maxLines = 1,
    this.prefixText,
    this.enabled = true,
    this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? helper;
  final TextInputType? keyboardType;
  final int maxLines;
  final String? prefixText;
  final bool enabled;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: vendorText(
            size: 10.5,
            weight: FontWeight.w700,
            letterSpacing: 0.5,
            color: VendorColors.muted,
          ),
        ),
        const SizedBox(height: 5),
        TextField(
          controller: controller,
          keyboardType: keyboardType,
          maxLines: maxLines,
          enabled: enabled,
          onChanged: onChanged,
          style: vendorText(size: 13.5, weight: FontWeight.w500),
          decoration: InputDecoration(
            isDense: true,
            hintText: hint,
            hintStyle: vendorText(size: 13, color: VendorColors.mutedSoft),
            prefixText: prefixText,
            prefixStyle: vendorText(
              size: 13,
              weight: FontWeight.w600,
              color: VendorColors.muted,
            ),
            filled: true,
            fillColor: enabled
                ? VendorColors.cardWhite
                : VendorColors.softFill,
            contentPadding: EdgeInsets.symmetric(
              horizontal: 12,
              vertical: maxLines > 1 ? 11 : 13,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(VendorRadii.sm),
              borderSide: const BorderSide(color: VendorColors.line),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(VendorRadii.sm),
              borderSide: const BorderSide(
                color: VendorColors.limeDark,
                width: 1.5,
              ),
            ),
            disabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(VendorRadii.sm),
              borderSide: const BorderSide(color: VendorColors.lineSoft),
            ),
          ),
        ),
        if (helper != null) ...[
          const SizedBox(height: 4),
          Text(
            helper!,
            style: vendorText(
              size: 10.5,
              color: VendorColors.muted,
              height: 1.4,
            ),
          ),
        ],
      ],
    );
  }
}

/// Image slot for avatar/banner/gallery/package photo. Upload happens in the
/// caller (see `vendor_media_picker.dart`); this widget only renders state.
class VendorMediaTile extends StatelessWidget {
  const VendorMediaTile({
    super.key,
    required this.label,
    required this.url,
    this.onPick,
    this.onClear,
    this.busy = false,
    this.height = 112,
  });

  final String label;
  final String? url;
  final VoidCallback? onPick;
  final VoidCallback? onClear;
  final bool busy;
  final double height;

  @override
  Widget build(BuildContext context) {
    final hasImage = url != null && url!.trim().isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: vendorText(
            size: 10.5,
            weight: FontWeight.w700,
            letterSpacing: 0.5,
            color: VendorColors.muted,
          ),
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(VendorRadii.md),
          child: Container(
            height: height,
            decoration: BoxDecoration(
              color: VendorColors.cardWhite,
              border: Border.all(color: VendorColors.line),
              borderRadius: BorderRadius.circular(VendorRadii.md),
            ),
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (hasImage)
                  Image.network(
                    url!,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => Center(
                      child: Icon(
                        Icons.broken_image_outlined,
                        size: 22,
                        color: VendorColors.mutedSoft,
                      ),
                    ),
                  )
                else
                  Center(
                    child: Text(
                      'Belum ada gambar',
                      style: vendorText(
                        size: 11.5,
                        color: VendorColors.mutedSoft,
                      ),
                    ),
                  ),
                if (busy)
                  Container(
                    color: VendorColors.ink.withValues(alpha: 0.45),
                    child: const Center(
                      child: SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: VendorColors.lime,
                        ),
                      ),
                    ),
                  ),
                if (!busy)
                  Positioned(
                    left: 8,
                    right: 8,
                    bottom: 8,
                    child: Row(
                      children: [
                        Expanded(
                          child: VendorButton(
                            label: hasImage ? 'Ganti' : 'Pilih dari galeri',
                            kind: VendorButtonKind.secondary,
                            small: true,
                            onPressed: onPick,
                          ),
                        ),
                        if (hasImage && onClear != null) ...[
                          const SizedBox(width: 6),
                          VendorButton(
                            label: 'Hapus',
                            kind: VendorButtonKind.secondary,
                            small: true,
                            onPressed: onClear,
                          ),
                        ],
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
