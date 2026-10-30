import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../booking/booking_support.dart';
import 'vendor_header.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

enum _OrderFilter { all, waiting, accepted, done, rejected }

const _filterLabels = <_OrderFilter, String>{
  _OrderFilter.all: 'Semua',
  _OrderFilter.waiting: 'Menunggu',
  _OrderFilter.accepted: 'Diterima',
  _OrderFilter.done: 'Selesai',
  _OrderFilter.rejected: 'Ditolak',
};

/// Vendor order list with status filters, matching OpenDesign "Semua Pesanan".
class VendorBookingsPage extends StatefulWidget {
  const VendorBookingsPage({super.key});

  @override
  State<VendorBookingsPage> createState() => _VendorBookingsPageState();
}

class _VendorBookingsPageState extends State<VendorBookingsPage> {
  bool _loading = true;
  String? _error;
  int _total = 0;
  List<Map<String, dynamic>> _items = [];
  _OrderFilter _filter = _OrderFilter.all;

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
        '/vendor/bookings',
        query: {'page': '1', 'page_size': '100'},
      );
      final payload = raw is Map ? raw.cast<String, dynamic>() : null;
      final itemsRaw = payload?['items'] is List
          ? payload!['items'] as List
          : const [];
      final items = itemsRaw
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList();

      if (!mounted) return;
      setState(() {
        _items = items;
        _total = (payload?['total'] as num?)?.toInt() ?? items.length;
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
        _error = 'Gagal memuat pesanan: $error';
      });
    }
  }

  List<Map<String, dynamic>> get _filtered {
    if (_filter == _OrderFilter.all) return _items;
    return _items.where((item) {
      final status = item['lifecycle_status']?.toString() ?? '';
      return _matches(_filter, status);
    }).toList();
  }

  bool _matches(_OrderFilter filter, String status) {
    switch (filter) {
      case _OrderFilter.all:
        return true;
      case _OrderFilter.waiting:
        return status == 'requested';
      case _OrderFilter.accepted:
        return status == 'accepted' ||
            status == 'confirmed' ||
            status == 'in_progress';
      case _OrderFilter.done:
        return status == 'completed';
      case _OrderFilter.rejected:
        return status == 'declined' ||
            status == 'rejected' ||
            status == 'cancelled' ||
            status == 'canceled' ||
            status == 'expired' ||
            status == 'no_show';
    }
  }

  Future<void> _openDetail(Map<String, dynamic> item) async {
    final id = item['id']?.toString() ?? '';
    if (id.isEmpty) return;
    await Navigator.pushNamed(
      context,
      Routes.vendorBookingDetail,
      arguments: id,
    );
    if (mounted) _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;
    return Scaffold(
      backgroundColor: VendorColors.canvas,
      appBar: VendorHeader(
        kicker: 'Antrean',
        title: 'Semua pesanan',
        showBack: true,
        trailing: VendorPill(label: '$_total total', tone: VendorPillTone.done),
      ),
      body: ColoredBox(
        color: VendorColors.canvas,
        child: _loading
            ? const VendorLoading(rows: 4)
            : _error != null
            ? VendorError(message: _error!, onRetry: _load)
            : ListView(
                padding: const EdgeInsets.fromLTRB(
                  VendorSp.lg,
                  14,
                  VendorSp.lg,
                  VendorSp.xl,
                ),
                children: [
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        for (final filter in _OrderFilter.values) ...[
                          _FilterChip(
                            label: _filterLabels[filter]!,
                            selected: _filter == filter,
                            onTap: () => setState(() => _filter = filter),
                          ),
                          if (filter != _OrderFilter.values.last)
                            const SizedBox(width: 6),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: VendorSp.md),
                  if (filtered.isEmpty)
                    VendorEmpty(
                      title: 'Tidak ada pesanan',
                      message:
                          'Belum ada pesanan dengan status '
                          '"${_filterLabels[_filter]}". Pilih "Semua" untuk '
                          'melihat seluruh antrean.',
                    )
                  else
                    for (var i = 0; i < filtered.length; i++) ...[
                      if (i > 0) const SizedBox(height: VendorSp.sm),
                      _OrderRow(
                        item: filtered[i],
                        onTap: () => _openDetail(filtered[i]),
                      ),
                    ],
                  if (_items.length < _total) ...[
                    const SizedBox(height: VendorSp.md),
                    Text(
                      'Menampilkan ${_items.length} pesanan terbaru dari '
                      '$_total.',
                      style: vendorText(size: 11, color: VendorColors.muted),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? VendorColors.ink : VendorColors.cardWhite,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: selected ? VendorColors.ink : const Color(0xFFD4D6D0),
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            height: 36,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 13),
              child: Center(
                child: Text(
                  label,
                  style: vendorText(
                    size: 11.5,
                    weight: FontWeight.w700,
                    color: selected
                        ? VendorColors.lime
                        : const Color(0xFF414C5C),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OrderRow extends StatelessWidget {
  const _OrderRow({required this.item, required this.onTap});

  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final parts = vendorDateParts(item['event_start_date']?.toString());
    final name = item['customer_name']?.toString() ?? 'Pelanggan';
    final title = item['event_title']?.toString() ?? 'Acara';
    final region = item['event_region_code']?.toString() ?? '';
    final status = item['lifecycle_status']?.toString() ?? '';
    final value = moneyValue(item, 'total_customer_idr') ?? 0;

    return VendorCard(
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              width: 52,
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: const BoxDecoration(
                color: VendorColors.softFill,
                border: Border(right: BorderSide(color: VendorColors.line)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    parts.dow.toUpperCase(),
                    style: vendorText(
                      size: 10.5,
                      weight: FontWeight.w700,
                      color: VendorColors.muted,
                      letterSpacing: 0.5,
                    ),
                  ),
                  Text(
                    parts.dom,
                    style: vendorText(
                      size: 21,
                      weight: FontWeight.w800,
                      letterSpacing: -0.5,
                    ),
                  ),
                  Text(
                    parts.mon.toUpperCase(),
                    style: vendorText(
                      size: 10.5,
                      weight: FontWeight.w600,
                      color: VendorColors.muted,
                      letterSpacing: 0.5,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: vendorText(
                                  size: 13.5,
                                  weight: FontWeight.w700,
                                  letterSpacing: -0.1,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                region.isEmpty ? title : '$region · $title',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: vendorText(
                                  size: 11,
                                  color: VendorColors.muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: VendorSp.sm),
                        VendorPill(
                          label: lifecycleText(status),
                          tone: vendorToneForStatus(status),
                        ),
                      ],
                    ),
                    const SizedBox(height: 7),
                    Text(
                      rupiahTight(value),
                      style: vendorText(size: 13, weight: FontWeight.w700),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
