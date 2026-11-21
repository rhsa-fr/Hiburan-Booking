import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';
import '../moderation/report_sheet.dart';

const _tabularFigures = <FontFeature>[FontFeature.tabularFigures()];
const _weekdayShort = <String>['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const _monthShort = <String>[
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

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
  String? _packageId;
  String? _date;
  bool? _isFavorite;
  bool _favoriteBusy = false;
  List<Map<String, dynamic>> _reviews = [];
  int _reviewTotal = 0;
  bool _reviewsLoading = false;
  String? _completedBookingId;
  String? _chatBookingId;
  String? _chatBookingCode;
  bool _bookingsChecked = false;
  final _scroll = ScrollController();
  bool _heroSolid = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_syncHeroBar);
  }

  void _syncHeroBar() {
    final solid = _scroll.hasClients && _scroll.offset > 28;
    if (solid != _heroSolid) setState(() => _heroSolid = solid);
  }

  @override
  void dispose() {
    _scroll
      ..removeListener(_syncHeroBar)
      ..dispose();
    super.dispose();
  }

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
        // A vendor is one group with one full-day offering. Keep a valid
        // package selected so the schedule CTA never asks for a package first.
        _packageId ??= detail.packages.isEmpty
            ? null
            : detail.packages.first.id;
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
      final raw = await AppScope.of(context).api.get('/favorites/${vendor.id}');
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
      // One fetch feeds two things: the review entry (completed) and the chat
      // entry (any booking with this vendor, newest first).
      final raw = await AppScope.of(
        context,
      ).api.get('/bookings', query: const {'page': '1', 'page_size': '50'});
      if (!mounted) return;
      if (raw is Map && raw['items'] is List) {
        final items = raw['items'] as List;
        String? completedBookingId;
        String? chatBookingId;
        String? chatBookingCode;
        for (final item in items) {
          if (item is! Map) continue;
          final v = item['vendor'];
          final vendorId = v is Map
              ? v['id']?.toString()
              : item['vendor_id']?.toString();
          if (vendorId != vendor.id) continue;
          final id = item['id']?.toString();
          if (id == null || id.isEmpty) continue;
          chatBookingId ??= id;
          chatBookingCode ??= item['code']?.toString();
          if (item['lifecycle_status']?.toString() == 'completed') {
            completedBookingId ??= id;
          }
        }
        setState(() {
          _completedBookingId = completedBookingId;
          _chatBookingId = chatBookingId;
          _chatBookingCode = chatBookingCode;
        });
      }
    } catch (_) {
      // Background check failure is non-fatal.
    }
  }

  /// Chat is per booking (ADR 0011). With a booking, the bubble opens the real
  /// in-app thread; without one, the sheet explains why and offers a fallback.
  Future<void> _openChatThread(VendorDetail vendor) async {
    final bookingId = _chatBookingId;
    if (bookingId != null) {
      await Navigator.of(context).pushNamed(
        Routes.bookingChat,
        arguments: ChatArgs(
          bookingId: bookingId,
          title: vendor.displayName,
          subtitle: _chatBookingCode == null
              ? 'Chat in-app'
              : 'Booking $_chatBookingCode',
        ),
      );
      return;
    }
    if (!mounted) return;

    final authorized = AppScope.of(context).session.authorized;
    final digits = _waDigits(vendor.whatsapp);
    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.xxl)),
      ),
      builder: (sheetContext) {
        final text = Theme.of(sheetContext).textTheme;
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(Sp.lg, 10, Sp.lg, Sp.lg),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.line,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: Sp.lg),
                const IconBadge(icon: Icons.forum_outlined, size: 44),
                const SizedBox(height: Sp.md),
                Text(
                  authorized
                      ? 'Chat aktif setelah booking'
                      : 'Masuk untuk chat vendor',
                  style: text.titleLarge?.copyWith(
                    fontSize: 19,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.4,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  authorized
                      ? 'Percakapan in-app terikat ke pesanan, jadi aman untuk '
                            'dua pihak. Buat booking dulu; setelah itu tombol '
                            'chat langsung terhubung ke vendor.'
                      : 'Chat Tarlink berjalan di dalam aplikasi dan terikat ke '
                            'pesanan. Masuk dulu, lalu buat booking untuk '
                            'mulai percakapan.',
                  style: text.bodyMedium?.copyWith(
                    color: AppColors.inkMuted,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: Sp.lg),
                PrimaryButton(
                  label: authorized ? 'Lihat paket & tanggal' : 'Masuk ke akun',
                  icon: authorized ? Icons.inventory_2_outlined : Icons.login,
                  onPressed: () => Navigator.pop(
                    sheetContext,
                    authorized ? 'packages' : 'login',
                  ),
                ),
                if (digits != null) ...[
                  const SizedBox(height: Sp.sm),
                  OutlinedButton.icon(
                    onPressed: () => Navigator.pop(sheetContext, 'whatsapp'),
                    icon: const Icon(Icons.chat_bubble_outline, size: 18),
                    label: const Text('WhatsApp (cadangan)'),
                  ),
                ],
                const SizedBox(height: Sp.sm),
                Text(
                  'WhatsApp hanya jalur cadangan; riwayat utama tetap di '
                  'Tarlink.',
                  textAlign: TextAlign.center,
                  style: text.bodySmall,
                ),
              ],
            ),
          ),
        );
      },
    );
    if (!mounted || action == null) return;
    if (action == 'login') {
      Navigator.pushNamed(context, Routes.login);
    } else if (action == 'packages') {
      _scrollTo(_packagesKey);
    } else if (action == 'whatsapp') {
      await _openWhatsApp(vendor.whatsapp);
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
      builder: (ctx) => _ReviewSheet(vendor: vendor, bookingId: bookingId),
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
        alignment: 0.12,
      );
    });
  }

  void _choosePackage(VendorPackage item) {
    setState(() => _packageId = item.id);
    _scrollTo(_scheduleKey);
  }

  /// Same date picker as the Explore page, restricted to the vendor's
  /// 45-day availability window.
  Future<void> _pickDate() async {
    final today = DateTime.now();
    final first = DateTime(today.year, today.month, today.day);
    final selected = _date == null ? null : DateTime.tryParse(_date!);
    final picked = await showTarlinkDatePicker(
      context: context,
      initialDate: selected ?? first,
      firstDate: first,
      lastDate: first.add(const Duration(days: 44)),
    );
    if (picked == null || !mounted) return;
    final date = isoDate(picked);
    if (_dayState(date) == 'blocked') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Tanggal itu sudah terisi. Pilih tanggal lain.'),
        ),
      );
      return;
    }
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
        date: _date,
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
        await AppScope.of(
          context,
        ).api.post('/favorites/${Uri.encodeComponent(vendor.id)}');
        if (!mounted) return;
        messenger.hideCurrentSnackBar();
        messenger.showSnackBar(
          const SnackBar(content: Text('Ditambahkan ke favorit')),
        );
      } else {
        await AppScope.of(
          context,
        ).api.delete('/favorites/${Uri.encodeComponent(vendor.id)}');
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
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: vendor == null
                ? _placeholderBody()
                : Stack(
                    children: [
                      _content(vendor),
                      Positioned(
                        top: 0,
                        left: 0,
                        right: 0,
                        child: _heroBar(vendor),
                      ),
                    ],
                  ),
          ),
        ),
        bottomNavigationBar: vendor == null ? null : _bottomBar(vendor),
      ),
    );
  }

  Widget _placeholderBody() {
    return Column(
      children: [
        StageHeader.back(context: context, title: 'Detail Grup Hiburan'),
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
      controller: _scroll,
      padding: EdgeInsets.zero,
      children: [
        _heroImage(vendor),
        _factsBand(vendor),
        const SizedBox(height: Sp.xl),
        if (description.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Sp.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _sectionTitle('Tentang grup'),
                const SizedBox(height: Sp.sm),
                _ExpandableDescription(text: description),
              ],
            ),
          ),
          const SizedBox(height: Sp.xl),
        ],
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Sp.lg),
          child: _packages(vendor),
        ),
        const SizedBox(height: Sp.xl),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Sp.lg),
          child: _schedule(vendor),
        ),
        if (vendor.videoUrl != null && vendor.videoUrl!.trim().isNotEmpty) ...[
          const SizedBox(height: Sp.xl),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Sp.lg),
            child: StageVideoCard(
              videoUrl: vendor.videoUrl!,
              thumbnailUrl: vendor.bannerUrl,
              vendorName: vendor.displayName,
              onOpenVideo: () => _openVideo(vendor.videoUrl!),
            ),
          ),
        ],
        if (vendor.photoUrls.isNotEmpty) ...[
          const SizedBox(height: Sp.xl),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Sp.lg),
            child: MediaGalleryReel(photoUrls: vendor.photoUrls),
          ),
        ],
        const SizedBox(height: Sp.xl),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Sp.lg),
          child: _assuranceSection(),
        ),
        if (address.isNotEmpty || transport != null) ...[
          const SizedBox(height: Sp.xl),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Sp.lg),
            child: _location(address, transport),
          ),
        ],
        const SizedBox(height: Sp.xl),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Sp.lg),
          child: _reviewsSection(vendor),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, 0),
          child: _reportLink(vendor),
        ),
        const SizedBox(height: 110),
      ],
    );
  }

  /// FR-123: laporkan vendor dari halaman publiknya. Dua ketukan
  /// (Laporkan vendor → Kirim laporan), tanpa perlu membuka chat.
  Widget _reportLink(VendorDetail vendor) {
    final text = Theme.of(context).textTheme;
    final authorized = AppScope.of(context).session.authorized;
    if (!authorized) {
      return Text(
        'Masuk untuk melaporkan vendor ini.',
        style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
      );
    }
    return Align(
      alignment: Alignment.centerLeft,
      child: TextButton.icon(
        onPressed: () => showReportSheet(
          context,
          targetKind: ReportTargetKind.vendor,
          targetId: vendor.id,
          targetLabel: vendor.displayName,
        ),
        icon: const Icon(Icons.flag_outlined, size: 18),
        label: const Text('Laporkan vendor'),
        style: TextButton.styleFrom(foregroundColor: AppColors.inkMuted),
      ),
    );
  }

  /// Immersive opening: the stage photo runs edge to edge, the name sits on the
  /// scrim, and the back/favorite/chat controls float above it.
  Widget _heroImage(VendorDetail vendor) {
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
    final height = (MediaQuery.sizeOf(context).height * 0.44).clamp(
      320.0,
      400.0,
    );

    return SizedBox(
      height: height,
      child: Stack(
        fit: StackFit.expand,
        children: [
          PosterTile(
            name: vendor.displayName,
            imageUrl: vendor.bannerUrl ?? vendor.avatarUrl,
            height: height,
            radius: 0,
            heroTag: 'vendor-poster-${vendor.id}',
          ),
          Positioned.fill(
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: const Alignment(0, -0.15),
                    end: Alignment.bottomCenter,
                    stops: const [0.18, 0.55, 1],
                    colors: [
                      Colors.transparent,
                      AppColors.ink.withValues(alpha: 0.38),
                      AppColors.ink.withValues(alpha: 0.96),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            left: Sp.lg,
            right: Sp.lg,
            bottom: Sp.lg + 2,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    if (category.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 9,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.lime,
                          borderRadius: BorderRadius.circular(Radii.pill),
                        ),
                        child: Text(
                          category,
                          style: const TextStyle(
                            fontSize: 10,
                            height: 1.2,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.3,
                            color: AppColors.ink,
                          ),
                        ),
                      ),
                    if (region.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 9,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(Radii.pill),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.22),
                          ),
                        ),
                        child: Text(
                          region,
                          style: const TextStyle(
                            fontSize: 10,
                            height: 1.2,
                            fontWeight: FontWeight.w600,
                            color: Colors.white,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  vendor.displayName,
                  style: text.headlineSmall?.copyWith(
                    fontSize: 27,
                    height: 1.08,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -1,
                    color: Colors.white,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 10,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (ratingText != null)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.star_rounded,
                            size: 16,
                            color: AppColors.lime,
                          ),
                          const SizedBox(width: 3),
                          Text(
                            ratingText,
                            style: TextStyle(
                              fontSize: 11.5,
                              height: 1.3,
                              fontWeight: FontWeight.w600,
                              color: Colors.white.withValues(alpha: 0.86),
                            ),
                          ),
                        ],
                      ),
                    if (responseText != null)
                      Text(
                        responseText,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11.5,
                          height: 1.3,
                          color: Colors.white.withValues(alpha: 0.60),
                        ),
                      ),
                    Text(
                      '${vendor.packages.length} paket',
                      style: TextStyle(
                        fontSize: 11.5,
                        height: 1.3,
                        color: Colors.white.withValues(alpha: 0.60),
                      ),
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

  /// Fixed controls over the photo: the status bar is always dark here, so the
  /// icons stay legible while the list scrolls underneath.
  Widget _heroBar(VendorDetail vendor) {
    final topInset = MediaQuery.paddingOf(context).top;
    final isAuthorized = AppScope.of(context).session.authorized;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      padding: EdgeInsets.fromLTRB(
        Sp.md,
        topInset + 6,
        Sp.md,
        _heroSolid ? 10 : 26,
      ),
      decoration: BoxDecoration(
        color: _heroSolid ? AppColors.ink : Colors.transparent,
        gradient: _heroSolid
            ? null
            : LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  AppColors.ink.withValues(alpha: 0.86),
                  AppColors.ink.withValues(alpha: 0),
                ],
              ),
        boxShadow: _heroSolid
            ? const [
                BoxShadow(
                  color: Color(0x330B1220),
                  blurRadius: 18,
                  offset: Offset(0, 6),
                ),
              ]
            : null,
      ),
      child: Row(
        children: [
          _HeroButton(
            icon: Icons.arrow_back,
            tooltip: 'Kembali',
            onTap: () => Navigator.maybePop(context),
          ),
          const SizedBox(width: 10),
          const Expanded(
            child: Text(
              'Detail Grup Hiburan',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                height: 1.2,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.2,
                color: Colors.white,
              ),
            ),
          ),
          if (isAuthorized) ...[
            const SizedBox(width: 8),
            _HeroButton(
              icon: _isFavorite == true
                  ? Icons.favorite
                  : Icons.favorite_border,
              tooltip: _isFavorite == true
                  ? 'Hapus dari favorit'
                  : 'Tambah ke favorit',
              color: _isFavorite == true ? AppColors.lime : Colors.white,
              onTap: _favoriteBusy ? null : () => _toggleFavorite(vendor),
            ),
          ],
          const SizedBox(width: 8),
          _HeroButton(
            icon: Icons.forum_outlined,
            tooltip: 'Chat dengan vendor',
            badge: _chatBookingId != null,
            onTap: () => _openChatThread(vendor),
          ),
        ],
      ),
    );
  }

  Widget _factsBand(VendorDetail vendor) {
    return Container(
      color: AppColors.card,
      padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, Sp.lg),
      child: _quickFacts(vendor),
    );
  }

  Widget _sectionTitle(String title, {String? caption, Widget? trailing}) {
    final text = Theme.of(context).textTheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: text.titleLarge?.copyWith(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.45,
                ),
              ),
              if (caption != null) ...[
                const SizedBox(height: 1),
                Text(caption, style: text.bodySmall),
              ],
            ],
          ),
        ),
        if (trailing != null) ...[const SizedBox(width: Sp.sm), trailing],
      ],
    );
  }

  Widget _assurance(IconData icon, String text) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: const BoxDecoration(
            color: AppColors.limeSoft,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, size: 13, color: AppColors.ink),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(height: 1.4, color: AppColors.ink),
          ),
        ),
      ],
    );
  }

  Widget _assuranceSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionTitle('Aman & jelas'),
        const SizedBox(height: Sp.sm),
        Container(
          padding: const EdgeInsets.all(Sp.md),
          decoration: BoxDecoration(
            color: AppColors.surfaceSoft,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _assurance(
                Icons.lock_outline,
                'DP ditahan PJP berizin sampai acara selesai',
              ),
              const SizedBox(height: Sp.sm),
              _assurance(
                Icons.receipt_long_outlined,
                'Harga final dihitung sistem saat booking dikirim',
              ),
              const SizedBox(height: Sp.sm),
              _assurance(
                Icons.schedule_outlined,
                'Bayar DP setelah vendor menerima permintaan',
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// Four honest metrics on a white band, not another rounded card.
  Widget _quickFacts(VendorDetail vendor) {
    final text = Theme.of(context).textTheme;
    final facts = <({IconData icon, String value, String label})>[];
    final package = vendor.packages.isEmpty ? null : vendor.packages.first;
    if (package != null && package.durationMinutes > 0) {
      facts.add((
        icon: Icons.schedule,
        value: _duration(package.durationMinutes),
        label: 'Durasi',
      ));
    }
    if (package != null && package.personnelCount > 0) {
      facts.add((
        icon: Icons.groups_outlined,
        value: '${package.personnelCount}',
        label: 'Personel',
      ));
    }
    if (vendor.minDpBp > 0) {
      facts.add((
        icon: Icons.payments_outlined,
        value: '${_percent(vendor.minDpBp)}%',
        label: 'DP',
      ));
    }
    if (vendor.serviceRadiusKm > 0) {
      facts.add((
        icon: Icons.near_me_outlined,
        value: '${_kilometers(vendor.serviceRadiusKm)} km',
        label: 'Jangkauan',
      ));
    }
    if (facts.isEmpty) return const SizedBox.shrink();
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < facts.length; i++) ...[
          if (i > 0)
            Container(
              width: 1,
              height: 34,
              margin: const EdgeInsets.only(top: 6),
              color: AppColors.line,
            ),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(left: i == 0 ? 0 : 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(facts[i].icon, size: 15, color: AppColors.inkMuted),
                  const SizedBox(height: 5),
                  Text(
                    facts[i].value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.labelLarge?.copyWith(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    facts[i].label.toUpperCase(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.labelSmall?.copyWith(
                      fontSize: 8.5,
                      letterSpacing: 0.8,
                      color: AppColors.muted2,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _packages(VendorDetail vendor) {
    final text = Theme.of(context).textTheme;
    return Column(
      key: _packagesKey,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionTitle(
          'Paket & fasilitas',
          caption: vendor.packages.isEmpty
              ? 'Vendor belum membuka paket'
              : '${vendor.packages.length} pilihan untuk acaramu',
        ),
        const SizedBox(height: Sp.md),
        if (vendor.packages.isEmpty)
          Container(
            padding: const EdgeInsets.all(Sp.lg),
            decoration: BoxDecoration(
              color: AppColors.card,
              borderRadius: BorderRadius.circular(Radii.xxl),
              border: Border.all(color: AppColors.line),
            ),
            child: Row(
              children: [
                const IconBadge(
                  icon: Icons.inventory_2_outlined,
                  tone: IconBadgeTone.neutral,
                ),
                const SizedBox(width: Sp.md),
                Expanded(
                  child: Text(
                    'Belum ada paket untuk vendor ini.',
                    style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
                  ),
                ),
              ],
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
        _sectionTitle(
          'Jadwal',
          caption: '45 hari ke depan',
          trailing: TextButton.icon(
            onPressed: _dates().isEmpty ? null : _pickDate,
            icon: const Icon(Icons.calendar_month_outlined, size: 16),
            label: const Text('Kalender'),
            style: TextButton.styleFrom(
              foregroundColor: AppColors.ink,
              backgroundColor: AppColors.primarySoft,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              minimumSize: const Size(0, 38),
              textStyle: text.labelMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
        const SizedBox(height: Sp.sm),
        if (_loadingAvail)
          const AppLoading(rows: 1, label: 'Memuat jadwal vendor')
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
            const SizedBox(height: Sp.sm),
          ],
          _dateRail(),
          const SizedBox(height: 9),
          const _ScheduleLegend(),
        ] else
          Text(
            'Jadwal belum tersedia untuk 45 hari ke depan.',
            style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
          ),
      ],
    );
  }

  Widget _dateRail() {
    final dates = _dates();
    if (dates.isEmpty) {
      return Text(
        'Belum ada tanggal yang dibuka vendor.',
        style: Theme.of(context).textTheme.bodyMedium,
      );
    }
    return SizedBox(
      height: 76,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        clipBehavior: Clip.none,
        itemCount: dates.length,
        separatorBuilder: (_, __) => const SizedBox(width: Sp.sm),
        itemBuilder: (context, index) {
          final date = dates[index];
          final parsed = DateTime.tryParse(date);
          if (parsed == null) return const SizedBox.shrink();
          return _DateChip(
            date: parsed,
            state: _dayState(date),
            selected: date == _date,
            onTap: () {
              if (_dayState(date) == 'blocked') {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'Tanggal itu sudah terisi. Pilih tanggal lain.',
                    ),
                  ),
                );
                return;
              }
              setState(() => _date = date);
            },
          );
        },
      ),
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

  Widget _location(String address, String? transport) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionTitle('Lokasi & transport'),
        const SizedBox(height: Sp.sm),
        Container(
          padding: const EdgeInsets.all(Sp.md),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(Radii.xl),
            border: Border.all(color: AppColors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (address.isNotEmpty)
                DetailRow(
                  icon: Icons.place_outlined,
                  label: 'Alamat panggung',
                  value: address,
                ),
              if (address.isNotEmpty && transport != null)
                const SizedBox(height: Sp.md),
              if (transport != null)
                DetailRow(
                  icon: Icons.directions_car_outlined,
                  label: 'Transport',
                  value: transport,
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
        _sectionTitle(
          'Ulasan pelanggan',
          caption: _reviewTotal > 0
              ? '$_reviewTotal ulasan dari pelanggan'
              : 'Belum ada ulasan',
          trailing: _completedBookingId == null
              ? null
              : TextButton.icon(
                  onPressed: () =>
                      _openReviewSheet(vendor, _completedBookingId!),
                  icon: const Icon(Icons.rate_review_outlined, size: 16),
                  label: const Text('Tulis'),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.ink,
                    backgroundColor: AppColors.primarySoft,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    minimumSize: const Size(0, 38),
                    textStyle: text.labelMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
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
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.ink,
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.xxl)),
        boxShadow: [
          BoxShadow(
            color: Color(0x330B1220),
            blurRadius: 24,
            offset: Offset(0, -8),
          ),
        ],
      ),
      padding: EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, Sp.md + bottomInset),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  date == null ? 'Harga mulai' : 'Tanggal dipilih',
                  maxLines: 1,
                  style: const TextStyle(
                    fontSize: 10,
                    height: 1.2,
                    fontWeight: FontWeight.w600,
                    color: Color(0x99FFFFFF),
                  ),
                ),
                const SizedBox(height: 2),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    date == null
                        ? (price == 0 ? 'Harga belum diisi' : _rp(price))
                        : formatDayMonth(date),
                    maxLines: 1,
                    style: TextStyle(
                      fontSize: date == null ? 18 : 16,
                      height: 1.2,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.5,
                      color: price == 0 && date == null
                          ? const Color(0xB3FFFFFF)
                          : Colors.white,
                      fontFeatures: _tabularFigures,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: Sp.md),
          SizedBox(
            width: 180,
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
          ),
        ],
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
    final hasPhoto =
        package.photoUrl != null && package.photoUrl!.trim().isNotEmpty;

    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? AppColors.ink : AppColors.card,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.xxl),
          side: BorderSide(
            color: selected ? AppColors.ink : AppColors.line,
            width: 1,
          ),
        ),
        elevation: 0,
        shadowColor: Colors.transparent,
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
                          child: Icon(
                            Icons.music_note,
                            color: AppColors.inkMuted,
                          ),
                        ),
                      ),
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Colors.transparent,
                              (selected ? AppColors.ink : Colors.black)
                                  .withValues(alpha: 0.45),
                            ],
                          ),
                        ),
                      ),
                      Positioned(
                        top: Sp.sm,
                        right: Sp.sm,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 9,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: selected
                                ? AppColors.lime
                                : Colors.black.withValues(alpha: 0.62),
                            borderRadius: BorderRadius.circular(Radii.pill),
                          ),
                          child: Text(
                            meta,
                            style: TextStyle(
                              color: selected ? AppColors.ink : Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
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
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  package.name,
                                  style: text.titleLarge?.copyWith(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: -0.5,
                                    color: selected
                                        ? Colors.white
                                        : AppColors.ink,
                                  ),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (selected) ...[
                                const SizedBox(width: Sp.sm),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 3,
                                  ),
                                  decoration: BoxDecoration(
                                    color: AppColors.lime,
                                    borderRadius: BorderRadius.circular(
                                      Radii.pill,
                                    ),
                                  ),
                                  child: const Text(
                                    'DIPILIH',
                                    style: TextStyle(
                                      fontSize: 9.5,
                                      height: 1.2,
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: 0.5,
                                      color: AppColors.ink,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                          if (meta.isNotEmpty && !hasPhoto) ...[
                            const SizedBox(height: Sp.xs),
                            Text(
                              meta,
                              style: text.bodySmall?.copyWith(
                                color: selected
                                    ? Colors.white.withValues(alpha: 0.58)
                                    : AppColors.inkMuted,
                              ),
                            ),
                          ],
                          const SizedBox(height: Sp.sm),
                          Text(
                            _rp(package.basePriceIdr),
                            style: text.titleMedium?.copyWith(
                              color: selected ? AppColors.lime : AppColors.ink,
                              fontSize: 19,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -0.4,
                              fontFeatures: _tabularFigures,
                            ),
                          ),
                          if (dp > 0) ...[
                            const SizedBox(height: 2),
                            Text(
                              'DP ${_rp(dp)} · ${_percent(minDpBp)}%',
                              style: text.bodySmall?.copyWith(
                                color: selected
                                    ? Colors.white.withValues(alpha: 0.58)
                                    : AppColors.inkMuted,
                              ),
                            ),
                          ],
                          if (package.inclusions.isNotEmpty) ...[
                            const SizedBox(height: Sp.md),
                            Text(
                              'FASILITAS',
                              style: text.labelSmall?.copyWith(
                                fontSize: 9.5,
                                letterSpacing: 0.8,
                                color: selected
                                    ? Colors.white.withValues(alpha: 0.45)
                                    : AppColors.muted2,
                              ),
                            ),
                            const SizedBox(height: Sp.xs),
                            for (final item in package.inclusions)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 3),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Padding(
                                      padding: const EdgeInsets.only(top: 2),
                                      child: Icon(
                                        Icons.check_circle_outline,
                                        size: 14,
                                        color: selected
                                            ? AppColors.lime
                                            : AppColors.accent,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Expanded(
                                      child: Text(
                                        item,
                                        style: text.bodySmall?.copyWith(
                                          color: selected
                                              ? Colors.white.withValues(
                                                  alpha: 0.84,
                                                )
                                              : AppColors.ink,
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
                              'TAMBAHAN',
                              style: text.labelSmall?.copyWith(
                                fontSize: 9.5,
                                letterSpacing: 0.8,
                                color: selected
                                    ? Colors.white.withValues(alpha: 0.45)
                                    : AppColors.muted2,
                              ),
                            ),
                            const SizedBox(height: Sp.xs),
                            for (final addon in package.addons)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 3),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        addon.name,
                                        style: text.bodySmall?.copyWith(
                                          color: selected
                                              ? Colors.white.withValues(
                                                  alpha: 0.84,
                                                )
                                              : AppColors.ink,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: Sp.sm),
                                    Flexible(
                                      child: Text(
                                        _addonPrice(addon),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        textAlign: TextAlign.right,
                                        style: text.bodySmall?.copyWith(
                                          color: selected
                                              ? Colors.white.withValues(
                                                  alpha: 0.52,
                                                )
                                              : AppColors.inkMuted,
                                        ),
                                      ),
                                    ),
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
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 160),
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: selected ? AppColors.lime : Colors.transparent,
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: selected
                                ? AppColors.lime
                                : AppColors.lineStrong,
                            width: 1.4,
                          ),
                        ),
                        child: selected
                            ? const Icon(
                                Icons.check_rounded,
                                size: 17,
                                color: AppColors.ink,
                              )
                            : null,
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

/// Floating control on the hero photo: dark glass, 40 dp, one icon.
class _HeroButton extends StatelessWidget {
  const _HeroButton({
    required this.icon,
    required this.tooltip,
    this.onTap,
    this.color = Colors.white,
    this.badge = false,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;
  final Color color;

  /// Lime dot: an in-app chat thread already exists for this vendor.
  final bool badge;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.black.withValues(alpha: 0.30),
        shape: CircleBorder(
          side: BorderSide(color: Colors.white.withValues(alpha: 0.22)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            width: 40,
            height: 40,
            child: Stack(
              alignment: Alignment.center,
              children: [
                Icon(icon, size: 19, color: color),
                if (badge)
                  Positioned(
                    top: 9,
                    right: 9,
                    child: Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: AppColors.lime,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.ink, width: 1.2),
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

/// One day on the schedule rail. The state is written, not just coloured.
class _DateChip extends StatelessWidget {
  const _DateChip({
    required this.date,
    required this.state,
    required this.selected,
    required this.onTap,
  });

  final DateTime date;
  final String state;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final blocked = state == 'blocked';
    final waiting = state == 'waiting';
    final background = selected
        ? AppColors.ink
        : blocked
        ? AppColors.surfaceSoft
        : waiting
        ? AppColors.warningSoft
        : AppColors.card;
    final borderColor = selected
        ? AppColors.ink
        : blocked
        ? AppColors.line
        : waiting
        ? AppColors.warning.withValues(alpha: 0.35)
        : AppColors.line;
    final weekdayColor = selected
        ? Colors.white.withValues(alpha: 0.62)
        : blocked
        ? AppColors.muted2
        : waiting
        ? AppColors.warning
        : AppColors.inkMuted;
    final dayColor = selected
        ? Colors.white
        : blocked
        ? AppColors.muted2
        : AppColors.ink;
    final dotColor = selected
        ? AppColors.lime
        : blocked
        ? AppColors.surfaceHighest
        : waiting
        ? AppColors.warning
        : AppColors.limeDark;

    return Semantics(
      button: true,
      selected: selected,
      enabled: !blocked,
      label:
          '${_weekdayShort[date.weekday - 1]} ${date.day} '
          '${_monthShort[date.month - 1]}'
          '${blocked
              ? ', sudah terisi'
              : waiting
              ? ', belum pasti'
              : ''}',
      excludeSemantics: true,
      child: Material(
        color: background,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.lg),
          side: BorderSide(color: borderColor, width: selected ? 1.5 : 1),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            width: 58,
            height: 76,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  _weekdayShort[date.weekday - 1].toUpperCase(),
                  style: TextStyle(
                    fontSize: 9.5,
                    height: 1.2,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                    color: weekdayColor,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${date.day}',
                  style: TextStyle(
                    fontSize: 19,
                    height: 1.05,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.5,
                    color: dayColor,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  _monthShort[date.month - 1],
                  style: TextStyle(
                    fontSize: 9.5,
                    height: 1.2,
                    fontWeight: FontWeight.w600,
                    color: weekdayColor,
                  ),
                ),
                const SizedBox(height: 4),
                Container(
                  width: 5,
                  height: 5,
                  decoration: BoxDecoration(
                    color: dotColor,
                    shape: BoxShape.circle,
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

class _ScheduleLegend extends StatelessWidget {
  const _ScheduleLegend();

  @override
  Widget build(BuildContext context) {
    return const Wrap(
      spacing: 14,
      runSpacing: 4,
      children: [
        _LegendDot(color: AppColors.limeDark, label: 'Tersedia'),
        _LegendDot(color: AppColors.warning, label: 'Belum pasti'),
        _LegendDot(color: AppColors.surfaceHighest, label: 'Terisi'),
      ],
    );
  }
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            fontSize: 11,
            color: AppColors.inkMuted,
          ),
        ),
      ],
    );
  }
}

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
  const _ReviewSheet({required this.vendor, required this.bookingId});

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
        body: {'rating': _rating, if (comment.isNotEmpty) 'comment': comment},
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
