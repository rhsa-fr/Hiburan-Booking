import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../booking/booking_support.dart';
import 'vendor_header.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// Vendor balance and disbursement history, styled after OpenDesign "Saldo".
class VendorEarningsPage extends StatefulWidget {
  const VendorEarningsPage({super.key});

  @override
  State<VendorEarningsPage> createState() => _VendorEarningsPageState();
}

class _VendorEarningsPageState extends State<VendorEarningsPage> {
  bool _loading = true;
  String? _error;
  int _heldIdr = 0;
  int _monthIdr = 0;
  int _settledTotal = 0;
  int _availableIdr = 0;
  int _pendingPayoutIdr = 0;
  Map<String, dynamic>? _bankAccount;
  List<Map<String, dynamic>> _payouts = [];
  List<Map<String, dynamic>> _settled = [];
  bool _exporting = false;

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
      final raw = await api.get(
        '/vendor/earnings',
        query: {'page': '1', 'page_size': '20'},
      );
      final payload = raw is Map
          ? raw.cast<String, dynamic>()
          : <String, dynamic>{};
      final held =
          moneyValue(payload, 'held_idr') ??
          moneyValue(payload, 'held_balance_idr') ??
          0;

      final settledRaw = payload['settled'];
      final itemsRaw = settledRaw is Map && settledRaw['items'] is List
          ? settledRaw['items'] as List
          : payload['items'] is List
          ? payload['items'] as List
          : const [];
      final items = itemsRaw
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList();
      final settledTotal = settledRaw is Map
          ? (settledRaw['total'] as num?)?.toInt()
          : null;

      final dashboardRaw = await _quiet(() => api.get('/vendor/dashboard'));
      final dashboard = dashboardRaw is Map
          ? dashboardRaw.cast<String, dynamic>()
          : null;
      final summary = dashboard?['summary'] is Map
          ? (dashboard!['summary'] as Map).cast<String, dynamic>()
          : dashboard;
      final monthIdr = moneyValue(summary ?? const {}, 'this_month_idr') ?? 0;

      final availableIdr = moneyValue(payload, 'available_idr') ?? 0;
      final pendingPayoutIdr = moneyValue(payload, 'pending_payout_idr') ?? 0;
      final bankRaw = payload['bank_account'];
      final bank = bankRaw is Map ? bankRaw.cast<String, dynamic>() : null;

      final payoutsRaw = await _quiet(
        () => api.get('/vendor/payouts', query: {'page': '1', 'page_size': '10'}),
      );
      final payoutsPayload = payoutsRaw is Map
          ? payoutsRaw.cast<String, dynamic>()
          : const <String, dynamic>{};
      final payoutItemsRaw = payoutsPayload['items'] is List
          ? payoutsPayload['items'] as List
          : const [];
      final payouts = payoutItemsRaw
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList();

      if (!mounted) return;
      setState(() {
        _heldIdr = held;
        _monthIdr = monthIdr;
        _settledTotal = settledTotal ?? items.length;
        _settled = items;
        _availableIdr = availableIdr;
        _pendingPayoutIdr = pendingPayoutIdr;
        _bankAccount = bank;
        _payouts = payouts;
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
        _error = 'Gagal memuat saldo: $error';
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

  Future<void> _openBankAccounts() async {
    await Navigator.of(context).pushNamed(Routes.vendorBankAccount);
    if (mounted) await _load(silent: true);
  }

  /// FR-126: monthly CSV whose totals come from the release ledger entries.
  /// The response is rendered as a preview because the mobile app has no file
  /// chooser dependency; "Salin CSV" puts the exact bytes on the clipboard.
  Future<void> _exportCsv() async {
    if (_exporting) return;

    setState(() => _exporting = true);
    try {
      final raw = await AppScope.of(context).api.get(
        '/vendor/earnings/export',
        query: {'format': 'json'},
      );
      final payload = raw is Map
          ? raw.cast<String, dynamic>()
          : <String, dynamic>{};
      if (!mounted) return;

      final copied = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        backgroundColor: VendorColors.cardWhite,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
        ),
        builder: (_) => _EarningsExportSheet(payload: payload),
      );
      if (copied == true && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('CSV disalin ke papan klip.')),
        );
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(apiMessage(error))));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Gagal menyiapkan ekspor: $error')));
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VendorColors.canvas,
      appBar: const VendorHeader(
        kicker: 'Uang',
        title: 'Saldo & Laporan',
        subtitle: 'Mode Vendor · Tarlink',
      ),
      body: ColoredBox(
        color: VendorColors.canvas,
        child: _loading
            ? const VendorLoading(rows: 3)
            : _error != null
            ? VendorError(message: _error!, onRetry: _load)
            : _content(),
      ),
    );
  }

  Widget _content() {
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
          Container(
            padding: const EdgeInsets.all(VendorSp.lg),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [VendorColors.headerTop, VendorColors.stage],
              ),
              borderRadius: BorderRadius.circular(VendorRadii.md),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x8C0B1220),
                  blurRadius: 26,
                  offset: Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'BISA DICAIRKAN',
                  style: vendorText(
                    size: 10.5,
                    weight: FontWeight.w700,
                    color: Colors.white.withValues(alpha: 0.62),
                    letterSpacing: 1.3,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  rupiahTight(_availableIdr),
                  style: vendorText(
                    size: 30,
                    weight: FontWeight.w800,
                    color: VendorColors.lime,
                    letterSpacing: -1,
                    height: 1.05,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  'Saldo yang sudah bisa kamu cairkan.',
                  style: vendorText(
                    size: 11.5,
                    color: Colors.white.withValues(alpha: 0.56),
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.only(top: 11),
                  decoration: BoxDecoration(
                    border: Border(
                      top: BorderSide(
                        color: Colors.white.withValues(alpha: 0.13),
                      ),
                    ),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: _HeroStat(
                          label: 'Ditahan PJP',
                          value: rupiahTight(_heldIdr),
                        ),
                      ),
                      const SizedBox(width: VendorSp.md),
                      Expanded(
                        child: _HeroStat(
                          label: 'Omzet bulan ini',
                          value: rupiahTight(_monthIdr),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: VendorSp.md),
          const _PayoutSteps(),
          const SizedBox(height: VendorSp.md),
          VendorCard(
            padding: const EdgeInsets.all(VendorSp.md),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'SEDANG DIPROSES',
                        style: vendorText(
                          size: 9.5,
                          weight: FontWeight.w700,
                          color: VendorColors.muted,
                          letterSpacing: 0.9,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        _pendingPayoutIdr > 0
                            ? rupiahTight(_pendingPayoutIdr)
                            : 'Belum ada',
                        style: vendorText(
                          size: 16,
                          weight: FontWeight.w800,
                          color: _pendingPayoutIdr > 0
                              ? VendorColors.ink
                              : VendorColors.mutedSoft,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: VendorSp.md),
                Icon(
                  Icons.schedule_rounded,
                  size: 22,
                  color: VendorColors.amber,
                ),
              ],
            ),
          ),
          const SizedBox(height: VendorSp.md),
          VendorCard(
            padding: const EdgeInsets.all(VendorSp.md),
            child: Row(
              children: [
                Icon(
                  Icons.account_balance_outlined,
                  size: 20,
                  color: _bankAccount == null
                      ? VendorColors.amber
                      : VendorColors.green,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _bankAccount == null
                            ? 'Rekening belum diisi'
                            : 'Rekening pencairan',
                        style: vendorText(
                          size: 12.5,
                          weight: FontWeight.w700,
                          color: _bankAccount == null
                              ? VendorColors.amber
                              : VendorColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _bankAccount == null
                            ? 'Isi rekening supaya dana bisa ditransfer.'
                            : '${_bankAccount!['bank_name'] ?? 'Bank'} · '
                                  '${_bankAccount!['account_number_masked'] ?? '—'}',
                        style: vendorText(
                          size: 11,
                          color: VendorColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: VendorSp.sm),
                VendorButton(
                  label: 'Kelola',
                  kind: VendorButtonKind.secondary,
                  small: true,
                  onPressed: _openBankAccounts,
                ),
              ],
            ),
          ),
          const SizedBox(height: VendorSp.lg),
          VendorSectionTitle(
            label: 'Riwayat pencairan',
            trailing: '$_settledTotal transaksi',
          ),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Dana yang sudah dilepas ke saldo.',
                  style: vendorText(size: 11.5, color: VendorColors.muted),
                ),
              ),
              VendorButton(
                label: _exporting ? 'Menyiapkan…' : 'Ekspor CSV',
                icon: Icons.file_download_outlined,
                kind: VendorButtonKind.secondary,
                small: true,
                onPressed: _exporting ? null : _exportCsv,
              ),
            ],
          ),
          const SizedBox(height: VendorSp.sm),
          if (_settled.isEmpty)
            const VendorEmpty(
              title: 'Belum ada riwayat pencairan',
              message:
                  'Dana muncul di sini setelah acara selesai dan pencairan '
                  'diproses.',
            )
          else
            for (var i = 0; i < _settled.length; i++) ...[
              if (i > 0) const SizedBox(height: VendorSp.sm),
              _SettledRow(item: _settled[i]),
            ],
          if (_settled.length < _settledTotal) ...[
            const SizedBox(height: VendorSp.sm),
            Text(
              'Menampilkan ${_settled.length} pencairan terbaru dari '
              '$_settledTotal.',
              style: vendorText(size: 11, color: VendorColors.muted),
            ),
          ],
          const SizedBox(height: VendorSp.lg),
          VendorSectionTitle(
            label: 'Transfer ke rekening',
            trailing: _payouts.isEmpty ? null : '${_payouts.length} terbaru',
          ),
          if (_payouts.isEmpty)
            const VendorEmpty(
              title: 'Belum ada transfer',
              message:
                  'Transfer muncul setelah admin membuat dan menyetujui payout.',
            )
          else
            for (var i = 0; i < _payouts.length; i++) ...[
              if (i > 0) const SizedBox(height: VendorSp.sm),
              _PayoutRow(item: _payouts[i]),
            ],
        ],
      ),
    );
  }
}

/// Three plain-language steps that explain the escrow without a paragraph.
class _PayoutSteps extends StatelessWidget {
  const _PayoutSteps();

  @override
  Widget build(BuildContext context) {
    const steps = ['Acara selesai', 'Masa sengketa', 'Dana cair'];
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: VendorSp.md,
        vertical: 10,
      ),
      decoration: BoxDecoration(
        color: VendorColors.card,
        borderRadius: BorderRadius.circular(VendorRadii.md),
        border: Border.all(color: VendorColors.lineSoft),
      ),
      child: Row(
        children: [
          for (var i = 0; i < steps.length; i++) ...[
            if (i > 0)
              Icon(
                Icons.chevron_right_rounded,
                size: 15,
                color: VendorColors.mutedSoft,
              ),
            Expanded(
              child: Row(
                children: [
                  Container(
                    width: 20,
                    height: 20,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: VendorColors.limeSoft,
                      shape: BoxShape.circle,
                      border: Border.all(color: VendorColors.limeDark),
                    ),
                    child: Text(
                      '${i + 1}',
                      style: vendorText(
                        size: 10,
                        weight: FontWeight.w800,
                        height: 1,
                      ),
                    ),
                  ),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      steps[i],
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: vendorText(
                        size: 10.5,
                        weight: FontWeight.w700,
                        height: 1.2,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

(String, VendorPillTone) _payoutStatus(String status) {
  switch (status) {
    case 'paid':
      return ('Cair', VendorPillTone.ok);
    case 'failed':
      return ('Gagal', VendorPillTone.no);
    case 'rejected':
      return ('Ditolak', VendorPillTone.no);
    case 'cancelled':
      return ('Dibatalkan', VendorPillTone.no);
    case 'processing':
      return ('Diproses', VendorPillTone.wait);
    case 'approved':
      return ('Disetujui', VendorPillTone.wait);
    default:
      return ('Menunggu', VendorPillTone.wait);
  }
}

class _PayoutRow extends StatelessWidget {
  const _PayoutRow({required this.item});

  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final status = item['status']?.toString() ?? 'requested';
    final (label, tone) = _payoutStatus(status);
    final amount = moneyValue(item, 'amount_idr') ?? 0;
    final bankRaw = item['bank'];
    final bank = bankRaw is Map
        ? bankRaw.cast<String, dynamic>()
        : const <String, dynamic>{};
    final parts = vendorDateParts(
      item['paid_at']?.toString() ?? item['created_at']?.toString(),
    );

    return VendorCard(
      padding: const EdgeInsets.all(VendorSp.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            padding: const EdgeInsets.only(top: 1),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  parts.dom,
                  style: vendorText(size: 12.5, weight: FontWeight.w700),
                ),
                Text(
                  parts.mon.toUpperCase(),
                  style: vendorText(size: 10.5, color: VendorColors.muted),
                ),
              ],
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item['code']?.toString() ?? '-',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: vendorText(
                    size: 11,
                    weight: FontWeight.w700,
                    color: VendorColors.muted,
                    letterSpacing: 0.2,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${bank['bank_name'] ?? 'Bank'} · '
                  '${bank['account_number_masked'] ?? '—'}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: vendorText(size: 12.5, height: 1.3),
                ),
                if (item['failure_reason'] != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    item['failure_reason'].toString(),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: vendorText(size: 11, color: VendorColors.danger),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: VendorSp.sm),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                rupiahTight(amount),
                style: vendorText(
                  size: 13,
                  weight: FontWeight.w700,
                  color: status == 'paid'
                      ? VendorColors.green
                      : VendorColors.ink,
                ),
              ),
              const SizedBox(height: 4),
              VendorPill(label: label, tone: tone),
            ],
          ),
        ],
      ),
    );
  }
}

class _HeroStat extends StatelessWidget {
  const _HeroStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: vendorText(
            size: 10,
            weight: FontWeight.w600,
            color: Colors.white.withValues(alpha: 0.56),
            letterSpacing: 0.8,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: vendorText(
            size: 12,
            weight: FontWeight.w700,
            color: Colors.white,
          ),
        ),
      ],
    );
  }
}

class _SettledRow extends StatelessWidget {
  const _SettledRow({required this.item});

  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final code = item['code']?.toString() ?? '-';
    final title = item['event_title']?.toString() ?? 'Acara';
    final amount = moneyValue(item, 'vendor_entitlement_idr') ?? 0;
    final releasedAt =
        item['released_at']?.toString() ?? item['created_at']?.toString();
    final parts = vendorDateParts(releasedAt);

    return VendorCard(
      padding: const EdgeInsets.all(VendorSp.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            padding: const EdgeInsets.only(top: 1),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  parts.dom,
                  style: vendorText(size: 12.5, weight: FontWeight.w700),
                ),
                Text(
                  parts.mon.toUpperCase(),
                  style: vendorText(size: 10.5, color: VendorColors.muted),
                ),
              ],
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  code,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: vendorText(
                    size: 11,
                    weight: FontWeight.w700,
                    color: VendorColors.muted,
                    letterSpacing: 0.2,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: vendorText(
                    size: 13.5,
                    weight: FontWeight.w700,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: VendorSp.sm),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '+${rupiahTight(amount)}',
                style: vendorText(
                  size: 13,
                  weight: FontWeight.w700,
                  color: VendorColors.green,
                ),
              ),
              const SizedBox(height: 4),
              const VendorPill(label: 'Cair', tone: VendorPillTone.ok),
            ],
          ),
        ],
      ),
    );
  }
}

/// FR-126 preview. Shows the totals from the ledger and lets the vendor copy
/// the exact CSV bytes (no file-picker dependency in the mobile allowlist).
class _EarningsExportSheet extends StatelessWidget {
  const _EarningsExportSheet({required this.payload});

  final Map<String, dynamic> payload;

  static int _amount(Map<String, dynamic> source, String key) {
    final value = source[key];
    return value is num ? value.toInt() : 0;
  }

  @override
  Widget build(BuildContext context) {
    final period = payload['period'] is Map
        ? (payload['period'] as Map).cast<String, dynamic>()
        : const <String, dynamic>{};
    final totals = payload['totals'] is Map
        ? (payload['totals'] as Map).cast<String, dynamic>()
        : const <String, dynamic>{};
    final rowCount = _amount(payload, 'row_count');
    final csv = payload['csv']?.toString() ?? '';
    final filename =
        payload['filename']?.toString() ?? 'pendapatan-vendor.csv';
    final clawback = _amount(totals, 'clawback_idr');

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          VendorSp.lg,
          VendorSp.sm,
          VendorSp.lg,
          VendorSp.lg + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Laporan pendapatan',
                      style: vendorText(size: 18, weight: FontWeight.w800),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context, false),
                    icon: const Icon(Icons.close_rounded, size: 20),
                    color: VendorColors.muted,
                    tooltip: 'Tutup',
                  ),
                ],
              ),
              Text(
                '${period['from'] ?? '-'} – ${period['to'] ?? '-'} · '
                '$rowCount transaksi',
                style: vendorText(size: 11.5, color: VendorColors.muted),
              ),
              const SizedBox(height: VendorSp.md),
              _ExportAmountRow(
                'GMV (nilai transaksi)',
                _amount(totals, 'gmv_idr'),
              ),
              _ExportAmountRow(
                'Komisi platform',
                _amount(totals, 'commission_idr'),
              ),
              _ExportAmountRow(
                'Biaya layanan',
                _amount(totals, 'service_fee_idr'),
              ),
              _ExportAmountRow(
                'Pendapatan vendor',
                _amount(totals, 'vendor_entitlement_idr'),
              ),
              if (clawback > 0)
                _ExportAmountRow('Clawback', clawback),
              Divider(height: VendorSp.lg, color: VendorColors.lineSoft),
              _ExportAmountRow(
                'Pendapatan bersih',
                _amount(totals, 'net_vendor_idr'),
                strong: true,
              ),
              _ExportAmountRow(
                'Pencairan tercatat',
                _amount(totals, 'payout_idr'),
              ),
              const SizedBox(height: VendorSp.md),
              Text(
                'Kolom uang berasal dari jurnal release (GMV, komisi, biaya '
                'layanan, pendapatan vendor); clawback dari jurnal '
                'clawback_recognized. Baris TOTAL adalah penjumlahan baris '
                'yang sama, jadi selisihnya Rp0 terhadap ledger.',
                style: vendorText(
                  size: 11,
                  color: VendorColors.muted,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                filename,
                style: vendorText(size: 10.5, color: VendorColors.mutedSoft),
              ),
              const SizedBox(height: VendorSp.md),
              SizedBox(
                width: double.infinity,
                child: VendorButton(
                  label: 'Salin CSV',
                  icon: Icons.copy_all_rounded,
                  onPressed: csv.isEmpty
                      ? null
                      : () async {
                          await Clipboard.setData(ClipboardData(text: csv));
                          if (context.mounted) Navigator.pop(context, true);
                        },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ExportAmountRow extends StatelessWidget {
  const _ExportAmountRow(this.label, this.amount, {this.strong = false});

  final String label;
  final int amount;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: vendorText(
                size: 12.5,
                weight: strong ? FontWeight.w700 : FontWeight.w400,
                color: strong ? VendorColors.ink : VendorColors.muted,
              ),
            ),
          ),
          const SizedBox(width: VendorSp.sm),
          Text(
            rupiahTight(amount),
            style: vendorText(
              size: strong ? 14 : 12.5,
              weight: strong ? FontWeight.w800 : FontWeight.w700,
              color: VendorColors.ink,
            ),
          ),
        ],
      ),
    );
  }
}
