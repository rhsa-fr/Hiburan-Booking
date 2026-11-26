import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../booking/booking_support.dart';
import 'vendor_header.dart';
import 'vendor_media_picker.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// Create/edit one package. `initial == null` means "new package".
class VendorPackageEditPage extends StatefulWidget {
  const VendorPackageEditPage({super.key, this.initial, this.picker});

  final Map<String, dynamic>? initial;
  final VendorMediaPickerFn? picker;

  @override
  State<VendorPackageEditPage> createState() => _VendorPackageEditPageState();
}

class _VendorPackageEditPageState extends State<VendorPackageEditPage> {
  final _name = TextEditingController();
  final _customHours = TextEditingController();
  PackageDurationOption? _durationOption = PackageDurationOption.halfDay;
  final _personnel = TextEditingController();
  final _price = TextEditingController();
  final _description = TextEditingController();
  final _inclusions = TextEditingController();

  String? _photoUrl;
  VendorMediaUpload? _pendingPhoto;
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
      _applyInitialDuration((item['duration_minutes'] as num?)?.toInt() ?? 360);
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
    }
  }

  /// Stored minutes → the chip that matches, or the custom field when the
  /// vendor's duration is not one of the three presets.
  void _applyInitialDuration(int minutes) {
    final preset = packageDurationOption(minutes);
    if (preset != null) {
      _durationOption = preset;
    } else {
      _durationOption = null;
      _customHours.text = packageDurationHoursInput(minutes);
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _customHours.dispose();
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
    if (_id == null) return;
    setState(() => _uploadingPhoto = true);
    final picker = widget.picker ?? pickAndUploadVendorImage;
    final result = await picker(context, kind: 'package_photo', packageId: _id);
    if (!mounted) return;
    setState(() => _uploadingPhoto = false);

    switch (result) {
      case VendorMediaCancelled():
        break;
      case VendorMediaFailed(:final message):
        _notice(message);
      case VendorMediaUploaded(:final media):
        setState(() {
          if (media.isPending) {
            _pendingPhoto = media;
          } else {
            _photoUrl = media.url;
            _pendingPhoto = null;
          }
        });
        _notice(
          'Media terkirim. Menunggu tinjauan admin sebelum tampil di profil.',
        );
    }
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final duration =
        _durationOption?.minutes ??
        packageDurationMinutesFromHours(_customHours.text);
    final price = _intOf(_price);
    final personnel = _intOf(_personnel);

    if (name.isEmpty) {
      _notice('Nama paket wajib diisi.');
      return;
    }
    if (duration == null) {
      _notice('Durasi khusus harus antara 0,5 dan 24 jam.');
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
      final details = error.details;
      if (error.code == 'MEDIA_NOT_APPROVED' ||
          (details is Map && details['reason'] == 'MEDIA_NOT_APPROVED')) {
        _notice('Foto paket belum disetujui admin.');
      } else {
        _notice(apiMessage(error));
      }
    } catch (error) {
      if (!mounted) return;
      _notice('Gagal menyimpan paket: $error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _notice(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final isNew = _id == null;
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
          padding: const EdgeInsets.fromLTRB(VendorSp.lg, 14, VendorSp.lg, 24),
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
                  _DurationPicker(
                    selected: _durationOption,
                    controller: _customHours,
                    onSelect: (option) =>
                        setState(() => _durationOption = option),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: VendorTextField(
                          label: 'Personel',
                          controller: _personnel,
                          keyboardType: TextInputType.number,
                          hint: '15',
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: VendorTextField(
                          label: 'Harga paket',
                          controller: _price,
                          keyboardType: TextInputType.number,
                          prefixText: 'Rp ',
                          hint: '15000000',
                        ),
                      ),
                    ],
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
                helper:
                    'Satu fasilitas per baris. Tampil di halaman pelanggan.',
              ),
            ),
            const VendorSectionTitle(label: 'Foto paket'),
            VendorCard(
              color: isNew ? VendorColors.softFill : VendorColors.cardWhite,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  () {
                    final isPending = _pendingPhoto != null;
                    final displayUrl = isPending
                        ? _pendingPhoto!.url
                        : _photoUrl;
                    return IgnorePointer(
                      ignoring: isNew,
                      child: Opacity(
                        opacity: isNew ? 0.6 : 1.0,
                        child: Stack(
                          children: [
                            VendorMediaTile(
                              label: 'Foto utama paket',
                              url: displayUrl,
                              busy: _uploadingPhoto,
                              height: 150,
                              onPick: isNew ? null : _pickPhoto,
                              onClear: isNew
                                  ? null
                                  : (_photoUrl != null || _pendingPhoto != null)
                                  ? () => setState(() {
                                      _photoUrl = null;
                                      _pendingPhoto = null;
                                    })
                                  : null,
                            ),
                            if (isPending)
                              const Positioned(
                                top: 24,
                                right: 8,
                                child: VendorPill(
                                  label: 'Menunggu tinjauan',
                                  tone: VendorPillTone.wait,
                                ),
                              ),
                          ],
                        ),
                      ),
                    );
                  }(),
                  const SizedBox(height: 4),
                  Text(
                    isNew
                        ? 'Simpan paket terlebih dahulu sebelum menambahkan foto.'
                        : 'Perubahan media tampil setelah disetujui admin.',
                    style: vendorText(size: 10.5, color: VendorColors.muted),
                  ),
                ],
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
        decoration: const BoxDecoration(
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

/// Four choices replace the old free-text minutes field: the three standard
/// durations plus a custom one for short packages (ADR 0042). The stored value
/// is still minutes, so nothing downstream changes.
class _DurationPicker extends StatelessWidget {
  const _DurationPicker({
    required this.selected,
    required this.controller,
    required this.onSelect,
  });

  final PackageDurationOption? selected;
  final TextEditingController controller;
  final ValueChanged<PackageDurationOption?> onSelect;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'DURASI',
          style: vendorText(
            size: 11,
            weight: FontWeight.w800,
            letterSpacing: 0.6,
            color: VendorColors.muted,
          ),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            for (final option in PackageDurationOption.values) ...[
              Expanded(
                child: _DurationChoice(
                  title: option.label,
                  detail: option.hoursLabel,
                  selected: selected == option,
                  onTap: () => onSelect(option),
                ),
              ),
              const SizedBox(width: 6),
            ],
            Expanded(
              child: _DurationChoice(
                title: 'Lainnya',
                detail: 'khusus',
                selected: selected == null,
                onTap: () => onSelect(null),
              ),
            ),
          ],
        ),
        if (selected == null) ...[
          const SizedBox(height: 10),
          VendorTextField(
            label: 'Durasi khusus (jam)',
            controller: controller,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            hint: '3',
            helper: 'Boleh desimal, mis. 1,5 untuk 1 jam 30. Rentang 0,5–24 jam.',
          ),
        ],
      ],
    );
  }
}

class _DurationChoice extends StatelessWidget {
  const _DurationChoice({
    required this.title,
    required this.detail,
    required this.selected,
    required this.onTap,
  });

  final String title;
  final String detail;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? VendorColors.ink : VendorColors.muted;
    final radius = BorderRadius.circular(VendorRadii.sm + 2);
    // `Ink` only paints when a Material sits above it; VendorCard is a plain
    // Container, so the chip draws its own background instead.
    return Semantics(
      button: true,
      selected: selected,
      label: '$title, $detail',
      child: InkWell(
        onTap: onTap,
        borderRadius: radius,
        child: Container(
          height: 62,
          padding: const EdgeInsets.symmetric(horizontal: 4),
          decoration: BoxDecoration(
            color: selected ? VendorColors.limeSoft : VendorColors.cardWhite,
            borderRadius: radius,
            border: Border.all(
              color: selected ? VendorColors.limeDark : VendorColors.line,
              width: selected ? 1.6 : 1,
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SizedBox(
                height: 28,
                child: Center(
                  child: Text(
                    title,
                    maxLines: 2,
                    textAlign: TextAlign.center,
                    style: vendorText(
                      size: 11.5,
                      weight: FontWeight.w800,
                      color: fg,
                      height: 1.12,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                detail,
                maxLines: 1,
                style: vendorText(
                  size: 9.5,
                  weight: FontWeight.w600,
                  color: VendorColors.muted,
                  letterSpacing: 0.2,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
