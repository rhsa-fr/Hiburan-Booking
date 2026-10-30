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
      MaterialPageRoute(
        builder: (_) => VendorPackageEditPage(initial: item),
      ),
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Paket dinonaktifkan.')),
      );
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
              color: VendorColors.cardWhite,
              padding: EdgeInsets.fromLTRB(
                VendorSp.lg,
                10,
                VendorSp.lg,
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
          title: 'Belum ada paket',
          message:
              'Tambahkan paket pertama agar pelanggan bisa melihat harga dan '
              'memilih jadwal.',
        ),
      ],
    );
  }

  Widget _list() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
        VendorSp.lg,
        14,
        VendorSp.lg,
        24,
      ),
      children: [
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
      ],
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
      if (duration > 0) _duration(duration),
      if (personnel > 0) '$personnel personel',
    ].join(' · ');

    return VendorCard(
      onTap: onTap,
      padding: const EdgeInsets.all(12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Container(
              width: 62,
              height: 62,
              color: VendorColors.softFill,
              child: photo.isEmpty
                  ? Icon(
                      Icons.music_note,
                      size: 22,
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
          const SizedBox(width: 11),
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
                        style: vendorText(size: 13.5, weight: FontWeight.w700),
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
                    style: vendorText(size: 11, color: VendorColors.muted),
                  ),
                ],
                const SizedBox(height: 7),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        price > 0 ? rupiahTight(price) : 'Harga belum diisi',
                        style: vendorText(size: 13, weight: FontWeight.w700),
                      ),
                    ),
                    IconButton(
                      onPressed: onDelete,
                      tooltip: 'Nonaktifkan paket',
                      icon: const Icon(
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

  String _duration(int minutes) {
    if (minutes < 60) return '$minutes menit';
    final hours = minutes ~/ 60;
    final rest = minutes % 60;
    return rest == 0 ? '$hours jam' : '$hours jam $rest menit';
  }
}
