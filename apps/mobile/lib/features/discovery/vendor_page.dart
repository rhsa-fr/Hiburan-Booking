import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/widgets.dart';

const _weekdays = <String>['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

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
  bool _showAllDates = false;
  String? _packageId;
  String? _date;
  String? _session;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await _loadVendor();
    if (!mounted || _vendor == null) return;
    await _loadAvailability();
  }

  Future<void> _loadVendor() async {
    setState(() {
      _vendorError = null;
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
        final dates = _dates();
        if (_date == null || !dates.contains(_date)) {
          _date = dates.isEmpty ? null : dates.first;
          _session = null;
        } else if (_session != null &&
            !_isSelectable(_stateOf(_date!, _session!))) {
          _session = null;
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

  List<String> _dates() {
    final dates = <String>{
      for (final day in _availability?.days ?? const <AvailabilityDay>[])
        day.date,
    }.toList();
    dates.sort();
    return dates;
  }

  List<AvailabilityDay> _sessionsFor(String date) {
    final sessions = [
      for (final day in _availability?.days ?? const <AvailabilityDay>[])
        if (day.date == date) day,
    ];
    sessions.sort(
      (a, b) => _sessionOrder(a.session).compareTo(_sessionOrder(b.session)),
    );
    return sessions;
  }

  int _sessionOrder(String session) => switch (session) {
    'day' => 0,
    'night' => 1,
    'full' => 2,
    _ => 3,
  };

  String _stateOf(String date, String session) {
    for (final day in _availability?.days ?? const <AvailabilityDay>[]) {
      if (day.date == date && day.session == session) return day.state;
    }
    return 'unconfirmed';
  }

  bool _isSelectable(String state) =>
      state == 'available' || state == 'unconfirmed' || state == 'stale';

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
    setState(() {
      _date = date;
      _session = null;
    });
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Detail vendor')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: _body(),
        ),
      ),
      bottomNavigationBar: _bottomBar(),
    );
  }

  Widget _body() {
    if (_vendor == null) {
      if (_vendorError != null) {
        return AppError(message: _vendorError!, onRetry: _bootstrap);
      }
      return ListView(
        padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, Sp.xl),
        children: const [AppLoading(rows: 5, label: 'Memuat vendor dan paket')],
      );
    }

    final vendor = _vendor!;
    return ListView(
      padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, Sp.xl),
      children: [
        _header(vendor),
        const SizedBox(height: Sp.xl),
        _packages(vendor),
        const SizedBox(height: Sp.xl),
        _schedule(),
      ],
    );
  }

  Widget _header(VendorDetail vendor) {
    final text = Theme.of(context).textTheme;
    final address = (vendor.baseAddress ?? '').trim();
    final whatsapp = vendor.whatsapp.trim();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(vendor.displayName, style: text.displaySmall),
        const SizedBox(height: Sp.sm),
        _RatingLine(rating: vendor.rating, count: vendor.ratingCount),
        const SizedBox(height: Sp.sm),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(
              Icons.place_outlined,
              size: 16,
              color: AppColors.inkMuted,
            ),
            const SizedBox(width: Sp.xs),
            Expanded(child: Text(vendor.regionName, style: text.bodyMedium)),
          ],
        ),
        const SizedBox(height: Sp.xs),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(
              Icons.home_outlined,
              size: 16,
              color: AppColors.inkMuted,
            ),
            const SizedBox(width: Sp.xs),
            Expanded(
              child: Text(
                address.isEmpty ? 'Alamat belum diisi' : address,
                style: text.bodyMedium?.copyWith(
                  color: address.isEmpty ? AppColors.inkMuted : AppColors.ink,
                ),
              ),
            ),
          ],
        ),
        if ((vendor.description ?? '').trim().isNotEmpty) ...[
          const SizedBox(height: Sp.md),
          Text(vendor.description!.trim(), style: text.bodyMedium),
        ],
        if (whatsapp.isNotEmpty) ...[
          const SizedBox(height: Sp.lg),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _openWhatsApp(whatsapp),
              icon: const Icon(Icons.chat_bubble_outline, size: 20),
              label: const Text('Chat vendor di WhatsApp'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.accent,
                minimumSize: const Size.fromHeight(48),
                side: const BorderSide(color: AppColors.accent),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(Radii.sm),
                ),
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
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(child: Text('Paket', style: text.titleLarge)),
            if (vendor.packages.isNotEmpty)
              Text('${vendor.packages.length} paket', style: text.bodySmall),
          ],
        ),
        const SizedBox(height: Sp.md),
        if (vendor.packages.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(Sp.lg),
              child: Text(
                'Belum ada paket untuk vendor ini.',
                style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
              ),
            ),
          )
        else
          for (final item in vendor.packages)
            Padding(
              padding: const EdgeInsets.only(bottom: Sp.md),
              child: _PackageCard(
                package: item,
                selected: item.id == _packageId,
                onChoose: () => _choosePackage(item),
              ),
            ),
      ],
    );
  }

  Widget _schedule() {
    final text = Theme.of(context).textTheme;
    final availability = _availability;
    final dates = _dates();

    return Column(
      key: _scheduleKey,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Jadwal', style: text.titleLarge),
        const SizedBox(height: Sp.xs),
        Text(
          'Pilih tanggal, lalu sesi siang atau malam.',
          style: text.bodySmall,
        ),
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
            _staleBanner(availability),
            const SizedBox(height: Sp.md),
          ],
          if (dates.isEmpty)
            Text(
              'Jadwal belum tersedia untuk 45 hari ke depan.',
              style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
            )
          else ...[
            _dateStrip(dates),
            if (dates.length > 14 && !_showAllDates)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => setState(() => _showAllDates = true),
                  icon: const Icon(Icons.expand_more, size: 20),
                  label: const Text('Lihat tanggal lain'),
                ),
              ),
            const SizedBox(height: Sp.md),
            _sessions(),
          ],
        ],
      ],
    );
  }

  Widget _staleBanner(Availability availability) {
    final text = Theme.of(context).textTheme;
    final freshness = relativeFreshness(
      availability.calendarUpdatedAt,
      staleAfterDays: availability.staleThresholdDays,
    );
    return Container(
      padding: const EdgeInsets.all(Sp.md),
      decoration: BoxDecoration(
        color: AppColors.warningSoft,
        borderRadius: BorderRadius.circular(Radii.sm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline, size: 18, color: AppColors.warning),
          const SizedBox(width: Sp.sm),
          Expanded(
            child: Text(
              '$freshness Sesi “Belum dikonfirmasi” tetap bisa dipesan; vendor akan memastikan.',
              style: text.bodySmall?.copyWith(color: AppColors.warning),
            ),
          ),
        ],
      ),
    );
  }

  Widget _dateStrip(List<String> dates) {
    final visible = _showAllDates ? dates : dates.take(14).toList();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final date in visible)
            Padding(
              padding: const EdgeInsets.only(right: Sp.sm),
              child: _DateChip(
                date: date,
                selected: date == _date,
                onTap: () => _chooseDate(date),
              ),
            ),
        ],
      ),
    );
  }

  Widget _sessions() {
    final text = Theme.of(context).textTheme;
    final selectedDate = _date;
    if (selectedDate == null) {
      return Text(
        'Pilih tanggal dulu untuk melihat sesi.',
        style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
      );
    }

    final sessions = _sessionsFor(selectedDate);
    if (sessions.isEmpty) {
      return Text(
        'Belum ada jadwal untuk tanggal ini.',
        style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
      );
    }

    final needsConfirmation =
        _session != null &&
        (_stateOf(selectedDate, _session!) == 'unconfirmed' ||
            _stateOf(selectedDate, _session!) == 'stale');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final day in sessions)
          Padding(
            padding: const EdgeInsets.only(bottom: Sp.sm),
            child: _sessionTile(day),
          ),
        if (needsConfirmation)
          Container(
            padding: const EdgeInsets.all(Sp.md),
            decoration: BoxDecoration(
              color: AppColors.warningSoft,
              borderRadius: BorderRadius.circular(Radii.sm),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.info_outline,
                  size: 18,
                  color: AppColors.warning,
                ),
                const SizedBox(width: Sp.sm),
                Expanded(
                  child: Text(
                    'Jadwal ini belum dikonfirmasi vendor. Kamu tetap bisa pesan; vendor akan memastikan.',
                    style: text.bodySmall?.copyWith(color: AppColors.warning),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _sessionTile(AvailabilityDay day) {
    final text = Theme.of(context).textTheme;
    final selectable = _isSelectable(day.state);
    final selected = _session == day.session;

    return Semantics(
      button: true,
      enabled: selectable,
      selected: selected,
      child: InkWell(
        onTap: selectable ? () => setState(() => _session = day.session) : null,
        borderRadius: BorderRadius.circular(Radii.sm),
        child: Container(
          padding: const EdgeInsets.all(Sp.md),
          decoration: BoxDecoration(
            color: selectable ? AppColors.card : AppColors.neutralSoft,
            borderRadius: BorderRadius.circular(Radii.sm),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.line,
              width: selected ? 1.6 : 1,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: Sp.sm,
                runSpacing: Sp.xs,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    _sessionLabel(day.session),
                    style: text.titleMedium?.copyWith(
                      color: selectable ? AppColors.ink : AppColors.inkMuted,
                    ),
                  ),
                  _StateChip(state: day.state),
                  if (selected)
                    const Icon(
                      Icons.check_circle,
                      size: 20,
                      color: AppColors.primary,
                    ),
                ],
              ),
              const SizedBox(height: Sp.xs),
              Text(
                _sessionNote(day.state),
                style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget? _bottomBar() {
    final vendor = _vendor;
    if (vendor == null) return null;

    if (vendor.packages.isEmpty) {
      return SafeArea(
        minimum: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, Sp.lg),
        child: const PrimaryButton(label: 'Belum ada paket', onPressed: null),
      );
    }

    final package = _selectedPackage;
    final date = _date == null ? null : DateTime.tryParse(_date!);
    final complete = package != null && date != null && _session != null;
    final label = complete
        ? 'Pesan ${package.name} · ${formatDayMonth(date)}'
        : package == null
        ? 'Pilih paket'
        : date == null
        ? 'Pilih tanggal'
        : 'Pilih sesi';

    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, Sp.lg),
      child: Center(
        heightFactor: 1,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 528),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (complete)
                Padding(
                  padding: const EdgeInsets.only(bottom: Sp.sm),
                  child: Text(
                    'Tanggal dan sesi dipilih ulang di halaman berikutnya.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              SizedBox(
                width: double.infinity,
                child: PrimaryButton(
                  label: label,
                  icon: complete ? Icons.arrow_forward : null,
                  onPressed: () {
                    if (complete) {
                      Navigator.pushNamed(
                        context,
                        Routes.bookCreate,
                        arguments: BookCreateArgs(
                          vendorIdOrSlug: vendor.slug,
                          packageId: package.id,
                        ),
                      );
                    } else if (package == null) {
                      _scrollTo(_packagesKey);
                    } else {
                      _scrollTo(_scheduleKey);
                    }
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RatingLine extends StatelessWidget {
  const _RatingLine({required this.rating, required this.count});

  final double? rating;
  final int count;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final value = rating;
    if (value == null) {
      return Text(
        'Belum ada ulasan',
        style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
      );
    }
    return Wrap(
      spacing: Sp.xs,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        const Icon(Icons.star_rounded, size: 18, color: AppColors.warning),
        Text(
          value.toStringAsFixed(1).replaceAll('.', ','),
          style: text.labelMedium,
        ),
        if (count > 0) Text('($count ulasan)', style: text.bodySmall),
      ],
    );
  }
}

class _PackageCard extends StatelessWidget {
  const _PackageCard({
    required this.package,
    required this.selected,
    required this.onChoose,
  });

  final VendorPackage package;
  final bool selected;
  final VoidCallback onChoose;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final personnel = package.personnelCount;
    final description = (package.description ?? '').trim();

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        side: BorderSide(
          color: selected ? AppColors.primary : AppColors.line,
          width: selected ? 1.6 : 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(Sp.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: Text(package.name, style: text.titleMedium)),
                if (selected)
                  const Icon(
                    Icons.check_circle,
                    size: 20,
                    color: AppColors.primary,
                  ),
              ],
            ),
            const SizedBox(height: Sp.sm),
            Wrap(
              spacing: Sp.md,
              runSpacing: Sp.xs,
              children: [
                _Meta(
                  icon: Icons.schedule,
                  label: _duration(package.durationMinutes),
                ),
                if (personnel > 0)
                  _Meta(
                    icon: Icons.people_alt_outlined,
                    label: '$personnel orang',
                  ),
              ],
            ),
            const SizedBox(height: Sp.sm),
            Text(
              rupiah(package.basePriceIdr),
              style: text.titleMedium?.copyWith(color: AppColors.accent),
            ),
            if (description.isNotEmpty) ...[
              const SizedBox(height: Sp.xs),
              Text(description, style: text.bodySmall),
            ],
            const SizedBox(height: Sp.md),
            Text('Add-on', style: text.labelSmall),
            const SizedBox(height: Sp.xs),
            if (package.addons.isEmpty)
              Text(
                'Belum ada add-on',
                style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
              )
            else
              for (final addon in package.addons)
                Padding(
                  padding: const EdgeInsets.only(bottom: Sp.xs),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.add,
                        size: 16,
                        color: AppColors.inkMuted,
                      ),
                      const SizedBox(width: Sp.xs),
                      Expanded(
                        child: Text(
                          '${addon.name} · ${_addonPrice(addon)}',
                          style: text.bodySmall,
                        ),
                      ),
                    ],
                  ),
                ),
            const SizedBox(height: Sp.md),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton(
                onPressed: onChoose,
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  minimumSize: const Size(48, 48),
                  side: const BorderSide(color: AppColors.primary),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Radii.sm),
                  ),
                ),
                child: Text(selected ? 'Paket dipilih' : 'Pesan paket ini'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: AppColors.inkMuted),
        const SizedBox(width: Sp.xs),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

class _DateChip extends StatelessWidget {
  const _DateChip({
    required this.date,
    required this.selected,
    required this.onTap,
  });

  final String date;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final parsed = DateTime.tryParse(date);
    if (parsed == null) return const SizedBox.shrink();
    final month = formatDayMonth(parsed).split(' ').last;
    final foreground = selected ? AppColors.onPrimary : AppColors.ink;

    return Semantics(
      button: true,
      selected: selected,
      label: formatDate(parsed),
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Radii.sm),
        child: Container(
          constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
          padding: const EdgeInsets.symmetric(
            horizontal: Sp.md,
            vertical: Sp.sm,
          ),
          decoration: BoxDecoration(
            color: selected ? AppColors.primary : AppColors.card,
            borderRadius: BorderRadius.circular(Radii.sm),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.line,
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                _weekdays[parsed.weekday - 1],
                style: text.labelSmall?.copyWith(
                  color: selected ? AppColors.onPrimary : AppColors.inkMuted,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '${parsed.day}',
                style: text.titleMedium?.copyWith(color: foreground),
              ),
              const SizedBox(height: 2),
              Text(
                month,
                style: text.bodySmall?.copyWith(
                  color: selected ? AppColors.onPrimary : AppColors.inkMuted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StateChip extends StatelessWidget {
  const _StateChip({required this.state});

  final String state;

  @override
  Widget build(BuildContext context) {
    final (:label, :foreground, :background) = switch (state) {
      'available' => (
        label: 'Tersedia',
        foreground: AppColors.accent,
        background: AppColors.accentSoft,
      ),
      'unconfirmed' || 'stale' => (
        label: 'Belum dikonfirmasi',
        foreground: AppColors.warning,
        background: AppColors.warningSoft,
      ),
      'blocked' => (
        label: 'Tutup',
        foreground: AppColors.danger,
        background: AppColors.dangerSoft,
      ),
      'held' => (
        label: 'Sedang ditahan',
        foreground: AppColors.warning,
        background: AppColors.warningSoft,
      ),
      'booked' => (
        label: 'Sudah terisi',
        foreground: AppColors.primary,
        background: AppColors.primarySoft,
      ),
      _ => (
        label: 'Belum jelas',
        foreground: AppColors.inkMuted,
        background: AppColors.neutralSoft,
      ),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Sp.md, vertical: Sp.xs),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      child: Text(
        label,
        style: Theme.of(
          context,
        ).textTheme.labelSmall?.copyWith(color: foreground),
      ),
    );
  }
}

String _sessionLabel(String session) => switch (session) {
  'day' => 'Siang',
  'night' => 'Malam',
  'full' => 'Sehari penuh',
  _ => session.replaceAll('_', ' '),
};

String _sessionNote(String state) => switch (state) {
  'available' => 'Vendor siap di tanggal ini.',
  'unconfirmed' || 'stale' => 'Vendor belum mengonfirmasi jadwal ini.',
  'blocked' => 'Vendor menutup sesi ini.',
  'held' => 'Sedang dipegang pesanan lain.',
  'booked' => 'Sudah ada pesanan.',
  _ => 'Jadwal belum bisa dipastikan.',
};

String _duration(int minutes) {
  if (minutes <= 0) return 'Durasi belum diisi';
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  if (hours == 0) return '$rest menit';
  if (rest == 0) return '$hours jam';
  return '$hours jam $rest menit';
}

String _addonPrice(Addon addon) {
  final unit = addon.unit.trim();
  final per = unit.isEmpty ? '' : ' / $unit';
  final max = addon.maxQty > 0 ? ' · maks ${addon.maxQty}' : '';
  return '${rupiah(addon.priceIdr)}$per$max';
}
