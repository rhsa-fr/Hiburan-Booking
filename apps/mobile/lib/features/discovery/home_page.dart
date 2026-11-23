import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';
import '../booking/booking_support.dart';
import '../booking/list_page.dart';
import '../notifications/notification_bell.dart';
import '../profile/account_page.dart';
import 'browse_page.dart';

const _tabularFigures = <FontFeature>[FontFeature.tabularFigures()];

/// Root of the signed-in app: four tabs, each one backed by a real endpoint.
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  static const _beranda = 0;
  static const _jelajah = 1;
  static const _booking = 2;
  static const _profil = 3;

  final _search = TextEditingController();
  final _visited = <int>{_beranda};

  int _tab = _beranda;
  String _browseQuery = '';
  String? _browseCategory;
  int _browseRequest = 0;

  void _selectTab(int index) {
    if (index == _tab) return;
    setState(() {
      _tab = index;
      _visited.add(index);
    });
  }

  void _openBrowse({String? query}) {
    setState(() {
      if (query != null) {
        _browseQuery = query;
        _browseCategory = null;
      }
      _browseRequest += 1;
      _visited.add(_jelajah);
      _tab = _jelajah;
    });
  }

  void _openCategory(String slug) {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _browseQuery = '';
      _browseCategory = slug;
      _browseRequest += 1;
      _search.clear();
      _visited.add(_jelajah);
      _tab = _jelajah;
    });
  }

  void _submitSearch(String value) {
    FocusManager.instance.primaryFocus?.unfocus();
    final query = value.trim();
    _search.text = query;
    _openBrowse(query: query);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppShell(
      index: _tab,
      onDestinationSelected: _selectTab,
      children: [
        _Beranda(
          searchController: _search,
          onSearch: _submitSearch,
          onOpenProfile: () => _selectTab(_profil),
          onOpenBrowse: (query) => _openBrowse(query: query),
          onOpenCategory: _openCategory,
        ),
        if (_visited.contains(_jelajah))
          BrowsePage(
            key: ValueKey(
              'browse:$_browseRequest:$_browseQuery:${_browseCategory ?? ''}',
            ),
            initialQuery: _browseQuery,
            initialCategory: _browseCategory,
          )
        else
          const SizedBox.shrink(),
        if (_visited.contains(_booking))
          BookingListPage(onBrowse: () => _selectTab(_jelajah))
        else
          const SizedBox.shrink(),
        if (_visited.contains(_profil))
          const AccountPage()
        else
          const SizedBox.shrink(),
      ],
    );
  }
}

class _Beranda extends StatefulWidget {
  const _Beranda({
    required this.searchController,
    required this.onSearch,
    required this.onOpenProfile,
    required this.onOpenBrowse,
    required this.onOpenCategory,
  });

  final TextEditingController searchController;
  final ValueChanged<String> onSearch;
  final VoidCallback onOpenProfile;
  final ValueChanged<String> onOpenBrowse;
  final ValueChanged<String> onOpenCategory;

  @override
  State<_Beranda> createState() => _BerandaState();
}

class _BerandaState extends State<_Beranda> {
  static const _previewCount = 4;

  final _vendors = <VendorSummary>[];

  BookingSummary? _activeBooking;
  String? _vendorsError;
  String? _bookingError;
  int _vendorGeneration = 0;
  int _bookingGeneration = 0;
  int _vendorTotal = 0;
  bool _started = false;
  bool _loadingVendors = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _loadVendors();
    _loadActiveBooking();
  }

  Future<void> _loadVendors({bool fromRefresh = false}) async {
    final api = AppScope.of(context).api;
    final generation = ++_vendorGeneration;
    if (!fromRefresh) {
      setState(() {
        _loadingVendors = true;
        _vendorsError = null;
      });
    }

    try {
      final raw = await api.get(
        '/vendors',
        query: {'page': '1', 'page_size': '$_previewCount'},
      );
      if (!mounted || generation != _vendorGeneration) return;
      if (raw is! Map) {
        throw const ApiException(
          code: 'INTERNAL_ERROR',
          message: 'Daftar vendor tidak bisa dibaca.',
        );
      }
      final result = PageResult<VendorSummary>.fromJson(
        raw.cast<String, dynamic>(),
        VendorSummary.fromJson,
      );
      setState(() {
        _vendors
          ..clear()
          ..addAll(result.items);
        _vendorTotal = result.total;
        _loadingVendors = false;
        _vendorsError = null;
      });
    } on ApiException catch (error) {
      if (!mounted || generation != _vendorGeneration) return;
      setState(() {
        _loadingVendors = false;
        _vendorsError = apiMessage(error);
      });
    } catch (_) {
      if (!mounted || generation != _vendorGeneration) return;
      setState(() {
        _loadingVendors = false;
        _vendorsError =
            'Vendor tidak bisa dimuat. Periksa sinyal, lalu coba lagi.';
      });
    }
  }

  Future<void> _loadActiveBooking() async {
    final api = AppScope.of(context).api;
    final generation = ++_bookingGeneration;

    try {
      final raw = await api.get(
        '/bookings',
        query: {'page': '1', 'page_size': '10'},
      );
      if (!mounted || generation != _bookingGeneration) return;
      if (raw is! Map) {
        throw const ApiException(
          code: 'INTERNAL_ERROR',
          message: 'Booking tidak bisa dibaca.',
        );
      }
      final page = PageResult<BookingSummary>.fromJson(
        raw.cast<String, dynamic>(),
        BookingSummary.fromJson,
      );
      BookingSummary? active;
      for (final booking in page.items) {
        if (_isActive(booking)) {
          active = booking;
          break;
        }
      }
      setState(() {
        _activeBooking = active;
        _bookingError = null;
      });
    } on ApiException catch (error) {
      if (!mounted || generation != _bookingGeneration) return;
      setState(() => _bookingError = apiMessage(error));
    } catch (_) {
      if (!mounted || generation != _bookingGeneration) return;
      setState(() {
        _bookingError =
            'Booking aktif tidak bisa dimuat. Periksa sinyal, lalu coba lagi.';
      });
    }
  }

  /// Terminal bookings never sit in the active slot, even with a partial DP.
  static bool _isActive(BookingSummary booking) {
    final lifecycle = booking.lifecycleStatus.toLowerCase();
    final payment = booking.paymentStatus.toLowerCase();
    if (isTerminalLifecycle(lifecycle)) return false;
    const activeLifecycle = {'unpaid', 'confirmed', 'scheduled'};
    const activePayment = {'unpaid', 'dp_paid'};
    return activeLifecycle.contains(lifecycle) ||
        activePayment.contains(payment);
  }

  Future<void> _refresh() =>
      Future.wait([_loadVendors(fromRefresh: true), _loadActiveBooking()]);

  void _openVendor(VendorSummary vendor) {
    Navigator.pushNamed(context, Routes.vendor, arguments: vendor.slug);
  }

  void _openBooking(BookingSummary booking) {
    Navigator.pushNamed(context, Routes.bookingStatus, arguments: booking.id);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          _HomeHeader(
            searchController: widget.searchController,
            onSearch: widget.onSearch,
            onOpenProfile: widget.onOpenProfile,
            vendorCount: _vendorTotal == 0 ? _vendors.length : _vendorTotal,
          ),
          Expanded(child: _content()),
        ],
      ),
    );
  }

  Widget _content() {
    if (_loadingVendors && _vendors.isEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, Sp.xl),
        children: const [
          VendorCardSkeleton(),
          SizedBox(height: Sp.lg),
          VendorCardSkeleton(),
          SizedBox(height: Sp.lg),
          VendorCardSkeleton(),
        ],
      );
    }

    if (_vendorsError != null && _vendors.isEmpty) {
      return AppError(message: _vendorsError!, onRetry: () => _loadVendors());
    }

    final active = _activeBooking;

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(Sp.lg, 0, Sp.lg, Sp.xl),
        children: [
          const SizedBox(height: Sp.lg),
          if (_bookingError != null) ...[
            InfoStrip(
              message: _bookingError!,
              icon: Icons.cloud_off_outlined,
              tone: InfoTone.danger,
              actionLabel: 'Coba lagi',
              onAction: _loadActiveBooking,
            ),
            const SizedBox(height: Sp.md),
          ],
          if (active != null) ...[
            _ActiveBookingCard(
              booking: active,
              onOpen: () => _openBooking(active),
            ),
            const SizedBox(height: Sp.xl),
          ],
          _CategoryShortcuts(onOpenCategory: widget.onOpenCategory),
          const SizedBox(height: Sp.xl),
          _SectionTitle(
            title: 'Vendor di Pantura',
            trailing: 'Lihat semua',
            onTrailing: () => widget.onOpenBrowse(''),
          ),
          const SizedBox(height: Sp.md),
          if (_vendorsError != null) ...[
            InfoStrip(
              message: _vendorsError!,
              icon: Icons.cloud_off_outlined,
              tone: InfoTone.danger,
              actionLabel: 'Coba lagi',
              onAction: () => _loadVendors(),
            ),
            const SizedBox(height: Sp.md),
          ],
          if (_vendors.isEmpty)
            SizedBox(
              height: 220,
              child: AppEmpty(
                message: 'Belum ada vendor yang siap tampil saat ini.',
                icon: Icons.storefront_outlined,
              ),
            )
          else
            for (var index = 0; index < _vendors.length; index++)
              Padding(
                padding: EdgeInsets.only(
                  bottom: index == _vendors.length - 1 ? 0 : Sp.md,
                ),
                child: VendorCard(
                  vendor: _vendors[index],
                  onTap: () => _openVendor(_vendors[index]),
                ),
              ),
          if (_vendorTotal > _vendors.length) ...[
            const SizedBox(height: Sp.lg),
            Center(
              child: Text(
                'Menampilkan ${_vendors.length} dari $_vendorTotal vendor',
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: AppColors.inkMuted),
              ),
            ),
          ],
          const SizedBox(height: Sp.xl),
          const _TrustPanel(),
        ],
      ),
    );
  }
}

class _HomeHeader extends StatelessWidget {
  const _HomeHeader({
    required this.searchController,
    required this.onSearch,
    required this.onOpenProfile,
    required this.vendorCount,
  });

  final TextEditingController searchController;
  final ValueChanged<String> onSearch;
  final VoidCallback onOpenProfile;
  final int vendorCount;

  @override
  Widget build(BuildContext context) {
    final topInset = MediaQuery.paddingOf(context).top;
    final user = AppScope.of(context).session.user;
    final now = DateTime.now();
    final greeting = now.hour < 11
        ? 'Selamat pagi'
        : now.hour < 15
        ? 'Selamat siang'
        : now.hour < 19
        ? 'Selamat sore'
        : 'Selamat malam';
    final rawName = user?.fullName?.trim() ?? '';
    final firstName = rawName.isEmpty ? null : rawName.split(' ').first;
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: AppColors.primaryDeepEnd,
        ),
        border: Border(bottom: BorderSide(color: AppColors.lime, width: 2)),
      ),
      child: Stack(
        children: [
          const Positioned.fill(child: StageBeams(intensity: 0.85)),
          Padding(
            padding: EdgeInsets.fromLTRB(Sp.lg, topInset + Sp.sm, Sp.lg, Sp.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const BrandLockup(light: true),
                    const Spacer(),
                    const NotificationBell(),
                    const SizedBox(width: Sp.xs + 2),
                    _ProfileButton(onTap: onOpenProfile),
                  ],
                ),
                const SizedBox(height: 22),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            formatDate(now).toUpperCase(),
                            style: const TextStyle(
                              fontSize: 9.5,
                              height: 1.2,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 1.5,
                              color: AppColors.lime,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            firstName == null
                                ? '$greeting.'
                                : '$greeting, $firstName',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 26,
                              height: 1.06,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -1.1,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              const Icon(
                                Icons.place_outlined,
                                size: 13,
                                color: AppColors.lime,
                              ),
                              const SizedBox(width: 4),
                              Flexible(
                                child: Text(
                                  'Pantura, Jawa Barat',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.w600,
                                    color: Colors.white.withValues(alpha: 0.72),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    if (vendorCount > 0) ...[
                      const SizedBox(width: Sp.md),
                      _HeaderCountPill(label: '$vendorCount grup'),
                    ],
                  ],
                ),
                const SizedBox(height: 16),
                StageSearchField(
                  controller: searchController,
                  hint: 'Cari tarling, organ tunggal, MC…',
                  onSubmitted: onSearch,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Quiet counter that balances the greeting, e.g. "8 grup". It replaces the
/// date that used to sit here and duplicated what the user already knows.
class _HeaderCountPill extends StatelessWidget {
  const _HeaderCountPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(Radii.pill),
        border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 5,
            height: 5,
            decoration: const BoxDecoration(
              color: AppColors.lime,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 10.5,
              height: 1.1,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
              color: Colors.white,
            ),
          ),
        ],
      ),
    );
  }
}

class _CategoryShortcuts extends StatelessWidget {
  const _CategoryShortcuts({required this.onOpenCategory});

  final ValueChanged<String> onOpenCategory;

  static const _items =
      <({String label, IconData icon, Color tint, Color ink, String category})>[
        (
          label: 'Tarling & Dangdut',
          icon: Icons.queue_music,
          tint: AppColors.limeSoft,
          ink: AppColors.primary,
          category: 'tarling',
        ),
        (
          label: 'Organ Tunggal',
          icon: Icons.piano,
          tint: AppColors.accentSoft,
          ink: AppColors.accent,
          category: 'organ-tunggal',
        ),
        (
          label: 'Seni Tradisi',
          icon: Icons.theater_comedy,
          tint: AppColors.tertiarySoft,
          ink: AppColors.tertiary,
          category: 'seni-tradisi',
        ),
        (
          label: 'Pendukung Acara',
          icon: Icons.speaker_group_outlined,
          tint: AppColors.secondarySoft,
          ink: AppColors.secondary,
          category: 'pendukung-acara',
        ),
      ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionTitle(title: 'Kategori'),
        const SizedBox(height: Sp.md),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < _items.length; i++) ...[
              if (i > 0) const SizedBox(width: Sp.sm),
              Expanded(child: _shortcut(context, _items[i])),
            ],
          ],
        ),
      ],
    );
  }

  Widget _shortcut(
    BuildContext context,
    ({String label, IconData icon, Color tint, Color ink, String category})
    item,
  ) {
    final text = Theme.of(context).textTheme;
    final radius = BorderRadius.circular(Radii.lg);
    return Semantics(
      button: true,
      label: item.label,
      child: Material(
        color: Colors.transparent,
        child: Ink(
          decoration: BoxDecoration(
            color: item.tint,
            borderRadius: radius,
            border: Border.all(color: item.ink.withValues(alpha: 0.10)),
          ),
          child: InkWell(
            onTap: () => onOpenCategory(item.category),
            borderRadius: radius,
            child: SizedBox(
              height: 96,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: Sp.xs + 2,
                  vertical: Sp.md,
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(item.icon, size: 26, color: item.ink),
                    const SizedBox(height: Sp.sm + 1),
                    SizedBox(
                      height: 29,
                      child: Align(
                        alignment: Alignment.topCenter,
                        child: Text(
                          item.label,
                          textAlign: TextAlign.center,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: text.labelSmall?.copyWith(
                            fontSize: 11.5,
                            height: 1.25,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.1,
                            color: AppColors.ink,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Editorial section heading: a lime rule, an 18/800 title, one quiet action.
/// No repeated icon box: the page already has enough little squares.
class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.trailing, this.onTrailing});

  final String title;
  final String? trailing;
  final VoidCallback? onTrailing;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Row(
      children: [
        Container(
          width: 3,
          height: 20,
          decoration: BoxDecoration(
            color: AppColors.limeDark,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: text.titleLarge?.copyWith(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.45,
            ),
          ),
        ),
        if (trailing != null)
          TextButton(
            onPressed: onTrailing,
            style: TextButton.styleFrom(
              minimumSize: const Size(0, 40),
              padding: const EdgeInsets.symmetric(horizontal: Sp.sm),
              foregroundColor: AppColors.ink,
              textStyle: text.labelMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(trailing!),
                const SizedBox(width: 3),
                const Icon(Icons.arrow_forward, size: 15),
              ],
            ),
          ),
      ],
    );
  }
}

class _TrustPanel extends StatelessWidget {
  const _TrustPanel();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, Sp.lg),
      decoration: BoxDecoration(
        color: AppColors.ink,
        borderRadius: BorderRadius.circular(Radii.xl),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.verified_user_outlined,
                size: 15,
                color: AppColors.lime,
              ),
              const SizedBox(width: 6),
              Text(
                'Jaminan Tarlink',
                style: text.labelMedium?.copyWith(
                  fontSize: 11,
                  letterSpacing: 0.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.lime,
                ),
              ),
            ],
          ),
          const SizedBox(height: Sp.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _pillar(
                context,
                Icons.lock_outline,
                'DP ditahan',
                'lewat PJP berizin',
              ),
              const SizedBox(width: Sp.sm),
              _pillar(
                context,
                Icons.event_available_outlined,
                'Jadwal jelas',
                '45 hari ke depan',
              ),
              const SizedBox(width: Sp.sm),
              _pillar(
                context,
                Icons.chat_bubble_outline,
                'Chat vendor',
                'langsung in-app',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _pillar(
    BuildContext context,
    IconData icon,
    String title,
    String caption,
  ) {
    final text = Theme.of(context).textTheme;
    return Expanded(
      child: Column(
        children: [
          Icon(icon, size: 19, color: AppColors.lime),
          const SizedBox(height: 7),
          Text(
            title,
            textAlign: TextAlign.center,
            style: text.labelSmall?.copyWith(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            caption,
            textAlign: TextAlign.center,
            maxLines: 2,
            style: text.labelSmall?.copyWith(
              fontSize: 9.5,
              fontWeight: FontWeight.w500,
              height: 1.25,
              color: AppColors.inkMuted,
            ),
          ),
        ],
      ),
    );
  }
}

class _DarkPill extends StatelessWidget {
  const _DarkPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(Radii.pill),
        border: Border.all(color: Colors.white.withValues(alpha: 0.20)),
      ),
      child: Text(
        label,
        style: const TextStyle(
          fontSize: 10,
          height: 1.2,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.2,
          color: Colors.white,
        ),
      ),
    );
  }
}

/// The active booking is the one thing a customer opens the app for, so it gets
/// the stage: a dark ticket with a lime amount, not another white card.
class _ActiveBookingCard extends StatelessWidget {
  const _ActiveBookingCard({required this.booking, required this.onOpen});

  final BookingSummary booking;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final pill = paymentPill(booking.paymentStatus);
    final total = booking.totalCustomerIdr;
    final paid = total - booking.outstandingIdr;
    final paidClamped = paid < 0 ? 0 : (paid > total ? total : paid);
    final paidRatio = total <= 0 ? 0.0 : paidClamped / total;
    final slot = booking.firstSlot;
    final eventDate = slot == null ? null : DateTime.tryParse(slot.date);
    final today = DateTime.now();
    final daysLeft = eventDate == null
        ? null
        : DateTime(
            eventDate.year,
            eventDate.month,
            eventDate.day,
          ).difference(DateTime(today.year, today.month, today.day)).inDays;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.ink,
        borderRadius: BorderRadius.circular(18),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          const Positioned.fill(child: StageBeams(intensity: 0.55)),
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onOpen,
              child: Padding(
                padding: const EdgeInsets.all(Sp.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        const Text(
                          'BOOKING AKTIF',
                          style: TextStyle(
                            fontSize: 9.5,
                            height: 1.2,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1.5,
                            color: AppColors.lime,
                          ),
                        ),
                        const Spacer(),
                        _DarkPill(label: pill.label),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      booking.vendor.displayName,
                      style: text.titleLarge?.copyWith(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        height: 1.15,
                        letterSpacing: -0.5,
                        color: Colors.white,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 5),
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            eventDate == null
                                ? booking.code
                                : '${booking.code} · ${formatDate(eventDate)}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 11.5,
                              height: 1.3,
                              fontWeight: FontWeight.w500,
                              color: Colors.white.withValues(alpha: 0.55),
                            ),
                          ),
                        ),
                        if (daysLeft != null && daysLeft >= 0) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.lime,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              daysLeft == 0 ? 'HARI INI' : 'H-$daysLeft',
                              style: const TextStyle(
                                fontSize: 9,
                                height: 1.2,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.4,
                                color: AppColors.ink,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 18),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Sisa pembayaran',
                                style: TextStyle(
                                  fontSize: 10.5,
                                  height: 1.2,
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: 0.3,
                                  color: Colors.white.withValues(alpha: 0.55),
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                rupiahTight(booking.outstandingIdr),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 28,
                                  height: 1.05,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -1.1,
                                  color: AppColors.lime,
                                  fontFeatures: _tabularFigures,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: Sp.md),
                        Container(
                          width: 42,
                          height: 42,
                          decoration: const BoxDecoration(
                            color: AppColors.lime,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.arrow_forward,
                            size: 20,
                            color: AppColors.ink,
                          ),
                        ),
                      ],
                    ),
                    if (total > 0) ...[
                      const SizedBox(height: 16),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(Radii.pill),
                        child: LinearProgressIndicator(
                          value: paidRatio,
                          minHeight: 5,
                          backgroundColor: Colors.white.withValues(alpha: 0.14),
                          valueColor: const AlwaysStoppedAnimation<Color>(
                            AppColors.lime,
                          ),
                        ),
                      ),
                      const SizedBox(height: 7),
                      Text(
                        paid >= total
                            ? 'Lunas ${rupiahTight(total)}'
                            : 'Sudah dibayar ${rupiahTight(paidClamped)} dari ${rupiahTight(total)}',
                        style: TextStyle(
                          fontSize: 10.5,
                          height: 1.3,
                          fontWeight: FontWeight.w500,
                          color: Colors.white.withValues(alpha: 0.50),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileButton extends StatelessWidget {
  const _ProfileButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final user = AppScope.of(context).session.user;

    return Semantics(
      button: true,
      label: 'Buka profil',
      child: Material(
        color: Colors.white.withValues(alpha: 0.14),
        shape: CircleBorder(
          side: BorderSide(color: Colors.white.withValues(alpha: 0.22)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            width: 36,
            height: 36,
            child: Center(
              child: Text(
                _initials(user),
                style: const TextStyle(
                  fontSize: 12,
                  height: 1,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.3,
                  color: AppColors.onPrimary,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String _initials(AppUser? user) {
  final name = user?.fullName?.trim() ?? '';
  final words = name
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .toList(growable: false);
  if (words.length >= 2) {
    return (words.first.substring(0, 1) + words.last.substring(0, 1))
        .toUpperCase();
  }
  if (words.length == 1) {
    final word = words.first;
    return (word.length >= 2 ? word.substring(0, 2) : word).toUpperCase();
  }
  final email = (user?.email ?? '').trim();
  if (email.isNotEmpty) return email.substring(0, 1).toUpperCase();
  return 'T';
}
