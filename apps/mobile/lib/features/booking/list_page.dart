import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/models.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';
import 'booking_support.dart';

enum _BookingFilter {
  all('Semua'),
  active('Aktif'),
  done('Selesai');

  const _BookingFilter(this.label);

  final String label;
}

/// Booking tab body, embedded by `AppShell`: no Scaffold, no bottom nav.
/// The status segmented control filters the pages already loaded, because the
/// list endpoint only understands one lifecycle value at a time.
class BookingListPage extends StatefulWidget {
  const BookingListPage({super.key, this.onBrowse});

  /// Optional way out of an empty list: the shell passes its Jelajah tab.
  final VoidCallback? onBrowse;

  @override
  State<BookingListPage> createState() => _BookingListPageState();
}

class _BookingListPageState extends State<BookingListPage> {
  static const _pageSize = 20;

  _BookingFilter _filter = _BookingFilter.all;
  final List<BookingSummary> _items = [];

  bool _loading = true;
  bool _loadingMore = false;
  bool _fetching = false;
  String? _error;
  String? _moreError;
  int _nextPage = 1;
  int _total = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load(reset: true);
    });
  }

  List<BookingSummary> get _visible => switch (_filter) {
    _BookingFilter.all => _items,
    _BookingFilter.active =>
      _items
          .where((booking) => !isTerminalLifecycle(booking.lifecycleStatus))
          .toList(growable: false),
    _BookingFilter.done =>
      _items
          .where((booking) => isTerminalLifecycle(booking.lifecycleStatus))
          .toList(growable: false),
  };

  Future<void> _load({required bool reset}) async {
    if (_fetching) return;
    _fetching = true;
    if (reset) {
      _nextPage = 1;
      _moreError = null;
    } else {
      if (_loadingMore) {
        _fetching = false;
        return;
      }
      setState(() => _loadingMore = true);
    }
    if (!mounted) {
      _fetching = false;
      return;
    }
    try {
      final raw = await AppScope.of(context).api.get(
        '/bookings',
        query: {'page': '$_nextPage', 'page_size': '$_pageSize'},
      );
      final page = PageResult.fromJson(
        raw is Map ? raw.cast<String, dynamic>() : const {},
        BookingSummary.fromJson,
      );
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(page.items);
        _total = page.total;
        _nextPage = page.page + 1;
        _loading = false;
        _loadingMore = false;
        _error = null;
        _moreError = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      final message = apiMessage(error);
      setState(() {
        _loading = false;
        _loadingMore = false;
        if (_items.isEmpty) {
          _error = message;
        } else {
          _moreError = message;
        }
      });
    } finally {
      _fetching = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const StageHeader(
          title: 'Booking Saya',
          subtitle: 'Transaksi, jadwal, dan pembayaran',
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, Sp.md),
          child: SegmentBar(
            items: [for (final filter in _BookingFilter.values) filter.label],
            index: _filter.index,
            onChanged: (index) =>
                setState(() => _filter = _BookingFilter.values[index]),
          ),
        ),
        Expanded(child: _content()),
      ],
    );
  }

  Widget _content() {
    final visible = _visible;

    if (_loading && _items.isEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, Sp.xl),
        children: const [AppLoading(rows: 3, label: 'Memuat booking')],
      );
    }

    if (_error != null && _items.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, Sp.xl),
        children: [
          SizedBox(
            height: 360,
            child: AppError(
              message: _error!,
              onRetry: () {
                setState(() => _loading = true);
                _load(reset: true);
              },
            ),
          ),
        ],
      );
    }

    if (visible.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => _load(reset: true),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.xl, Sp.lg, Sp.xl),
          children: [
            SizedBox(
              height: 300,
              child: AppEmpty(
                message: _emptyMessage,
                icon: Icons.confirmation_number_outlined,
                action: _items.length < _total
                    ? TextButton(
                        onPressed: _loadingMore
                            ? null
                            : () => _load(reset: false),
                        child: Text(
                          _loadingMore ? 'Memuat…' : 'Muat lebih banyak',
                        ),
                      )
                    : widget.onBrowse != null
                    ? FilledButton.icon(
                        onPressed: widget.onBrowse,
                        icon: const Icon(Icons.search, size: 18),
                        label: const Text('Cari vendor'),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(0, 46),
                          padding: const EdgeInsets.symmetric(
                            horizontal: Sp.xl,
                          ),
                        ),
                      )
                    : TextButton(
                        onPressed: () => _load(reset: true),
                        child: const Text('Muat ulang'),
                      ),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => _load(reset: true),
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(Sp.lg, 0, Sp.lg, Sp.xl),
        itemCount: visible.length + 1,
        itemBuilder: (context, index) {
          if (index == visible.length) return _footer(visible.length);
          final booking = visible[index];
          return Padding(
            padding: const EdgeInsets.only(bottom: Sp.md),
            child: _BookingCard(
              booking: booking,
              onTap: () => Navigator.pushNamed(
                context,
                Routes.bookingStatus,
                arguments: booking.id,
              ),
            ),
          );
        },
      ),
    );
  }

  String get _emptyMessage => switch (_filter) {
    _BookingFilter.all => 'Belum ada booking. Mulai dari melihat vendor.',
    _BookingFilter.active => 'Tidak ada booking yang sedang berjalan.',
    _BookingFilter.done => 'Belum ada booking yang selesai.',
  };

  Widget _footer(int visibleCount) {
    final hasMore = _items.length < _total;
    if (!hasMore && _moreError == null) {
      return Padding(
        padding: const EdgeInsets.only(top: Sp.sm),
        child: Text(
          '$visibleCount booking',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: Sp.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_moreError != null) ...[
            AppError(message: _moreError!, compact: true),
            const SizedBox(height: Sp.sm),
            TextButton(
              onPressed: () => _load(reset: false),
              child: const Text('Coba lagi'),
            ),
          ] else
            TextButton(
              onPressed: _loadingMore ? null : () => _load(reset: false),
              child: Text(_loadingMore ? 'Memuat…' : 'Muat lebih banyak'),
            ),
        ],
      ),
    );
  }
}

class _BookingCard extends StatelessWidget {
  const _BookingCard({required this.booking, required this.onTap});

  final BookingSummary booking;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final slot = booking.firstSlot;
    final eventDate = slot == null ? null : DateTime.tryParse(slot.date);
    final lifecycle = booking.lifecycleStatus.toLowerCase();
    final fullyPaid = isFullySettled(booking.paymentStatus);
    final refunded = booking.paymentStatus.toLowerCase() == 'refunded';
    final closed = isTerminalLifecycle(lifecycle) && lifecycle != 'completed';
    final summary = bookingMoneySummary(
      lifecycleStatus: booking.lifecycleStatus,
      paymentStatus: booking.paymentStatus,
      totalCustomerIdr: booking.totalCustomerIdr,
      dpAmountIdr: booking.dpAmountIdr,
      outstandingIdr: booking.outstandingIdr,
    );

    final Color moneyColor = fullyPaid
        ? AppColors.accent
        : refunded || closed
        ? AppColors.inkMuted
        : AppColors.ink;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x120B1220),
            blurRadius: 18,
            offset: Offset(0, 6),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _DateSpine(date: eventDate),
                SizedBox(
                  width: 1,
                  child: CustomPaint(painter: _TicketSeamPainter()),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(
                          Sp.md,
                          Sp.md,
                          Sp.md,
                          11,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    booking.code,
                                    style: text.labelMedium?.copyWith(
                                      fontSize: 10.5,
                                      color: AppColors.inkMuted,
                                      letterSpacing: 0.5,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: Sp.sm),
                                StatusPill(
                                  label: lifecycleText(booking.lifecycleStatus),
                                  tone: bookingPillTone(
                                    booking.lifecycleStatus,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 7),
                            Text(
                              booking.vendor.displayName,
                              style: text.titleLarge?.copyWith(
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                                height: 1.2,
                                letterSpacing: -0.35,
                              ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              slot == null
                                  ? 'Jadwal menyusul'
                                  : '${sessionText(slot.session)} · '
                                        '${eventDate?.year ?? ''}',
                              style: text.bodySmall,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.fromLTRB(
                          Sp.md,
                          10,
                          Sp.sm,
                          10,
                        ),
                        decoration: const BoxDecoration(
                          color: AppColors.surfaceSoft,
                          border: Border(
                            top: BorderSide(color: AppColors.line),
                          ),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                summary.detail,
                                style: text.bodySmall,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: Sp.sm),
                            Text(
                              summary.label,
                              style: text.titleMedium?.copyWith(
                                fontSize: 15,
                                fontWeight: FontWeight.w800,
                                color: moneyColor,
                                fontFeatures: const [
                                  FontFeature.tabularFigures(),
                                ],
                              ),
                            ),
                            const SizedBox(width: 2),
                            const Icon(
                              Icons.chevron_right,
                              size: 18,
                              color: AppColors.inkMuted,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Ticket stub: the date lives in a dark spine, so a list of bookings can be
/// scanned by when they happen, not by their booking code.
class _DateSpine extends StatelessWidget {
  const _DateSpine({required this.date});

  final DateTime? date;

  static const _weekdays = ['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'];
  static const _months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MEI',
    'JUN',
    'JUL',
    'AGU',
    'SEP',
    'OKT',
    'NOV',
    'DES',
  ];

  @override
  Widget build(BuildContext context) {
    final value = date;
    return Container(
      width: 58,
      color: AppColors.ink,
      padding: const EdgeInsets.symmetric(vertical: 13),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.start,
        children: [
          Text(
            value == null ? 'JADWAL' : _weekdays[value.weekday - 1],
            style: const TextStyle(
              fontSize: 8.5,
              height: 1.2,
              fontWeight: FontWeight.w800,
              letterSpacing: 1,
              color: AppColors.lime,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value == null ? '—' : '${value.day}',
            style: const TextStyle(
              fontSize: 25,
              height: 1.05,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.8,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 1),
          Text(
            value == null ? 'MENYUSUL' : _months[value.month - 1],
            style: TextStyle(
              fontSize: 8.5,
              height: 1.2,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.9,
              color: Colors.white.withValues(alpha: 0.55),
            ),
          ),
        ],
      ),
    );
  }
}

/// One-pixel perforation between the stub and the body.
class _TicketSeamPainter extends CustomPainter {
  const _TicketSeamPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.lineStrong
      ..strokeWidth = 1;
    for (var y = 0.0; y < size.height; y += 7) {
      canvas.drawLine(Offset(0.5, y), Offset(0.5, y + 4), paint);
    }
  }

  @override
  bool shouldRepaint(_TicketSeamPainter oldDelegate) => false;
}
