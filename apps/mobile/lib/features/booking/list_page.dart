import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
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

const _closedLifecycles = {
  'completed',
  'cancelled',
  'canceled',
  'rejected',
  'expired',
};

/// Booking tab body, embedded by `AppShell`: no Scaffold, no bottom nav.
/// The status segmented control filters the pages already loaded, because the
/// list endpoint only understands one lifecycle value at a time.
class BookingListPage extends StatefulWidget {
  const BookingListPage({super.key});

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
          .where(
            (booking) => !_closedLifecycles.contains(
              booking.lifecycleStatus.toLowerCase(),
            ),
          )
          .toList(growable: false),
    _BookingFilter.done =>
      _items
          .where(
            (booking) => _closedLifecycles.contains(
              booking.lifecycleStatus.toLowerCase(),
            ),
          )
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
          subtitle: 'Daftar transaksi dan jadwal acara',
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
    final lifecycle = booking.lifecycleStatus.toLowerCase();
    final fullyPaid = isFullySettled(booking.paymentStatus);
    final refunded = booking.paymentStatus.toLowerCase() == 'refunded';
    final closed =
        _closedLifecycles.contains(lifecycle) && lifecycle != 'completed';

    final ({String label, Color color}) money = fullyPaid
        ? (label: 'Lunas', color: AppColors.accent)
        : refunded
        ? (label: 'Dikembalikan', color: AppColors.inkMuted)
        : closed
        ? (label: 'Tidak ditagih', color: AppColors.inkMuted)
        : (
            label: 'Sisa ${rupiah(booking.outstandingIdr)}',
            color: AppColors.ink,
          );

    final detail = fullyPaid
        ? 'Dibayar ${rupiah(booking.totalCustomerIdr)} · '
              'Sisa ${rupiah(booking.outstandingIdr)}'
        : isDpSettled(booking.paymentStatus)
        ? 'Dibayar ${rupiah(booking.dpAmountIdr)} (DP)'
        : 'Belum ada pembayaran';

    return Material(
      color: AppColors.card,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        side: const BorderSide(color: AppColors.line),
      ),
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(Sp.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      booking.code,
                      style: text.labelMedium?.copyWith(
                        color: AppColors.inkMuted,
                        letterSpacing: 0.4,
                      ),
                    ),
                  ),
                  const SizedBox(width: Sp.sm),
                  StatusPill(
                    label: lifecycleText(booking.lifecycleStatus),
                    tone: bookingPillTone(booking.lifecycleStatus),
                  ),
                ],
              ),
              const SizedBox(height: Sp.sm),
              Text(
                booking.vendor.displayName,
                style: text.titleLarge,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Row(
                children: [
                  const Icon(
                    Icons.event_outlined,
                    size: 15,
                    color: AppColors.inkMuted,
                  ),
                  const SizedBox(width: Sp.xs),
                  Expanded(
                    child: Text(
                      slot == null
                          ? 'Jadwal menyusul'
                          : '${formatDateIso(slot.date)} · '
                                '${sessionText(slot.session)}',
                      style: text.bodySmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: Sp.md),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(child: Text(detail, style: text.bodySmall)),
                  const SizedBox(width: Sp.sm),
                  Text(
                    money.label,
                    style: text.titleMedium?.copyWith(
                      color: money.color,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                  const SizedBox(width: Sp.xs),
                  const Icon(
                    Icons.chevron_right,
                    size: 20,
                    color: AppColors.inkMuted,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
