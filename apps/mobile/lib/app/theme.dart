import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Theme: OpenDesign "Graphite · Lime" tokens, aligned with the vendor app.
/// Obsidian ink (#0B1220), milk-white canvas (#FBF9F4), white cards (#FFFFFF),
/// lime action (#D9FB4F), amber hold (#9A4208), and green money (#076C48).
abstract final class AppColors {
  // OpenDesign "Graphite · Lime" palette.
  static const primary = Color(0xFF0B1220);
  static const primaryContainer = Color(0xFF182540);
  static const primaryDeep = Color(0xFF182540);
  static const primarySoft = Color(0xFFF2FBD3);
  static const onPrimary = Color(0xFFFFFFFF);

  static const secondary = Color(0xFF606870);
  static const secondarySoft = Color(0xFFE7EEF3);
  static const onSecondaryContainer = Color(0xFF0B1220);
  static const onSecondary = Color(0xFFFFFFFF);

  static const tertiary = Color(0xFF9A4208);
  static const tertiarySoft = Color(0xFFFBEEDF);

  static const surface = Color(0xFFFBF9F4);
  static const card = Color(0xFFFFFFFF);
  static const surfaceSoft = Color(0xFFF3F0E9);
  static const surfaceTint = Color(0xFFF2FBD3);
  static const surfaceHigh = Color(0xFFEDE9E0);
  static const surfaceHighest = Color(0xFFE4DFD4);
  static const line = Color(0xFFE6E1D6);
  static const lineStrong = Color(0xFFD5CFC2);
  static const skeleton = Color(0xFFEFEBE3);

  static const ink = Color(0xFF0B1220);
  static const inkMuted = Color(0xFF606870);
  static const muted2 = Color(0xFF88929C);

  static const accent = Color(0xFF076C48);
  static const accentSoft = Color(0xFFE4F1EA);

  static const danger = Color(0xFFA22A22);
  static const dangerSoft = Color(0xFFF8E7E4);
  static const warning = Color(0xFF9A4208);
  static const warningSoft = Color(0xFFFBEEDF);
  static const neutralSoft = Color(0xFFEFEFEA);

  static const lime = Color(0xFFD9FB4F);
  static const limeDark = Color(0xFFBDDB2C);
  static const limeSoft = Color(0xFFF2FBD3);

  static const accentGlow = Color(0x00000000);
  static const primaryDeepEnd = <Color>[primaryDeep, primary];
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
TextTheme _textTheme() {
  return const TextTheme(
    displaySmall: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 25,
      height: 1.28,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.3,
      color: AppColors.ink,
    ),
    headlineSmall: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 21,
      height: 1.33,
      fontWeight: FontWeight.w700,
      color: AppColors.ink,
    ),
    titleLarge: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 19,
      height: 1.35,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.35,
      color: AppColors.ink,
    ),
    titleMedium: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 16,
      height: 1.33,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.15,
      color: AppColors.ink,
    ),
    bodyLarge: TextStyle(
      fontFamily: _body,
      fontFamilyFallback: _fontFallback,
      fontSize: 15,
      height: 1.5,
      fontWeight: FontWeight.w400,
      color: AppColors.ink,
    ),
    bodyMedium: TextStyle(
      fontFamily: _body,
      fontFamilyFallback: _fontFallback,
      fontSize: 13.5,
      height: 1.45,
      fontWeight: FontWeight.w400,
      color: AppColors.ink,
    ),
    bodySmall: TextStyle(
      fontFamily: _body,
      fontFamilyFallback: _fontFallback,
      fontSize: 12,
      height: 1.38,
      fontWeight: FontWeight.w400,
      color: AppColors.inkMuted,
    ),
    labelLarge: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 14,
      height: 1.35,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.1,
      color: AppColors.ink,
    ),
    labelMedium: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 12,
      height: 1.33,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.1,
      color: AppColors.ink,
    ),
    labelSmall: TextStyle(
      fontFamily: _display,
      fontFamilyFallback: _fontFallback,
      fontSize: 11,
      height: 1.27,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.25,
      color: AppColors.ink,
    ),
  );
}

ThemeData buildTheme() {
  final text = _textTheme();
  final scheme =
      ColorScheme.fromSeed(
        seedColor: AppColors.primary,
        brightness: Brightness.light,
      ).copyWith(
        primary: AppColors.primary,
        onPrimary: AppColors.onPrimary,
        primaryContainer: AppColors.primaryContainer,
        onPrimaryContainer: AppColors.onPrimary,
        secondary: AppColors.secondary,
        onSecondary: AppColors.onSecondary,
        secondaryContainer: AppColors.secondarySoft,
        onSecondaryContainer: AppColors.onSecondaryContainer,
        tertiary: AppColors.tertiary,
        onTertiary: AppColors.onPrimary,
        tertiaryContainer: AppColors.tertiarySoft,
        onTertiaryContainer: AppColors.tertiary,
        surface: AppColors.surface,
        onSurface: AppColors.ink,
        onSurfaceVariant: AppColors.inkMuted,
        surfaceContainerLowest: AppColors.card,
        surfaceContainerLow: AppColors.surfaceSoft,
        surfaceContainer: AppColors.surfaceTint,
        surfaceContainerHigh: AppColors.surfaceHigh,
        surfaceContainerHighest: AppColors.surfaceHighest,
        error: AppColors.danger,
        onError: AppColors.onPrimary,
        errorContainer: AppColors.dangerSoft,
        onErrorContainer: AppColors.danger,
        outline: AppColors.lineStrong,
        outlineVariant: AppColors.line,
      );

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.surface,
    fontFamily: _fontFamily,
    fontFamilyFallback: _fontFallback,
    textTheme: text,
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: AppBarTheme(
      backgroundColor: AppColors.ink,
      foregroundColor: AppColors.onPrimary,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      toolbarHeight: 60,
      titleSpacing: Sp.lg,
      iconTheme: const IconThemeData(color: AppColors.onPrimary, size: 24),
      actionsIconTheme: const IconThemeData(
        color: AppColors.onPrimary,
        size: 24,
      ),
      titleTextStyle: text.titleLarge?.copyWith(
        fontSize: 20,
        color: AppColors.onPrimary,
      ),
      systemOverlayStyle: SystemUiOverlayStyle.light,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.lime,
        foregroundColor: AppColors.ink,
        disabledBackgroundColor: AppColors.surfaceHighest,
        disabledForegroundColor: AppColors.inkMuted,
        minimumSize: const Size.fromHeight(52),
        padding: const EdgeInsets.symmetric(horizontal: Sp.xl, vertical: Sp.md),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.lg),
        ),
        side: const BorderSide(color: AppColors.limeDark),
        textStyle: text.labelLarge?.copyWith(
          color: AppColors.ink,
          fontWeight: FontWeight.w800,
        ),
        elevation: 0,
        shadowColor: Colors.transparent,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.ink,
        backgroundColor: AppColors.card,
        minimumSize: const Size.fromHeight(50),
        side: const BorderSide(color: AppColors.lineStrong, width: 1.2),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.lg),
        ),
        textStyle: text.labelLarge?.copyWith(color: AppColors.ink),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: AppColors.ink,
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
        textStyle: text.labelMedium?.copyWith(
          color: AppColors.ink,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      // Warm white field on the canvas; the lime ring is the only focus cue.
      fillColor: AppColors.card,
      hintStyle: text.bodyMedium?.copyWith(color: AppColors.muted2),
      labelStyle: text.labelMedium?.copyWith(color: AppColors.inkMuted),
      floatingLabelStyle: text.labelMedium?.copyWith(
        color: AppColors.ink,
        fontWeight: FontWeight.w700,
      ),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: Sp.lg,
        vertical: Sp.lg,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: const BorderSide(color: AppColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: const BorderSide(color: AppColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: const BorderSide(color: AppColors.limeDark, width: 1.8),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: const BorderSide(color: AppColors.danger, width: 1.5),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        borderSide: const BorderSide(color: AppColors.danger, width: 1.8),
      ),
    ),
    cardTheme: CardThemeData(
      color: AppColors.card,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.xxl),
        side: const BorderSide(color: AppColors.line),
      ),
    ),
    dividerTheme: const DividerThemeData(color: AppColors.line, thickness: 1),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.ink,
      contentTextStyle: text.bodyMedium?.copyWith(color: AppColors.onPrimary),
      actionTextColor: AppColors.lime,
      behavior: SnackBarBehavior.floating,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: AppColors.card,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.xxl),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: AppColors.card,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      height: 68,
      indicatorColor: AppColors.limeSoft,
      indicatorShape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return IconThemeData(
          size: 24,
          color: selected ? AppColors.ink : AppColors.inkMuted,
        );
      }),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return text.labelSmall?.copyWith(
          fontSize: 11,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          color: selected ? AppColors.ink : AppColors.inkMuted,
        );
      }),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: AppColors.limeDark,
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? AppColors.lime
            : Colors.transparent,
      ),
      checkColor: const WidgetStatePropertyAll(AppColors.ink),
      side: const BorderSide(color: AppColors.lineStrong, width: 1.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: AppColors.card,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        side: const BorderSide(color: AppColors.line),
      ),
      textStyle: text.bodyMedium,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: AppColors.card,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.xxl)),
      ),
    ),
  );
}
