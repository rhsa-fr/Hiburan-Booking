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
          const BookingListPage()
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
  static const _previewCount = 3;

  final _vendors = <VendorSummary>[];

  BookingSummary? _activeBooking;
  String? _vendorsError;
  String? _bookingError;
  int _vendorGeneration = 0;
  int _bookingGeneration = 0;
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
    const terminal = {'completed', 'cancelled', 'canceled', 'expired'};
    if (terminal.contains(lifecycle)) return false;
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
            onOpenBrowse: () => widget.onOpenBrowse(''),
            vendorCount: _vendors.length,
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
        children: const [AppLoading(rows: 3, label: 'Memuat vendor')],
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
            Text(
              'Booking aktif',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.2,
              ),
            ),
            const SizedBox(height: Sp.md),
            _ActiveBookingCard(
              booking: active,
              onOpen: () => _openBooking(active),
            ),
            const SizedBox(height: Sp.xl),
          ],
          _CategoryShortcuts(onOpenCategory: widget.onOpenCategory),
          const SizedBox(height: Sp.xl),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Vendor Siap Tanggap',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                  ),
                ),
              ),
              TextButton(
                onPressed: () => widget.onOpenBrowse(''),
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, 40),
                  padding: const EdgeInsets.symmetric(horizontal: Sp.sm),
                  textStyle: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: AppColors.primary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                child: const Row(
                  children: [
                    Text('Semua'),
                    SizedBox(width: 2),
                    Icon(Icons.arrow_forward, size: 16),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: Sp.xs),
          Text(
            'Pilih grup, cek jadwal, lalu amankan tanggal acara.',
            style: Theme.of(context).textTheme.bodySmall,
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
                  bottom: index == _vendors.length - 1 ? 0 : Sp.lg,
                ),
                child: TweenAnimationBuilder<double>(
                  key: ValueKey('home-vendor-${_vendors[index].id}'),
                  duration: const Duration(milliseconds: 220),
                  tween: Tween(begin: 0.0, end: 1.0),
                  builder: (context, value, child) => Opacity(
                    opacity: value,
                    child: Transform.translate(
                      offset: Offset(0, (1 - value) * 10),
                      child: child,
                    ),
                  ),
                  child: VendorCard(
                    vendor: _vendors[index],
                    onTap: () => _openVendor(_vendors[index]),
                  ),
                ),
              ),
          const SizedBox(height: Sp.xl),
          const _GuaranteeCard(),
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
    required this.onOpenBrowse,
    required this.vendorCount,
  });

  final TextEditingController searchController;
  final ValueChanged<String> onSearch;
  final VoidCallback onOpenProfile;
  final VoidCallback onOpenBrowse;
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
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: AppColors.primaryDeepEnd,
        ),
      ),
      padding: EdgeInsets.fromLTRB(Sp.lg, topInset + Sp.sm, Sp.lg, Sp.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const BrandLockup(light: true),
              const Spacer(),
              _HeaderIconButton(
                icon: Icons.explore_outlined,
                label: 'Jelajah',
                onTap: onOpenBrowse,
              ),
              const SizedBox(width: 7),
              _ProfileButton(onTap: onOpenProfile),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            formatDate(now),
            style: const TextStyle(
              fontSize: 9.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.2,
              color: Colors.white54,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            firstName == null ? '$greeting.' : '$greeting, $firstName',
            style: const TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.6,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(
                Icons.place_outlined,
                size: 14,
                color: AppColors.lime,
              ),
              const SizedBox(width: 4),
              Expanded(
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
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.limeSoft,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text(
                  'Siap',
                  style: TextStyle(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
              ),
              if (vendorCount > 0) ...[
                const SizedBox(width: 6),
                Text(
                  '$vendorCount grup aktif',
                  style: TextStyle(
                    fontSize: 10.5,
                    color: Colors.white.withValues(alpha: 0.45),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          StageSearchField(
            controller: searchController,
            hint: 'Cari tarling, organ tunggal, MC…',
            onSubmitted: onSearch,
          ),
        ],
      ),
    );
  }
}

class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: Colors.white.withValues(alpha: 0.12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(9),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.16)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            width: 34,
            height: 34,
            child: Icon(icon, size: 17, color: AppColors.onPrimary),
          ),
        ),
      ),
    );
  }
}

class _CategoryShortcuts extends StatelessWidget {
  const _CategoryShortcuts({required this.onOpenCategory});

  final ValueChanged<String> onOpenCategory;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final items =
        <({String label, IconData icon, Color tint, Color ink, String category})>[
      (
        label: 'Tarling\nDangdut',
        icon: Icons.queue_music,
        tint: AppColors.primarySoft,
        ink: AppColors.primaryDeep,
        category: 'tarling',
      ),
      (
        label: 'Organ\nTunggal',
        icon: Icons.piano,
        tint: AppColors.secondarySoft,
        ink: AppColors.secondary,
        category: 'organ-tunggal',
      ),
      (
        label: 'Seni\nTradisi',
        icon: Icons.theater_comedy,
        tint: AppColors.tertiarySoft,
        ink: AppColors.tertiary,
        category: 'seni-tradisi',
      ),
      (
        label: 'Pendukung\nAcara',
        icon: Icons.speaker_group_outlined,
        tint: AppColors.secondarySoft,
        ink: AppColors.secondary,
        category: 'pendukung-acara',
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Kategori Panggung',
          style: text.titleMedium?.copyWith(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.2,
          ),
        ),
        const SizedBox(height: Sp.md),
        Row(
          children: [
            Expanded(child: _tile(context, text, items[0])),
            const SizedBox(width: Sp.sm),
            Expanded(
              child: _tile(context, text, items[1], featured: true),
            ),
          ],
        ),
        const SizedBox(height: Sp.sm),
        Row(
          children: [
            Expanded(child: _tile(context, text, items[2])),
            const SizedBox(width: Sp.sm),
            Expanded(child: _tile(context, text, items[3])),
          ],
        ),
      ],
    );
  }

  Widget _tile(
    BuildContext context,
    TextTheme text,
    ({
      String label,
      IconData icon,
      Color tint,
      Color ink,
      String category,
    })
    item, {
    bool featured = false,
  }) {
    return Material(
      color: featured ? AppColors.ink : AppColors.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.sm),
        side: BorderSide(
          color: featured ? AppColors.ink : AppColors.line,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => onOpenCategory(item.category),
        child: SizedBox(
          height: 72,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            child: Row(
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    color: featured ? AppColors.lime : item.tint,
                    borderRadius: BorderRadius.circular(7),
                  ),
                  child: Icon(
                    item.icon,
                    size: 16,
                    color: featured ? AppColors.ink : item.ink,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    item.label,
                    maxLines: 2,
                    style: text.labelSmall?.copyWith(
                      fontSize: 11,
                      height: 1.2,
                      fontWeight: FontWeight.w700,
                      color: featured
                          ? AppColors.onPrimary
                          : AppColors.ink,
                    ),
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

class _GuaranteeCard extends StatelessWidget {
  const _GuaranteeCard();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(Sp.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceTint,
        borderRadius: BorderRadius.circular(Radii.sm),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: const BoxDecoration(
              color: AppColors.secondary,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.shield_outlined,
              size: 20,
              color: AppColors.onPrimary,
            ),
          ),
          const SizedBox(width: Sp.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Jaminan Tanggap Sahibul Hajat',
                  style: text.labelMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'DP ditahan PJP berizin sampai acara selesai, lalu diteruskan ke vendor.',
                  style: text.bodySmall?.copyWith(height: 1.4),
                ),
              ],
            ),
          ),
          const SizedBox(width: Sp.sm),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.card,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: AppColors.line),
            ),
            child: Text(
              'PJP\nRekber',
              textAlign: TextAlign.center,
              style: text.labelSmall?.copyWith(
                fontSize: 9,
                height: 1.2,
                color: AppColors.secondary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActiveBookingCard extends StatelessWidget {
  const _ActiveBookingCard({required this.booking, required this.onOpen});

  final BookingSummary booking;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final pill = _paymentPill(booking.paymentStatus);

    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: const BorderRadius.all(Radius.circular(Radii.lg)),
        border: Border.all(color: AppColors.line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x060F172A),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, Sp.xs),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          booking.vendor.displayName,
                          style: text.titleLarge,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          booking.code,
                          style: text.labelMedium?.copyWith(
                            color: AppColors.inkMuted,
                            letterSpacing: 0.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: Sp.md),
                  StatusPill(label: pill.label, tone: pill.tone),
                ],
              ),
              const SizedBox(height: Sp.md),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: Text(
                      'Sisa yang harus dibayar',
                      style: text.bodySmall,
                    ),
                  ),
                  const SizedBox(width: Sp.md),
                  Text(
                    rupiahTight(booking.outstandingIdr),
                    style: text.titleLarge?.copyWith(
                      color: AppColors.primary,
                      fontFeatures: _tabularFigures,
                    ),
                  ),
                ],
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: onOpen,
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: Sp.sm),
                    minimumSize: const Size(0, 48),
                  ),
                  child: const Text('Lihat booking'),
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

({String label, PillTone tone}) _paymentPill(String status) =>
    switch (status.toLowerCase()) {
      'unpaid' => (label: 'Belum bayar', tone: PillTone.warning),
      'dp_paid' => (label: 'DP lunas', tone: PillTone.success),
      'fully_paid' => (label: 'Lunas', tone: PillTone.success),
      'pending' => (label: 'Menunggu bayar', tone: PillTone.warning),
      _ => (label: paymentText(status), tone: PillTone.neutral),
    };

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
