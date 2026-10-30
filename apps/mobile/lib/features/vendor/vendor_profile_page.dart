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

    final stats = <({String value, String label})>[
      (value: '$_completed', label: 'Pesanan selesai'),
      if (rating is num && ratingCount > 0)
        (
          value: rating.toStringAsFixed(1).replaceAll('.', ','),
          label: 'Rating vendor',
        ),
      if (packages.isNotEmpty)
        (value: '${packages.length}', label: 'Paket aktif'),
    ];

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
          if (stats.isNotEmpty)
            VendorCard(
              padding: EdgeInsets.zero,
              child: IntrinsicHeight(
                child: Row(
                  children: [
                    for (var i = 0; i < stats.length; i++)
                      Expanded(
                        child: VendorStatCell(
                          value: stats[i].value,
                          label: stats[i].label,
                          showDivider: i != stats.length - 1,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          const VendorSectionTitle(label: 'Kelola'),
          VendorCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _InfoRow(
                  title: 'Profil & media',
                  subtitle: 'Nama, deskripsi, alamat, foto, video',
                  trailingIcon: Icons.storefront_outlined,
                  onTap: _openManageProfile,
                ),
                _InfoRow(
                  title: 'Paket & harga',
                  subtitle: 'Harga, durasi, personel, fasilitas, foto paket',
                  trailingIcon: Icons.inventory_2_outlined,
                  onTap: _openManagePackages,
                ),
                _InfoRow(
                  title: 'Ketersediaan',
                  subtitle: 'Atur tanggal tersedia atau tutup',
                  trailingIcon: Icons.edit_calendar_outlined,
                  onTap: widget.onOpenCalendar,
                  showDivider: false,
                ),
              ],
            ),
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
            child: _InfoRow(
              title: 'Keluar mode vendor',
              subtitle: 'Kembali ke aplikasi pelanggan',
              trailingIcon: Icons.logout,
              onTap: _leaveVendorMode,
              showDivider: false,
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

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.title,
    required this.subtitle,
    this.onTap,
    this.trailingIcon = Icons.chevron_right,
    this.showDivider = true,
  });

  final String title;
  final String subtitle;
  final VoidCallback? onTap;
  final IconData trailingIcon;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
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
          Icon(trailingIcon, size: 15, color: const Color(0xFF9AA1A9)),
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
