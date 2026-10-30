import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../core/api_exception.dart';
import '../booking/booking_support.dart';
import 'vendor_header.dart';
import 'vendor_media_picker.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// Create/edit one package. `initial == null` means "new package".
class VendorPackageEditPage extends StatefulWidget {
  const VendorPackageEditPage({super.key, this.initial});

  final Map<String, dynamic>? initial;

  @override
  State<VendorPackageEditPage> createState() => _VendorPackageEditPageState();
}

class _VendorPackageEditPageState extends State<VendorPackageEditPage> {
  final _name = TextEditingController();
  final _duration = TextEditingController();
  final _personnel = TextEditingController();
  final _price = TextEditingController();
  final _description = TextEditingController();
  final _inclusions = TextEditingController();

  String? _photoUrl;
  bool _active = true;
  bool _saving = false;
  bool _uploadingPhoto = false;

  String? get _id => widget.initial?['id']?.toString();

  @override
  void initState() {
    super.initState();
    final item = widget.initial;
    if (item != null) {
      _name.text = item['name']?.toString() ?? '';
      _duration.text = item['duration_minutes']?.toString() ?? '360';
      _personnel.text = item['personnel_count']?.toString() ?? '';
      final price = moneyValue(item, 'base_price_idr') ?? 0;
      _price.text = price > 0 ? '$price' : '';
      _description.text = item['description']?.toString() ?? '';
      final inclusions = item['inclusions'];
      _inclusions.text = inclusions is List
          ? inclusions.whereType<String>().join('\n')
          : '';
      _photoUrl = item['photo_url']?.toString();
      _active = item['is_active'] != false;
    } else {
      _duration.text = '360';
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _duration.dispose();
    _personnel.dispose();
    _price.dispose();
    _description.dispose();
    _inclusions.dispose();
    super.dispose();
  }

  int? _intOf(TextEditingController controller) {
    final digits = controller.text.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.isEmpty) return null;
    return int.tryParse(digits);
  }

  Future<void> _pickPhoto() async {
    setState(() => _uploadingPhoto = true);
    final url = await pickAndUploadVendorImage(context);
    if (!mounted) return;
    setState(() {
      _uploadingPhoto = false;
      if (url != null) _photoUrl = url;
    });
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final duration = _intOf(_duration);
    final price = _intOf(_price);
    final personnel = _intOf(_personnel);

    if (name.isEmpty) {
      _notice('Nama paket wajib diisi.');
      return;
    }
    if (duration == null || duration < 30 || duration > 1440) {
      _notice('Durasi harus 30–1440 menit.');
      return;
    }
    if (price == null || price <= 0) {
      _notice('Harga paket wajib diisi.');
      return;
    }
    if (personnel != null && personnel > 200) {
      _notice('Jumlah personel maksimal 200.');
      return;
    }

    final inclusions = _inclusions.text
        .split('\n')
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList(growable: false);
    if (inclusions.length > 30) {
      _notice('Fasilitas maksimal 30 baris.');
      return;
    }

    final body = <String, dynamic>{
      'name': name,
      'duration_minutes': duration,
      'personnel_count': personnel != null && personnel > 0 ? personnel : null,
      'base_price_idr': price,
      'description': _description.text.trim(),
      'inclusions': inclusions,
      'photo_url': _photoUrl,
      'is_active': _active,
    };

    setState(() => _saving = true);
    try {
      final api = AppScope.of(context).api;
      if (_id == null) {
        await api.post('/vendor/packages', body: body);
      } else {
        await api.patch('/vendor/packages/$_id', body: body);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_id == null ? 'Paket dibuat.' : 'Paket diperbarui.'),
        ),
      );
      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      _notice(apiMessage(error));
    } catch (error) {
      if (!mounted) return;
      _notice('Gagal menyimpan paket: $error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _notice(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final isNew = widget.initial == null;
    return Scaffold(
      backgroundColor: VendorColors.canvas,
      appBar: VendorHeader(
        kicker: 'Paket',
        title: isNew ? 'Paket baru' : 'Edit paket',
        showBack: true,
        trailing: VendorPill(
          label: _active ? 'Aktif' : 'Nonaktif',
          tone: _active ? VendorPillTone.ok : VendorPillTone.done,
        ),
      ),
      body: ColoredBox(
        color: VendorColors.canvas,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            VendorSp.lg,
            14,
            VendorSp.lg,
            24,
          ),
          children: [
            const VendorSectionTitle(label: 'Detail paket'),
            VendorCard(
              child: Column(
                children: [
                  VendorTextField(
                    label: 'Nama paket',
                    controller: _name,
                    hint: 'Paket Hajatan Lengkap',
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: VendorTextField(
                          label: 'Durasi (menit)',
                          controller: _duration,
                          keyboardType: TextInputType.number,
                          hint: '360',
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: VendorTextField(
                          label: 'Personel',
                          controller: _personnel,
                          keyboardType: TextInputType.number,
                          hint: '15',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  VendorTextField(
                    label: 'Harga paket',
                    controller: _price,
                    keyboardType: TextInputType.number,
                    prefixText: 'Rp ',
                    hint: '15000000',
                  ),
                  const SizedBox(height: 12),
                  VendorTextField(
                    label: 'Deskripsi',
                    controller: _description,
                    maxLines: 3,
                    hint: 'Apa yang termasuk dalam paket ini',
                  ),
                ],
              ),
            ),
            const VendorSectionTitle(label: 'Fasilitas'),
            VendorCard(
              child: VendorTextField(
                label: 'Daftar fasilitas',
                controller: _inclusions,
                maxLines: 5,
                hint: 'Sound System 5.000 Watt\nGenset 10 kVA',
                helper: 'Satu fasilitas per baris. Tampil di halaman pelanggan.',
              ),
            ),
            const VendorSectionTitle(label: 'Foto paket'),
            VendorCard(
              child: VendorMediaTile(
                label: 'Foto utama paket',
                url: _photoUrl,
                busy: _uploadingPhoto,
                height: 150,
                onPick: _pickPhoto,
                onClear: () => setState(() => _photoUrl = null),
              ),
            ),
            const VendorSectionTitle(label: 'Status'),
            VendorCard(
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Tampilkan paket',
                          style: vendorText(
                            size: 12.5,
                            weight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Paket nonaktif tidak muncul di halaman pelanggan.',
                          style: vendorText(
                            size: 11,
                            color: VendorColors.muted,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Switch(
                    value: _active,
                    onChanged: (value) => setState(() => _active = value),
                    activeThumbColor: VendorColors.limeDark,
                  ),
                ],
              ),
            ),
            const SizedBox(height: VendorSp.md),
            Text(
              'Harga memakai rupiah penuh. DP pelanggan dihitung dari '
              'persentase DP di profil vendor.',
              style: vendorText(
                size: 11,
                color: VendorColors.muted,
                height: 1.5,
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: Container(
        color: VendorColors.cardWhite,
        padding: EdgeInsets.fromLTRB(
          VendorSp.lg,
          10,
          VendorSp.lg,
          12 + MediaQuery.viewPaddingOf(context).bottom,
        ),
        child: VendorButton(
          label: _saving
              ? 'Menyimpan...'
              : isNew
              ? 'Simpan paket'
              : 'Simpan perubahan',
          onPressed: _saving ? null : _save,
        ),
      ),
    );
  }
}
