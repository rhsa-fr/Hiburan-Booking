import 'package:flutter/material.dart';

import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/ui.dart';

/// Once-only welcome screen for the OpenDesign customer flow.
class WelcomePage extends StatelessWidget {
  const WelcomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.ink,
      body: LayoutBuilder(
        builder: (context, constraints) {
          final heroHeight = constraints.maxHeight * 0.58;
          return Column(
            children: [
              SizedBox(
                height: heroHeight,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Image.asset(
                      'assets/images/welcome_stage.jpg',
                      fit: BoxFit.cover,
                      alignment: const Alignment(0, -0.2),
                    ),
                    const DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Color(0xE60B1220),
                            Color(0x6B0B1220),
                            Color(0xF20B1220),
                            AppColors.ink,
                          ],
                          stops: [0, 0.3, 0.78, 1],
                        ),
                      ),
                    ),
                    SafeArea(
                      bottom: false,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const BrandLockup(light: true),
                            const Spacer(),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.10),
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: 0.16),
                                ),
                              ),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.place_outlined,
                                    size: 12,
                                    color: AppColors.lime,
                                  ),
                                  SizedBox(width: 4),
                                  Flexible(
                                    child: Text(
                                      'Gerbang hiburan Pantura',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 10),
                            const Text(
                              'Hiburan panggung\nuntuk acaramu.',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 28,
                                height: 1.08,
                                fontWeight: FontWeight.w800,
                                letterSpacing: -1.2,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Tarling, organ tunggal, wayang golek — semua di jalur Pantura.',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.70),
                                fontSize: 11.5,
                                height: 1.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: SafeArea(
                  top: false,
                  child: LayoutBuilder(
                    builder: (context, body) {
                      return SingleChildScrollView(
                        padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
                        child: ConstrainedBox(
                          constraints: BoxConstraints(
                            minHeight: body.maxHeight - 26,
                          ),
                          child: IntrinsicHeight(
                            child: Column(
                              children: [
                                const _WelcomeFeature(
                                  icon: Icons.shield_outlined,
                                  title: 'DP ditahan',
                                  body:
                                      'DP baru diteruskan ke vendor setelah acara selesai.',
                                ),
                                const _WelcomeFeature(
                                  icon: Icons.calendar_month_outlined,
                                  title: 'Jadwal dan paket jelas',
                                  body:
                                      'Tanggal kosong, harga, dan jumlah personel terlihat sebelum bayar.',
                                ),
                                const _WelcomeFeature(
                                  icon: Icons.chat_bubble_outline,
                                  title: 'Langsung ke vendor',
                                  body:
                                      'Tanya atau ubah rencana lewat WhatsApp, bukan chat aplikasi.',
                                ),
                                const Spacer(),
                                SizedBox(
                                  width: double.infinity,
                                  child: FilledButton.icon(
                                    onPressed: () =>
                                        Navigator.pushReplacementNamed(
                                          context,
                                          Routes.register,
                                        ),
                                    icon: const Icon(
                                      Icons.arrow_forward,
                                      size: 16,
                                    ),
                                    label: const Text('Mulai cari hiburan'),
                                  ),
                                ),
                                const SizedBox(height: 10),
                                TextButton(
                                  onPressed: () =>
                                      Navigator.pushReplacementNamed(
                                        context,
                                        Routes.login,
                                      ),
                                  child: Text.rich(
                                    TextSpan(
                                      text: 'Sudah punya akun? ',
                                      style: TextStyle(
                                        color: Colors.white.withValues(
                                          alpha: 0.55,
                                        ),
                                        fontSize: 11,
                                      ),
                                      children: const [
                                        TextSpan(
                                          text: 'Masuk',
                                          style: TextStyle(
                                            color: AppColors.lime,
                                            fontWeight: FontWeight.w800,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _WelcomeFeature extends StatelessWidget {
  const _WelcomeFeature({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: AppColors.lime.withValues(alpha: 0.13),
              borderRadius: BorderRadius.circular(9),
              border: Border.all(
                color: AppColors.lime.withValues(alpha: 0.18),
              ),
            ),
            child: Icon(icon, size: 16, color: AppColors.lime),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.2,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  body,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.60),
                    fontSize: 10.5,
                    height: 1.45,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
