import 'package:flutter/material.dart';

import 'theme.dart';
import 'theme_controller.dart';

String themeModeLabel(ThemeMode mode) => switch (mode) {
  ThemeMode.system => 'Sistem',
  ThemeMode.light => 'Terang',
  ThemeMode.dark => 'Gelap',
};

String _themeHint(ThemeMode mode) => switch (mode) {
  ThemeMode.system => 'Menyesuaikan pengaturan HP',
  ThemeMode.light => 'Latar terang sepanjang waktu',
  ThemeMode.dark => 'Latar gelap, nyaman untuk malam',
};

IconData _themeIcon(ThemeMode mode) => switch (mode) {
  ThemeMode.system => Icons.brightness_auto_outlined,
  ThemeMode.light => Icons.light_mode_outlined,
  ThemeMode.dark => Icons.dark_mode_outlined,
};

/// One picker for the customer and vendor sides. Dark is opt-in; the default
/// stays light until the user chooses otherwise.
Future<void> showThemePicker(BuildContext context) async {
  final controller = ThemeScope.of(context);
  final chosen = await showModalBottomSheet<ThemeMode>(
    context: context,
    showDragHandle: true,
    backgroundColor: AppColors.card,
    builder: (sheet) {
      final text = Theme.of(sheet).textTheme;
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Sp.lg, 0, Sp.lg, Sp.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Tampilan', style: text.titleLarge?.copyWith(fontSize: 18)),
              const SizedBox(height: 2),
              Text(
                'Pilih tema yang paling nyaman untuk matamu.',
                style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
              ),
              const SizedBox(height: Sp.sm),
              for (final mode in const [
                ThemeMode.light,
                ThemeMode.dark,
                ThemeMode.system,
              ])
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    _themeIcon(mode),
                    color: controller.mode == mode
                        ? AppColors.ink
                        : AppColors.inkMuted,
                  ),
                  title: Text(
                    themeModeLabel(mode),
                    style: text.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  subtitle: Text(
                    _themeHint(mode),
                    style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
                  ),
                  trailing: controller.mode == mode
                      ? const Icon(
                          Icons.check_circle_rounded,
                          color: AppColors.limeDark,
                        )
                      : null,
                  onTap: () => Navigator.pop(sheet, mode),
                ),
            ],
          ),
        ),
      );
    },
  );
  if (chosen != null) await controller.setMode(chosen);
}
