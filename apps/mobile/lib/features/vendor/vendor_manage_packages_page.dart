import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../booking/booking_support.dart';
import 'vendor_header.dart';
import 'vendor_package_edit_page.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// CRUD for the packages customers see in the booking form.
class VendorManagePackagesPage extends StatefulWidget {
  const VendorManagePackagesPage({super.key});

  @override
  State<VendorManagePackagesPage> createState() =>
      _VendorManagePackagesPageState();
}

class _VendorManagePackagesPageState extends State<VendorManagePackagesPage> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _items = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final raw = await AppScope.of(context).api.get('/vendor/packages');
      final payload = raw is Map ? raw.cast<String, dynamic>() : null;
      final items = payload?['items'] is List
          ? (payload!['items'] as List)
                .whereType<Map>()
                .map((item) => item.cast<String, dynamic>())
                .toList(growable: false)
          : const <Map<String, dynamic>>[];
      if (!mounted) return;
      setState(() {
        _items = items;
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
        _error = 'Gagal memuat paket: $error';
      });
    }
  }

  Future<void> _openEditor([Map<String, dynamic>? item]) async {
    final saved = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => VendorPackageEditPage(initial: item)),
    );
    if (saved == true) await _load(silent: true);
  }

  Future<void> _delete(Map<String, dynamic> item) async {
    final id = item['id']?.toString();
    if (id == null || id.isEmpty) return;
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
                'Nonaktifkan paket?',
                style: vendorText(size: 16, weight: FontWeight.w800),
              ),
              const SizedBox(height: 6),
              Text(
                'Paket "${item['name'] ?? ''}" tidak akan tampil di halaman '
                'pelanggan. Booking lama tetap tersimpan.',
                style: vendorText(
                  size: 12.5,
                  color: VendorColors.muted,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: VendorSp.lg),
              VendorButton(
                label: 'Nonaktifkan',
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

    try {
      await AppScope.of(context).api.delete('/vendor/packages/$id');
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Paket dinonaktifkan.')));
      await _load(silent: true);
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(apiMessage(error))));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VendorColors.canvas,
      appBar: VendorHeader(
        kicker: 'Kelola',
        title: 'Paket & harga',
        showBack: true,
        trailing: _loading || _error != null
            ? null
            : VendorPill(
                label: '${_items.length} paket',
                tone: VendorPillTone.done,
              ),
      ),
      body: ColoredBox(
        color: VendorColors.canvas,
        child: _loading
            ? const VendorLoading(rows: 4)
            : _error != null
            ? VendorError(message: _error!, onRetry: _load)
            : RefreshIndicator(
                color: VendorColors.limeDark,
                onRefresh: () => _load(silent: true),
                child: _items.isEmpty ? _empty() : _list(),
              ),
      ),
      bottomNavigationBar: _loading || _error != null
          ? null
          : Container(
              decoration: BoxDecoration(
                color: VendorColors.cardWhite,
                borderRadius: BorderRadius.vertical(
                  top: Radius.circular(VendorRadii.lg),
                ),
                boxShadow: [
                  BoxShadow(
                    color: Color(0x160B1220),
                    blurRadius: 20,
                    offset: Offset(0, -6),
                  ),
                ],
              ),
              padding: EdgeInsets.fromLTRB(
                VendorSp.lg,
                12,
                16,
                12 + MediaQuery.viewPaddingOf(context).bottom,
              ),
              child: VendorButton(
                label: 'Tambah paket',
                icon: Icons.add,
                onPressed: () => _openEditor(),
              ),
            ),
    );
  }

  Widget _empty() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(VendorSp.lg),
      children: [
        VendorEmpty(
          icon: Icons.inventory_2_outlined,
          title: 'Belum ada paket',
          message:
              'Tambahkan paket pertama agar pelanggan bisa melihat harga dan '
              'memilih jadwal.',
          action: VendorButton(
            label: 'Tambah paket pertama',
            icon: Icons.add,
            onPressed: () => _openEditor(),
          ),
        ),
      ],
    );
  }

  Widget _list() {
    final active = _items.where((item) => item['is_active'] != false).length;
    var cheapest = 0;
    for (final item in _items) {
      final price = moneyValue(item, 'base_price_idr') ?? 0;
      if (price <= 0) continue;
      if (cheapest == 0 || price < cheapest) cheapest = price;
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(VendorSp.lg, 14, VendorSp.lg, 24),
      children: [
        Container(
          padding: const EdgeInsets.all(VendorSp.lg),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF182540), VendorColors.ink],
            ),
            borderRadius: BorderRadius.circular(VendorRadii.lg),
            boxShadow: const [
              BoxShadow(
                color: Color(0x240B1220),
                blurRadius: 20,
                offset: Offset(0, 8),
              ),
            ],
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 28,
                      height: 3,
                      decoration: BoxDecoration(
                        color: VendorColors.lime,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    const SizedBox(height: 9),
                    Text(
                      'Katalog $active aktif',
                      style: vendorText(
                        size: 17,
                        weight: FontWeight.w800,
                        color: Colors.white,
                        letterSpacing: -0.3,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      cheapest > 0
                          ? 'Mulai ${rupiahTight(cheapest)} per acara'
                          : 'Harga paket belum diisi',
                      style: vendorText(
                        size: 11.5,
                        color: Colors.white.withValues(alpha: 0.62),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: VendorSp.md),
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: VendorColors.lime.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: VendorColors.lime.withValues(alpha: 0.38),
                  ),
                ),
                child: const Icon(
                  Icons.inventory_2_outlined,
                  size: 22,
                  color: VendorColors.lime,
                ),
              ),
            ],
          ),
        ),
        const VendorSectionTitle(label: 'Daftar paket'),
        for (final item in _items) ...[
          _PackageCard(
            item: item,
            onTap: () => _openEditor(item),
            onDelete: () => _delete(item),
          ),
          const SizedBox(height: VendorSp.md),
        ],
        Text(
          'Paket nonaktif tidak tampil di halaman pelanggan, tetapi tetap '
          'tersimpan untuk riwayat booking.',
          style: vendorText(size: 11, color: VendorColors.muted, height: 1.5),
        ),
        const SizedBox(height: VendorSp.sm),
        const VendorSectionTitle(label: 'Tips paket'),
        const VendorCard(
          child: Column(
            children: [
              _PackageTip(
                icon: Icons.photo_camera_outlined,
                title: 'Pasang foto paket',
                body:
                    'Paket dengan foto panggung lebih mudah dipilih '
                    'pelanggan.',
              ),
              _PackageTip(
                icon: Icons.list_alt_outlined,
                title: 'Tulis fasilitas dengan jelas',
                body:
                    'Sound, personel, dan durasi yang jujur mengurangi '
                    'pertanyaan berulang.',
              ),
              _PackageTip(
                icon: Icons.event_repeat_outlined,
                title: 'Nonaktifkan, jangan hapus',
                body:
                    'Riwayat booking tetap tersimpan saat paket dinonaktifkan.',
                last: true,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PackageTip extends StatelessWidget {
  const _PackageTip({
    required this.icon,
    required this.title,
    required this.body,
    this.last = false,
  });

  final IconData icon;
  final String title;
  final String body;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 11),
      decoration: BoxDecoration(
        border: last
            ? null
            : Border(bottom: BorderSide(color: VendorColors.lineSoft)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              color: VendorColors.limeSoft,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 16, color: VendorColors.ink),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: vendorText(size: 12.5, weight: FontWeight.w700),
                ),
                const SizedBox(height: 2),
                Text(
                  body,
                  style: vendorText(
                    size: 11.5,
                    color: VendorColors.muted,
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

class _PackageCard extends StatelessWidget {
  const _PackageCard({
    required this.item,
    required this.onTap,
    required this.onDelete,
  });

  final Map<String, dynamic> item;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final photo = item['photo_url']?.toString().trim() ?? '';
    final active = item['is_active'] != false;
    final duration = (item['duration_minutes'] as num?)?.toInt() ?? 0;
    final personnel = (item['personnel_count'] as num?)?.toInt() ?? 0;
    final price = moneyValue(item, 'base_price_idr') ?? 0;
    final meta = <String>[
      if (duration > 0) packageDurationLabel(duration),
      if (personnel > 0) '$personnel personel',
    ].join(' · ');

    return VendorCard(
      onTap: onTap,
      padding: const EdgeInsets.all(13),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Container(
              width: 76,
              height: 76,
              color: VendorColors.softFill,
              child: photo.isEmpty
                  ? Icon(
                      Icons.music_note,
                      size: 24,
                      color: VendorColors.mutedSoft,
                    )
                  : Image.network(
                      photo,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => Icon(
                        Icons.broken_image_outlined,
                        size: 20,
                        color: VendorColors.mutedSoft,
                      ),
                    ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        item['name']?.toString() ?? 'Paket',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: vendorText(size: 14.5, weight: FontWeight.w800),
                      ),
                    ),
                    const SizedBox(width: 6),
                    VendorPill(
                      label: active ? 'Aktif' : 'Nonaktif',
                      tone: active ? VendorPillTone.ok : VendorPillTone.done,
                    ),
                  ],
                ),
                if (meta.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    meta,
                    style: vendorText(size: 11.5, color: VendorColors.muted),
                  ),
                ],
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        price > 0 ? rupiahTight(price) : 'Harga belum diisi',
                        style: vendorText(
                          size: 15,
                          weight: FontWeight.w800,
                          letterSpacing: -0.3,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: onDelete,
                      tooltip: 'Nonaktifkan paket',
                      visualDensity: VisualDensity.compact,
                      icon: Icon(
                        Icons.delete_outline,
                        size: 18,
                        color: VendorColors.muted,
                      ),
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
