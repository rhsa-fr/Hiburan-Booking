import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// Dark obsidian header for the vendor portal, matching the OpenDesign board.
class VendorHeader extends StatelessWidget implements PreferredSizeWidget {
  const VendorHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.kicker,
    this.mark,
    this.showBack = false,
    this.trailing,
    this.money,
  });

  final String title;
  final String? subtitle;
  final String? kicker;
  final String? mark;
  final bool showBack;
  final Widget? trailing;
  final Widget? money;

  double get _bottomHeight => money == null ? 2 : 60;

  @override
  Size get preferredSize => Size.fromHeight(60 + _bottomHeight);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      automaticallyImplyLeading: false,
      backgroundColor: VendorColors.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      toolbarHeight: 60,
      systemOverlayStyle: SystemUiOverlayStyle.light,
      titleSpacing: 14,
      flexibleSpace: Stack(
        fit: StackFit.expand,
        children: [
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [VendorColors.headerTop, VendorColors.ink],
              ),
            ),
          ),
          CustomPaint(
            painter: VendorDotGridPainter(
              color: Colors.white.withValues(alpha: 0.08),
              spacing: 9,
            ),
          ),
        ],
      ),
      title: Row(
        children: [
          if (showBack) ...[
            _BackButton(onTap: () => Navigator.maybePop(context)),
            const SizedBox(width: 9),
          ],
          if (mark != null && mark!.isNotEmpty) ...[
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: VendorColors.lime.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(7),
                border: Border.all(
                  color: VendorColors.lime.withValues(alpha: 0.4),
                ),
              ),
              child: Text(
                mark!,
                style: vendorText(
                  size: 11,
                  weight: FontWeight.w800,
                  color: VendorColors.lime,
                  letterSpacing: 0.4,
                ),
              ),
            ),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (kicker != null && kicker!.isNotEmpty) ...[
                  Text(
                    kicker!.toUpperCase(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: vendorText(
                      size: 9.5,
                      weight: FontWeight.w700,
                      color: Colors.white.withValues(alpha: 0.55),
                      letterSpacing: 1.25,
                    ),
                  ),
                  const SizedBox(height: 2),
                ],
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: vendorText(
                    size: 14,
                    weight: FontWeight.w800,
                    color: Colors.white,
                    letterSpacing: -0.15,
                  ),
                ),
                if (subtitle != null && subtitle!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: vendorText(
                      size: 11,
                      weight: FontWeight.w500,
                      color: Colors.white.withValues(alpha: 0.55),
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 8), trailing!],
        ],
      ),
      bottom: PreferredSize(
        preferredSize: Size.fromHeight(_bottomHeight),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (money != null) money!,
            Container(height: 2, color: VendorColors.lime),
          ],
        ),
      ),
    );
  }
}

class _BackButton extends StatelessWidget {
  const _BackButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.04),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(7),
        side: BorderSide(color: Colors.white.withValues(alpha: 0.16)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: const SizedBox(
          width: 32,
          height: 32,
          child: Center(
            child: Icon(Icons.arrow_back, size: 18, color: Colors.white),
          ),
        ),
      ),
    );
  }
}

/// Money strip inside the dark header (held balance + right-hand context).
class VendorMoneyStrip extends StatelessWidget {
  const VendorMoneyStrip({
    super.key,
    required this.label,
    required this.value,
    this.rightTop,
    this.rightBottom,
  });

  final String label;
  final String value;
  final String? rightTop;
  final String? rightBottom;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 11),
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: Colors.white.withValues(alpha: 0.10)),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label.toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: vendorText(
                    size: 9.5,
                    weight: FontWeight.w600,
                    color: Colors.white.withValues(alpha: 0.48),
                    letterSpacing: 1.1,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: vendorText(
                    size: 21,
                    weight: FontWeight.w800,
                    color: VendorColors.lime,
                    letterSpacing: -0.6,
                  ),
                ),
              ],
            ),
          ),
          if (rightTop != null || rightBottom != null) ...[
            const SizedBox(width: VendorSp.md),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (rightTop != null)
                  Text(
                    rightTop!,
                    maxLines: 1,
                    style: vendorText(
                      size: 10.5,
                      color: Colors.white.withValues(alpha: 0.45),
                    ),
                  ),
                if (rightBottom != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    rightBottom!,
                    maxLines: 1,
                    style: vendorText(
                      size: 11,
                      weight: FontWeight.w600,
                      color: Colors.white.withValues(alpha: 0.78),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }
}
