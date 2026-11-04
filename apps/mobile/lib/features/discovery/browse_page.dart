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

/// Jelajah: every approved vendor, filtered only by what the API really
/// supports — text search, a region present in the loaded list, and sorting.
class BrowsePage extends StatefulWidget {
  const BrowsePage({super.key, this.initialQuery = '', this.initialCategory});

  final String initialQuery;
  final String? initialCategory;

  @override
  State<BrowsePage> createState() => _BrowsePageState();
}

class _BrowsePageState extends State<BrowsePage> {
  static const _pageSize = 20;

  final _search = TextEditingController();
  final _vendors = <VendorSummary>[];
  final _categories = <VendorCategory>[];

  int _generation = 0;
  int _page = 0;
  int _total = 0;
  int _sort = 0;
  String _query = '';
  String? _region;
  String? _category;
  DateTime? _date;
  String? _error;
  bool _started = false;
  bool _loading = true;
  bool _loadingMore = false;
  bool _showFilterPanel = false;

  @override
  void initState() {
    super.initState();
    _query = widget.initialQuery.trim();
    _search.text = _query;
    final category = widget.initialCategory?.trim() ?? '';
    _category = category.isEmpty ? null : category;
    _showFilterPanel = _category != null;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _loadCategories();
    _load(reset: true);
  }

  Future<void> _loadCategories() async {
    try {
      final raw = await AppScope.of(context).api.get('/categories');
      if (!mounted || raw is! Map) return;
      final items = _categoriesFrom(raw);
      setState(() => _categories
        ..clear()
        ..addAll(items));
    } catch (_) {
      // Kategori hanya pelengkap filter; kegagalan muat tidak memblokir vendor.
    }
  }

  List<VendorCategory> _categoriesFrom(Map raw) {
    final items = raw['items'];
    if (items is! List) return const [];
    return items
        .whereType<Map>()
        .map((item) => VendorCategory.fromJson(item.cast<String, dynamic>()))
        .where((category) => category.slug.isNotEmpty && category.name.isNotEmpty)
        .toList(growable: false);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({required bool reset, bool fromRefresh = false}) async {
    final api = AppScope.of(context).api;

    if (reset) {
      _generation++;
      if (!fromRefresh) {
        setState(() {
          _loading = true;
          _error = null;
          _vendors.clear();
          _page = 0;
          _total = 0;
        });
      }
    } else {
      if (_loading || _loadingMore || _vendors.length >= _total) return;
      setState(() {
        _loadingMore = true;
        _error = null;
      });
    }

    final generation = _generation;
    final nextPage = reset ? 1 : _page + 1;

    try {
      final raw = await api.get(
        '/vendors',
        query: {
          if (_query.isNotEmpty) 'q': _query,
          if (_category != null) 'category': _category!,
          if (_date != null) 'date': isoDate(_date!),
          'sort': _sort == 1 ? 'name_asc' : 'price_asc',
          'page': '$nextPage',
          'page_size': '$_pageSize',
        },
      );
      if (!mounted || generation != _generation) return;
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
        _error = null;
        if (_region != null &&
            !_vendors.any((vendor) => vendor.regionName.trim() == _region)) {
          _region = null;
        }
      });
    } on ApiException catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = apiMessage(error);
        _loading = false;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = 'Vendor tidak bisa dimuat. Periksa sinyal, lalu coba lagi.';
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  Future<void> _refresh() => _load(reset: true, fromRefresh: true);

  void _submit(String value) {
    FocusManager.instance.primaryFocus?.unfocus();
    final next = value.trim();
    _search.text = next;
    if (next == _query) return;
    _query = next;
    _load(reset: true);
  }

  void _clearSearch() {
    _search.clear();
    if (_query.isEmpty) return;
    _query = '';
    _load(reset: true);
  }

  void _setCategory(String? slug) {
    if (_category == slug) return;
    setState(() {
      _category = slug;
      _region = null;
    });
    _load(reset: true);
  }

  Future<void> _pickDate() async {
    final today = DateTime.now();
    final first = DateTime(today.year, today.month, today.day);
    final picked = await showTarlinkDatePicker(
      context: context,
      initialDate: _date ?? first,
      firstDate: first,
      lastDate: DateTime(today.year + 3, 12, 31),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _date = DateTime(picked.year, picked.month, picked.day);
      _region = null;
    });
    _load(reset: true);
  }

  void _clearDate() {
    if (_date == null) return;
    setState(() {
      _date = null;
      _region = null;
    });
    _load(reset: true);
  }

  void _setSort(int index) {
    if (_sort == index) return;
    setState(() => _sort = index);
    _load(reset: true);
  }

  void _resetFilters() {
    setState(() {
      _category = null;
      _date = null;
      _region = null;
      _sort = 0;
    });
    _load(reset: true);
  }

  void _openVendor(VendorSummary vendor) {
    Navigator.pushNamed(context, Routes.vendor, arguments: vendor.slug);
  }

  List<String> get _regions {
    final names = <String>{};
    for (final vendor in _vendors) {
      final name = vendor.regionName.trim();
      if (name.isNotEmpty) names.add(name);
    }
    return names.toList()..sort();
  }

  /// Regions stay client-side: the API filters by region code, while the chips
  /// are built from the region names that actually arrived in this page set.
  List<VendorSummary> get _visible {
    if (_region == null) return List<VendorSummary>.of(_vendors);
    return _vendors
        .where((vendor) => vendor.regionName.trim() == _region)
        .toList(growable: false);
  }

  String get _subtitle {
    if (_loading && _vendors.isEmpty) return 'Memuat vendor';
    if (_region != null) return '${_visible.length} dari $_total vendor';
    return '$_total vendor';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          StageHeader(
            title: 'Jelajah Vendor',
            subtitle: _subtitle,
            leading: const BrandMark(),
            bottom: StageSearchField(
              controller: _search,
              hint: 'Cari grup tarling, dangdut, organ, sound…',
              onSubmitted: _submit,
              onClear: _clearSearch,
            ),
          ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    final visible = _visible;
    // Keep the filters visible when the result is empty: otherwise a category
    // with no vendor would hide the chips that let the user switch away. They
    // also stay put while a category/date reload is in flight.
    final showFilters = !_loading || _vendors.isNotEmpty || _categories.isNotEmpty;

    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          if (showFilters) SliverToBoxAdapter(child: _filters()),
          if (_loading && _vendors.isEmpty)
            const SliverPadding(
              padding: EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, Sp.xl),
              sliver: SliverToBoxAdapter(
                child: AppLoading(rows: 4, label: 'Memuat vendor'),
              ),
            )
          else if (_error != null && _vendors.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: AppError(
                message: _error!,
                onRetry: () => _load(reset: true),
              ),
            )
          else if (visible.isEmpty)
            SliverFillRemaining(hasScrollBody: false, child: _emptyState())
          else ...[
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, 0),
              sliver: SliverList.builder(
                itemCount: visible.length,
                itemBuilder: (context, index) => Padding(
                  padding: EdgeInsets.only(
                    bottom: index == visible.length - 1 ? 0 : Sp.sm,
                  ),
                  child: TweenAnimationBuilder<double>(
                    key: ValueKey('vendor-${visible[index].id}'),
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
                      vendor: visible[index],
                      onTap: () => _openVendor(visible[index]),
                    ),
                  ),
                ),
              ),
            ),
            SliverToBoxAdapter(child: _footer(visible.length)),
          ],
        ],
      ),
    );
  }

  Widget _filters() {
    final regions = _regions;
    final hasActiveFilters =
        _category != null || _date != null || _region != null || _sort != 0;
    final activeCount = (_category != null ? 1 : 0) +
        (_date != null ? 1 : 0) +
        (_region != null ? 1 : 0) +
        (_sort != 0 ? 1 : 0);

    return Padding(
      padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, 0),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(Radii.lg),
          border: Border.all(color: AppColors.line),
          boxShadow: const [
            BoxShadow(
              color: Color(0x060B1220),
              blurRadius: 8,
              offset: Offset(0, 2),
            ),
          ],
        ),
        padding: const EdgeInsets.all(Sp.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              onTap: () => setState(() => _showFilterPanel = !_showFilterPanel),
              borderRadius: BorderRadius.circular(Radii.sm),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    Expanded(
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.tune_rounded,
                            size: 16,
                            color: (hasActiveFilters || _showFilterPanel)
                                ? AppColors.primary
                                : AppColors.inkMuted,
                          ),
                          const SizedBox(width: Sp.xs + 2),
                          Flexible(
                            child: Text(
                              'Filter & Urutan',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: (hasActiveFilters || _showFilterPanel)
                                    ? AppColors.primary
                                    : AppColors.ink,
                              ),
                            ),
                          ),
                          if (activeCount > 0) ...[
                            const SizedBox(width: Sp.xs + 2),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: AppColors.primary,
                                borderRadius: BorderRadius.circular(Radii.pill),
                              ),
                              child: Text(
                                '$activeCount',
                                style: const TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.onPrimary,
                                ),
                              ),
                            ),
                          ],
                          const SizedBox(width: Sp.xs),
                          Icon(
                            _showFilterPanel
                                ? Icons.keyboard_arrow_up
                                : Icons.keyboard_arrow_down,
                            size: 18,
                            color: AppColors.inkMuted,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: Sp.sm),
                    if (hasActiveFilters)
                      InkWell(
                        onTap: _resetFilters,
                        borderRadius: BorderRadius.circular(Radii.sm),
                        child: const Padding(
                          padding:
                              EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.refresh_rounded,
                                size: 13,
                                color: AppColors.tertiary,
                              ),
                              SizedBox(width: 3),
                              Text(
                                'Reset',
                                style: TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.tertiary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      )
                    else
                      Text(
                        '$_total vendor',
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w500,
                          color: AppColors.inkMuted,
                        ),
                      ),
                  ],
                ),
              ),
            ),
            if (_showFilterPanel) ...[
              const SizedBox(height: Sp.sm),
              if (_categories.isNotEmpty) ...[
                SizedBox(
                  height: 36,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: _categories.length + 1,
                    separatorBuilder: (_, _) => const SizedBox(width: Sp.sm),
                    itemBuilder: (context, index) {
                      if (index == 0) {
                        return SelectChip(
                          label: 'Semua kategori',
                          selected: _category == null,
                          onTap: () => _setCategory(null),
                          compact: true,
                        );
                      }
                      final category = _categories[index - 1];
                      return SelectChip(
                        label: category.name,
                        selected: _category == category.slug,
                        onTap: () => _setCategory(category.slug),
                        compact: true,
                      );
                    },
                  ),
                ),
                const SizedBox(height: Sp.sm),
              ],
              Row(
                children: [
                  Expanded(child: _dateTile()),
                  const SizedBox(width: Sp.sm),
                  Expanded(child: _regionTile(regions)),
                ],
              ),
              const SizedBox(height: Sp.sm),
              SegmentBar(
                items: const ['Termurah', 'Nama A-Z'],
                index: _sort,
                onChanged: _setSort,
              ),
            ] else ...[
              const Offstage(
                offstage: true,
                child: SizedBox(
                  height: 0,
                  child: SelectChip(label: '', selected: false),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _dateTile() {
    final active = _date != null;
    return Material(
      color: active ? AppColors.surfaceTint : AppColors.surfaceSoft,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.sm),
        side: BorderSide(
          color: active ? AppColors.primary : AppColors.line,
          width: active ? 1.5 : 1.0,
        ),
      ),
      child: InkWell(
        onTap: _pickDate,
        borderRadius: BorderRadius.circular(Radii.sm),
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: Sp.md),
          child: Row(
            children: [
              Icon(
                Icons.event_outlined,
                size: 16,
                color: active ? AppColors.primary : AppColors.inkMuted,
              ),
              const SizedBox(width: Sp.xs + 2),
              Expanded(
                child: Text(
                  active ? formatDate(_date!) : 'Tanggal Acara',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                    color: active ? AppColors.primary : AppColors.inkMuted,
                  ),
                ),
              ),
              if (active) ...[
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: _clearDate,
                  child: const Padding(
                    padding: EdgeInsets.all(4),
                    child: Icon(Icons.close, size: 16, color: AppColors.primary),
                  ),
                ),
              ] else ...[
                const Icon(
                  Icons.keyboard_arrow_down,
                  size: 16,
                  color: AppColors.inkMuted,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _regionTile(List<String> regions) {
    final active = _region != null;
    final hasRegions = regions.isNotEmpty;
    return Material(
      color: active ? AppColors.surfaceTint : AppColors.surfaceSoft,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.sm),
        side: BorderSide(
          color: active ? AppColors.primary : AppColors.line,
          width: active ? 1.5 : 1.0,
        ),
      ),
      child: InkWell(
        onTap: hasRegions ? () => _openRegionPicker(regions) : null,
        borderRadius: BorderRadius.circular(Radii.sm),
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: Sp.md),
          child: Row(
            children: [
              Icon(
                Icons.location_on_outlined,
                size: 16,
                color: active ? AppColors.primary : AppColors.inkMuted,
              ),
              const SizedBox(width: Sp.xs + 2),
              Expanded(
                child: Text(
                  active ? _region! : 'Semua Wilayah',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                    color: active ? AppColors.primary : AppColors.inkMuted,
                  ),
                ),
              ),
              if (active) ...[
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => setState(() => _region = null),
                  child: const Padding(
                    padding: EdgeInsets.all(4),
                    child: Icon(Icons.close, size: 16, color: AppColors.primary),
                  ),
                ),
              ] else ...[
                const Icon(
                  Icons.keyboard_arrow_down,
                  size: 16,
                  color: AppColors.inkMuted,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _openRegionPicker(List<String> regions) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.xl)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: Sp.md),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, Sp.sm),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.location_on_outlined,
                        size: 20,
                        color: AppColors.primary,
                      ),
                      const SizedBox(width: Sp.sm),
                      Text(
                        'Pilih Wilayah Pantura',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink,
                            ),
                      ),
                      const Spacer(),
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        icon: const Icon(Icons.close, size: 20),
                        color: AppColors.inkMuted,
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1, color: AppColors.line),
                ListTile(
                  leading: Icon(
                    _region == null
                        ? Icons.radio_button_checked
                        : Icons.radio_button_off,
                    color: _region == null ? AppColors.primary : AppColors.inkMuted,
                  ),
                  title: const Text(
                    'Semua Wilayah',
                    style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                  ),
                  selected: _region == null,
                  onTap: () {
                    setState(() => _region = null);
                    Navigator.pop(context);
                  },
                ),
                ...regions.map(
                  (r) => ListTile(
                    leading: Icon(
                      _region == r
                          ? Icons.radio_button_checked
                          : Icons.radio_button_off,
                      color:
                          _region == r ? AppColors.primary : AppColors.inkMuted,
                    ),
                    title: Text(
                      r,
                      style: TextStyle(
                        fontWeight: _region == r
                            ? FontWeight.w700
                            : FontWeight.w500,
                        fontSize: 14,
                      ),
                    ),
                    selected: _region == r,
                    onTap: () {
                      setState(() => _region = r);
                      Navigator.pop(context);
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _emptyState() {
    final date = _date;
    if (date != null) {
      return AppEmpty(
        message: 'Belum ada vendor yang tersedia pada ${formatDate(date)}.',
        icon: Icons.event_busy_outlined,
        action: TextButton(
          onPressed: _resetFilters,
          child: const Text('Hapus filter'),
        ),
      );
    }
    final category = _category;
    if (category != null) {
      String? name;
      for (final item in _categories) {
        if (item.slug == category) {
          name = item.name;
          break;
        }
      }
      return AppEmpty(
        message: 'Belum ada vendor di kategori ${name ?? category}.',
        icon: Icons.category_outlined,
        action: TextButton(
          onPressed: _resetFilters,
          child: const Text('Semua kategori'),
        ),
      );
    }
    final region = _region;
    if (region != null) {
      return AppEmpty(
        message: 'Tidak ada vendor di $region.',
        icon: Icons.place_outlined,
        action: TextButton(
          onPressed: () => setState(() => _region = null),
          child: const Text('Semua wilayah'),
        ),
      );
    }
    if (_query.isNotEmpty) {
      return AppEmpty(
        message: "Tidak ada vendor yang cocok dengan '$_query'.",
        icon: Icons.search_off,
        action: TextButton(
          onPressed: _clearSearch,
          child: const Text('Hapus pencarian'),
        ),
      );
    }
    return const AppEmpty(
      message: 'Belum ada vendor yang siap tampil saat ini.',
      icon: Icons.storefront_outlined,
    );
  }

  Widget _footer(int visibleCount) {
    final error = _error;
    final remaining = _total - _vendors.length;
    final hasMore = remaining > 0;

    return Padding(
      padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, Sp.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (error != null) ...[
            AppError(message: error, compact: true),
            const SizedBox(height: Sp.sm),
            TextButton(
              onPressed: () => _load(reset: false),
              child: const Text('Coba lagi'),
            ),
          ] else if (hasMore)
            SizedBox(
              height: 48,
              child: OutlinedButton.icon(
                onPressed: _loadingMore ? null : () => _load(reset: false),
                icon: _loadingMore
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.expand_more, size: 18),
                label: Text(
                  _loadingMore
                      ? 'Memuat…'
                      : 'Muat vendor lainnya (+$remaining)',
                ),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.secondary,
                  side: const BorderSide(color: AppColors.secondary),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Radii.sm),
                  ),
                  textStyle: Theme.of(context).textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            )
          else
            Text(
              '$visibleCount vendor',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
        ],
      ),
    );
  }
}
