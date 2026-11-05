import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../app/app.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';
import '../booking/booking_support.dart';

/// FR-002/FR-003: customer applies to become a vendor.
///
/// The KTP is uploaded to the private endpoint first; the returned opaque key
/// is what the application body carries. The file never becomes a public
/// `/v1/media` URL.
class VendorApplyPage extends StatefulWidget {
  const VendorApplyPage({super.key});

  @override
  State<VendorApplyPage> createState() => _VendorApplyPageState();
}

class _VendorApplyPageState extends State<VendorApplyPage> {
  final _displayName = TextEditingController();
  final _legalName = TextEditingController();
  final _nik = TextEditingController();
  final _address = TextEditingController();

  List<Map<String, dynamic>> _regions = const [];
  String? _regionCode;
  Map<String, dynamic>? _application;
  XFile? _ktp;
  bool _loading = true;
  bool _busy = false;
  bool _formVisible = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _displayName.dispose();
    _legalName.dispose();
    _nik.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final api = AppScope.of(context).api;
    try {
      final results = await Future.wait([
        api.get('/vendor-applications/me'),
        api.get('/regions', auth: false),
      ]);
      if (!mounted) return;
      final application = _map(results[0]);
      final regionsRaw = _map(results[1]);
      final items = (regionsRaw?['items'] as List? ?? const [])
          .whereType<Map>()
          .map((row) => row.cast<String, dynamic>())
          .toList(growable: false);
      setState(() {
        _application = application;
        _regions = items;
        _regionCode ??= items.isNotEmpty ? '${items.first['code']}' : null;
        _formVisible = application == null || application['status'] == 'rejected';
        _loading = false;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = apiMessage(error);
      });
    }
  }

  Future<void> _pickKtp() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
    );
    if (picked == null || !mounted) return;
    setState(() => _ktp = picked);
  }

  Future<void> _submit() async {
    if (_busy) return;
    final displayName = _displayName.text.trim();
    final legalName = _legalName.text.trim();
    final nik = _nik.text.trim();
    final address = _address.text.trim();
    final region = _regionCode;

    if (displayName.length < 2 ||
        legalName.length < 2 ||
        !RegExp(r'^[0-9]{16}$').hasMatch(nik) ||
        address.length < 10 ||
        region == null) {
      setState(() => _error = 'Lengkapi semua isian. NIK harus 16 digit.');
      return;
    }
    if (_ktp == null) {
      setState(() => _error = 'Foto KTP wajib diunggah.');
      return;
    }

    final api = AppScope.of(context).api;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final bytes = await _ktp!.readAsBytes();
      final upload = await api.uploadFile(
        '/vendor-applications/ktp',
        filename: _ktp!.name,
        bytes: bytes,
      );
      final key = _map(upload)?['ktp_object_key'];
      if (key is! String || key.isEmpty) {
        throw const ApiException(
          code: 'INTERNAL_ERROR',
          message: 'Unggahan KTP tidak menghasilkan kunci.',
        );
      }

      final created = await api.post(
        '/vendor-applications',
        body: {
          'display_name': displayName,
          'legal_name': legalName,
          'nik': nik,
          'region_code': region,
          'base_address': address,
          'ktp_object_key': key,
        },
      );
      if (!mounted) return;
      setState(() {
        _application = _map(created);
        _formVisible = false;
        _busy = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pengajuan vendor terkirim.')),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = apiMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          StageHeader.back(context: context, title: 'Daftar jadi vendor'),
          Expanded(
            child: _loading
                ? const AppLoading(label: 'Memuat pengajuan')
                : SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(
                      Sp.lg,
                      Sp.lg,
                      Sp.lg,
                      Sp.xxl,
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 520),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            if (_error != null) ...[
                              InfoStrip(
                                message: _error!,
                                icon: Icons.error_outline,
                                tone: InfoTone.danger,
                              ),
                              const SizedBox(height: Sp.lg),
                            ],
                            if (_application != null && !_formVisible)
                              _statusCard(_application!)
                            else
                              _form(context),
                          ],
                        ),
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _statusCard(Map<String, dynamic> application) {
    final status = '${application['status'] ?? 'submitted'}';
    final note = application['review_note'];
    final labels = {
      'submitted': 'Menunggu pemeriksaan admin',
      'approved': 'Disetujui',
      'rejected': 'Ditolak',
      'draft': 'Draf',
    };
    final tone = status == 'approved'
        ? InfoTone.success
        : status == 'rejected'
        ? InfoTone.danger
        : InfoTone.warning;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InfoStrip(
          message: labels[status] ?? status,
          icon: status == 'approved'
              ? Icons.verified_outlined
              : status == 'rejected'
              ? Icons.cancel_outlined
              : Icons.hourglass_empty,
          tone: tone,
        ),
        if (note is String && note.trim().isNotEmpty) ...[
          const SizedBox(height: Sp.md),
          Text('Catatan admin: ${note.trim()}', style: Theme.of(context).textTheme.bodyMedium),
        ],
        if (status == 'rejected') ...[
          const SizedBox(height: Sp.lg),
          FilledButton(
            onPressed: () => setState(() => _formVisible = true),
            child: const Text('Ajukan ulang'),
          ),
        ],
      ],
    );
  }

  Widget _form(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Lengkapi data grup dan unggah foto KTP pimpinan. Data KTP hanya '
          'dibuka admin verifikasi dan tidak tampil ke pelanggan.',
          style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
        ),
        const SizedBox(height: Sp.lg),
        TextField(
          controller: _displayName,
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(
            labelText: 'Nama grup / vendor',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: Sp.md),
        TextField(
          controller: _legalName,
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(
            labelText: 'Nama legal (sesuai KTP)',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: Sp.md),
        TextField(
          controller: _nik,
          keyboardType: TextInputType.number,
          maxLength: 16,
          decoration: const InputDecoration(
            labelText: 'NIK pimpinan',
            border: OutlineInputBorder(),
          ),
        ),
        DropdownButtonFormField<String>(
          initialValue: _regionCode,
          decoration: const InputDecoration(
            labelText: 'Wilayah basis',
            border: OutlineInputBorder(),
          ),
          items: _regions
              .map(
                (row) => DropdownMenuItem(
                  value: '${row['code']}',
                  child: Text('${row['name']}'),
                ),
              )
              .toList(growable: false),
          onChanged: (value) => setState(() => _regionCode = value),
        ),
        const SizedBox(height: Sp.md),
        TextField(
          controller: _address,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Alamat basis',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: Sp.lg),
        OutlinedButton.icon(
          onPressed: _busy ? null : _pickKtp,
          icon: const Icon(Icons.badge_outlined),
          label: Text(
            _ktp == null ? 'Pilih foto KTP' : 'Ganti foto: ${_ktp!.name}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(52),
            foregroundColor: AppColors.ink,
            side: const BorderSide(color: AppColors.line),
          ),
        ),
        const SizedBox(height: Sp.xl),
        FilledButton(
          onPressed: _busy ? null : _submit,
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          child: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Kirim pengajuan'),
        ),
      ],
    );
  }
}

Map<String, dynamic>? _map(dynamic value) {
  if (value is Map) return value.cast<String, dynamic>();
  return null;
}
