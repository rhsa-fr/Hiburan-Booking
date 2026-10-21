import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/widgets.dart';
import 'booking_support.dart';

enum _BookingFilter {
  all('Semua', null),
  waiting('Menunggu', 'requested'),
  scheduled('Terjadwal', 'confirmed'),
  done('Selesai', 'completed'),
  cancelled('Batal', 'cancelled');

  const _BookingFilter(this.label, this.status);

  final String label;
  final String? status;
}

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
        query: {
          'status': _filter.status,
          'page': '$_nextPage',
          'page_size': '$_pageSize',
        },
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
      if (_items.isNotEmpty) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(message)));
      }
    } finally {
      _fetching = false;
    }
  }

  void _selectFilter(_BookingFilter filter) {
    if (filter == _filter || _loading || _fetching) return;
    setState(() {
      _filter = filter;
      _items.clear();
      _total = 0;
      _error = null;
      _moreError = null;
      _loading = true;
    });
    _load(reset: true);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Booking saya')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, 0),
                child: Row(
                  children: [
                    for (final filter in _BookingFilter.values) ...[
                      ChoiceChip(
                        label: Text(filter.label),
                        selected: filter == _filter,
                        showCheckmark: false,
                        onSelected: _loading
                            ? null
                            : (_) => _selectFilter(filter),
                        selectedColor: AppColors.primary,
                        backgroundColor: AppColors.card,
                        side: BorderSide(
                          color: filter == _filter
                              ? AppColors.primary
                              : AppColors.line,
                        ),
                        labelStyle: text.labelMedium?.copyWith(
                          color: filter == _filter
                              ? AppColors.onPrimary
                              : AppColors.ink,
                        ),
                      ),
                      const SizedBox(width: Sp.sm),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: Sp.md),
              Expanded(child: _content(text)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _content(TextTheme text) {
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

    if (_items.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => _load(reset: true),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.xl, Sp.lg, Sp.xl),
          children: [
            AppEmpty(
              message: 'Belum ada booking. Cari tarling dulu, yuk.',
              icon: Icons.confirmation_number_outlined,
              action: PrimaryButton(
                label: 'Cari tarling',
                icon: Icons.search,
                onPressed: () => Navigator.pushNamed(context, Routes.home),
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
        itemCount: _items.length + 1,
        itemBuilder: (context, index) {
          if (index == _items.length) return _footer(text);
          return Padding(
            padding: const EdgeInsets.only(bottom: Sp.md),
            child: _BookingCard(
              booking: _items[index],
              onTap: () => Navigator.pushNamed(
                context,
                Routes.bookingStatus,
                arguments: _items[index].id,
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _footer(TextTheme text) {
    final hasMore = _items.length < _total;
    if (!hasMore && _moreError == null) {
      return Padding(
        padding: const EdgeInsets.only(top: Sp.sm),
        child: Text(
          '${_items.length} booking',
          textAlign: TextAlign.center,
          style: text.bodySmall,
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
              onPressed: () => _load(reset: true),
              child: const Text('Coba lagi'),
            ),
          ] else if (hasMore)
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
    final paid = isFullySettled(booking.paymentStatus)
        ? booking.totalCustomerIdr
        : isDpSettled(booking.paymentStatus)
        ? booking.dpAmountIdr
        : 0;
    final remaining = booking.outstandingIdr;
    final slot = booking.firstSlot;

    return Card(
      clipBehavior: Clip.antiAlias,
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
                  const Icon(
                    Icons.chevron_right,
                    size: 20,
                    color: AppColors.inkMuted,
                  ),
                ],
              ),
              const SizedBox(height: Sp.sm),
              Text(booking.vendor.displayName, style: text.titleMedium),
              const SizedBox(height: Sp.xs),
              Text(booking.package.name, style: text.bodySmall),
              const SizedBox(height: Sp.md),
              Wrap(
                spacing: Sp.sm,
                runSpacing: Sp.sm,
                children: [
                  BookingStatusChip(booking.lifecycleStatus),
                  BookingStatusChip(
                    booking.paymentStatus,
                    kind: BookingChipKind.payment,
                  ),
                ],
              ),
              const SizedBox(height: Sp.md),
              Row(
                children: [
                  const Icon(
                    Icons.event_outlined,
                    size: 18,
                    color: AppColors.inkMuted,
                  ),
                  const SizedBox(width: Sp.sm),
                  Expanded(
                    child: Text(
                      slot == null
                          ? 'Jadwal menyusul'
                          : '${formatDateIso(slot.date)} · ${sessionText(slot.session)}',
                      style: text.bodyMedium,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: Sp.md),
              const Divider(height: 1),
              const SizedBox(height: Sp.md),
              Text(
                'Dibayar ${rupiah(paid)} · Sisa ${rupiah(remaining)}',
                style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
