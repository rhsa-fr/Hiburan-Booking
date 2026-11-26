import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Theme: OpenDesign "Graphite · Lime" tokens, aligned with the vendor app.
/// Light: obsidian ink (#0B1220), milk-white canvas (#FBF9F4), white cards.
/// Dark:  deep navy canvas (#080D16), elevated cards (#101827), lime action.
///
/// [AppColors] is read at build time, so switching [ThemeMode] rebuilds the
/// tree and every getter returns the active palette. The few tokens that must
/// never flip (`onLime`, `stage`, `onPrimary`) stay `const` on purpose.
class _Palette {
  const _Palette(this.isDark);

  final bool isDark;

  Color get primary => const Color(0xFF0B1220);
  Color get primaryContainer =>
      isDark ? const Color(0xFF16233A) : const Color(0xFF182540);
  Color get primaryDeep =>
      isDark ? const Color(0xFF050912) : const Color(0xFF182540);
  Color get primarySoft =>
      isDark ? const Color(0xFF1D2A12) : const Color(0xFFF2FBD3);
  Color get onPrimary => const Color(0xFFFFFFFF);

  Color get secondary =>
      isDark ? const Color(0xFFA6B3C1) : const Color(0xFF606870);
  Color get secondarySoft =>
      isDark ? const Color(0xFF1A2536) : const Color(0xFFE7EEF3);
  Color get onSecondaryContainer =>
      isDark ? const Color(0xFFF4F7FB) : const Color(0xFF0B1220);
  Color get onSecondary =>
      isDark ? const Color(0xFF0B1220) : const Color(0xFFFFFFFF);

  Color get tertiary =>
      isDark ? const Color(0xFFF0A56A) : const Color(0xFF9A4208);
  Color get tertiarySoft =>
      isDark ? const Color(0xFF33230F) : const Color(0xFFFBEEDF);

  Color get surface =>
      isDark ? const Color(0xFF080D16) : const Color(0xFFFBF9F4);
  Color get card =>
      isDark ? const Color(0xFF101827) : const Color(0xFFFFFFFF);
  Color get surfaceSoft =>
      isDark ? const Color(0xFF151F2E) : const Color(0xFFF3F0E9);
  Color get surfaceTint =>
      isDark ? const Color(0xFF16223A) : const Color(0xFFF2FBD3);
  Color get surfaceHigh =>
      isDark ? const Color(0xFF1A2536) : const Color(0xFFEDE9E0);
  Color get surfaceHighest =>
      isDark ? const Color(0xFF223045) : const Color(0xFFE4DFD4);
  Color get line =>
      isDark ? const Color(0xFF1E2A3B) : const Color(0xFFE6E1D6);
  Color get lineStrong =>
      isDark ? const Color(0xFF2D3B4F) : const Color(0xFFD5CFC2);
  Color get skeleton =>
      isDark ? const Color(0xFF182333) : const Color(0xFFEFEBE3);

  Color get ink =>
      isDark ? const Color(0xFFF4F7FB) : const Color(0xFF0B1220);
  Color get inkMuted =>
      isDark ? const Color(0xFFA6B3C1) : const Color(0xFF606870);
  Color get muted2 =>
      isDark ? const Color(0xFF7E8C9B) : const Color(0xFF88929C);

  Color get accent =>
      isDark ? const Color(0xFF5FE0A6) : const Color(0xFF076C48);
  Color get accentSoft =>
      isDark ? const Color(0xFF0F2A1E) : const Color(0xFFE4F1EA);

  Color get danger =>
      isDark ? const Color(0xFFFF8F85) : const Color(0xFFA22A22);
  Color get dangerSoft =>
      isDark ? const Color(0xFF3A1A17) : const Color(0xFFF8E7E4);
  Color get warning =>
      isDark ? const Color(0xFFF0A56A) : const Color(0xFF9A4208);
  Color get warningSoft =>
      isDark ? const Color(0xFF33230F) : const Color(0xFFFBEEDF);
  Color get neutralSoft =>
      isDark ? const Color(0xFF1A2536) : const Color(0xFFEFEFEA);

  Color get lime => const Color(0xFFD9FB4F);
  Color get limeDark => const Color(0xFFBDDB2C);
  Color get limeSoft =>
      isDark ? const Color(0xFF223012) : const Color(0xFFF2FBD3);
  Color get onLime => const Color(0xFF0B1220);
  Color get stage => const Color(0xFF0B1220);
  Color get accentGlow => const Color(0x00000000);
  List<Color> get primaryDeepEnd => <Color>[primaryDeep, primary];
}

abstract final class AppColors {
  /// `null` follows the OS; a value forces the whole app one way.
  static Brightness? forced;

  static Brightness get brightness =>
      forced ?? PlatformDispatcher.instance.platformBrightness;

  static bool get isDark => brightness == Brightness.dark;

  static _Palette get _p => _Palette(isDark);

  static Color get primaryContainer => _p.primaryContainer;
  static Color get primaryDeep => _p.primaryDeep;
  static Color get primarySoft => _p.primarySoft;

  static Color get secondary => _p.secondary;
  static Color get secondarySoft => _p.secondarySoft;
  static Color get onSecondaryContainer => _p.onSecondaryContainer;
  static Color get onSecondary => _p.onSecondary;

  static Color get tertiary => _p.tertiary;
  static Color get tertiarySoft => _p.tertiarySoft;

  static Color get surface => _p.surface;
  static Color get card => _p.card;
  static Color get surfaceSoft => _p.surfaceSoft;
  static Color get surfaceTint => _p.surfaceTint;
  static Color get surfaceHigh => _p.surfaceHigh;
  static Color get surfaceHighest => _p.surfaceHighest;
  static Color get line => _p.line;
  static Color get lineStrong => _p.lineStrong;
  static Color get skeleton => _p.skeleton;

  static Color get ink => _p.ink;
  static Color get inkMuted => _p.inkMuted;
  static Color get muted2 => _p.muted2;

  static Color get accent => _p.accent;
  static Color get accentSoft => _p.accentSoft;

  static Color get danger => _p.danger;
  static Color get dangerSoft => _p.dangerSoft;
  static Color get warning => _p.warning;
  static Color get warningSoft => _p.warningSoft;
  static Color get neutralSoft => _p.neutralSoft;

  static Color get limeSoft => _p.limeSoft;

  static List<Color> get primaryDeepEnd => _p.primaryDeepEnd;

  // Tokens that must not flip with the theme.
  static const primary = Color(0xFF0B1220);
  static const onPrimary = Color(0xFFFFFFFF);
  static const lime = Color(0xFFD9FB4F);
  static const limeDark = Color(0xFFBDDB2C);
  static const onLime = Color(0xFF0B1220);
  static const stage = Color(0xFF0B1220);
  static const accentGlow = Color(0x00000000);
}

/// 4/8 spacing scale. Every gap in the app is one of these.
abstract final class Sp {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
}

/// Soft stage geometry: cards and sheets are rounded enough to feel warm,
/// chips stay pill-shaped, and nothing reads as a hard wireframe box.
abstract final class Radii {
  static const double sm = 8;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 26;
  static const double pill = 999;
}

const _fontFamily = 'Plus Jakarta Sans';
const _display = _fontFamily;
const _body = _fontFamily;
const _fontFallback = <String>['PlusJakartaSans', 'sans-serif'];

/// Typography: Plus Jakarta Sans used globally across all headings, actions,
/// and body copy per design revision. Sizes follow `.stitch/DESIGN.md`.
TextTheme _textTheme(_Palette palette) {
  return TextTheme(
    displaySmall: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 25,
      height: 1.28,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.3,
      color: palette.ink,
    ),
    headlineSmall: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 21,
      height: 1.33,
      fontWeight: FontWeight.w700,
      color: palette.ink,
    ),
    titleLarge: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 19,
      height: 1.35,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.35,
      color: palette.ink,
    ),
    titleMedium: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 16,
      height: 1.33,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.15,
      color: palette.ink,
    ),
    bodyLarge: TextStyle(
      fontFamily: _body,
      fontFamilyFallback: _fontFallback,
      fontSize: 15,
      height: 1.5,
      fontWeight: FontWeight.w400,
      color: palette.ink,
    ),
    bodyMedium: TextStyle(
      fontFamily: _body,
      fontFamilyFallback: _fontFallback,
      fontSize: 13.5,
      height: 1.45,
      fontWeight: FontWeight.w400,
      color: palette.ink,
    ),
    bodySmall: TextStyle(
      fontFamily: _body,
      fontFamilyFallback: _fontFallback,
      fontSize: 12,
      height: 1.38,
      fontWeight: FontWeight.w400,
      color: palette.inkMuted,
    ),
    labelLarge: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 14,
      height: 1.35,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.1,
      color: palette.ink,
    ),
    labelMedium: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 12,
      height: 1.33,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.1,
      color: palette.ink,
    ),
    labelSmall: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 11,
      height: 1.27,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.25,
      color: palette.ink,
    ),
  );
}

ThemeData buildTheme({Brightness? brightness}) {
  final effective = brightness ?? AppColors.brightness;
  final p = _Palette(effective == Brightness.dark);
  final text = _textTheme(p);
  final scheme =
      ColorScheme.fromSeed(
        seedColor: p.primary,
        brightness: effective,
      ).copyWith(
        primary: p.primary,
        onPrimary: p.onPrimary,
        primaryContainer: p.primaryContainer,
        onPrimaryContainer: p.onPrimary,
        secondary: p.secondary,
        onSecondary: p.onSecondary,
        secondaryContainer: p.secondarySoft,
        onSecondaryContainer: p.onSecondaryContainer,
        tertiary: p.tertiary,
        onTertiary: const Color(0xFF0B1220),
        tertiaryContainer: p.tertiarySoft,
        onTertiaryContainer: p.tertiary,
        surface: p.surface,
        onSurface: p.ink,
        onSurfaceVariant: p.inkMuted,
        surfaceContainerLowest: p.card,
        surfaceContainerLow: p.surfaceSoft,
        surfaceContainer: p.surfaceTint,
        surfaceContainerHigh: p.surfaceHigh,
        surfaceContainerHighest: p.surfaceHighest,
        error: p.danger,
        onError: const Color(0xFF0B1220),
        errorContainer: p.dangerSoft,
        onErrorContainer: p.danger,
        outline: p.lineStrong,
        outlineVariant: p.line,
      );

  return ThemeData(
    useMaterial3: true,
    brightness: effective,
    colorScheme: scheme,
    scaffoldBackgroundColor: p.surface,
    fontFamily: _fontFamily,
    fontFamilyFallback: _fontFallback,
    textTheme: text,
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: AppBarTheme(
      backgroundColor: p.primary,
      foregroundColor: p.onPrimary,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      toolbarHeight: 60,
      titleSpacing: Sp.lg,
      iconTheme: IconThemeData(color: p.onPrimary, size: 24),
      actionsIconTheme: IconThemeData(color: p.onPrimary, size: 24),
      titleTextStyle: text.titleLarge?.copyWith(
        fontSize: 20,
        color: p.onPrimary,
      ),
      systemOverlayStyle: SystemUiOverlayStyle.light,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: p.lime,
        foregroundColor: p.onLime,
        disabledBackgroundColor: p.surfaceHighest,
        disabledForegroundColor: p.inkMuted,
        minimumSize: const Size.fromHeight(52),
        padding: const EdgeInsets.symmetric(horizontal: Sp.xl, vertical: Sp.md),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.lg),
        ),
        side: BorderSide(color: p.limeDark),
        textStyle: text.labelLarge?.copyWith(
          color: p.onLime,
          fontWeight: FontWeight.w800,
        ),
        elevation: 0,
        shadowColor: Colors.transparent,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: p.ink,
        backgroundColor: p.card,
        minimumSize: const Size.fromHeight(50),
        side: BorderSide(color: p.lineStrong, width: 1.2),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.lg),
        ),
        textStyle: text.labelLarge?.copyWith(color: p.ink),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: p.ink,
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
        textStyle: text.labelMedium?.copyWith(
          color: p.ink,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      // Warm field on the canvas; the lime ring is the only focus cue.
      fillColor: p.card,
      hintStyle: text.bodyMedium?.copyWith(color: p.muted2),
      labelStyle: text.labelMedium?.copyWith(color: p.inkMuted),
      floatingLabelStyle: text.labelMedium?.copyWith(
        color: p.ink,
        fontWeight: FontWeight.w700,
      ),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: Sp.lg,
        vertical: Sp.lg,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: BorderSide(color: p.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: BorderSide(color: p.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: BorderSide(color: p.limeDark, width: 1.8),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: BorderSide(color: p.danger, width: 1.5),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: BorderSide(color: p.danger, width: 1.8),
      ),
    ),
    cardTheme: CardThemeData(
      color: p.card,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.xxl),
        side: BorderSide(color: p.line),
      ),
    ),
    dividerTheme: DividerThemeData(color: p.line, thickness: 1),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: p.primary,
      contentTextStyle: text.bodyMedium?.copyWith(color: p.onPrimary),
      actionTextColor: p.lime,
      behavior: SnackBarBehavior.floating,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: p.card,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.xxl),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: p.card,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      height: 68,
      indicatorColor: p.limeSoft,
      indicatorShape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return IconThemeData(
          size: 24,
          color: selected ? p.ink : p.inkMuted,
        );
      }),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return text.labelSmall?.copyWith(
          fontSize: 11,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          color: selected ? p.ink : p.inkMuted,
        );
      }),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: p.limeDark),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (states) =>
            states.contains(WidgetState.selected) ? p.lime : Colors.transparent,
      ),
      checkColor: WidgetStatePropertyAll(p.onLime),
      side: BorderSide(color: p.lineStrong, width: 1.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: p.card,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        side: BorderSide(color: p.line),
      ),
      textStyle: text.bodyMedium,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: p.card,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.xxl)),
      ),
    ),
  );
}
