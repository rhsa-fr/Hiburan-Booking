import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../booking/booking_support.dart';
import 'vendor_header.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// Vendor profile built only from fields the API actually returns.
class VendorProfilePage extends StatefulWidget {
  const VendorProfilePage({super.key, this.onOpenCalendar});

  /// Switches the shell to the Kalender tab (availability editor lives there).
  final VoidCallback? onOpenCalendar;

  @override
  State<VendorProfilePage> createState() => _VendorProfilePageState();
}

class _VendorProfilePageState extends State<VendorProfilePage> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _me;
  Map<String, dynamic>? _public;
  int _completed = 0;
  bool _signingOut = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  Future<void> _load({bool silent = false}) async {
    final api = AppScope.of(context).api;
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final meRaw = await api.get('/vendor/me');
      final me = meRaw is Map ? meRaw.cast<String, dynamic>() : null;
      if (me == null || me.isEmpty) {
        throw const ApiException(
          code: 'VENDOR_NOT_FOUND',
          message: 'Data vendor tidak ditemukan.',
        );
      }

      final slug = me['slug']?.toString();
      final results = await Future.wait([
        if (slug != null && slug.isNotEmpty)
          _quiet(() => api.get('/vendors/${Uri.encodeComponent(slug)}'))
        else
          Future<dynamic>.value(null),
        _quiet(
          () => api.get(
            '/vendor/bookings',
            query: {'status': 'completed', 'page': '1', 'page_size': '1'},
          ),
        ),
      ]);
      final publicRaw = results[0];
      final completedRaw = results[1];

      final completedPayload = completedRaw is Map
          ? completedRaw.cast<String, dynamic>()
          : null;

      if (!mounted) return;
      setState(() {
        _me = me;
        _public = vendorPublicPayload(publicRaw);
        _completed = (completedPayload?['total'] as num?)?.toInt() ?? 0;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = apiMessage(error);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Gagal memuat profil: $error';
      });
    }
  }

  Future<dynamic> _quiet(Future<dynamic> Function() call) async {
    try {
      return await call();
    } catch (_) {
      return null;
    }
  }

  Future<void> _openWhatsApp(String? raw) async {
    final digits = whatsappDigits(raw);
    if (digits == null) return;
    final uri = Uri.parse('https://wa.me/$digits');
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tidak dapat membuka WhatsApp.')),
      );
    }
  }

  Future<void> _openManageProfile() async {
    await Navigator.pushNamed(context, Routes.vendorManageProfile);
    if (mounted) await _load(silent: true);
  }

  Future<void> _openManagePackages() async {
    await Navigator.pushNamed(context, Routes.vendorManagePackages);
    if (mounted) await _load(silent: true);
  }

  Future<void> _openBankAccounts() async {
    await Navigator.pushNamed(context, Routes.vendorBankAccount);
    if (mounted) await _load(silent: true);
  }

  Future<void> _leaveVendorMode() async {
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: VendorColors.cardWhite,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Keluar mode vendor?',
                style: vendorText(size: 16, weight: FontWeight.w800),
              ),
              const SizedBox(height: 6),
              Text(
                'Kamu akan kembali ke aplikasi pelanggan. Data vendor tetap '
                'tersimpan dan bisa dibuka lagi dengan akun yang sama.',
                style: vendorText(
                  size: 12.5,
                  color: VendorColors.muted,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: VendorSp.lg),
              VendorButton(
                label: 'Kembali ke aplikasi pelanggan',
                onPressed: () => Navigator.pop(sheetContext, true),
              ),
              const SizedBox(height: VendorSp.sm),
              VendorButton(
                label: 'Batal',
                kind: VendorButtonKind.secondary,
                onPressed: () => Navigator.pop(sheetContext, false),
              ),
            ],
          ),
        ),
      ),
    );
    if (confirmed != true || !mounted) return;
    Navigator.pushNamedAndRemoveUntil(context, Routes.home, (_) => false);
  }

  /// Same sequence as the account screen: revoke best effort, always clear the
  /// local session, then land on Login with the stack cleared.
  Future<void> _confirmSignOut() async {
    if (_signingOut) return;
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: VendorColors.cardWhite,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Keluar dari akun?',
                style: vendorText(
                  size: 16,
                  weight: FontWeight.w800,
                  color: VendorColors.danger,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Sesi di perangkat ini akan diakhiri, jadi kamu perlu masuk lagi '
                'untuk membuka mode vendor maupun aplikasi pelanggan. Data dan '
                'booking tetap tersimpan di server.',
                style: vendorText(
                  size: 12.5,
                  color: VendorColors.muted,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: VendorSp.lg),
              VendorButton(
                label: 'Ya, keluar akun',
                onPressed: () => Navigator.pop(sheetContext, true),
              ),
              const SizedBox(height: VendorSp.sm),
              VendorButton(
                label: 'Batal',
                kind: VendorButtonKind.secondary,
                onPressed: () => Navigator.pop(sheetContext, false),
              ),
            ],
          ),
        ),
      ),
    );
    if (confirmed != true || !mounted) return;

    final scope = AppScope.of(context);
    setState(() => _signingOut = true);
    // Delete the FCM row before revoking the session: after logout the access
    // token is dead and the device would keep receiving the old account's push.
    await scope.push?.stop();
    try {
      await scope.api.post('/auth/logout');
    } on ApiException {
      // Revocation is best effort; the local session must go either way.
    }
    await scope.session.signOut();
    if (!mounted) return;
    Navigator.pushNamedAndRemoveUntil(context, Routes.login, (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    final me = _me;
    final public = _public;
    final displayName = me?['display_name']?.toString() ?? 'Profil Vendor';
    final category = public?['category_name']?.toString().trim() ?? '';
    final regionName = public?['region_name']?.toString().trim() ?? '';
    final regionCode = me?['region_code']?.toString() ?? '';
    final region = regionName.isNotEmpty
        ? regionName
        : regionCode.isEmpty
        ? ''
        : 'Wilayah $regionCode';
    final subtitle = <String>[
      if (category.isNotEmpty) category,
      if (region.isNotEmpty) region,
    ].join(' · ');
    final verification = me?['verification_status']?.toString() ?? '';

    return Scaffold(
      backgroundColor: VendorColors.canvas,
      appBar: VendorHeader(
        kicker: 'Profil',
        title: displayName,
        subtitle: subtitle.isEmpty ? 'Mode Vendor · Tarlink' : subtitle,
        mark: vendorInitials(displayName),
        trailing: verification.isEmpty
            ? null
            : VendorPill(
                label: _verificationLabel(verification),
                tone: _verificationTone(verification),
              ),
      ),
      body: ColoredBox(
        color: VendorColors.canvas,
        child: _loading
            ? const VendorLoading(rows: 4)
            : _error != null
            ? VendorError(message: _error!, onRetry: _load)
            : _content(me!, public),
      ),
    );
  }

  Widget _content(Map<String, dynamic> me, Map<String, dynamic>? public) {
    final verification = me['verification_status']?.toString() ?? '';
    final regionName = public?['region_name']?.toString().trim() ?? '';
    final regionCode = me['region_code']?.toString() ?? '';
    final calendarUpdatedAt = me['calendar_updated_at']?.toString();
    final meWhatsapp = me['whatsapp']?.toString().trim() ?? '';
    final whatsapp = meWhatsapp.isNotEmpty
        ? meWhatsapp
        : public?['whatsapp']?.toString();
    final rating = public?['rating'];
    final ratingCount = (public?['rating_count'] as num?)?.toInt() ?? 0;
    final packages = public?['packages'] is List
        ? public!['packages'] as List
        : const [];

    return RefreshIndicator(
      color: VendorColors.limeDark,
      onRefresh: () => _load(silent: true),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          VendorSp.lg,
          14,
          VendorSp.lg,
          VendorSp.xl,
        ),
        children: [
          _ProfileHero(
            name: me['display_name']?.toString() ?? 'Vendor',
            subtitle: [
              if ((public?['category_name']?.toString().trim() ?? '')
                  .isNotEmpty)
                public!['category_name'].toString().trim(),
              if (regionName.isNotEmpty)
                regionName
              else if (regionCode.isNotEmpty)
                'Wilayah $regionCode',
            ].join(' · '),
            verification: verification,
            onEdit: _openManageProfile,
          ),
          const SizedBox(height: VendorSp.md),
          Row(
            children: [
              Expanded(
                child: _ProfileStat(
                  icon: Icons.task_alt_rounded,
                  value: '$_completed',
                  label: 'Pesanan selesai',
                ),
              ),
              if (rating is num && ratingCount > 0) ...[
                const SizedBox(width: VendorSp.sm),
                Expanded(
                  child: _ProfileStat(
                    icon: Icons.star_outline_rounded,
                    value: rating.toStringAsFixed(1).replaceAll('.', ','),
                    label: 'Rating vendor',
                  ),
                ),
              ],
              if (packages.isNotEmpty) ...[
                const SizedBox(width: VendorSp.sm),
                Expanded(
                  child: _ProfileStat(
                    icon: Icons.inventory_2_outlined,
                    value: '${packages.length}',
                    label: 'Paket aktif',
                  ),
                ),
              ],
            ],
          ),
          const VendorSectionTitle(label: 'Kelola'),
          Row(
            children: [
              Expanded(
                child: _ActionTile(
                  icon: Icons.storefront_outlined,
                  title: 'Profil & media',
                  subtitle: 'Nama, foto, video',
                  onTap: _openManageProfile,
                ),
              ),
              const SizedBox(width: VendorSp.sm),
              Expanded(
                child: _ActionTile(
                  icon: Icons.inventory_2_outlined,
                  title: 'Paket & harga',
                  subtitle: 'Harga dan fasilitas',
                  onTap: _openManagePackages,
                ),
              ),
            ],
          ),
          const SizedBox(height: VendorSp.sm),
          Row(
            children: [
              Expanded(
                child: _ActionTile(
                  icon: Icons.account_balance_outlined,
                  title: 'Rekening pencairan',
                  subtitle: 'Tujuan transfer',
                  onTap: _openBankAccounts,
                ),
              ),
              const SizedBox(width: VendorSp.sm),
              Expanded(
                child: _ActionTile(
                  icon: Icons.edit_calendar_outlined,
                  title: 'Ketersediaan',
                  subtitle: 'Tanggal buka atau tutup',
                  onTap: widget.onOpenCalendar,
                ),
              ),
            ],
          ),
          const VendorSectionTitle(label: 'Akun'),
          VendorCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _InfoRow(
                  title: 'Identitas & verifikasi',
                  subtitle:
                      '${_verificationLabel(verification)} · '
                      '${me['is_active'] == true ? 'Aktif' : 'Nonaktif'}',
                  trailingIcon: Icons.verified_outlined,
                ),
                _InfoRow(
                  title: 'Wilayah',
                  subtitle: regionName.isNotEmpty
                      ? regionName
                      : regionCode.isEmpty
                      ? 'Belum diisi'
                      : 'Wilayah $regionCode',
                  trailingIcon: Icons.place_outlined,
                ),
                _InfoRow(
                  title: 'Kalender manggung',
                  subtitle: relativeFreshness(calendarUpdatedAt),
                  trailingIcon: Icons.schedule,
                ),
                _InfoRow(
                  title: 'Kontak vendor',
                  subtitle: whatsapp == null || whatsapp.isEmpty
                      ? 'Nomor WhatsApp belum diisi'
                      : formatIndonesianPhone(whatsapp),
                  trailingIcon: Icons.chat_bubble_outline,
                  onTap: whatsapp == null || whatsapp.isEmpty
                      ? null
                      : () => _openWhatsApp(whatsapp),
                  showDivider: false,
                ),
              ],
            ),
          ),
          const VendorSectionTitle(label: 'Sesi'),
          VendorCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _InfoRow(
                  title: 'Keluar mode vendor',
                  subtitle: 'Kembali ke aplikasi pelanggan',
                  trailingIcon: Icons.logout,
                  onTap: _leaveVendorMode,
                ),
                _InfoRow(
                  title: 'Keluar akun',
                  subtitle: _signingOut
                      ? 'Mengakhiri sesi…'
                      : 'Akhiri sesi di perangkat ini',
                  trailingIcon: Icons.power_settings_new_rounded,
                  onTap: _signingOut ? null : _confirmSignOut,
                  danger: true,
                  showDivider: false,
                ),
              ],
            ),
          ),
          const SizedBox(height: VendorSp.md),
          Text(
            'Rekening pencairan, komisi, dan pengaturan notifikasi belum bisa '
            'diatur dari aplikasi ini. Hubungi admin Tarlink untuk perubahan '
            'verifikasi, kategori, atau wilayah.',
            style: vendorText(size: 11, color: VendorColors.muted, height: 1.5),
          ),
        ],
      ),
    );
  }
}

class _ProfileHero extends StatelessWidget {
  const _ProfileHero({
    required this.name,
    required this.subtitle,
    required this.verification,
    required this.onEdit,
  });

  final String name;
  final String subtitle;
  final String verification;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF182540), VendorColors.ink],
        ),
        borderRadius: BorderRadius.circular(VendorRadii.lg),
        boxShadow: const [
          BoxShadow(
            color: Color(0x240B1220),
            blurRadius: 22,
            offset: Offset(0, 8),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          const Positioned.fill(child: VendorBeams(intensity: 0.8)),
          Padding(
            padding: const EdgeInsets.all(VendorSp.lg),
            child: Row(
              children: [
                Container(
                  width: 58,
                  height: 58,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: VendorColors.lime.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(VendorRadii.md),
                    border: Border.all(
                      color: VendorColors.lime.withValues(alpha: 0.45),
                    ),
                  ),
                  child: Text(
                    vendorInitials(name),
                    style: vendorText(
                      size: 18,
                      weight: FontWeight.w800,
                      color: VendorColors.lime,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
                const SizedBox(width: VendorSp.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: vendorText(
                          size: 17,
                          weight: FontWeight.w800,
                          color: Colors.white,
                          letterSpacing: -0.35,
                          height: 1.16,
                        ),
                      ),
                      if (subtitle.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: vendorText(
                            size: 11.5,
                            color: Colors.white.withValues(alpha: 0.62),
                          ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          if (verification.isNotEmpty)
                            VendorPill(
                              label: _verificationLabel(verification),
                              tone: _verificationTone(verification),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: VendorSp.sm),
                Column(
                  children: [
                    VendorButton(
                      label: 'Ubah',
                      icon: Icons.edit_outlined,
                      kind: VendorButtonKind.outlineOnDark,
                      small: true,
                      onPressed: onEdit,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileStat extends StatelessWidget {
  const _ProfileStat({
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: VendorColors.cardWhite,
        borderRadius: BorderRadius.circular(VendorRadii.md),
        border: Border.all(color: VendorColors.lineSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: VendorColors.muted),
          const SizedBox(height: 6),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: vendorText(size: 18, weight: FontWeight.w800),
          ),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: vendorText(size: 10.5, color: VendorColors.muted),
          ),
        ],
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: VendorColors.cardWhite,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(VendorRadii.md),
        side: const BorderSide(color: VendorColors.lineSoft),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: VendorColors.limeSoft,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(icon, size: 18, color: VendorColors.ink),
              ),
              const SizedBox(height: 9),
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: vendorText(size: 12.5, weight: FontWeight.w800),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: vendorText(size: 10.5, color: VendorColors.muted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.title,
    required this.subtitle,
    this.onTap,
    this.trailingIcon = Icons.chevron_right,
    this.showDivider = true,
    this.danger = false,
  });

  final String title;
  final String subtitle;
  final VoidCallback? onTap;
  final IconData trailingIcon;
  final bool showDivider;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final accent = danger ? VendorColors.danger : VendorColors.ink;
    final content = Padding(
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 11),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: vendorText(
                    size: 12.5,
                    weight: FontWeight.w700,
                    letterSpacing: -0.1,
                    color: accent,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: vendorText(
                    size: 11,
                    color: VendorColors.muted,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: VendorSp.sm),
          Icon(
            trailingIcon,
            size: 15,
            color: danger ? VendorColors.danger : const Color(0xFF9AA1A9),
          ),
        ],
      ),
    );

    return Container(
      decoration: BoxDecoration(
        border: showDivider
            ? const Border(bottom: BorderSide(color: VendorColors.lineSoft))
            : null,
      ),
      child: onTap == null
          ? content
          : Material(
              color: Colors.transparent,
              child: InkWell(onTap: onTap, child: content),
            ),
    );
  }
}

String _verificationLabel(String status) => switch (status.toLowerCase()) {
  'approved' => 'Terverifikasi',
  'pending' => 'Menunggu verifikasi',
  'rejected' => 'Verifikasi ditolak',
  'suspended' => 'Ditangguhkan',
  '' => 'Belum diisi',
  _ => status,
};

VendorPillTone _verificationTone(String status) =>
    switch (status.toLowerCase()) {
      'approved' => VendorPillTone.ok,
      'pending' => VendorPillTone.wait,
      'rejected' || 'suspended' => VendorPillTone.no,
      _ => VendorPillTone.done,
    };
