import 'package:flutter/material.dart';

/// Design tokens. No colour, spacing, or radius value belongs outside this file.
abstract final class AppColors {
  // Stage-light maroon, tuned dark enough for white text on any phone.
  static const primary = Color(0xFF7A1B2E);
  static const primaryDeep = Color(0xFF571020);
  static const primarySoft = Color(0xFFF6E7E7);
  static const onPrimary = Color(0xFFFFFFFF);

  // Warm neutral surfaces, easy on eyes under dim tarling tents.
  static const surface = Color(0xFFFAF5EF);
  static const card = Color(0xFFFFFCF8);
  static const line = Color(0xFFE6DAD0);
  static const skeleton = Color(0xFFEDE3DA);

  static const ink = Color(0xFF231918);
  static const inkMuted = Color(0xFF6A5B56);

  // Single accent: money and success.
  static const accent = Color(0xFF1F6B4E);
  static const accentSoft = Color(0xFFE2F0E8);

  static const danger = Color(0xFF9A2B1E);
  static const dangerSoft = Color(0xFFFBE7E3);
  static const warning = Color(0xFF8A5A00);
  static const warningSoft = Color(0xFFF8EED9);
  static const neutralSoft = Color(0xFFEFE7DF);
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

abstract final class Radii {
  static const double sm = 12;
  static const double lg = 16;
  static const double pill = 999;
}

/// 14px base, system font (no downloaded font file). Scale survives 1.3x text.
TextTheme _textTheme() {
  const tight = -0.4;
  return const TextTheme(
    displaySmall: TextStyle(
      fontSize: 28,
      height: 1.18,
      fontWeight: FontWeight.w700,
      letterSpacing: tight,
      color: AppColors.ink,
    ),
    headlineSmall: TextStyle(
      fontSize: 22,
      height: 1.25,
      fontWeight: FontWeight.w700,
      color: AppColors.ink,
    ),
    titleLarge: TextStyle(
      fontSize: 18,
      height: 1.3,
      fontWeight: FontWeight.w700,
      color: AppColors.ink,
    ),
    titleMedium: TextStyle(
      fontSize: 15,
      height: 1.35,
      fontWeight: FontWeight.w600,
      color: AppColors.ink,
    ),
    bodyLarge: TextStyle(
      fontSize: 15,
      height: 1.5,
      fontWeight: FontWeight.w400,
      color: AppColors.ink,
    ),
    bodyMedium: TextStyle(
      fontSize: 14,
      height: 1.5,
      fontWeight: FontWeight.w400,
      color: AppColors.ink,
    ),
    bodySmall: TextStyle(
      fontSize: 12,
      height: 1.45,
      fontWeight: FontWeight.w400,
      color: AppColors.inkMuted,
    ),
    labelLarge: TextStyle(
      fontSize: 15,
      height: 1.2,
      fontWeight: FontWeight.w700,
      color: AppColors.onPrimary,
    ),
    labelMedium: TextStyle(
      fontSize: 13,
      height: 1.2,
      fontWeight: FontWeight.w600,
      color: AppColors.ink,
    ),
    labelSmall: TextStyle(
      fontSize: 12,
      height: 1.2,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.2,
      color: AppColors.ink,
    ),
  );
}

ThemeData buildTheme() {
  final text = _textTheme();
  final scheme = ColorScheme.fromSeed(
    seedColor: AppColors.primary,
    brightness: Brightness.light,
  ).copyWith(
    primary: AppColors.primary,
    onPrimary: AppColors.onPrimary,
    secondary: AppColors.accent,
    onSecondary: AppColors.onPrimary,
    surface: AppColors.surface,
    onSurface: AppColors.ink,
    surfaceContainerHighest: AppColors.neutralSoft,
    error: AppColors.danger,
    onError: AppColors.onPrimary,
    outline: AppColors.line,
    outlineVariant: AppColors.line,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.surface,
    textTheme: text,
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: AppBarTheme(
      backgroundColor: AppColors.surface,
      foregroundColor: AppColors.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: text.titleLarge,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.onPrimary,
        disabledBackgroundColor: AppColors.neutralSoft,
        disabledForegroundColor: AppColors.inkMuted,
        minimumSize: const Size.fromHeight(52),
        padding: const EdgeInsets.symmetric(horizontal: Sp.xl, vertical: Sp.md),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.sm),
        ),
        textStyle: text.labelLarge,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: AppColors.primary,
        minimumSize: const Size(48, 48),
        textStyle: text.labelMedium?.copyWith(color: AppColors.primary),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.card,
      hintStyle: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: Sp.lg,
        vertical: Sp.md,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.sm),
        borderSide: const BorderSide(color: AppColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.sm),
        borderSide: const BorderSide(color: AppColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.sm),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.6),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.sm),
        borderSide: const BorderSide(color: AppColors.danger),
      ),
    ),
    cardTheme: CardThemeData(
      color: AppColors.card,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        side: const BorderSide(color: AppColors.line),
      ),
    ),
    dividerTheme: const DividerThemeData(color: AppColors.line, thickness: 1),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.ink,
      contentTextStyle: text.bodyMedium?.copyWith(color: AppColors.surface),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.sm),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: AppColors.card,
      indicatorColor: AppColors.primarySoft,
      surfaceTintColor: Colors.transparent,
      labelTextStyle: WidgetStatePropertyAll(text.labelSmall),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: AppColors.primary,
    ),
  );
}
