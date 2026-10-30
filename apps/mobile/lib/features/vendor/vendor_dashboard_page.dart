import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../booking/booking_support.dart';
import 'vendor_booking_detail_page.dart';
import 'vendor_header.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// Vendor home: what needs an answer, this week's stage, and the money hold.
class VendorDashboardPage extends StatefulWidget {
  const VendorDashboardPage({
    super.key,
    this.onOpenBookings,
    this.onOpenEarnings,
  });

  final VoidCallback? onOpenBookings;
  final VoidCallback? onOpenEarnings;

  @override
  State<VendorDashboardPage> createState() => _VendorDashboardPageState();
}

class _VendorDashboardPageState extends State<VendorDashboardPage> {
  bool _loading = true;
  String? _error;
  bool _actionBusy = false;

  Map<String, dynamic>? _dashboard;
  List<Map<String, dynamic>> _bookings = [];
  int _heldIdr = 0;
  Map<String, dynamic>? _publicVendor;
  Availability? _availability;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  Map<String, dynamic>? get _vendorMap {
    final data = _dashboard;
    if (data == null) return null;
    final vendor = data['vendor'];
    return vendor is Map ? vendor.cast<String, dynamic>() : data;
  }

  Map<String, dynamic>? get _summaryMap {
    final data = _dashboard;
    if (data == null) return null;
    final summary = data['summary'];
    return summary is Map ? summary.cast<String, dynamic>() : data;
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
      final dashRaw = await api.get('/vendor/dashboard');
      final dash = dashRaw is Map
          ? dashRaw.cast<String, dynamic>()
          : <String, dynamic>{};

      final bookingsRaw = await api.get(
        '/vendor/bookings',
        query: {'page': '1', 'page_size': '50'},
      );
      final bookingsPayload = bookingsRaw is Map
          ? bookingsRaw.cast<String, dynamic>()
          : null;
      final itemsRaw = bookingsPayload?['items'] is List
          ? bookingsPayload!['items'] as List
          : const [];
      final items = itemsRaw
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList();
      items.sort((a, b) {
        final aWaiting = a['lifecycle_status'] == 'requested' ? 0 : 1;
        final bWaiting = b['lifecycle_status'] == 'requested' ? 0 : 1;
        if (aWaiting != bWaiting) return aWaiting.compareTo(bWaiting);
        final aCreated = a['created_at']?.toString() ?? '';
        final bCreated = b['created_at']?.toString() ?? '';
        return bCreated.compareTo(aCreated);
      });

      final vendor = dash['vendor'] is Map
          ? (dash['vendor'] as Map).cast<String, dynamic>()
          : dash;
      final slug = vendor['slug']?.toString();
      final vendorId = vendor['id']?.toString();
      final today = DateTime.now();
      final start = DateTime(today.year, today.month, today.day);

      final futures = <Future<dynamic>>[
        _quiet(
          () => api.get(
            '/vendor/earnings',
            query: {'page': '1', 'page_size': '5'},
          ),
        ),
      ];
      if (slug != null && slug.isNotEmpty) {
        futures.add(
          _quiet(() => api.get('/vendors/${Uri.encodeComponent(slug)}')),
        );
      }
      if (vendorId != null && vendorId.isNotEmpty) {
        futures.add(
          _quiet(
            () => api.get(
              '/vendors/$vendorId/availability',
              query: {
                'from': isoDate(start),
                'to': isoDate(start.add(const Duration(days: 6))),
              },
            ),
          ),
        );
      }

      final optional = await Future.wait(futures);
      var cursor = 0;
      final earningsRaw = optional[cursor++];
      final publicRaw = slug != null && slug.isNotEmpty
          ? optional[cursor++]
          : null;
      final availabilityRaw = vendorId != null && vendorId.isNotEmpty
          ? optional[cursor++]
          : null;

      final earnings = earningsRaw is Map
          ? earningsRaw.cast<String, dynamic>()
          : null;
      final held = earnings == null
          ? 0
          : moneyValue(earnings, 'held_idr') ??
                moneyValue(earnings, 'held_balance_idr') ??
                0;

      Availability? availability;
      if (availabilityRaw is Map) {
        try {
          availability = Availability.fromJson(
            availabilityRaw.cast<String, dynamic>(),
          );
        } catch (_) {
          availability = null;
        }
      }

      if (!mounted) return;
      setState(() {
        _dashboard = dash;
        _bookings = items;
        _heldIdr = held;
        _publicVendor = vendorPublicPayload(publicRaw);
        _availability = availability;
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
        _error = 'Gagal memuat dashboard: $error';
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

  Future<void> _acceptBooking(String bookingId) async {
    if (_actionBusy) return;
    final api = AppScope.of(context).api;
    setState(() => _actionBusy = true);

    try {
      await api.post('/bookings/$bookingId/accept', body: {});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pesanan berhasil diterima.')),
      );
      await _load(silent: true);
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gagal menerima pesanan: ${apiMessage(error)}')),
      );
    } finally {
      if (mounted) setState(() => _actionBusy = false);
    }
  }

  Future<void> _declineBooking(String bookingId, String code) async {
    if (_actionBusy) return;
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: VendorColors.cardWhite,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
      builder: (_) => VendorDeclineSheet(bookingCode: code),
    );
    if (result == null || !mounted) return;

    final api = AppScope.of(context).api;
    setState(() => _actionBusy = true);

    try {
      await api.post('/bookings/$bookingId/decline', body: result);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Pesanan telah ditolak.')));
      await _load(silent: true);
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gagal menolak pesanan: ${apiMessage(error)}')),
      );
    } finally {
      if (mounted) setState(() => _actionBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final vendor = _vendorMap;
    final summary = _summaryMap;
    final displayName = vendor?['display_name']?.toString() ?? 'Portal Vendor';
    final pending =
        (summary?['pending_count'] as num?)?.toInt() ??
        _bookings
            .where((item) => item['lifecycle_status'] == 'requested')
            .length;
    final total =
        (summary?['total_bookings'] as num?)?.toInt() ?? _bookings.length;
    final monthCount = (summary?['this_month_count'] as num?)?.toInt() ?? 0;
    final monthIdr = moneyValue(summary ?? const {}, 'this_month_idr') ?? 0;
    final now = DateTime.now();

    final category = _publicVendor?['category_name']?.toString().trim() ?? '';

    return Scaffold(
      backgroundColor: VendorColors.canvas,
      appBar: VendorHeader(
        kicker: category.isEmpty ? null : category,
        title: displayName,
        subtitle: 'Mode Vendor · Tarlink',
        mark: vendorInitials(displayName),
        money: VendorMoneyStrip(
          label: 'Ditahan PJP',
          value: rupiahTight(_heldIdr),
          rightTop: 'Omzet ${vendorMonthName(now.month)}',
          rightBottom: '$monthCount pesanan',
        ),
      ),
      body: ColoredBox(
        color: VendorColors.canvas,
        child: Stack(
          children: [
            Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(
                  painter: VendorDotGridPainter(
                    color: VendorColors.ink.withValues(alpha: 0.05),
                    spacing: 22,
                  ),
                ),
              ),
            ),
            if (_loading)
              const VendorLoading(rows: 4)
            else if (_error != null)
              VendorError(message: _error!, onRetry: () => _load())
            else
              RefreshIndicator(
                color: VendorColors.limeDark,
                onRefresh: () => _load(silent: true),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(
                    VendorSp.lg,
                    0,
                    VendorSp.lg,
                    VendorSp.xl,
                  ),
                  children: [
                    _lead(pending),
                    VendorCard(
                      padding: EdgeInsets.zero,
                      child: IntrinsicHeight(
                        child: Row(
                          children: [
                            Expanded(
                              child: VendorStatCell(
                                value: '$total',
                                label: 'Total Pesanan',
                              ),
                            ),
                            Expanded(
                              child: VendorStatCell(
                                value: '$pending',
                                label: 'Menunggu',
                              ),
                            ),
                            Expanded(
                              child: VendorStatCell(
                                value: '$monthCount',
                                label: 'Bulan Ini',
                                showDivider: false,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    VendorSectionTitle(
                      label: 'Antrean Booking',
                      trailing: '${_bookings.length} pesanan',
                    ),
                    _queue(),
                    if (widget.onOpenBookings != null ||
                        widget.onOpenEarnings != null) ...[
                      const SizedBox(height: VendorSp.sm),
                      Row(
                        children: [
                          if (widget.onOpenBookings != null)
                            Expanded(
                              child: VendorButton(
                                label: 'Semua pesanan',
                                icon: Icons.receipt_long_outlined,
                                kind: VendorButtonKind.secondary,
                                onPressed: widget.onOpenBookings,
                              ),
                            ),
                          if (widget.onOpenBookings != null &&
                              widget.onOpenEarnings != null)
                            const SizedBox(width: VendorSp.sm),
                          if (widget.onOpenEarnings != null)
                            Expanded(
                              child: VendorButton(
                                label: 'Lihat saldo',
                                icon: Icons.account_balance_wallet_outlined,
                                kind: VendorButtonKind.secondary,
                                onPressed: widget.onOpenEarnings,
                              ),
                            ),
                        ],
                      ),
                    ],
                    const VendorSectionTitle(label: 'Jadwal 7 hari'),
                    _weekCard(),
                    const VendorSectionTitle(label: 'Uang'),
                    _moneyPanel(monthIdr),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _lead(int pending) {
    return Padding(
      padding: const EdgeInsets.only(top: 18, bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Perlu jawaban',
            style: vendorText(
              size: 25,
              weight: FontWeight.w800,
              letterSpacing: -0.8,
              height: 1.08,
            ),
          ),
          const SizedBox(height: 7),
          Text.rich(
            TextSpan(
              style: vendorText(
                size: 12.5,
                color: VendorColors.muted,
                height: 1.5,
              ),
              children: [
                if (pending > 0) ...[
                  TextSpan(
                    text: '$pending',
                    style: vendorText(
                      size: 12.5,
                      weight: FontWeight.w800,
                      color: VendorColors.ink,
                    ),
                  ),
                  const TextSpan(
                    text:
                        ' pesanan menunggu. Batas 24 jam sejak DP masuk, '
                        'lewat dari itu batal otomatis.',
                  ),
                ] else
                  const TextSpan(
                    text:
                        'Tidak ada pesanan menunggu jawaban. Antrean baru '
                        'akan muncul di sini.',
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _queue() {
    final waiting = _bookings
        .where((item) => item['lifecycle_status'] == 'requested')
        .take(5)
        .toList();
    if (waiting.isEmpty) {
      return const VendorEmpty(
        title: 'Belum ada antrean booking',
        message:
            'Pesanan baru muncul setelah pelanggan mengirim permintaan dan '
            'DP masuk.',
      );
    }
    return Column(
      children: [
        for (var i = 0; i < waiting.length; i++) ...[
          if (i > 0) const SizedBox(height: VendorSp.sm),
          _JobCard(
            item: waiting[i],
            busy: _actionBusy,
            onTap: () => _openDetail(waiting[i]),
            onAccept: () {
              final id = waiting[i]['id']?.toString() ?? '';
              if (id.isNotEmpty) _acceptBooking(id);
            },
            onDecline: () {
              final id = waiting[i]['id']?.toString() ?? '';
              final code =
                  waiting[i]['code']?.toString() ?? (id.isEmpty ? '-' : id);
              if (id.isNotEmpty) _declineBooking(id, code);
            },
          ),
        ],
      ],
    );
  }

  Future<void> _openDetail(Map<String, dynamic> item) async {
    final bookingId = item['id']?.toString() ?? '';
    if (bookingId.isEmpty) return;
    await Navigator.pushNamed(
      context,
      Routes.vendorBookingDetail,
      arguments: bookingId,
    );
    if (mounted) _load(silent: true);
  }

  Widget _weekCard() {
    final availability = _availability;
    if (availability == null || availability.days.isEmpty) {
      return const VendorEmpty(
        title: 'Jadwal belum tersedia',
        message: 'Kalender vendor belum diisi untuk 7 hari ke depan.',
      );
    }

    final today = DateTime.now();
    final start = DateTime(today.year, today.month, today.day);
    final dates = <DateTime>[
      for (var i = 0; i < 7; i++) start.add(Duration(days: i)),
    ];
    final states = <String, Map<String, String>>{};
    for (final day in availability.days) {
      states.putIfAbsent(day.date, () => <String, String>{})[day.session] =
          day.state;
    }

    return VendorCard(
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 10),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final date in dates)
                Expanded(
                  child: _WeekCell(
                    date: date,
                    dayState: states[isoDate(date)]?['day'],
                    nightState: states[isoDate(date)]?['night'],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 9),
          Container(
            padding: const EdgeInsets.only(top: 7),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: VendorColors.lineSoft)),
            ),
            child: const Wrap(
              spacing: 12,
              runSpacing: 4,
              children: [
                _WeekLegend(color: VendorColors.ink, label: 'Terisi'),
                _WeekLegend(color: VendorColors.limeDark, label: 'Tersedia'),
                _WeekLegend(color: VendorColors.amber, label: 'Ditahan'),
                _WeekLegend(color: VendorColors.line, label: 'Kosong'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _moneyPanel(int monthIdr) {
    return VendorCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Potensi Penghasilan Bulan Ini',
            style: vendorText(size: 12, color: VendorColors.muted),
          ),
          const SizedBox(height: 4),
          Text(
            rupiahTight(monthIdr),
            style: vendorText(
              size: 22,
              weight: FontWeight.w800,
              letterSpacing: -0.7,
            ),
          ),
          const SizedBox(height: VendorSp.sm),
          const Divider(height: 1, color: VendorColors.lineSoft),
          VendorLedgerRow(
            label: 'Saldo tertahan (PJP)',
            value: rupiahTight(_heldIdr),
          ),
          const SizedBox(height: VendorSp.sm),
          Text(
            'Dana pelanggan ditahan PJP berizin. Pencairan H+3 setelah acara '
            'selesai dan jendela sengketa tutup.',
            style: vendorText(size: 11, color: VendorColors.muted, height: 1.5),
          ),
        ],
      ),
    );
  }
}

class _JobCard extends StatelessWidget {
  const _JobCard({
    required this.item,
    required this.busy,
    required this.onTap,
    required this.onAccept,
    required this.onDecline,
  });

  final Map<String, dynamic> item;
  final bool busy;
  final VoidCallback onTap;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  @override
  Widget build(BuildContext context) {
    final parts = vendorDateParts(item['event_start_date']?.toString());
    final code = item['code']?.toString() ?? '';
    final customer = item['customer_name']?.toString() ?? 'Pelanggan';
    final region = item['event_region_code']?.toString() ?? '';
    final title = item['event_title']?.toString() ?? 'Acara';
    final value = moneyValue(item, 'total_customer_idr') ?? 0;
    final deadline = DateTime.tryParse(
      item['respond_deadline']?.toString() ?? '',
    );
    final remaining = deadline?.difference(DateTime.now());
    final expired = remaining?.isNegative ?? false;
    final timer = deadline == null
        ? null
        : expired
        ? 'Batas respons lewat'
        : _remainingText(remaining!);
    final calm = remaining != null && remaining.inHours > 12;

    return VendorCard(
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          IntrinsicHeight(
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
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (code.isNotEmpty) ...[
                          Text(
                            code,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: vendorText(
                              size: 10.5,
                              weight: FontWeight.w700,
                              color: VendorColors.muted,
                              letterSpacing: 0.2,
                            ),
                          ),
                          const SizedBox(height: 2),
                        ],
                        Text(
                          customer,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: vendorText(
                            size: 14,
                            weight: FontWeight.w700,
                            letterSpacing: -0.15,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          region.isEmpty ? title : '$region · $title',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: vendorText(
                            size: 11.5,
                            color: VendorColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
            decoration: const BoxDecoration(
              color: VendorColors.softRow,
              border: Border(top: BorderSide(color: VendorColors.lineSoft)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        rupiahTight(value),
                        style: vendorText(
                          size: 14,
                          weight: FontWeight.w700,
                          letterSpacing: -0.2,
                        ),
                      ),
                      if (timer != null) ...[
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            Container(
                              width: 4,
                              height: 4,
                              decoration: BoxDecoration(
                                color: expired
                                    ? VendorColors.amber
                                    : calm
                                    ? VendorColors.mutedSoft
                                    : VendorColors.amber,
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                timer,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: vendorText(
                                  size: 11,
                                  weight: FontWeight.w700,
                                  color: expired
                                      ? VendorColors.amber
                                      : calm
                                      ? VendorColors.muted
                                      : VendorColors.amber,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: VendorSp.sm),
                Row(
                  children: [
                    VendorButton(
                      label: 'Tolak',
                      kind: VendorButtonKind.secondary,
                      small: true,
                      onPressed: busy ? null : onDecline,
                    ),
                    const SizedBox(width: 5),
                    VendorButton(
                      label: 'Terima',
                      small: true,
                      onPressed: busy ? null : onAccept,
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

  String _remainingText(Duration remaining) {
    if (remaining.inDays > 0) {
      return 'sisa ${remaining.inDays} hari ${remaining.inHours % 24} jam';
    }
    if (remaining.inHours > 0) {
      return 'sisa ${remaining.inHours} jam ${remaining.inMinutes % 60} menit';
    }
    return 'sisa ${remaining.inMinutes} menit';
  }
}

class _WeekCell extends StatelessWidget {
  const _WeekCell({
    required this.date,
    required this.dayState,
    required this.nightState,
  });

  final DateTime date;
  final String? dayState;
  final String? nightState;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          vendorWeekdayShort(date.weekday).toUpperCase(),
          maxLines: 1,
          style: vendorText(
            size: 10.5,
            weight: FontWeight.w700,
            color: VendorColors.muted,
            letterSpacing: 0.4,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          '${date.day}',
          maxLines: 1,
          style: vendorText(size: 13, weight: FontWeight.w700),
        ),
        const SizedBox(height: 5),
        _SlotBar(state: dayState),
        const SizedBox(height: 3),
        _SlotBar(state: nightState),
      ],
    );
  }
}

class _SlotBar extends StatelessWidget {
  const _SlotBar({required this.state});

  final String? state;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 6,
      width: double.infinity,
      decoration: BoxDecoration(
        color: _slotColor(state),
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }
}

Color _slotColor(String? state) => switch (state) {
  'available' => VendorColors.limeDark,
  'held' => VendorColors.amber,
  'booked' => VendorColors.ink,
  _ => VendorColors.line,
};

class _WeekLegend extends StatelessWidget {
  const _WeekLegend({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 4,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(1),
          ),
        ),
        const SizedBox(width: 4),
        Text(label, style: vendorHint),
      ],
    );
  }
}
