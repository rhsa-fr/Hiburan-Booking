import 'package:flutter/material.dart';

import '../../app/app.dart';
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
  List<Map<String, dynamic>> _settled = [];

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

      if (!mounted) return;
      setState(() {
        _heldIdr = held;
        _monthIdr = monthIdr;
        _settledTotal = settledTotal ?? items.length;
        _settled = items;
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
          const VendorSectionTitle(label: 'Saldo Tertahan (Escrow PJP)'),
          Container(
            padding: const EdgeInsets.all(VendorSp.lg),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF1B2946), VendorColors.ink],
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
                  'DITAHAN PJP',
                  style: vendorText(
                    size: 10.5,
                    weight: FontWeight.w600,
                    color: Colors.white.withValues(alpha: 0.58),
                    letterSpacing: 1.4,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  rupiahTight(_heldIdr),
                  style: vendorText(
                    size: 27,
                    weight: FontWeight.w800,
                    color: VendorColors.lime,
                    letterSpacing: -1,
                    height: 1.05,
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
                          label: 'Omzet bulan ini',
                          value: rupiahTight(_monthIdr),
                        ),
                      ),
                      const SizedBox(width: VendorSp.md),
                      Expanded(
                        child: _HeroStat(
                          label: 'Transaksi cair',
                          value: '$_settledTotal',
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: VendorSp.sm),
          Text(
            'Dana pelanggan ditahan PJP berizin. Pencairan otomatis H+3 setelah '
            'acara selesai dan jendela sengketa 7 hari lewat.',
            style: vendorText(size: 11, color: VendorColors.muted, height: 1.5),
          ),
          VendorSectionTitle(
            label: 'Riwayat Pencairan',
            trailing: '$_settledTotal transaksi',
          ),
          if (_settled.isEmpty)
            const VendorEmpty(
              title: 'Belum ada riwayat pencairan',
              message:
                  'Dana akan muncul di sini setelah acara selesai dan '
                  'pencairan diproses.',
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
