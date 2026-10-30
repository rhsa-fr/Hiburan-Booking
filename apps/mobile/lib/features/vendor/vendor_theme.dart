import 'package:flutter/material.dart';

/// OpenDesign vendor palette ("Tarlink Vendor").
/// Kept local to the vendor feature: the customer theme in `app/theme.dart`
/// is frozen and deliberately uses a different (maroon/parchment) language.
abstract final class VendorColors {
  static const ink = Color(0xFF0B1220);
  static const canvas = Color(0xFFEEEEE9);
  static const card = Color(0xFFFAFAF7);
  static const cardWhite = Color(0xFFFFFFFF);
  static const line = Color(0xFFDDDDD7);
  static const lineSoft = Color(0xFFEBEBE5);
  static const muted = Color(0xFF606870);
  static const mutedSoft = Color(0xFF88929C);
  static const lime = Color(0xFFD9FB4F);
  static const limeDark = Color(0xFFBDDB2C);
  static const amber = Color(0xFF9A4208);
  static const danger = Color(0xFF9E2B25);
  static const green = Color(0xFF076C48);
  static const headerTop = Color(0xFF182540);
  static const softFill = Color(0xFFF4F4EF);
  static const softRow = Color(0xFFF7F7F3);

  static const waitBg = Color(0xFFFCEFE2);
  static const waitFg = Color(0xFF8C3D05);
  static const okBg = Color(0xFFE7F8F0);
  static const okFg = Color(0xFF076C48);
  static const doneBg = Color(0xFFEDEFF2);
  static const doneFg = Color(0xFF414C5C);
  static const noBg = Color(0xFFF2F2ED);
  static const noFg = Color(0xFF626A74);
}

abstract final class VendorSp {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
}

abstract final class VendorRadii {
  static const double sm = 6;
  static const double md = 10;
}

const _font = 'Plus Jakarta Sans';
const _fallback = <String>['PlusJakartaSans', 'sans-serif'];

TextStyle vendorText({
  double size = 12,
  FontWeight weight = FontWeight.w500,
  Color color = VendorColors.ink,
  double? height,
  double? letterSpacing,
}) {
  return TextStyle(
    fontFamily: _font,
    fontFamilyFallback: _fallback,
    fontSize: size,
    fontWeight: weight,
    color: color,
    height: height,
    letterSpacing: letterSpacing,
  );
}

/// Uppercase section label from the OpenDesign board.
TextStyle get vendorKicker => vendorText(
  size: 11,
  weight: FontWeight.w700,
  color: const Color(0xFF3F4A58),
  letterSpacing: 0.14 * 11,
);

TextStyle get vendorHint => vendorText(size: 11, color: VendorColors.muted);
