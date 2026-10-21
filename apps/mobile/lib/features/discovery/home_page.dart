import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/widgets.dart';

/// Browse surface: search + approved vendors, honest about missing data.
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  static const _pageSize = 20;

  final _search = TextEditingController();
  final _scroll = ScrollController();
  final _vendors = <VendorSummary>[];

  Timer? _debounce;
  String _query = '';
  int _page = 0;
  int _total = 0;
  int _generation = 0;
  bool _started = false;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _load(reset: true);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scroll.hasClients) return;
    if (_scroll.position.extentAfter > 400) return;
    if (_loading || _loadingMore || _error != null) return;
    if (_vendors.length >= _total) return;
    _load(reset: false);
  }

  Future<void> _load({required bool reset, bool fromRefresh = false}) async {
    if (reset) {
      _generation++;
      setState(() {
        _loading = true;
        _error = null;
        _vendors.clear();
        _page = 0;
        _total = 0;
      });
    } else {
      if (_loadingMore || _vendors.length >= _total) return;
      setState(() {
        _loadingMore = true;
        _error = null;
      });
    }

    final generation = _generation;
    final nextPage = reset ? 1 : _page + 1;

    try {
      final raw = await AppScope.of(context).api.get(
        '/vendors',
        query: {
          if (_query.isNotEmpty) 'q': _query,
          'page': '$nextPage',
          'page_size': '$_pageSize',
        },
      );
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
      if (!mounted || generation != _generation) return;
      setState(() {
        if (reset) {
          _vendors
            ..clear()
            ..addAll(result.items);
        } else {
          _vendors.addAll(result.items);
        }
        _page = result.page == 0 ? nextPage : result.page;
        _total = result.total;
        _loading = false;
        _loadingMore = false;
      });
    } on ApiException catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = error.userMessage;
        _loading = false;
        _loadingMore = false;
      });
      if (fromRefresh && _vendors.isNotEmpty) _toast(error.userMessage);
    } catch (_) {
      if (!mounted || generation != _generation) return;
      const message =
          'Vendor tidak bisa dimuat. Periksa sinyal, lalu coba lagi.';
      setState(() {
        _error = message;
        _loading = false;
        _loadingMore = false;
      });
      if (fromRefresh && _vendors.isNotEmpty) _toast(message);
    }
  }

  Future<void> _refresh() => _load(reset: true, fromRefresh: true);

  void _toast(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  void _onSearchChanged(String value) {
    setState(() {});
    _debounce?.cancel();
    final trimmed = value.trim();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      final next = trimmed.length >= 2 ? trimmed : '';
      if (next == _query) return;
      _query = next;
      _load(reset: true);
    });
  }

  void _submitSearch(String value) {
    _debounce?.cancel();
    final trimmed = value.trim();
    final next = trimmed.length >= 2 ? trimmed : '';
    if (next == _query) return;
    _query = next;
    _load(reset: true);
  }

  void _clearSearch() {
    _debounce?.cancel();
    _search.clear();
    if (_query.isEmpty) {
      setState(() {});
      return;
    }
    _query = '';
    _load(reset: true);
  }

  void _openVendor(VendorSummary vendor) {
    Navigator.pushNamed(context, Routes.vendor, arguments: vendor.slug);
  }

  /// Shared phones: revoke the token best effort, then always clear locally.
  Future<void> _signOut() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Keluar dari akun?'),
        content: const Text('Kamu perlu masuk lagi untuk melihat booking.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Keluar'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final scope = AppScope.of(context);
    try {
      await scope.api.post('/auth/logout');
    } on ApiException {
      // Revocation is best effort; the local session must go either way.
    }
    await scope.session.signOut();
    if (!mounted) return;
    Navigator.pushNamedAndRemoveUntil(context, Routes.login, (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.circular(9),
              ),
              child: const Icon(
                Icons.music_note_rounded,
                size: 19,
                color: AppColors.onPrimary,
              ),
            ),
            const SizedBox(width: Sp.sm),
            Text('Tarlink', style: Theme.of(context).textTheme.titleLarge),
          ],
        ),
        actions: [
          PopupMenuButton<String>(
            tooltip: 'Menu akun',
            icon: const Icon(Icons.more_vert),
            onSelected: (value) {
              if (value == 'signOut') _signOut();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(
                value: 'signOut',
                height: 48,
                child: Row(
                  children: [
                    Icon(Icons.logout, size: 20),
                    SizedBox(width: Sp.sm),
                    Text('Keluar'),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, Sp.sm),
            child: TextField(
              controller: _search,
              textInputAction: TextInputAction.search,
              onChanged: _onSearchChanged,
              onSubmitted: _submitSearch,
              decoration: InputDecoration(
                hintText: 'Cari tarling, organ, alamat…',
                prefixIcon: const Icon(
                  Icons.search,
                  size: 22,
                  color: AppColors.inkMuted,
                ),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Hapus pencarian',
                        onPressed: _clearSearch,
                        icon: const Icon(Icons.close, size: 20),
                      ),
              ),
            ),
          ),
          Expanded(child: _content()),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: 0,
        onDestinationSelected: (index) {
          if (index == 1) Navigator.pushNamed(context, Routes.bookings);
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Beranda',
          ),
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long),
            label: 'Booking saya',
          ),
        ],
      ),
    );
  }

  Widget _content() {
    if (_loading && _vendors.isEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, Sp.xl),
        children: [
          _greeting(),
          const SizedBox(height: Sp.lg),
          const AppLoading(rows: 4, label: 'Memuat vendor terdekat'),
        ],
      );
    }

    if (_error != null && _vendors.isEmpty) {
      return AppError(message: _error!, onRetry: () => _load(reset: true));
    }

    if (_vendors.isEmpty) {
      return RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, Sp.xl),
          children: [
            _greeting(),
            const SizedBox(height: Sp.xl),
            SizedBox(
              height: 280,
              child: AppEmpty(
                message: 'Belum ada vendor di daerah ini',
                icon: Icons.storefront_outlined,
                action: _query.isEmpty
                    ? null
                    : TextButton(
                        onPressed: _clearSearch,
                        child: const Text('Hapus pencarian'),
                      ),
              ),
            ),
          ],
        ),
      );
    }

    final showFooter =
        _vendors.length < _total || _loadingMore || _error != null;
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView.builder(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, Sp.xl),
        itemCount: 1 + _vendors.length + (showFooter ? 1 : 0),
        itemBuilder: (context, index) {
          if (index == 0) return _header();
          final vendorIndex = index - 1;
          if (vendorIndex < _vendors.length) {
            return Padding(
              padding: const EdgeInsets.only(bottom: Sp.md),
              child: _VendorCard(
                vendor: _vendors[vendorIndex],
                onTap: () => _openVendor(_vendors[vendorIndex]),
              ),
            );
          }
          if (_error != null) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AppError(message: _error!, compact: true),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => _load(reset: false),
                    child: const Text('Coba lagi'),
                  ),
                ),
              ],
            );
          }
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: Sp.lg),
            child: Center(
              child: SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2.4),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _greeting() {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _query.isEmpty
              ? 'Malam ini mau\ntarling di mana?'
              : 'Hasil “$_query”',
          style: text.displaySmall,
        ),
        const SizedBox(height: Sp.sm),
        Text(
          _query.isEmpty
              ? 'Vendor tarling terverifikasi di Pantura.'
              : 'Ketuk vendor untuk lihat paket dan jadwal.',
          style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
        ),
      ],
    );
  }

  Widget _header() {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: Sp.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _greeting(),
          const SizedBox(height: Sp.xl),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Text(
                  _query.isEmpty ? 'Vendor di sekitar' : 'Vendor ditemukan',
                  style: text.titleLarge,
                ),
              ),
              if (_total > 0) Text('$_total vendor', style: text.bodySmall),
            ],
          ),
        ],
      ),
    );
  }
}

class _VendorCard extends StatelessWidget {
  const _VendorCard({required this.vendor, required this.onTap});

  final VendorSummary vendor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final price = vendor.startingPriceIdr == 0
        ? 'Harga belum diisi'
        : 'Mulai ${rupiah(vendor.startingPriceIdr)}';
    final packages = vendor.packageCount == 0
        ? 'Belum ada paket'
        : '${vendor.packageCount} paket';

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
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(vendor.displayName, style: text.titleLarge),
                  ),
                  const SizedBox(width: Sp.sm),
                  _RatingBadge(rating: vendor.rating),
                ],
              ),
              const SizedBox(height: Sp.xs),
              Row(
                children: [
                  const Icon(
                    Icons.place_outlined,
                    size: 16,
                    color: AppColors.inkMuted,
                  ),
                  const SizedBox(width: Sp.xs),
                  Expanded(
                    child: Text(vendor.regionName, style: text.bodySmall),
                  ),
                ],
              ),
              const SizedBox(height: Sp.md),
              Wrap(
                spacing: Sp.sm,
                runSpacing: Sp.xs,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    price,
                    style: text.titleMedium?.copyWith(
                      color: vendor.startingPriceIdr == 0
                          ? AppColors.inkMuted
                          : AppColors.accent,
                    ),
                  ),
                  Text('· $packages', style: text.bodySmall),
                ],
              ),
              const SizedBox(height: Sp.md),
              Row(
                children: [
                  Container(
                    width: 7,
                    height: 7,
                    decoration: const BoxDecoration(
                      color: AppColors.accent,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: Sp.sm),
                  Expanded(
                    child: Text('Menerima pesanan', style: text.labelSmall),
                  ),
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

class _RatingBadge extends StatelessWidget {
  const _RatingBadge({required this.rating});

  final double? rating;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final value = rating;
    if (value == null) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: Sp.md, vertical: Sp.xs),
        decoration: BoxDecoration(
          color: AppColors.neutralSoft,
          borderRadius: BorderRadius.circular(Radii.pill),
        ),
        child: Text(
          'Baru',
          style: text.labelSmall?.copyWith(color: AppColors.inkMuted),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Sp.md, vertical: Sp.xs),
      decoration: BoxDecoration(
        color: AppColors.warningSoft,
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.star_rounded, size: 16, color: AppColors.warning),
          const SizedBox(width: 2),
          Text(
            value.toStringAsFixed(1).replaceAll('.', ','),
            style: text.labelSmall?.copyWith(color: AppColors.warning),
          ),
        ],
      ),
    );
  }
}
