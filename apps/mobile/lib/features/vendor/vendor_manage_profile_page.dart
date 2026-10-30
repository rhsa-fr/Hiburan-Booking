import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../core/api_exception.dart';
import '../booking/booking_support.dart';
import 'vendor_header.dart';
import 'vendor_media_picker.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// Lets a vendor owner change exactly what customers see on the public page:
/// identity, service terms, media and gallery. Admin-only fields are read-only.
class VendorManageProfilePage extends StatefulWidget {
  const VendorManageProfilePage({super.key});

  @override
  State<VendorManageProfilePage> createState() =>
      _VendorManageProfilePageState();
}

class _VendorManageProfilePageState extends State<VendorManageProfilePage> {
  final _displayName = TextEditingController();
  final _legalName = TextEditingController();
  final _description = TextEditingController();
  final _baseAddress = TextEditingController();
  final _radius = TextEditingController();
  final _freeRadius = TextEditingController();
  final _transport = TextEditingController();
  final _dp = TextEditingController();
  final _video = TextEditingController();

  bool _loading = true;
  bool _saving = false;
  String? _error;
  String? _avatarUrl;
  String? _bannerUrl;
  final List<String> _photos = [];
  bool _uploadingAvatar = false;
  bool _uploadingBanner = false;
  bool _uploadingGallery = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  @override
  void dispose() {
    _displayName.dispose();
    _legalName.dispose();
    _description.dispose();
    _baseAddress.dispose();
    _radius.dispose();
    _freeRadius.dispose();
    _transport.dispose();
    _dp.dispose();
    _video.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final raw = await AppScope.of(context).api.get('/vendor/me');
      final me = raw is Map ? raw.cast<String, dynamic>() : null;
      if (me == null || me.isEmpty) {
        throw const ApiException(
          code: 'VENDOR_NOT_FOUND',
          message: 'Data vendor tidak ditemukan.',
        );
      }
      if (!mounted) return;
      setState(() {
        _displayName.text = me['display_name']?.toString() ?? '';
        _legalName.text = me['legal_name']?.toString() ?? '';
        _description.text = me['description']?.toString() ?? '';
        _baseAddress.text = me['base_address']?.toString() ?? '';
        _radius.text = me['service_radius_km']?.toString() ?? '';
        _freeRadius.text = me['free_radius_km']?.toString() ?? '';
        _transport.text = me['transport_fee_per_km_idr']?.toString() ?? '';
        final dp = (me['min_dp_bp'] as num?)?.toInt() ?? 0;
        _dp.text = (dp / 100).toStringAsFixed(dp % 100 == 0 ? 0 : 2);
        _video.text = me['video_url']?.toString() ?? '';
        _avatarUrl = me['avatar_url']?.toString();
        _bannerUrl = me['banner_url']?.toString();
        _photos
          ..clear()
          ..addAll(
            (me['photo_urls'] is List)
                ? (me['photo_urls'] as List)
                      .whereType<String>()
                      .where((value) => value.trim().isNotEmpty)
                : const <String>[],
          );
        _loading = false;
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

  int? _parseInt(String raw) {
    final digits = raw.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.isEmpty) return null;
    return int.tryParse(digits);
  }

  Future<void> _save() async {
    final name = _displayName.text.trim();
    if (name.isEmpty) {
      _notice('Nama vendor wajib diisi.');
      return;
    }
    final dpPercent = double.tryParse(_dp.text.trim().replaceAll(',', '.'));
    if (dpPercent == null || dpPercent < 0 || dpPercent > 100) {
      _notice('DP harus antara 0 dan 100 persen.');
      return;
    }
    final radius = _parseInt(_radius.text);
    if (radius != null && radius > 500) {
      _notice('Radius layanan maksimal 500 km.');
      return;
    }

    final body = <String, dynamic>{
      'display_name': name,
      'legal_name': _legalName.text.trim(),
      'description': _description.text.trim(),
      'base_address': _baseAddress.text.trim(),
      'service_radius_km': radius,
      'free_radius_km': _parseInt(_freeRadius.text) ?? 0,
      'transport_fee_per_km_idr': _parseInt(_transport.text) ?? 0,
      'min_dp_bp': (dpPercent * 100).round(),
      'avatar_url': _avatarUrl,
      'banner_url': _bannerUrl,
      'photo_urls': List<String>.from(_photos),
      'video_url': _video.text.trim(),
    };

    setState(() => _saving = true);
    try {
      await AppScope.of(context).api.patch('/vendor/me', body: body);
      if (!mounted) return;
      _notice('Profil dan media tersimpan.');
      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      _notice(apiMessage(error));
    } catch (error) {
      if (!mounted) return;
      _notice('Gagal menyimpan: $error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickAvatar() async {
    setState(() => _uploadingAvatar = true);
    final url = await pickAndUploadVendorImage(context);
    if (!mounted) return;
    setState(() {
      _uploadingAvatar = false;
      if (url != null) _avatarUrl = url;
    });
  }

  Future<void> _pickBanner() async {
    setState(() => _uploadingBanner = true);
    final url = await pickAndUploadVendorImage(context);
    if (!mounted) return;
    setState(() {
      _uploadingBanner = false;
      if (url != null) _bannerUrl = url;
    });
  }

  Future<void> _addPhoto() async {
    if (_photos.length >= 8) {
      _notice('Maksimal 8 foto galeri.');
      return;
    }
    setState(() => _uploadingGallery = true);
    final url = await pickAndUploadVendorImage(context);
    if (!mounted) return;
    setState(() {
      _uploadingGallery = false;
      if (url != null) _photos.add(url);
    });
  }

  Future<void> _replacePhoto(int index) async {
    setState(() => _uploadingGallery = true);
    final url = await pickAndUploadVendorImage(context);
    if (!mounted) return;
    setState(() {
      _uploadingGallery = false;
      if (url != null) _photos[index] = url;
    });
  }

  void _notice(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VendorColors.canvas,
      appBar: const VendorHeader(
        kicker: 'Kelola',
        title: 'Profil & media',
        showBack: true,
      ),
      body: ColoredBox(
        color: VendorColors.canvas,
        child: _loading
            ? const VendorLoading(rows: 5)
            : _error != null
            ? VendorError(message: _error!, onRetry: _load)
            : _form(),
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
                label: _saving ? 'Menyimpan...' : 'Simpan perubahan',
                onPressed: _saving ? null : _save,
              ),
            ),
    );
  }

  Widget _form() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        VendorSp.lg,
        14,
        VendorSp.lg,
        24,
      ),
      children: [
        const VendorSectionTitle(label: 'Identitas'),
        VendorCard(
          child: Column(
            children: [
              VendorTextField(
                label: 'Nama vendor',
                controller: _displayName,
                hint: 'Nama yang tampil ke pelanggan',
              ),
              const SizedBox(height: 12),
              VendorTextField(
                label: 'Nama legal',
                controller: _legalName,
                hint: 'Opsional, untuk dokumen',
              ),
              const SizedBox(height: 12),
              VendorTextField(
                label: 'Deskripsi',
                controller: _description,
                maxLines: 4,
                hint: 'Ceritakan gaya pentas, personel, dan pengalaman',
              ),
              const SizedBox(height: 12),
              VendorTextField(
                label: 'Alamat basis',
                controller: _baseAddress,
                maxLines: 2,
                hint: 'Kecamatan, kabupaten',
              ),
            ],
          ),
        ),
        const VendorSectionTitle(label: 'Layanan & harga'),
        VendorCard(
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: VendorTextField(
                      label: 'Radius layanan (km)',
                      controller: _radius,
                      keyboardType: TextInputType.number,
                      hint: '25',
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: VendorTextField(
                      label: 'Bebas transport (km)',
                      controller: _freeRadius,
                      keyboardType: TextInputType.number,
                      hint: '5',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: VendorTextField(
                      label: 'Transport per km',
                      controller: _transport,
                      keyboardType: TextInputType.number,
                      prefixText: 'Rp ',
                      hint: '15000',
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: VendorTextField(
                      label: 'DP (%)',
                      controller: _dp,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      hint: '30',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Harga paket diatur di menu Paket & harga.',
                  style: vendorText(
                    size: 10.5,
                    color: VendorColors.muted,
                  ),
                ),
              ),
            ],
          ),
        ),
        const VendorSectionTitle(label: 'Media'),
        VendorCard(
          child: Column(
            children: [
              VendorMediaTile(
                label: 'Avatar vendor',
                url: _avatarUrl,
                busy: _uploadingAvatar,
                height: 112,
                onPick: _pickAvatar,
                onClear: () => setState(() => _avatarUrl = null),
              ),
              const SizedBox(height: 14),
              VendorMediaTile(
                label: 'Banner halaman',
                url: _bannerUrl,
                busy: _uploadingBanner,
                height: 132,
                onPick: _pickBanner,
                onClear: () => setState(() => _bannerUrl = null),
              ),
              const SizedBox(height: 14),
              VendorTextField(
                label: 'URL video (YouTube)',
                controller: _video,
                hint: 'https://youtube.com/...',
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 14),
              LayoutBuilder(
                builder: (context, constraints) {
                  final width = (constraints.maxWidth - 8) / 2;
                  return Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (var i = 0; i < _photos.length; i++)
                        SizedBox(
                          width: width,
                          child: VendorMediaTile(
                            label: 'Galeri ${i + 1}',
                            url: _photos[i],
                            height: 92,
                            onPick: () => _replacePhoto(i),
                            onClear: () => setState(() => _photos.removeAt(i)),
                          ),
                        ),
                      SizedBox(
                        width: width,
                        child: VendorMediaTile(
                          label: 'Tambah foto',
                          url: null,
                          height: 92,
                          busy: _uploadingGallery,
                          onPick: _addPhoto,
                        ),
                      ),
                    ],
                  );
                },
              ),
            ],
          ),
        ),
        const SizedBox(height: VendorSp.md),
        Text(
          'Verifikasi, kategori, wilayah, dan status aktif diatur admin Tarlink. '
          'Foto disimpan di server Tarlink dan langsung tampil di halaman pelanggan.',
          style: vendorText(size: 11, color: VendorColors.muted, height: 1.5),
        ),
      ],
    );
  }
}
