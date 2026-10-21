import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/widgets.dart';
import 'booking_support.dart';

const _weekdays = <String>['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const _allowedStates = {'available', 'unconfirmed', 'stale'};
const _sessions = <String>['day', 'night', 'full'];

Map<String, dynamic> _asMap(dynamic value) =>
    value is Map ? value.cast<String, dynamic>() : const <String, dynamic>{};

/// One scrollable screen: package, date/session, event details, estimate.
/// No wizard, no invented total — the API computes the final number.
class CreateBookingPage extends StatefulWidget {
  const CreateBookingPage({super.key, required this.args});

  final BookCreateArgs args;

  @override
  State<CreateBookingPage> createState() => _CreateBookingPageState();
}

class _CreateBookingPageState extends State<CreateBookingPage> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _guests = TextEditingController();
  final _address = TextEditingController();
  final _notes = TextEditingController();

  VendorDetail? _vendor;
  VendorPackage? _package;
  Policy? _policy;
  List<String> _dates = const [];
  Map<String, Map<String, String>> _availability = const {};

  String? _selectedDate;
  String? _selectedSession;
  bool _titleEdited = false;
  bool _settingTitle = false;

  bool _loading = true;
  String? _loadError;
  bool _submitting = false;
  String? _submitError;
  bool _dateError = false;

  @override
  void initState() {
    super.initState();
    _title.addListener(() {
      if (!_settingTitle) _titleEdited = true;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  @override
  void dispose() {
    _title.dispose();
    _guests.dispose();
    _address.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final api = AppScope.of(context).api;
      final rawVendor = await api.get('/vendors/${widget.args.vendorIdOrSlug}');
      final vendorJson = _asMap(rawVendor);
      final profile = vendorJson['vendor'] is Map
          ? _asMap(vendorJson['vendor'])
          : vendorJson;
      final vendor = VendorDetail.fromJson({
        ...profile,
        'packages': vendorJson['packages'] ?? profile['packages'] ?? const [],
      });

      VendorPackage? chosen;
      for (final package in vendor.packages) {
        if (package.id == widget.args.packageId) chosen = package;
      }
      if (chosen == null) {
        throw const ApiException(
          code: 'NOT_FOUND',
          message: 'Paket yang dipilih tidak ada di vendor ini.',
          statusCode: 404,
        );
      }

      final today = DateTime.now();
      final from = DateTime(today.year, today.month, today.day);
      final to = from.add(const Duration(days: 44));
      final results = await Future.wait<dynamic>([
        api.get('/policies/cancellation'),
        api.get(
          '/vendors/${vendor.id}/availability',
          query: {'from': isoDate(from), 'to': isoDate(to)},
        ),
      ]);

      final availability = Availability.fromJson(_asMap(results[1]));
      final availabilityByDate = <String, Map<String, String>>{};
      for (final day in availability.days) {
        availabilityByDate.putIfAbsent(day.date, () => {})[day.session] =
            day.state;
      }
      final dates = availabilityByDate.keys.toList()..sort();

      if (!mounted) return;
      setState(() {
        _vendor = vendor;
        _package = chosen;
        _policy = Policy.fromJson(_asMap(results[0]));
        _availability = availabilityByDate;
        _dates = dates;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = apiMessage(error);
      });
    }
  }

  bool _stateAllowed(String? state) =>
      state != null && _allowedStates.contains(state);

  String? _stateFor(String date, String session) {
    final states = _availability[date] ?? const <String, String>{};
    if (session != 'full') return states[session];
    final explicit = states['full'];
    if (explicit != null) return explicit;
    final day = states['day'];
    final night = states['night'];
    if (day == null && night == null) return null;
    if (!_stateAllowed(day) || !_stateAllowed(night)) return 'blocked';
    return day == 'available' && night == 'available' ? 'available' : 'stale';
  }

  bool _dateEnabled(String date) =>
      _stateAllowed(_stateFor(date, 'day')) ||
      _stateAllowed(_stateFor(date, 'night')) ||
      _stateAllowed(_stateFor(date, 'full'));

  bool _dateUncertain(String date) {
    if (!_dateEnabled(date)) return false;
    final day = _stateFor(date, 'day');
    final night = _stateFor(date, 'night');
    return (_stateAllowed(day) && day != 'available') ||
        (_stateAllowed(night) && night != 'available');
  }

  String _stateText(String? state) {
    if (!_stateAllowed(state)) return 'Tidak tersedia';
    return state == 'available' ? 'Tersedia' : 'Belum dikonfirmasi';
  }

  void _pickDate(String date) {
    final current = _selectedSession;
    final keep = current != null && _stateAllowed(_stateFor(date, current));
    final hasDay = _stateAllowed(_stateFor(date, 'day'));
    final hasNight = _stateAllowed(_stateFor(date, 'night'));
    final hasFull = _stateAllowed(_stateFor(date, 'full'));
    setState(() {
      _selectedDate = date;
      _dateError = false;
      if (!keep) {
        _selectedSession = hasDay
            ? 'day'
            : hasNight
            ? 'night'
            : hasFull
            ? 'full'
            : null;
      }
    });
    _syncTitle();
  }

  void _pickSession(String session) {
    if (!_stateAllowed(_stateFor(_selectedDate!, session))) return;
    setState(() {
      _selectedSession = session;
      _dateError = false;
    });
  }

  void _syncTitle() {
    final vendor = _vendor;
    final date = _selectedDate;
    if (_titleEdited || vendor == null || date == null) return;
    final parsed = DateTime.tryParse(date);
    if (parsed == null) return;
    final generated = '${vendor.displayName} · ${formatDate(parsed)}';
    _settingTitle = true;
    _title.text = generated.length > 150
        ? generated.substring(0, 150)
        : generated;
    _settingTitle = false;
  }

  int get _packagePrice => _package?.basePriceIdr ?? 0;
  int get _serviceFee => (_packagePrice * 0.01).round();
  int get _estimateTotal => _packagePrice + _serviceFee;

  Future<void> _submit() async {
    if (_submitting) return;
    FocusScope.of(context).unfocus();
    final valid = _formKey.currentState?.validate() ?? false;
    if (!valid) return;

    final date = _selectedDate;
    final session = _selectedSession;
    final vendor = _vendor;
    final package = _package;
    final policy = _policy;
    if (date == null || session == null) {
      setState(() => _dateError = true);
      return;
    }
    if (vendor == null || package == null) return;
    final location = vendor.location;
    if (location == null) {
      setState(() {
        _submitError =
            'Lokasi vendor belum diatur. Hubungi vendor dulu sebelum memesan.';
      });
      return;
    }
    if (policy == null) {
      setState(() {
        _submitError = 'Kebijakan pembatalan belum bisa dimuat. Coba lagi.';
      });
      return;
    }

    final note = _notes.text.trim();
    final guestText = _guests.text.trim();
    final guest = guestText.isEmpty ? null : int.tryParse(guestText);

    setState(() {
      _submitting = true;
      _submitError = null;
    });

    try {
      final raw = await AppScope.of(context).api.post(
        '/bookings',
        body: {
          'vendor_id': vendor.id,
          'package_id': package.id,
          'event': {
            'title': _title.text.trim(),
            'region_code': vendor.regionCode,
            'venue_address': _address.text.trim(),
            'venue_location': {'lat': location.lat, 'lng': location.lng},
            'start_date': date,
            'end_date': date,
            if (guest != null) 'guest_estimate': guest,
            if (note.isNotEmpty) 'notes': note,
          },
          'slots': [
            {'date': date, 'session': session},
          ],
          if (note.isNotEmpty) 'notes': note,
          'policy_version_id': policy.id,
        },
      );
      if (!mounted) return;
      final created = _asMap(raw);
      final id = created['id'];
      if (id is! String || id.isEmpty) {
        setState(() {
          _submitting = false;
          _submitError =
              'Booking terkirim, tapi nomornya tidak terbaca. Cek daftar booking.';
        });
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Booking terkirim. Menunggu jawaban vendor.'),
        ),
      );
      Navigator.pushReplacementNamed(
        context,
        Routes.bookingStatus,
        arguments: id,
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _submitError = apiMessage(error);
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _submitError = 'Booking belum terkirim. Coba lagi.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Buat booking')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: _loading
              ? const Padding(
                  padding: EdgeInsets.all(Sp.lg),
                  child: AppLoading(rows: 3, label: 'Memuat vendor dan jadwal'),
                )
              : _loadError != null
              ? AppError(message: _loadError!, onRetry: _load)
              : Form(
                  key: _formKey,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(
                      Sp.lg,
                      Sp.sm,
                      Sp.lg,
                      Sp.xl,
                    ),
                    children: [
                      Text('Atur acara', style: text.displaySmall),
                      const SizedBox(height: Sp.xs),
                      Text(
                        'Isi satu layar ini, lalu kirim. Vendor menjawab dulu sebelum pembayaran.',
                        style: text.bodyMedium?.copyWith(
                          color: AppColors.inkMuted,
                        ),
                      ),
                      const SizedBox(height: Sp.xl),
                      _packagePanel(text),
                      const SizedBox(height: Sp.xl),
                      _scheduleSection(text),
                      const SizedBox(height: Sp.xl),
                      _detailSection(text),
                      const SizedBox(height: Sp.xl),
                      _moneySection(text),
                      if (_submitError != null) ...[
                        const SizedBox(height: Sp.lg),
                        Semantics(
                          liveRegion: true,
                          child: AppError(
                            message: _submitError!,
                            compact: true,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
        ),
      ),
      bottomNavigationBar: _loading || _loadError != null
          ? null
          : SafeArea(
              minimum: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, Sp.lg),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_package != null) ...[
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Total perkiraan',
                            style: text.bodyMedium?.copyWith(
                              color: AppColors.inkMuted,
                            ),
                          ),
                        ),
                        Text(rupiah(_estimateTotal), style: text.titleMedium),
                      ],
                    ),
                    const SizedBox(height: Sp.sm),
                  ],
                  PrimaryButton(
                    label: 'Kirim permintaan booking',
                    loadingLabel: 'Mengirim…',
                    loading: _submitting,
                    onPressed: _submit,
                  ),
                ],
              ),
            ),
    );
  }

  Widget _packagePanel(TextTheme text) {
    final package = _package;
    final vendor = _vendor;
    if (package == null || vendor == null) return const SizedBox.shrink();
    final facts = <String>[
      if (package.durationMinutes > 0)
        package.durationMinutes >= 60
            ? '${package.durationMinutes ~/ 60} jam'
            : '${package.durationMinutes} menit',
      if (package.personnelCount > 0) '${package.personnelCount} personel',
    ];
    return BookingPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(vendor.displayName, style: text.titleLarge),
          const SizedBox(height: Sp.xs),
          Text(
            '${vendor.regionName} · ${vendor.regionCode}',
            style: text.bodySmall,
          ),
          const SizedBox(height: Sp.md),
          Text(package.name, style: text.titleMedium),
          if (facts.isNotEmpty) ...[
            const SizedBox(height: Sp.xs),
            Text(facts.join(' · '), style: text.bodySmall),
          ],
          if (package.description != null) ...[
            const SizedBox(height: Sp.xs),
            Text(package.description!, style: text.bodyMedium),
          ],
          const SizedBox(height: Sp.md),
          MoneyLine(label: 'Harga paket', value: rupiah(package.basePriceIdr)),
        ],
      ),
    );
  }

  Widget _scheduleSection(TextTheme text) {
    if (_vendor?.location == null) {
      return BookingSection(
        title: 'Tanggal acara',
        child: AppError(
          compact: true,
          message:
              'Lokasi vendor belum diatur, jadi jadwal belum bisa dipesan. Hubungi vendor dulu.',
        ),
      );
    }
    if (_dates.isEmpty) {
      return BookingSection(
        title: 'Tanggal acara',
        child: Text(
          'Jadwal vendor belum tersedia. Coba muat ulang nanti.',
          style: text.bodyMedium,
        ),
      );
    }
    final selectedDate = _selectedDate;
    return BookingSection(
      title: 'Tanggal acara',
      hint:
          'Pilih satu tanggal. Tanda "Belum dikonfirmasi" berarti vendor perlu mengecek dulu, tapi kamu tetap bisa memesan.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final date in _dates) ...[
                  _DateButton(
                    date: date,
                    selected: date == selectedDate,
                    enabled: _dateEnabled(date),
                    uncertain: _dateUncertain(date),
                    onTap: () => _pickDate(date),
                  ),
                  const SizedBox(width: Sp.sm),
                ],
              ],
            ),
          ),
          const SizedBox(height: Sp.xs),
          Text('Geser ke samping untuk tanggal lain.', style: text.bodySmall),
          if (selectedDate != null && _dateUncertain(selectedDate)) ...[
            const SizedBox(height: Sp.sm),
            Align(
              alignment: Alignment.centerLeft,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: Sp.md,
                  vertical: Sp.xs + 2,
                ),
                decoration: BoxDecoration(
                  color: AppColors.warningSoft,
                  borderRadius: BorderRadius.circular(Radii.pill),
                ),
                child: Text(
                  'Belum dikonfirmasi',
                  style: text.labelSmall?.copyWith(color: AppColors.warning),
                ),
              ),
            ),
          ],
          if (selectedDate == null) ...[
            const SizedBox(height: Sp.md),
            Text(
              'Pilih tanggal dulu untuk melihat sesi.',
              style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
            ),
          ] else ...[
            const SizedBox(height: Sp.lg),
            Text(
              'Sesi · ${formatDate(DateTime.parse(selectedDate))}',
              style: text.titleMedium,
            ),
            const SizedBox(height: Sp.sm),
            for (final session in _sessions) ...[
              _SessionOption(
                label: sessionText(session),
                stateText: _stateText(_stateFor(selectedDate, session)),
                enabled: _stateAllowed(_stateFor(selectedDate, session)),
                selected: _selectedSession == session,
                onTap: () => _pickSession(session),
              ),
              const SizedBox(height: Sp.sm),
            ],
          ],
          if (_dateError) ...[
            const SizedBox(height: Sp.xs),
            Text(
              'Pilih tanggal dan sesi dulu.',
              style: text.bodySmall?.copyWith(color: AppColors.danger),
            ),
          ],
        ],
      ),
    );
  }

  Widget _detailSection(TextTheme text) {
    return BookingSection(
      title: 'Detail acara',
      hint: 'Nama acara otomatis terisi. Kamu bisa mengubahnya.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            controller: _title,
            textInputAction: TextInputAction.next,
            maxLength: 150,
            decoration: const InputDecoration(
              labelText: 'Judul acara',
              counterText: '',
            ),
            validator: (value) {
              final trimmed = value?.trim() ?? '';
              if (trimmed.isEmpty) return 'Judul acara wajib diisi.';
              if (trimmed.length > 150) return 'Judul maksimal 150 karakter.';
              return null;
            },
          ),
          const SizedBox(height: Sp.md),
          TextFormField(
            controller: _guests,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.next,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(
              labelText: 'Perkiraan jumlah tamu (opsional)',
              hintText: 'Contoh: 120',
            ),
            validator: (value) {
              final trimmed = value?.trim() ?? '';
              if (trimmed.isEmpty) return null;
              final parsed = int.tryParse(trimmed);
              if (parsed == null || parsed < 0 || parsed > 100000) {
                return 'Isi angka 0 sampai 100.000.';
              }
              return null;
            },
          ),
          const SizedBox(height: Sp.md),
          TextFormField(
            controller: _address,
            textInputAction: TextInputAction.next,
            minLines: 2,
            maxLines: 4,
            maxLength: 1000,
            decoration: const InputDecoration(
              labelText: 'Alamat lokasi acara',
              hintText: 'Nama kampung, jalan, patokan',
              counterText: '',
            ),
            validator: (value) {
              final trimmed = value?.trim() ?? '';
              if (trimmed.length < 10) return 'Alamat minimal 10 karakter.';
              if (trimmed.length > 1000) {
                return 'Alamat maksimal 1.000 karakter.';
              }
              return null;
            },
          ),
          const SizedBox(height: Sp.md),
          TextFormField(
            controller: _notes,
            minLines: 2,
            maxLines: 4,
            maxLength: 2000,
            decoration: const InputDecoration(
              labelText: 'Catatan untuk vendor (opsional)',
              hintText: 'Contoh: listrik tersedia, panggung di halaman',
              counterText: '',
            ),
          ),
        ],
      ),
    );
  }

  Widget _moneySection(TextTheme text) {
    return BookingSection(
      title: 'Perkiraan biaya',
      child: BookingPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            MoneyLine(label: 'Harga paket', value: rupiah(_packagePrice)),
            const SizedBox(height: Sp.sm),
            MoneyLine(
              label: 'Biaya layanan 1%',
              value: rupiah(_serviceFee),
              muted: true,
            ),
            const SizedBox(height: Sp.md),
            const Divider(height: 1),
            const SizedBox(height: Sp.md),
            MoneyLine(
              label: 'Total perkiraan',
              value: rupiah(_estimateTotal),
              emphasis: true,
            ),
            const SizedBox(height: Sp.md),
            Container(
              padding: const EdgeInsets.all(Sp.md),
              decoration: BoxDecoration(
                color: AppColors.warningSoft,
                borderRadius: BorderRadius.circular(Radii.sm),
              ),
              child: Text(
                'Perkiraan — total final dari sistem. Angka pasti muncul setelah booking dikirim.',
                style: text.bodySmall?.copyWith(color: AppColors.warning),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DateButton extends StatelessWidget {
  const _DateButton({
    required this.date,
    required this.selected,
    required this.enabled,
    required this.uncertain,
    required this.onTap,
  });

  final String date;
  final bool selected;
  final bool enabled;
  final bool uncertain;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final parsed = DateTime.tryParse(date);
    final weekday = parsed == null ? '' : _weekdays[parsed.weekday - 1];
    return Semantics(
      button: true,
      selected: selected,
      enabled: enabled,
      label:
          '${parsed == null ? date : formatDate(parsed)}'
          '${uncertain ? ', belum dikonfirmasi' : ''}',
      excludeSemantics: true,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(Radii.pill),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(
              horizontal: Sp.md,
              vertical: Sp.sm + 2,
            ),
            decoration: BoxDecoration(
              color: selected
                  ? AppColors.primarySoft
                  : enabled
                  ? AppColors.card
                  : AppColors.neutralSoft,
              borderRadius: BorderRadius.circular(Radii.pill),
              border: Border.all(
                color: selected
                    ? AppColors.primary
                    : enabled
                    ? AppColors.line
                    : AppColors.neutralSoft,
                width: selected ? 1.6 : 1,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (uncertain) ...[
                  Container(
                    width: 6,
                    height: 6,
                    decoration: const BoxDecoration(
                      color: AppColors.warning,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: Sp.xs + 2),
                ],
                Text(
                  '${weekday.isEmpty ? '' : '$weekday '}${parsed == null ? date : formatDayMonth(parsed)}',
                  style: text.labelMedium?.copyWith(
                    color: enabled ? AppColors.ink : AppColors.inkMuted,
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

class _SessionOption extends StatelessWidget {
  const _SessionOption({
    required this.label,
    required this.stateText,
    required this.enabled,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String stateText;
  final bool enabled;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(Radii.sm),
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(
            horizontal: Sp.md,
            vertical: Sp.md,
          ),
          decoration: BoxDecoration(
            color: selected ? AppColors.primarySoft : AppColors.card,
            borderRadius: BorderRadius.circular(Radii.sm),
            border: Border.all(
              color: selected ? AppColors.primary : AppColors.line,
              width: selected ? 1.6 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                selected
                    ? Icons.radio_button_checked
                    : Icons.radio_button_unchecked,
                size: 22,
                color: enabled
                    ? selected
                          ? AppColors.primary
                          : AppColors.inkMuted
                    : AppColors.inkMuted,
              ),
              const SizedBox(width: Sp.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: text.titleMedium?.copyWith(
                        color: enabled ? AppColors.ink : AppColors.inkMuted,
                      ),
                    ),
                    Text(
                      stateText,
                      style: text.bodySmall?.copyWith(
                        color: enabled
                            ? stateText == 'Tersedia'
                                  ? AppColors.accent
                                  : AppColors.warning
                            : AppColors.inkMuted,
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
