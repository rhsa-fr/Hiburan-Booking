import 'package:flutter/material.dart';

/// OpenDesign vendor palette ("Tarlink Vendor").
/// Kept local to the vendor feature: the customer theme in `app/theme.dart`
/// is frozen and deliberately uses a different (maroon/parchment) language.
abstract final class VendorColors {
  static const ink = Color(0xFF0B1220);
  static const canvas = Color(0xFFFBF9F4);
  static const card = Color(0xFFFFFFFF);
  static const cardWhite = Color(0xFFFFFFFF);
  static const line = Color(0xFFE6E1D6);
  static const lineSoft = Color(0xFFF0ECE4);
  static const muted = Color(0xFF606870);
  static const mutedSoft = Color(0xFF88929C);
  static const lime = Color(0xFFD9FB4F);
  static const limeDark = Color(0xFFBDDB2C);
  static const amber = Color(0xFF9A4208);
  static const danger = Color(0xFF9E2B25);
  static const green = Color(0xFF076C48);
  static const headerTop = Color(0xFF182540);
  static const softFill = Color(0xFFF3F0E9);
  static const softRow = Color(0xFFF7F4ED);

  static const waitBg = Color(0xFFFCEFE2);
  static const waitFg = Color(0xFF8C3D05);
  static const okBg = Color(0xFFE7F8F0);
  static const okFg = Color(0xFF076C48);
  static const doneBg = Color(0xFFEDEFF2);
  static const doneFg = Color(0xFF414C5C);
  static const noBg = Color(0xFFF2F2ED);
  static const noFg = Color(0xFF626A74);
  static const limeSoft = Color(0xFFF2FBD3);
  static const night = Color(0xFF141D2E);
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
  size: 11.5,
  weight: FontWeight.w800,
  color: const Color(0xFF3F4A58),
  letterSpacing: 1.25,
);

TextStyle get vendorHint => vendorText(size: 11.5, color: VendorColors.muted);
