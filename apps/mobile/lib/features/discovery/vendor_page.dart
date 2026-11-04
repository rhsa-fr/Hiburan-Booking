import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';

const _weekdays = <String>['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const _tabularFigures = <FontFeature>[FontFeature.tabularFigures()];

/// `Rp 1.500.000` → `Rp1.500.000`, the tighter form DESIGN.md asks for.
String _rp(int amount) => rupiah(amount).replaceFirst('Rp ', 'Rp');

/// Vendor profile, packages, and an honest 45-day schedule view.
class VendorPage extends StatefulWidget {
  const VendorPage({super.key, required this.idOrSlug});

  final String idOrSlug;

  @override
  State<VendorPage> createState() => _VendorPageState();
}

class _VendorPageState extends State<VendorPage> {
  final _packagesKey = GlobalKey();
  final _scheduleKey = GlobalKey();

  VendorDetail? _vendor;
  Availability? _availability;
  String? _vendorError;
  String? _availError;
  bool _loadingAvail = true;
  bool _started = false;
  int _weekIndex = 0;
  String? _packageId;
  String? _date;
  bool? _isFavorite;
  bool _favoriteBusy = false;
  List<Map<String, dynamic>> _reviews = [];
  int _reviewTotal = 0;
  bool _reviewsLoading = false;
  String? _completedBookingId;
  bool _bookingsChecked = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_started) {
      _started = true;
      _bootstrap();
      return;
    }
    final authorized = AppScope.of(context).session.authorized;
    if (_vendor != null && _isFavorite == null && authorized) {
      _loadFavoriteStatus();
    }
    if (_vendor != null && !_bookingsChecked && authorized) {
      _checkCompletedBooking();
    }
  }

  Future<void> _bootstrap() async {
    await _loadVendor();
    if (!mounted || _vendor == null) return;
    _loadFavoriteStatus();
    _loadReviews();
    _checkCompletedBooking();
    await _loadAvailability();
  }

  Future<void> _loadVendor() async {
    setState(() {
      _vendorError = null;
      _isFavorite = null;
    });
    try {
      final raw = await AppScope.of(
        context,
      ).api.get('/vendors/${Uri.encodeComponent(widget.idOrSlug)}');
      final detail = VendorDetail.fromJson(_vendorPayload(raw));
      if (!mounted) return;
      setState(() {
        _vendor = detail;
        if (_packageId != null &&
            !detail.packages.any((item) => item.id == _packageId)) {
          _packageId = null;
        }
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _vendorError = error.userMessage;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _vendorError =
            'Vendor tidak bisa dimuat. Periksa sinyal, lalu coba lagi.';
      });
    }
  }

  Map<String, dynamic> _vendorPayload(dynamic raw) {
    if (raw is! Map) {
      throw const ApiException(
        code: 'INTERNAL_ERROR',
        message: 'Profil vendor tidak bisa dibaca.',
      );
    }
    final data = raw.cast<String, dynamic>();
    final vendor = data['vendor'];
    if (vendor is! Map) {
      throw const ApiException(
        code: 'INTERNAL_ERROR',
        message: 'Profil vendor tidak lengkap.',
      );
    }
    final json = vendor.cast<String, dynamic>();
    json['packages'] = data['packages'];
    return json;
  }

  Future<void> _loadAvailability() async {
    final vendor = _vendor;
    if (vendor == null) return;
    setState(() {
      _loadingAvail = true;
      _availError = null;
    });

    final today = DateTime.now();
    final start = DateTime(today.year, today.month, today.day);
    try {
      final raw = await AppScope.of(context).api.get(
        '/vendors/${vendor.id}/availability',
        query: {
          'from': isoDate(start),
          'to': isoDate(start.add(const Duration(days: 44))),
        },
      );
      if (raw is! Map) {
        throw const ApiException(
          code: 'INTERNAL_ERROR',
          message: 'Jadwal vendor tidak bisa dibaca.',
        );
      }
      final availability = Availability.fromJson(raw.cast<String, dynamic>());
      if (!mounted) return;
      setState(() {
        _availability = availability;
        _loadingAvail = false;
        _weekIndex = 0;
        final dates = _dates();
        final date = _date;
        if (date == null ||
            !dates.contains(date) ||
            _dayState(date) == 'blocked') {
          _date = null;
        }
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _availError = error.userMessage;
        _loadingAvail = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _availError =
            'Jadwal tidak bisa dimuat. Periksa sinyal, lalu coba lagi.';
        _loadingAvail = false;
      });
    }
  }

  Future<void> _loadFavoriteStatus() async {
    final vendor = _vendor;
    if (vendor == null) return;
    if (!AppScope.of(context).session.authorized) return;

    try {
      final raw = await AppScope.of(context).api.get(
        '/favorites/${vendor.id}',
      );
      if (!mounted || _isFavorite != null) return;
      var isFav = false;
      if (raw is Map) {
        if (raw['is_favorite'] is bool) {
          isFav = raw['is_favorite'] as bool;
        } else if (raw['data'] is Map && raw['data']['is_favorite'] is bool) {
          isFav = raw['data']['is_favorite'] as bool;
        }
      }
      if (!mounted || _isFavorite != null) return;
      setState(() {
        _isFavorite = isFav;
      });
    } catch (_) {
      if (!mounted || _isFavorite != null) return;
      setState(() {
        _isFavorite = false;
      });
    }
  }

  Future<void> _loadReviews() async {
    final vendor = _vendor;
    if (vendor == null) return;
    setState(() => _reviewsLoading = true);
    try {
      final raw = await AppScope.of(context).api.get(
        '/vendors/${vendor.id}/reviews',
        query: const {'page': '1', 'page_size': '5'},
      );
      if (!mounted) return;
      if (raw is Map && raw['items'] is List) {
        final items = (raw['items'] as List)
            .whereType<Map>()
            .map((item) => item.cast<String, dynamic>())
            .toList();
        final total = raw['total'] is num
            ? (raw['total'] as num).toInt()
            : items.length;
        setState(() {
          _reviews = items;
          _reviewTotal = total;
          _reviewsLoading = false;
        });
      } else {
        setState(() {
          _reviews = const [];
          _reviewTotal = 0;
          _reviewsLoading = false;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _reviews = const [];
        _reviewTotal = 0;
        _reviewsLoading = false;
      });
    }
  }

  Future<void> _checkCompletedBooking() async {
    final vendor = _vendor;
    if (vendor == null) return;
    if (!AppScope.of(context).session.authorized) return;

    _bookingsChecked = true;
    try {
      final raw = await AppScope.of(context).api.get(
        '/bookings',
        query: const {
          'status': 'completed',
          'page': '1',
          'page_size': '50',
        },
      );
      if (!mounted) return;
      if (raw is Map && raw['items'] is List) {
        final items = raw['items'] as List;
        String? matchingBookingId;
        for (final item in items) {
          if (item is Map) {
            final v = item['vendor'];
            final vendorId = v is Map ? v['id']?.toString() : item['vendor_id']?.toString();
            if (vendorId == vendor.id) {
              matchingBookingId = item['id']?.toString();
              break;
            }
          }
        }
        setState(() {
          _completedBookingId = matchingBookingId;
        });
      }
    } catch (_) {
      // Background check failure is non-fatal.
    }
  }

  Future<void> _openReviewSheet(VendorDetail vendor, String bookingId) async {
    final messenger = ScaffoldMessenger.of(context);
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.lg)),
      ),
      builder: (ctx) => _ReviewSheet(
        vendor: vendor,
        bookingId: bookingId,
      ),
    );
    if (sent == true && mounted) {
      setState(() => _completedBookingId = null);
      messenger.showSnackBar(
        const SnackBar(content: Text('Ulasan berhasil dikirim!')),
      );
      _loadReviews();
    }
  }

  List<String> _dates() {
    final dates = <String>{
      for (final day in _availability?.days ?? const <AvailabilityDay>[])
        day.date,
    }.toList();
    dates.sort();
    return dates;
  }

  /// Aggregates the day's sessions into what the strip can honestly show.
  String _dayState(String date) {
    var available = false;
    var waiting = false;
    for (final day in _availability?.days ?? const <AvailabilityDay>[]) {
      if (day.date != date) continue;
      if (day.state == 'available') {
        available = true;
      } else if (day.state != 'booked' && day.state != 'blocked') {
        waiting = true;
      }
    }
    if (available) return 'available';
    if (waiting) return 'waiting';
    return 'blocked';
  }

  VendorPackage? get _selectedPackage {
    for (final item in _vendor?.packages ?? const <VendorPackage>[]) {
      if (item.id == _packageId) return item;
    }
    return null;
  }

  void _scrollTo(GlobalKey key) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = key.currentContext;
      if (target == null) return;
      Scrollable.ensureVisible(
        target,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
        alignment: 0.02,
      );
    });
  }

  void _choosePackage(VendorPackage item) {
    setState(() => _packageId = item.id);
    _scrollTo(_scheduleKey);
  }

  void _chooseDate(String date) {
    setState(() => _date = date);
  }

  void _continue(VendorDetail vendor) {
    final package = _selectedPackage;
    if (package == null) {
      _scrollTo(_packagesKey);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Pilih paket dulu, ya.')));
      return;
    }
    Navigator.pushNamed(
      context,
      Routes.bookCreate,
      arguments: BookCreateArgs(
        vendorIdOrSlug: vendor.slug,
        packageId: package.id,
      ),
    );
  }

  Future<void> _toggleFavorite(VendorDetail vendor) async {
    if (_favoriteBusy) return;
    final currentlyFavorite = _isFavorite == true;
    final next = !currentlyFavorite;

    setState(() {
      _favoriteBusy = true;
      _isFavorite = next;
    });

    final messenger = ScaffoldMessenger.of(context);
    try {
      if (next) {
        await AppScope.of(context).api.post(
          '/favorites/${Uri.encodeComponent(vendor.id)}',
        );
        if (!mounted) return;
        messenger.hideCurrentSnackBar();
        messenger.showSnackBar(
          const SnackBar(content: Text('Ditambahkan ke favorit')),
        );
      } else {
        await AppScope.of(context).api.delete(
          '/favorites/${Uri.encodeComponent(vendor.id)}',
        );
        if (!mounted) return;
        messenger.hideCurrentSnackBar();
        messenger.showSnackBar(
          const SnackBar(content: Text('Dihapus dari favorit')),
        );
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _isFavorite = currentlyFavorite;
      });
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(SnackBar(content: Text(error.userMessage)));
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isFavorite = currentlyFavorite;
      });
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(
        const SnackBar(content: Text('Gagal memperbarui favorit.')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _favoriteBusy = false;
        });
      }
    }
  }

  Future<void> _openWhatsApp(String raw) async {
    final digits = _waDigits(raw);
    if (digits == null) return;
    var opened = false;
    try {
      opened = await launchUrl(
        Uri.parse('https://wa.me/$digits'),
        mode: LaunchMode.externalApplication,
      );
    } catch (_) {
      opened = false;
    }
    if (!mounted || opened) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('WhatsApp tidak bisa dibuka di HP ini.')),
    );
  }

  String? _waDigits(String raw) {
    var digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.isEmpty) return null;
    if (digits.startsWith('62')) return digits;
    if (digits.startsWith('0')) return '62${digits.substring(1)}';
    if (digits.startsWith('8')) return '62$digits';
    return digits;
  }

  Future<void> _openVideo(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    try {
      final opened = await launchUrl(
        uri,
        mode: LaunchMode.inAppBrowserView,
        browserConfiguration: const BrowserConfiguration(showTitle: true),
      );
      if (!opened) {
        await launchUrl(uri, mode: LaunchMode.platformDefault);
      }
    } catch (_) {
      try {
        await launchUrl(uri, mode: LaunchMode.platformDefault);
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Gagal memutar video pentas.')),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final vendor = _vendor;
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: vendor == null ? _placeholderBody() : _content(vendor),
        ),
      ),
      bottomNavigationBar: vendor == null ? null : _bottomBar(vendor),
    );
  }

  Widget _placeholderBody() {
    return Column(
      children: [
        StageHeader.back(
          context: context,
          title: 'Detail Grup Hiburan',
        ),
        Expanded(
          child: _vendorError != null
              ? AppError(message: _vendorError!, onRetry: _bootstrap)
              : ListView(
                  padding: const EdgeInsets.fromLTRB(
                    Sp.lg,
                    Sp.sm,
                    Sp.lg,
                    Sp.xl,
                  ),
                  children: const [
                    AppLoading(rows: 5, label: 'Memuat vendor dan paket'),
                  ],
                ),
        ),
      ],
    );
  }

  Widget _content(VendorDetail vendor) {
    final description = (vendor.description ?? '').trim();
    final address = (vendor.baseAddress ?? '').trim();
    final transport = _transportLine(vendor);

    return ListView(
      padding: EdgeInsets.zero,
      children: [
        _hero(vendor),
        if (vendor.videoUrl != null && vendor.videoUrl!.trim().isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, 0),
            child: StageVideoCard(
              videoUrl: vendor.videoUrl!,
              thumbnailUrl: vendor.bannerUrl,
              vendorName: vendor.displayName,
              onOpenVideo: () => _openVideo(vendor.videoUrl!),
            ),
          ),
        ],
        if (vendor.photoUrls.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, 0),
            child: MediaGalleryReel(photoUrls: vendor.photoUrls),
          ),
        ],
        if (description.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, 0),
            child: _ExpandableDescription(text: description),
          ),
          const SizedBox(height: Sp.sm),
        ],
        const Padding(
          padding: EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, 0),
          child: Divider(color: AppColors.line),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, 0),
          child: _packages(vendor),
        ),
        const Padding(
          padding: EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, 0),
          child: Divider(color: AppColors.line),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, 0),
          child: _schedule(vendor),
        ),
        if (address.isNotEmpty || transport != null) ...[
          const Padding(
            padding: EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, 0),
            child: Divider(color: AppColors.line),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, 0),
            child: _location(address, transport),
          ),
        ],
        const Padding(
          padding: EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, 0),
          child: Divider(color: AppColors.line),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, 0),
          child: _reviewsSection(vendor),
        ),
        const SizedBox(height: 96),
      ],
    );
  }

  Widget? _headerActions(
    VendorDetail vendor,
    bool isAuthorized,
    String? whatsapp,
  ) {
    final actions = <Widget>[
      if (isAuthorized)
        Tooltip(
          message: _isFavorite == true
              ? 'Hapus dari favorit'
              : 'Tambah ke favorit',
          child: Material(
            color: AppColors.card,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(Radii.sm),
              side: const BorderSide(color: AppColors.line),
            ),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: _favoriteBusy ? null : () => _toggleFavorite(vendor),
              child: SizedBox(
                width: 38,
                height: 38,
                child: Center(
                  child: Icon(
                    _isFavorite == true
                        ? Icons.favorite
                        : Icons.favorite_border,
                    size: 19,
                    color: _isFavorite == true
                        ? AppColors.danger
                        : AppColors.ink,
                  ),
                ),
              ),
            ),
          ),
        ),
      if (whatsapp != null)
        Tooltip(
          message: 'Hubungi via WhatsApp',
          child: Material(
            color: AppColors.card,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(Radii.sm),
              side: const BorderSide(color: AppColors.line),
            ),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => _openWhatsApp(vendor.whatsapp),
              child: const SizedBox(
                width: 38,
                height: 38,
                child: Center(
                  child: Icon(
                    Icons.chat_outlined,
                    size: 19,
                    color: AppColors.ink,
                  ),
                ),
              ),
            ),
          ),
        ),
    ];

    if (actions.isEmpty) return null;
    if (actions.length == 1) return actions.first;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        actions[0],
        const SizedBox(width: Sp.sm),
        actions[1],
      ],
    );
  }

  Widget _hero(VendorDetail vendor) {
    final text = Theme.of(context).textTheme;
    final region = vendor.regionName.trim();
    final category = vendor.categoryName?.trim() ?? '';
    final rating = vendor.rating;
    final ratingText = rating == null || vendor.ratingCount == 0
        ? null
        : '${rating.toStringAsFixed(1)} (${vendor.ratingCount} ulasan)';
    final responseRate = vendor.responseRateBp;
    final responseText = responseRate == null
        ? null
        : 'Respons ${(responseRate / 100).round()}%';
    final whatsapp = _waDigits(vendor.whatsapp);
    final isAuthorized = AppScope.of(context).session.authorized;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        StageHeader.back(
          context: context,
          title: 'Detail Grup Hiburan',
          subtitle: vendor.displayName,
          trailing: _headerActions(vendor, isAuthorized, whatsapp),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, 0),
          child: PosterTile(
            name: vendor.displayName,
            imageUrl: vendor.bannerUrl ?? vendor.avatarUrl,
            aspectRatio: 16 / 9,
            heroTag: 'vendor-poster-${vendor.id}',
            badges: [
              if (category.isNotEmpty) category,
              if (region.isNotEmpty) region,
              if (vendor.videoUrl != null &&
                  vendor.videoUrl!.trim().isNotEmpty)
                '▶ Cuplikan Video',
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  if (vendor.avatarUrl != null &&
                      vendor.avatarUrl!.trim().isNotEmpty) ...[
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.primary, width: 2),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x18000000),
                            blurRadius: 8,
                            offset: Offset(0, 2),
                          ),
                        ],
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: Image.network(
                        vendor.avatarUrl!.trim(),
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const ColoredBox(
                          color: AppColors.surfaceSoft,
                          child: Icon(Icons.person, color: AppColors.primary),
                        ),
                      ),
                    ),
                    const SizedBox(width: Sp.md),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          vendor.displayName,
                          style: text.headlineSmall?.copyWith(
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.3,
                          ),
                        ),
                        const SizedBox(height: Sp.xs),
                        Row(
                          children: [
                            const Icon(
                              Icons.place_outlined,
                              size: 16,
                              color: AppColors.inkMuted,
                            ),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                <String>[
                                  if (region.isNotEmpty) region,
                                  '${vendor.packages.length} paket',
                                ].join(' · '),
                                style: text.bodySmall,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (ratingText != null || responseText != null) ...[
                const SizedBox(height: Sp.xs),
                Row(
                  children: [
                    if (ratingText != null) ...[
                      const Icon(
                        Icons.star_rounded,
                        size: 17,
                        color: AppColors.tertiary,
                      ),
                      const SizedBox(width: 2),
                      Text(
                        ratingText,
                        style: text.bodySmall?.copyWith(
                          color: AppColors.ink,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                    if (ratingText != null && responseText != null)
                      Text(' · ', style: text.bodySmall),
                    if (responseText != null)
                      Flexible(
                        child: Text(
                          responseText,
                          style: text.bodySmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: Sp.md),
              _pricePill(vendor),
            ],
          ),
        ),
      ],
    );
  }

  Widget _pricePill(VendorDetail vendor) {
    final text = Theme.of(context).textTheme;
    final price = _startingPrice(vendor);
    final percent = vendor.minDpBp > 0 ? _percent(vendor.minDpBp) : null;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Mulai dari', style: text.bodySmall?.copyWith(fontSize: 11)),
              Text(
                price == 0 ? 'Harga belum diisi' : _rp(price),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: text.displaySmall?.copyWith(
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                  color: price == 0 ? AppColors.inkMuted : AppColors.primary,
                  fontFeatures: _tabularFigures,
                ),
              ),
            ],
          ),
        ),
        if (percent != null)
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: Sp.sm + 2,
              vertical: Sp.xs + 1,
            ),
            decoration: BoxDecoration(
              color: AppColors.primarySoft,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              'DP $percent%',
              style: text.labelSmall?.copyWith(
                color: AppColors.primaryDeep,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
      ],
    );
  }

  Widget _packages(VendorDetail vendor) {
    final text = Theme.of(context).textTheme;
    return Column(
      key: _packagesKey,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(title: 'Paket'),
        const SizedBox(height: Sp.md),
        if (vendor.packages.isEmpty)
          Container(
            padding: const EdgeInsets.all(Sp.lg),
            decoration: BoxDecoration(
              color: AppColors.card,
              borderRadius: BorderRadius.circular(Radii.lg),
              border: Border.all(color: AppColors.line),
            ),
            child: Text(
              'Belum ada paket untuk vendor ini.',
              style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
            ),
          )
        else
          for (var i = 0; i < vendor.packages.length; i++)
            Padding(
              padding: EdgeInsets.only(
                bottom: i == vendor.packages.length - 1 ? 0 : Sp.md,
              ),
              child: _PackageCard(
                package: vendor.packages[i],
                minDpBp: vendor.minDpBp,
                selected: vendor.packages[i].id == _packageId,
                onChoose: () => _choosePackage(vendor.packages[i]),
              ),
            ),
      ],
    );
  }

  Widget _schedule(VendorDetail vendor) {
    final text = Theme.of(context).textTheme;
    final availability = _availability;

    return Column(
      key: _scheduleKey,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(title: 'Jadwal', caption: '45 hari ke depan'),
        const SizedBox(height: Sp.md),
        if (_loadingAvail)
          const AppLoading(rows: 2, label: 'Memuat jadwal vendor')
        else if (_availError != null) ...[
          AppError(message: _availError!, compact: true),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: _loadAvailability,
              child: const Text('Coba lagi'),
            ),
          ),
        ] else if (availability != null) ...[
          if (availability.stale) ...[
            _staleStrip(vendor, availability),
            const SizedBox(height: Sp.md),
          ],
          _datesStrip(availability),
        ] else
          Text(
            'Jadwal belum tersedia untuk 45 hari ke depan.',
            style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
          ),
      ],
    );
  }

  Widget _staleStrip(VendorDetail vendor, Availability availability) {
    final whatsapp = _waDigits(vendor.whatsapp);
    return InfoStrip(
      message: _staleMessage(availability),
      icon: Icons.history,
      tone: InfoTone.warning,
      actionLabel: whatsapp == null ? null : 'WhatsApp',
      onAction: whatsapp == null ? null : () => _openWhatsApp(vendor.whatsapp),
    );
  }

  String _staleMessage(Availability availability) {
    final updated = availability.calendarUpdatedAt == null
        ? null
        : DateTime.tryParse(availability.calendarUpdatedAt!);
    if (updated == null) {
      return 'Jadwal terakhir belum pernah diperbarui. Konfirmasi ke vendor '
          'lewat WhatsApp.';
    }
    final days = DateTime.now().toUtc().difference(updated.toUtc()).inDays;
    final age = days < 1 ? 1 : days;
    return 'Jadwal terakhir diperbarui $age hari lalu. Konfirmasi ke vendor '
        'lewat WhatsApp.';
  }

  Widget _datesStrip(Availability availability) {
    final text = Theme.of(context).textTheme;
    final dates = _dates();
    if (dates.isEmpty) {
      return Text(
        'Jadwal belum tersedia untuk 45 hari ke depan.',
        style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
      );
    }

    final weeks = <List<String>>[];
    for (var i = 0; i < dates.length; i += 7) {
      weeks.add(dates.sublist(i, i + 7 > dates.length ? dates.length : i + 7));
    }
    final index = _weekIndex.clamp(0, weeks.length - 1);
    final week = weeks[index];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            IconButton(
              tooltip: 'Minggu sebelumnya',
              onPressed: index == 0
                  ? null
                  : () => setState(() => _weekIndex = index - 1),
              icon: const Icon(Icons.chevron_left),
              color: AppColors.inkMuted,
            ),
            Expanded(
              child: Text(
                _weekLabel(week),
                textAlign: TextAlign.center,
                style: text.labelMedium?.copyWith(
                  color: AppColors.ink,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            IconButton(
              tooltip: 'Minggu berikutnya',
              onPressed: index >= weeks.length - 1
                  ? null
                  : () => setState(() => _weekIndex = index + 1),
              icon: const Icon(Icons.chevron_right),
              color: AppColors.inkMuted,
            ),
          ],
        ),
        const SizedBox(height: Sp.sm),
        LayoutBuilder(
          builder: (context, constraints) {
            final cellWidth = ((constraints.maxWidth - Sp.sm * 6) / 7).clamp(
              34.0,
              56.0,
            );
            final states = <String, String>{
              for (final date in week) date: _dayState(date),
            };
            final cells = <Widget>[];
            for (final date in week) {
              final parsed = DateTime.tryParse(date);
              if (parsed == null) continue;
              final state = states[date]!;
              cells.add(
                _DayCell(
                  date: parsed,
                  state: state,
                  selected: date == _date,
                  width: cellWidth,
                  // Blocked days stay visible but cannot be chosen.
                  onTap: state == 'blocked' ? null : () => _chooseDate(date),
                ),
              );
            }
            return Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: cells,
            );
          },
        ),
        const SizedBox(height: Sp.sm),
        const _ScheduleLegend(),
      ],
    );
  }

  String _weekLabel(List<String> week) {
    final first = DateTime.tryParse(week.first);
    final last = DateTime.tryParse(week.last);
    if (first == null || last == null) return '${week.first} – ${week.last}';
    if (first.year == last.year) {
      if (first.month == last.month) {
        return '${first.day} – ${formatDate(last)}';
      }
      return '${formatDayMonth(first)} – ${formatDate(last)}';
    }
    return '${formatDate(first)} – ${formatDate(last)}';
  }

  Widget _location(String address, String? transport) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(title: 'Lokasi & transport'),
        const SizedBox(height: Sp.md),
        Container(
          padding: const EdgeInsets.all(Sp.lg),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(Radii.lg),
            border: Border.all(color: AppColors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (address.isNotEmpty)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding: EdgeInsets.only(top: 2),
                      child: Icon(
                        Icons.place_outlined,
                        size: 18,
                        color: AppColors.inkMuted,
                      ),
                    ),
                    const SizedBox(width: Sp.sm),
                    Expanded(child: Text(address, style: text.bodyMedium)),
                  ],
                ),
              if (address.isNotEmpty && transport != null)
                const SizedBox(height: Sp.sm),
              if (transport != null)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding: EdgeInsets.only(top: 2),
                      child: Icon(
                        Icons.directions_car_outlined,
                        size: 18,
                        color: AppColors.inkMuted,
                      ),
                    ),
                    const SizedBox(width: Sp.sm),
                    Expanded(
                      child: Text(
                        transport,
                        style: text.bodyMedium?.copyWith(
                          color: AppColors.inkMuted,
                        ),
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _reviewsSection(VendorDetail vendor) {
    final text = Theme.of(context).textTheme;
    final displayedReviews = _reviews.take(5).toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(
              child: SectionHeader(title: 'Ulasan Pelanggan'),
            ),
            if (_completedBookingId != null) ...[
              const SizedBox(width: Sp.sm),
              OutlinedButton.icon(
                onPressed: () => _openReviewSheet(vendor, _completedBookingId!),
                icon: const Icon(Icons.rate_review_outlined, size: 16),
                label: const Text('Tulis Ulasan'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.ink,
                  side: const BorderSide(color: AppColors.line),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Radii.sm),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: Sp.md,
                    vertical: Sp.xs,
                  ),
                  textStyle: text.labelSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: Sp.md),
        if (_reviewsLoading)
          const AppLoading(rows: 2, label: 'Memuat ulasan')
        else if (_reviews.isEmpty || _reviewTotal == 0)
          const InfoStrip(
            message: 'Belum ada ulasan untuk vendor ini.',
            icon: Icons.rate_review_outlined,
            tone: InfoTone.neutral,
          )
        else ...[
          for (var i = 0; i < displayedReviews.length; i++)
            Padding(
              padding: EdgeInsets.only(
                bottom: i == displayedReviews.length - 1 && _reviewTotal <= 5
                    ? 0
                    : Sp.sm,
              ),
              child: _ReviewCard(review: displayedReviews[i]),
            ),
          if (_reviewTotal > 5) ...[
            const SizedBox(height: Sp.xs),
            Center(
              child: Text(
                'dan ${_reviewTotal - 5} ulasan lainnya',
                style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
              ),
            ),
          ],
        ],
      ],
    );
  }

  Widget? _bottomBar(VendorDetail vendor) {
    final date = _date == null ? null : DateTime.tryParse(_date!);
    final label = date == null
        ? 'Pilih jadwal'
        : 'Lanjut · ${formatDayMonth(date)}';
    final price = _startingPrice(vendor);
    final hasPackages = vendor.packages.isNotEmpty;

    return StickyActionBar(
      leading: FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerLeft,
        child: Text(
          price == 0 ? 'Harga belum diisi' : 'Mulai ${_rp(price)}',
          maxLines: 1,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w700,
            color: price == 0 ? AppColors.inkMuted : AppColors.ink,
            fontFeatures: _tabularFigures,
          ),
        ),
      ),
      child: PrimaryButton(
        label: hasPackages ? label : 'Belum ada paket',
        onPressed: hasPackages
            ? () {
                if (date == null) {
                  _scrollTo(_scheduleKey);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Pilih tanggal acara dulu, ya.'),
                    ),
                  );
                  return;
                }
                _continue(vendor);
              }
            : null,
      ),
    );
  }

  int _startingPrice(VendorDetail vendor) {
    var best = 0;
    for (final item in vendor.packages) {
      if (item.basePriceIdr <= 0) continue;
      if (best == 0 || item.basePriceIdr < best) best = item.basePriceIdr;
    }
    return best;
  }

  String? _transportLine(VendorDetail vendor) {
    final parts = <String>[
      if (vendor.transportFeePerKmIdr > 0)
        'Biaya transport ${_rp(vendor.transportFeePerKmIdr)}/km',
      if (vendor.serviceRadiusKm > 0)
        'jangkauan ${_kilometers(vendor.serviceRadiusKm)} km',
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}

class _ExpandableDescription extends StatefulWidget {
  const _ExpandableDescription({required this.text});

  final String text;

  @override
  State<_ExpandableDescription> createState() => _ExpandableDescriptionState();
}

class _ExpandableDescriptionState extends State<_ExpandableDescription> {
  static const _maxLines = 4;

  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyLarge;
    return LayoutBuilder(
      builder: (context, constraints) {
        final painter = TextPainter(
          text: TextSpan(text: widget.text, style: style),
          maxLines: _maxLines,
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
        )..layout(maxWidth: constraints.maxWidth);
        final clamped = painter.didExceedMaxLines;
        painter.dispose();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.text,
              style: style,
              maxLines: _expanded ? null : _maxLines,
              overflow: _expanded ? TextOverflow.clip : TextOverflow.ellipsis,
            ),
            if (clamped)
              TextButton(
                onPressed: () => setState(() => _expanded = !_expanded),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  padding: EdgeInsets.zero,
                  minimumSize: const Size(0, 44),
                  tapTargetSize: MaterialTapTargetSize.padded,
                  textStyle: Theme.of(context).textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
                child: Text(_expanded ? 'Tutup' : 'Baca selengkapnya'),
              ),
          ],
        );
      },
    );
  }
}

class _PackageCard extends StatelessWidget {
  const _PackageCard({
    required this.package,
    required this.minDpBp,
    required this.selected,
    required this.onChoose,
  });

  final VendorPackage package;
  final int minDpBp;
  final bool selected;
  final VoidCallback onChoose;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final meta = <String>[
      if (package.durationMinutes > 0) _duration(package.durationMinutes),
      if (package.personnelCount > 0) '${package.personnelCount} personel',
    ].join(' · ');
    final dp = minDpBp > 0 ? package.basePriceIdr * minDpBp ~/ 10000 : 0;
    final hasPhoto = package.photoUrl != null && package.photoUrl!.trim().isNotEmpty;

    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: AppColors.card,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.lg),
          side: BorderSide(
            color: selected ? AppColors.primary : AppColors.line,
            width: selected ? 2 : 1,
          ),
        ),
        child: InkWell(
          onTap: onChoose,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (hasPhoto)
                AspectRatio(
                  aspectRatio: 16 / 7,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      Image.network(
                        package.photoUrl!.trim(),
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const ColoredBox(
                          color: AppColors.surfaceSoft,
                          child: Icon(Icons.music_note, color: AppColors.inkMuted),
                        ),
                      ),
                      Positioned(
                        top: Sp.sm,
                        right: Sp.sm,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.6),
                            borderRadius: BorderRadius.circular(Radii.pill),
                          ),
                          child: Text(
                            meta,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              Padding(
                padding: const EdgeInsets.all(Sp.lg),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            package.name,
                            style: text.titleLarge,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          if (meta.isNotEmpty && !hasPhoto) ...[
                            const SizedBox(height: Sp.xs),
                            Text(meta, style: text.bodySmall),
                          ],
                          const SizedBox(height: Sp.sm),
                          Text(
                            _rp(package.basePriceIdr),
                            style: text.titleMedium?.copyWith(
                              color: AppColors.ink,
                              fontWeight: FontWeight.w700,
                              fontFeatures: _tabularFigures,
                            ),
                          ),
                      if (dp > 0) ...[
                        const SizedBox(height: 2),
                        Text(
                          'DP ${_rp(dp)} · ${_percent(minDpBp)}%',
                          style: text.bodySmall,
                        ),
                      ],
                      if (package.inclusions.isNotEmpty) ...[
                        const SizedBox(height: Sp.md),
                        Text(
                          'Fasilitas',
                          style: text.labelSmall?.copyWith(
                            color: AppColors.inkMuted,
                          ),
                        ),
                        const SizedBox(height: Sp.xs),
                        for (final item in package.inclusions)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 2),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Padding(
                                  padding: EdgeInsets.only(top: 2),
                                  child: Icon(
                                    Icons.check,
                                    size: 13,
                                    color: AppColors.accent,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    item,
                                    style: text.bodySmall?.copyWith(
                                      color: AppColors.ink,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                      if (package.addons.isNotEmpty) ...[
                        const SizedBox(height: Sp.md),
                        Text(
                          'Add-on',
                          style: text.labelSmall?.copyWith(
                            color: AppColors.inkMuted,
                          ),
                        ),
                        const SizedBox(height: Sp.xs),
                        for (final addon in package.addons)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 2),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Text(
                                    addon.name,
                                    style: text.bodySmall?.copyWith(
                                      color: AppColors.ink,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: Sp.sm),
                                Text(_addonPrice(addon), style: text.bodySmall),
                              ],
                            ),
                          ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: Sp.md),
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Icon(
                    selected ? Icons.check_circle_rounded : Icons.chevron_right,
                    size: 22,
                    color: selected ? AppColors.primary : AppColors.inkMuted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  ),
);
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.date,
    required this.state,
    required this.selected,
    required this.width,
    required this.onTap,
  });

  final DateTime date;
  final String state;
  final bool selected;
  final double width;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final disabled = onTap == null;
    final waiting = state == 'waiting';
    final background = selected
        ? AppColors.primary
        : disabled
        ? AppColors.neutralSoft
        : waiting
        ? AppColors.warningSoft
        : AppColors.accentSoft;
    final border = selected
        ? AppColors.primary
        : disabled
        ? Colors.transparent
        : waiting
        ? AppColors.warning.withValues(alpha: 0.35)
        : AppColors.accent.withValues(alpha: 0.35);
    final dayColor = selected
        ? AppColors.onPrimary
        : disabled
        ? AppColors.inkMuted
        : waiting
        ? AppColors.warning
        : AppColors.accent;
    final weekdayColor = selected
        ? AppColors.onPrimary.withValues(alpha: 0.85)
        : AppColors.inkMuted;

    return Semantics(
      button: !disabled,
      enabled: !disabled,
      selected: selected,
      label: '${formatDate(date)}, ${_stateLabel(state)}',
      excludeSemantics: true,
      child: SizedBox(
        width: width,
        height: 56,
        child: Material(
          color: background,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Radii.sm),
            side: BorderSide(color: border, width: selected ? 1.5 : 1),
          ),
          child: InkWell(
            onTap: onTap,
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _weekdays[date.weekday - 1],
                    maxLines: 1,
                    style: text.labelSmall?.copyWith(
                      fontSize: 10,
                      height: 1.2,
                      fontWeight: FontWeight.w600,
                      color: weekdayColor,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${date.day}',
                    maxLines: 1,
                    style: text.titleMedium?.copyWith(
                      fontSize: 15,
                      height: 1.2,
                      fontWeight: FontWeight.w700,
                      color: dayColor,
                      fontFeatures: _tabularFigures,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Container(
                    width: 4,
                    height: 4,
                    decoration: BoxDecoration(
                      color: waiting
                          ? (selected ? AppColors.onPrimary : AppColors.warning)
                          : Colors.transparent,
                      shape: BoxShape.circle,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ScheduleLegend extends StatelessWidget {
  const _ScheduleLegend();

  @override
  Widget build(BuildContext context) {
    return const Wrap(
      spacing: Sp.md,
      runSpacing: Sp.xs,
      children: [
        _LegendItem(
          label: 'Tersedia',
          background: AppColors.card,
          border: AppColors.line,
        ),
        _LegendItem(
          label: 'Menunggu konfirmasi',
          background: AppColors.warningSoft,
          border: AppColors.warning,
        ),
        _LegendItem(
          label: 'Terisi',
          background: AppColors.neutralSoft,
          border: AppColors.neutralSoft,
        ),
      ],
    );
  }
}

class _LegendItem extends StatelessWidget {
  const _LegendItem({
    required this.label,
    required this.background,
    required this.border,
  });

  final String label;
  final Color background;
  final Color border;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 9,
          height: 9,
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(3),
            border: Border.all(color: border),
          ),
        ),
        const SizedBox(width: Sp.xs + 2),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

String _stateLabel(String state) => switch (state) {
  'available' => 'Tersedia',
  'waiting' => 'Menunggu konfirmasi',
  'blocked' => 'Terisi atau tutup',
  _ => 'Belum jelas',
};

String _duration(int minutes) {
  if (minutes <= 0) return 'Durasi belum diisi';
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  if (hours == 0) return '$rest menit';
  if (rest == 0) return '$hours jam';
  return '$hours jam $rest menit';
}

String _percent(int basisPoints) {
  final percent = basisPoints / 100;
  final value = percent == percent.roundToDouble()
      ? percent.toStringAsFixed(0)
      : percent.toStringAsFixed(1);
  return value.replaceAll('.', ',');
}

String _kilometers(double value) {
  final rounded = (value * 10).round() / 10;
  return rounded == rounded.roundToDouble()
      ? rounded.toStringAsFixed(0)
      : rounded.toStringAsFixed(1).replaceAll('.', ',');
}

String _addonPrice(Addon addon) {
  final unit = addon.unit.trim();
  final per = unit.isEmpty ? '' : ' / $unit';
  final max = addon.maxQty > 0 ? ' · maks ${addon.maxQty}' : '';
  return '${_rp(addon.priceIdr)}$per$max';
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.review});

  final Map<String, dynamic> review;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final customerName = (review['customer_name'] as String?)?.trim();
    final name = (customerName != null && customerName.isNotEmpty)
        ? customerName
        : 'Pelanggan';
    final ratingNum = (review['rating'] as num?)?.toInt() ?? 0;
    final rating = ratingNum.clamp(0, 5);
    final comment = (review['comment'] as String?)?.trim();
    final createdAt = review['created_at'] as String?;

    return Container(
      padding: const EdgeInsets.all(Sp.md),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(Radii.lg),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  name,
                  style: text.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (createdAt != null && createdAt.isNotEmpty) ...[
                const SizedBox(width: Sp.sm),
                Text(
                  formatDateIso(createdAt),
                  style: text.bodySmall?.copyWith(
                    color: AppColors.inkMuted,
                    fontSize: 11,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: Sp.xs),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: List.generate(5, (index) {
              final filled = index < rating;
              return Icon(
                filled ? Icons.star : Icons.star_border,
                size: 14,
                color: filled ? AppColors.warning : AppColors.line,
              );
            }),
          ),
          if (comment != null && comment.isNotEmpty) ...[
            const SizedBox(height: Sp.sm),
            Text(
              comment,
              style: text.bodyMedium?.copyWith(
                color: AppColors.ink,
                height: 1.4,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ReviewSheet extends StatefulWidget {
  const _ReviewSheet({
    required this.vendor,
    required this.bookingId,
  });

  final VendorDetail vendor;
  final String bookingId;

  @override
  State<_ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends State<_ReviewSheet> {
  int _rating = 0;
  late final TextEditingController _commentController;
  bool _submitting = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _commentController = TextEditingController();
  }

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_rating < 1 || _submitting) return;

    setState(() {
      _submitting = true;
      _errorMessage = null;
    });

    try {
      final comment = _commentController.text.trim();
      await AppScope.of(context).api.post(
        '/bookings/${widget.bookingId}/review',
        body: {
          'rating': _rating,
          if (comment.isNotEmpty) 'comment': comment,
        },
      );
      if (!mounted) return;
      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        if (error.statusCode == 409 || error.code == 'CONFLICT') {
          _errorMessage = 'Kamu sudah memberikan ulasan untuk booking ini.';
        } else {
          _errorMessage = error.userMessage;
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _errorMessage = 'Gagal mengirim ulasan. Coba lagi sebentar.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(Sp.xl, Sp.md, Sp.xl, Sp.xl + bottomInset),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.neutralSoft,
                    borderRadius: BorderRadius.circular(Radii.pill),
                  ),
                ),
              ),
              const SizedBox(height: Sp.md),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Tulis Ulasan',
                    style: text.titleLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(
                      Icons.close,
                      size: 20,
                      color: AppColors.inkMuted,
                    ),
                    onPressed: _submitting
                        ? null
                        : () => Navigator.pop(context, false),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
              const SizedBox(height: Sp.xs),
              Text(
                widget.vendor.displayName,
                style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
              ),
              const SizedBox(height: Sp.lg),
              Center(
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: List.generate(5, (index) {
                    final starNum = index + 1;
                    final isFilled = starNum <= _rating;
                    return IconButton(
                      iconSize: 32,
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      visualDensity: VisualDensity.compact,
                      tooltip: '$starNum bintang',
                      onPressed: _submitting
                          ? null
                          : () => setState(() => _rating = starNum),
                      icon: Icon(
                        isFilled
                            ? Icons.star_rounded
                            : Icons.star_outline_rounded,
                        color: isFilled ? AppColors.warning : AppColors.line,
                      ),
                    );
                  }),
                ),
              ),
              const SizedBox(height: Sp.lg),
              TextField(
                controller: _commentController,
                maxLength: 500,
                maxLines: 4,
                minLines: 3,
                enabled: !_submitting,
                decoration: InputDecoration(
                  hintText: 'Tulis ulasan tentang vendor ini (opsional)...',
                  hintStyle: text.bodyMedium?.copyWith(
                    color: AppColors.inkMuted,
                  ),
                  filled: true,
                  fillColor: AppColors.surface,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(Radii.sm),
                    borderSide: const BorderSide(color: AppColors.line),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(Radii.sm),
                    borderSide: const BorderSide(color: AppColors.line),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(Radii.sm),
                    borderSide: const BorderSide(
                      color: AppColors.primary,
                      width: 1.5,
                    ),
                  ),
                  counterStyle: text.bodySmall?.copyWith(
                    color: AppColors.inkMuted,
                  ),
                ),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: Sp.sm),
                InfoStrip(
                  message: _errorMessage!,
                  tone: InfoTone.danger,
                  icon: Icons.error_outline,
                ),
              ],
              const SizedBox(height: Sp.lg),
              PrimaryButton(
                label: 'Kirim Ulasan',
                loading: _submitting,
                onPressed: _rating >= 1 && !_submitting ? _submit : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
