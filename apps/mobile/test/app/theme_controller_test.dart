// ignore_for_file: depend_on_referenced_packages

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/test/test_flutter_secure_storage_platform.dart';
import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:tarlink_customer/app/theme.dart';
import 'package:tarlink_customer/app/theme_controller.dart';

void main() {
  setUp(() {
    FlutterSecureStoragePlatform.instance = TestFlutterSecureStoragePlatform({});
    AppColors.forced = null;
  });

  tearDown(() {
    AppColors.forced = null;
  });

  test('dark mode flips the palette and survives a restore', () async {
    final lightCard = AppColors.card;

    final controller = ThemeController();
    await controller.setMode(ThemeMode.dark);

    expect(controller.mode, ThemeMode.dark);
    expect(AppColors.isDark, isTrue);
    expect(AppColors.card, isNot(lightCard));
    expect(
      buildTheme(brightness: Brightness.dark).scaffoldBackgroundColor,
      AppColors.surface,
    );

    final restored = ThemeController();
    await restored.restore();
    expect(restored.mode, ThemeMode.dark);
    expect(AppColors.isDark, isTrue);
  });

  test('light mode also persists and never leaks into the next controller', () async {
    final darkCard = () {
      AppColors.forced = Brightness.dark;
      return AppColors.card;
    }();

    final controller = ThemeController();
    await controller.setMode(ThemeMode.light);
    expect(AppColors.isDark, isFalse);
    expect(AppColors.card, isNot(darkCard));

    final restored = ThemeController();
    await restored.restore();
    expect(restored.mode, ThemeMode.light);
    expect(AppColors.isDark, isFalse);
  });
}
