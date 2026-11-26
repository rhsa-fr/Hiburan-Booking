import 'package:flutter/material.dart';

import '../../app/theme.dart';

/// OpenDesign vendor palette ("Tarlink Vendor").
///
/// It keeps a separate visual language from the customer app but follows the
/// same light/dark switch: [AppColors.isDark] is set by `ThemeController`, so
/// the vendor shell flips with the rest of the app.
class _VendorPalette {
  const _VendorPalette(this.isDark);

  final bool isDark;

  Color get ink =>
      isDark ? const Color(0xFFF4F7FB) : const Color(0xFF0B1220);
  Color get canvas =>
      isDark ? const Color(0xFF080D16) : const Color(0xFFFBF9F4);
  Color get card =>
      isDark ? const Color(0xFF101827) : const Color(0xFFFFFFFF);
  Color get line =>
      isDark ? const Color(0xFF1E2A3B) : const Color(0xFFE6E1D6);
  Color get lineSoft =>
      isDark ? const Color(0xFF182333) : const Color(0xFFF0ECE4);
  Color get muted =>
      isDark ? const Color(0xFFA6B3C1) : const Color(0xFF606870);
  Color get mutedSoft =>
      isDark ? const Color(0xFF7E8C9B) : const Color(0xFF88929C);
  Color get amber =>
      isDark ? const Color(0xFFF0A56A) : const Color(0xFF9A4208);
  Color get danger =>
      isDark ? const Color(0xFFFF8F85) : const Color(0xFF9E2B25);
  Color get green =>
      isDark ? const Color(0xFF5FE0A6) : const Color(0xFF076C48);
  Color get softFill =>
      isDark ? const Color(0xFF151F2E) : const Color(0xFFF3F0E9);
  Color get softRow =>
      isDark ? const Color(0xFF131C2B) : const Color(0xFFF7F4ED);

  Color get waitBg =>
      isDark ? const Color(0xFF33230F) : const Color(0xFFFCEFE2);
  Color get waitFg =>
      isDark ? const Color(0xFFF0A56A) : const Color(0xFF8C3D05);
  Color get okBg =>
      isDark ? const Color(0xFF0F2A1E) : const Color(0xFFE7F8F0);
  Color get okFg =>
      isDark ? const Color(0xFF5FE0A6) : const Color(0xFF076C48);
  Color get doneBg =>
      isDark ? const Color(0xFF1A2536) : const Color(0xFFEDEFF2);
  Color get doneFg =>
      isDark ? const Color(0xFFA6B3C1) : const Color(0xFF414C5C);
  Color get noBg =>
      isDark ? const Color(0xFF1A2536) : const Color(0xFFF2F2ED);
  Color get noFg =>
      isDark ? const Color(0xFFA6B3C1) : const Color(0xFF626A74);
  Color get limeSoft =>
      isDark ? const Color(0xFF223012) : const Color(0xFFF2FBD3);
}

abstract final class VendorColors {
  static _VendorPalette get _p => _VendorPalette(AppColors.isDark);

  static Color get ink => _p.ink;
  static Color get canvas => _p.canvas;
  static Color get card => _p.card;
  static Color get cardWhite => _p.card;
  static Color get line => _p.line;
  static Color get lineSoft => _p.lineSoft;
  static Color get muted => _p.muted;
  static Color get mutedSoft => _p.mutedSoft;
  static Color get amber => _p.amber;
  static Color get danger => _p.danger;
  static Color get green => _p.green;
  static Color get softFill => _p.softFill;
  static Color get softRow => _p.softRow;
  static Color get waitBg => _p.waitBg;
  static Color get waitFg => _p.waitFg;
  static Color get okBg => _p.okBg;
  static Color get okFg => _p.okFg;
  static Color get doneBg => _p.doneBg;
  static Color get doneFg => _p.doneFg;
  static Color get noBg => _p.noBg;
  static Color get noFg => _p.noFg;
  static Color get limeSoft => _p.limeSoft;

  // Tokens that never flip.
  static const lime = Color(0xFFD9FB4F);
  static const limeDark = Color(0xFFBDDB2C);
  static const onLime = Color(0xFF0B1220);
  static const stage = Color(0xFF0B1220);
  static const headerTop = Color(0xFF182540);
  static const night = Color(0xFF080D16);
  static const onHeader = Color(0xFFFFFFFF);
}

abstract final class VendorSp {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
}

abstract final class VendorRadii {
  static const double sm = 10;
  static const double md = 16;
  static const double lg = 22;
  static const double pill = 999;
}

const _font = 'Plus Jakarta Sans';
const _fallback = <String>['PlusJakartaSans', 'sans-serif'];

TextStyle vendorText({
  double size = 13,
  FontWeight weight = FontWeight.w500,
  Color? color,
  double? height,
  double? letterSpacing,
}) {
  return TextStyle(
    fontFamily: _font,
    fontFamilyFallback: _fallback,
    fontSize: size,
    fontWeight: weight,
    color: color ?? VendorColors.ink,
    height: height,
    letterSpacing: letterSpacing,
  );
}

/// Uppercase section label from the OpenDesign board.
TextStyle get vendorKicker => vendorText(
  size: 11.5,
  weight: FontWeight.w800,
  color: VendorColors.muted,
  letterSpacing: 1.25,
);

TextStyle get vendorHint => vendorText(size: 11.5, color: VendorColors.muted);
