import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../core/api_exception.dart';
import '../booking/booking_support.dart';
import 'vendor_banks.dart';
import 'vendor_header.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// Rekening tujuan pencairan. Nomor rekening hanya ditampilkan dalam bentuk
/// masked; nomor penuh tidak pernah dikirim balik oleh API.
class VendorBankAccountPage extends StatefulWidget {
  const VendorBankAccountPage({super.key});

  @override
  State<VendorBankAccountPage> createState() => _VendorBankAccountPageState();
}

class _VendorBankAccountPageState extends State<VendorBankAccountPage> {
  final _number = TextEditingController();
  final _holder = TextEditingController();
  String _bankCode = vendorBanks.first.code;
  bool _loading = true;
  bool _saving = false;
  String? _error;
  String? _formError;
  List<Map<String, dynamic>> _items = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  @override
  void dispose() {
    _number.dispose();
    _holder.dispose();
    super.dispose();
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
      final raw = await api.get('/vendor/bank-accounts');
      final items = raw is List
          ? raw.whereType<Map>().map((item) => item.cast<String, dynamic>()).toList()
          : <Map<String, dynamic>>[];
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
        _error = 'Gagal memuat rekening: $error';
      });
    }
  }

  String? _validate() {
    final digits = _number.text.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length < 6 || digits.length > 20) {
      return 'Nomor rekening harus 6–20 digit.';
    }
    if (_holder.text.trim().length < 2) {
      return 'Nama pemilik rekening wajib diisi.';
    }
    return null;
  }

  Future<void> _save() async {
    final validation = _validate();
    if (validation != null) {
      setState(() => _formError = validation);
      return;
    }

    final api = AppScope.of(context).api;
    setState(() {
      _saving = true;
      _formError = null;
    });

    try {
      await api.post(
        '/vendor/bank-accounts',
        body: {
          'bank_code': _bankCode,
          'account_number': _number.text.trim(),
          'account_holder_name': _holder.text.trim(),
        },
      );
      if (!mounted) return;
      _number.clear();
      _holder.clear();
      setState(() => _saving = false);
      _snack('Rekening dikirim. Menunggu verifikasi admin.');
      await _load(silent: true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _formError = apiMessage(error);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _formError = 'Gagal menyimpan rekening: $error';
      });
    }
  }

  Future<void> _cancel(Map<String, dynamic> item) async {
    final id = item['id']?.toString();
    if (id == null || id.isEmpty) return;

    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: VendorColors.card,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(VendorSp.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Batalkan rekening?',
                style: vendorText(size: 16, weight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              Text(
                'Rekening yang dibatalkan tidak dipakai untuk pencairan. '
                'Anda bisa mendaftarkannya lagi nanti.',
                style: vendorText(size: 12.5, color: VendorColors.muted, height: 1.5),
              ),
              const SizedBox(height: VendorSp.lg),
              Row(
                children: [
                  Expanded(
                    child: VendorButton(
                      label: 'Kembali',
                      kind: VendorButtonKind.secondary,
                      onPressed: () => Navigator.of(context).pop(false),
                    ),
                  ),
                  const SizedBox(width: VendorSp.sm),
                  Expanded(
                    child: VendorButton(
                      label: 'Batalkan',
                      onPressed: () => Navigator.of(context).pop(true),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    if (confirmed != true || !mounted) return;

    final api = AppScope.of(context).api;
    try {
      await api.delete('/vendor/bank-accounts/$id');
      if (!mounted) return;
      _snack('Rekening dibatalkan.');
      await _load(silent: true);
    } on ApiException catch (error) {
      if (!mounted) return;
      _snack(apiMessage(error));
    }
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VendorColors.canvas,
      appBar: const VendorHeader(
        kicker: 'Pencairan',
        title: 'Rekening',
        subtitle: 'Mode Vendor · Tarlink',
        showBack: true,
      ),
      body: _loading
          ? const VendorLoading(rows: 3)
          : _error != null
          ? VendorError(message: _error!, onRetry: _load)
          : _content(),
    );
  }

  Widget _content() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        VendorSp.lg,
        14,
        VendorSp.lg,
        VendorSp.xl,
      ),
      children: [
        Text(
          'Dana hanya bisa dicairkan ke rekening yang sudah diverifikasi admin. '
          'Nomor rekening disimpan terenkripsi dan hanya tampil sebagian.',
          style: vendorText(size: 11.5, color: VendorColors.muted, height: 1.5),
        ),
        const SizedBox(height: VendorSp.md),
        const VendorSectionTitle(label: 'Rekening terdaftar'),
        if (_items.isEmpty)
          const VendorEmpty(
            title: 'Belum ada rekening',
            message: 'Tambahkan rekening agar pencairan bisa diproses admin.',
          )
        else
          for (var i = 0; i < _items.length; i++) ...[
            if (i > 0) const SizedBox(height: VendorSp.sm),
            _BankRow(item: _items[i], onCancel: () => _cancel(_items[i])),
          ],
        const SizedBox(height: VendorSp.xl),
        const VendorSectionTitle(label: 'Tambah rekening'),
        VendorCard(
          padding: const EdgeInsets.all(VendorSp.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DropdownButtonFormField<String>(
                initialValue: _bankCode,
                decoration: const InputDecoration(
                  labelText: 'Bank',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                items: [
                  for (final bank in vendorBanks)
                    DropdownMenuItem(value: bank.code, child: Text(bank.name)),
                ],
                onChanged: _saving
                    ? null
                    : (value) {
                        if (value != null) setState(() => _bankCode = value);
                      },
              ),
              const SizedBox(height: VendorSp.md),
              VendorTextField(
                label: 'Nomor rekening',
                controller: _number,
                hint: 'Contoh: 1234567890',
                keyboardType: TextInputType.number,
                enabled: !_saving,
                onChanged: (_) => setState(() => _formError = null),
              ),
              const SizedBox(height: VendorSp.md),
              VendorTextField(
                label: 'Nama pemilik rekening',
                controller: _holder,
                hint: 'Sesuai buku tabungan',
                enabled: !_saving,
                onChanged: (_) => setState(() => _formError = null),
              ),
              if (_formError != null) ...[
                const SizedBox(height: VendorSp.sm),
                Text(
                  _formError!,
                  style: vendorText(size: 12, color: VendorColors.danger),
                ),
              ],
              const SizedBox(height: VendorSp.md),
              VendorButton(
                label: _saving ? 'Menyimpan…' : 'Simpan rekening',
                expand: true,
                onPressed: _saving ? null : _save,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _BankRow extends StatelessWidget {
  const _BankRow({required this.item, required this.onCancel});

  final Map<String, dynamic> item;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final status = item['status']?.toString() ?? 'pending';
    final (label, tone) = switch (status) {
      'verified' => ('Terverifikasi', VendorPillTone.ok),
      'rejected' => ('Ditolak', VendorPillTone.no),
      _ => ('Menunggu verifikasi', VendorPillTone.wait),
    };
    final cooling = item['cooling_until']?.toString();
    final parts = vendorDateParts(cooling);

    return VendorCard(
      padding: const EdgeInsets.all(VendorSp.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${item['bank_name'] ?? item['bank_code'] ?? 'Bank'} · '
                      '${item['account_number_masked'] ?? '—'}',
                      style: vendorText(size: 13.5, weight: FontWeight.w700),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'a.n. ${item['account_holder_name'] ?? '—'}',
                      style: vendorText(size: 12, color: VendorColors.muted),
                    ),
                  ],
                ),
              ),
              VendorPill(label: label, tone: tone),
            ],
          ),
          if (status != 'verified' && cooling != null) ...[
            const SizedBox(height: 6),
            Text(
              'Masa tunggu sampai ${parts.dom} ${parts.mon}',
              style: vendorText(size: 11, color: VendorColors.muted),
            ),
          ],
          if (item['rejection_reason'] != null) ...[
            const SizedBox(height: 6),
            Text(
              item['rejection_reason'].toString(),
              style: vendorText(size: 11.5, color: VendorColors.danger),
            ),
          ],
          if (status == 'pending') ...[
            const SizedBox(height: VendorSp.sm),
            VendorButton(
              label: 'Batalkan',
              kind: VendorButtonKind.secondary,
              small: true,
              onPressed: onCancel,
            ),
          ],
        ],
      ),
    );
  }
}
