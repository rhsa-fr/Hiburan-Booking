import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/geo/geo.dart';
import '../../core/models.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';
import 'booking_support.dart';

const _weekdays = <String>['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const _allowedStates = {'available', 'unconfirmed', 'stale'};
const _tabularFigures = <FontFeature>[FontFeature.tabularFigures()];

/// Server pricing: 30% DP of the package, 1% service fee, add-ons on top.
const _dpRatePercent = 30;
const _serviceFeeBp = 100;
const _dpRule = 'DP berlaku 24 jam. Untuk nilai Rp10 juta ke atas, 48 jam.';

/// Stored as `events.event_type` (free text, max 50). The API has no enum, so
/// these are human labels the vendor and invoice can read as-is.
const _eventTypes = <String>[
  'Hajatan',
  'Khitanan / Sunatan',
  'Syukuran',
  'Unjungan',
  'Pesta Panen',
  'Lainnya',
];

enum _LocationMode { typed, gps }

Map<String, dynamic> _asMap(dynamic value) =>
    value is Map ? value.cast<String, dynamic>() : const <String, dynamic>{};

/// RFC-4122 v4 id used as `Idempotency-Key` + `client_generated_id`.
/// No uuid package: the mobile dependency list is locked (ADR 0003).
String _uuidV4() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

bool _allowedState(String? state) =>
    state != null && _allowedStates.contains(state);

/// `full` without an explicit row is derived from the two half-day sessions.
String? _sessionState(
  Map<String, Map<String, String>> availability,
  String date,
  String session,
) {
  final states = availability[date] ?? const <String, String>{};
  if (session != 'full') return states[session];
  final explicit = states['full'];
  if (explicit != null) return explicit;
  final day = states['day'];
  final night = states['night'];
  if (day == null && night == null) return null;
  if (!_allowedState(day) || !_allowedState(night)) return 'blocked';
  return day == 'available' && night == 'available' ? 'available' : 'stale';
}

bool _dateEnabled(Map<String, Map<String, String>> availability, String date) =>
    _allowedState(_sessionState(availability, date, 'day')) ||
    _allowedState(_sessionState(availability, date, 'night')) ||
    _allowedState(_sessionState(availability, date, 'full'));

bool _dateUncertain(
  Map<String, Map<String, String>> availability,
  String date,
) {
  if (!_dateEnabled(availability, date)) return false;
  final day = _sessionState(availability, date, 'day');
  final night = _sessionState(availability, date, 'night');
  return (_allowedState(day) && day != 'available') ||
      (_allowedState(night) && night != 'available');
}

/// One scrollable screen, three numbered blocks: event, package/add-ons, money.
/// The API still computes the final number; this page never invents a total.
class CreateBookingPage extends StatefulWidget {
  const CreateBookingPage({super.key, required this.args});

  final BookCreateArgs args;

  @override
  State<CreateBookingPage> createState() => _CreateBookingPageState();
}

class _CreateBookingPageState extends State<CreateBookingPage> {
  final _formKey = GlobalKey<FormState>();
  final String _clientGeneratedId = _uuidV4();
  final _title = TextEditingController();
  final _guests = TextEditingController();
  final _address = TextEditingController();
  final _notes = TextEditingController();
  final _place = TextEditingController();
  final _patokan = TextEditingController();
  final _eventOther = TextEditingController();

  VendorDetail? _vendor;
  VendorPackage? _package;
  Policy? _policy;
  List<String> _dates = const [];
  Map<String, Map<String, String>> _availability = const {};
  final Map<String, int> _addonQty = {};

  String? _eventType;
  String? _selectedDate;
  String? _selectedSession;
  bool _titleEdited = false;
  bool _settingTitle = false;

  _LocationMode _locationMode = _LocationMode.typed;
  GeoReading? _pin;
  bool _locating = false;
  String? _locationError;

  bool _loading = true;
  String? _loadError;
  bool _submitting = false;
  String? _submitError;
  bool _dateError = false;

  @override
  void initState() {
    super.initState();
    _selectedDate = widget.args.date;
    _selectedSession = 'full';
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
    _place.dispose();
    _patokan.dispose();
    _eventOther.dispose();
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
      _syncTitle();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = apiMessage(error);
      });
    }
  }

  bool _dateUncertainOn(String date) => _dateUncertain(_availability, date);

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
  int get _serviceFee => _packagePrice * _serviceFeeBp ~/ 10000;
  int get _dpAmount => _packagePrice * _dpRatePercent ~/ 100;

  /// `event_type` is free text in the API. "Lainnya" stores what the customer
  /// typed so the vendor sees a real occasion, not the word "Lainnya".
  String? _resolvedEventType() {
    final selected = _eventType;
    if (selected == null) return null;
    if (selected == 'Lainnya') {
      final custom = _eventOther.text.trim();
      return custom.isEmpty ? null : custom;
    }
    return selected;
  }

  /// GPS mode sends the pin plus an optional landmark because the API still
  /// requires a human-readable `venue_address` for the vendor.
  String _effectiveAddress() {
    if (_locationMode != _LocationMode.gps) return _address.text.trim();
    final pin = _pin;
    if (pin == null) return '';
    final patokan = _patokan.text.trim();
    return patokan.isEmpty
        ? pin.coordinateText
        : '$patokan · ${pin.coordinateText}';
  }

  Future<void> _useCurrentLocation() async {
    if (_locating) return;
    setState(() {
      _locating = true;
      _locationError = null;
    });
    try {
      final reading = await readCurrentLocation();
      if (!mounted) return;
      setState(() {
        _pin = reading;
        _locating = false;
      });
    } on GeoException catch (error) {
      if (!mounted) return;
      setState(() {
        _locating = false;
        _locationError = switch (error.failure) {
          GeoFailure.denied =>
            'Izin lokasi ditolak. Aktifkan izin lokasi di browser, lalu coba lagi.',
          GeoFailure.timeout =>
            'Pencarian lokasi terlalu lama. Coba lagi di area terbuka.',
          GeoFailure.unavailable =>
            'Titik lokasi tidak ditemukan. Pastikan GPS aktif, lalu coba lagi.',
          GeoFailure.unsupported =>
            'Perangkat ini belum mendukung GPS. Ketik alamat manual.',
        };
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _locating = false;
        _locationError = 'Titik lokasi belum bisa diambil. Coba lagi.';
      });
    }
  }

  int _qtyOf(Addon addon) => _addonQty[addon.id] ?? 0;

  int get _addonTotal {
    final package = _package;
    if (package == null) return 0;
    var total = 0;
    for (final addon in package.addons) {
      total += addon.priceIdr * _qtyOf(addon);
    }
    return total;
  }

  int get _total => _packagePrice + _addonTotal + _serviceFee;
  int get _remaining => _total - _dpAmount;

  int _maxQty(Addon addon) {
    final max = addon.maxQty > 0 ? addon.maxQty : 10;
    return max > 10 ? 10 : max;
  }

  void _setQty(Addon addon, int next) {
    final max = _maxQty(addon);
    final clamped = next < 0 ? 0 : (next > max ? max : next);
    setState(() => _addonQty[addon.id] = clamped);
  }

  Future<void> _pickSlot() async {
    if (_dates.isEmpty) return;
    final result = await showModalBottomSheet<({String date, String session})>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.lg)),
      ),
      builder: (_) => _SlotSheet(
        dates: _dates,
        availability: _availability,
        initialDate: _selectedDate,
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      _selectedDate = result.date;
      _selectedSession = result.session;
      _dateError = false;
    });
    _syncTitle();
  }

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
    if (vendor == null || package == null) return;
    if (policy == null) {
      setState(() {
        _submitError = 'Kebijakan pembatalan belum bisa dimuat. Coba lagi.';
      });
      return;
    }
    if (date == null || session == null) {
      setState(() => _dateError = true);
      return;
    }

    final note = _notes.text.trim();
    final guestText = _guests.text.trim();
    final guest = guestText.isEmpty ? null : int.tryParse(guestText);
    final eventType = _resolvedEventType();
    final place = _place.text.trim();

    if (_locationMode == _LocationMode.gps && _pin == null) {
      setState(() {
        _locationError =
            'Ambil titik lokasi dulu, atau pilih "Ketik alamat" dan isi alamat.';
      });
      return;
    }
    final address = _effectiveAddress();

    setState(() {
      _submitting = true;
      _submitError = null;
    });

    try {
      final addons = [
        for (final addon in package.addons)
          if (_qtyOf(addon) > 0) {'addon_id': addon.id, 'qty': _qtyOf(addon)},
      ];
      final raw = await AppScope.of(context).api.post(
        '/bookings',
        headers: {'Idempotency-Key': _clientGeneratedId},
        body: {
          'vendor_id': vendor.id,
          'package_id': package.id,
          'client_generated_id': _clientGeneratedId,
          'event': {
            'title': _title.text.trim(),
            if (eventType != null) 'event_type': eventType,
            'region_code': vendor.regionCode,
            if (place.isNotEmpty) 'venue_name': place,
            'venue_address': address,
            // `venue_location` adalah koordinat ACARA, bukan lokasi vendor.
            // Hanya dikirim saat pelanggan memilih mode GPS; mode ketik manual
            // tidak membawa titik lama yang mungkin sudah tidak relevan.
            if (_locationMode == _LocationMode.gps && _pin != null)
              'venue_location': {'lat': _pin!.latitude, 'lng': _pin!.longitude},
            'start_date': date,
            'end_date': date,
            if (guest != null) 'guest_estimate': guest,
            if (note.isNotEmpty) 'notes': note,
          },
          'slots': [
            {'date': date, 'session': session},
          ],
          if (addons.isNotEmpty) 'addons': addons,
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
    final loaded = !_loading && _loadError == null && _package != null;

    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Column(
            children: [
              StageHeader.back(
                context: context,
                title: 'Buat Booking',
                subtitle: _vendor?.displayName ?? 'Pilih jadwal & paket',
              ),
              Expanded(
                child: _loading
                    ? const Padding(
                        padding: EdgeInsets.all(Sp.lg),
                        child: AppLoading(
                          rows: 3,
                          label: 'Memuat vendor dan jadwal',
                        ),
                      )
                    : _loadError != null
                    ? AppError(message: _loadError!, onRetry: _load)
                    : Form(
                        key: _formKey,
                        autovalidateMode: AutovalidateMode.onUserInteraction,
                        child: ListView(
                          padding: const EdgeInsets.fromLTRB(
                            Sp.lg,
                            Sp.sm,
                            Sp.lg,
                            160,
                          ),
                          children: [
                            _summaryStrip(text),
                            const SizedBox(height: Sp.md),
                            _eventBlock(text),
                            const SizedBox(height: Sp.md),
                            _locationBlock(text),
                            const SizedBox(height: Sp.md),
                            _packageBlock(text),
                            const SizedBox(height: Sp.md),
                            _moneyBlock(),
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
            ],
          ),
        ),
      ),
      bottomNavigationBar: loaded
          ? StickyActionBar(
              child: PrimaryButton(
                label: 'Kirim permintaan booking',
                loadingLabel: 'Mengirim…',
                loading: _submitting,
                onPressed: _submit,
              ),
            )
          : null,
    );
  }

  /// Compact order rail: package + DP visible before the first field so the
  /// page never opens on a wall of empty inputs.
  Widget _summaryStrip(TextTheme text) {
    final package = _package;
    if (package == null) return const SizedBox.shrink();
    final meta = <String>[
      if (package.durationMinutes > 0) _duration(package.durationMinutes),
      if (package.personnelCount > 0) '${package.personnelCount} personel',
    ].join(' · ');

    return Container(
      padding: const EdgeInsets.all(Sp.md),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(Radii.lg),
        border: Border.all(color: AppColors.line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A0B1220),
            blurRadius: 14,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          const IconBadge(icon: Icons.inventory_2_outlined, size: 38),
          const SizedBox(width: Sp.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  package.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.labelLarge?.copyWith(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.2,
                  ),
                ),
                if (meta.isNotEmpty) ...[
                  const SizedBox(height: 1),
                  Text(
                    meta,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: Sp.sm),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(
              color: AppColors.limeSoft,
              borderRadius: BorderRadius.circular(Radii.pill),
              border: Border.all(
                color: AppColors.limeDark.withValues(alpha: 0.45),
              ),
            ),
            child: Text(
              'DP $_dpRatePercent%',
              style: text.labelSmall?.copyWith(
                color: AppColors.ink,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.1,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _eventBlock(TextTheme text) {
    return SectionPanel(
      leading: const StepBadge(step: 1, icon: Icons.event_outlined),
      title: 'Acara',
      caption: 'Detail yang dipakai vendor untuk menyiapkan acara.',
      padding: const EdgeInsets.all(Sp.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            controller: _title,
            textInputAction: TextInputAction.next,
            maxLength: 150,
            decoration: const InputDecoration(
              labelText: 'Nama acara',
              hintText: 'Contoh: Hajatan keluarga di rumah',
              counterText: '',
            ),
            validator: (value) {
              final trimmed = value?.trim() ?? '';
              if (trimmed.isEmpty) return 'Nama acara wajib diisi.';
              if (trimmed.length > 150) return 'Nama maksimal 150 karakter.';
              return null;
            },
          ),
          const SizedBox(height: Sp.md),
          _eventTypePicker(text),
          if (_eventType == 'Lainnya') ...[
            const SizedBox(height: Sp.md),
            TextFormField(
              controller: _eventOther,
              textInputAction: TextInputAction.next,
              maxLength: 50,
              decoration: const InputDecoration(
                labelText: 'Sebutkan jenis acara',
                hintText: 'Contoh: Kenduri keluarga besar',
                counterText: '',
              ),
              validator: (value) {
                if (_eventType != 'Lainnya') return null;
                final trimmed = value?.trim() ?? '';
                if (trimmed.isEmpty) return 'Jenis acara wajib disebutkan.';
                if (trimmed.length > 50) return 'Maksimal 50 karakter.';
                return null;
              },
            ),
          ],
          const SizedBox(height: Sp.md),
          if (_dates.isEmpty)
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const InfoStrip(
                  message:
                      'Jadwal vendor belum tersedia untuk 45 hari ke depan. '
                      'Muat ulang dulu sebelum memesan.',
                  icon: Icons.event_busy_outlined,
                  tone: InfoTone.warning,
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: _load,
                    child: const Text('Muat ulang jadwal'),
                  ),
                ),
              ],
            )
          else
            _slotSummary(text),
          if (_dateError && _dates.isNotEmpty) ...[
            const SizedBox(height: Sp.xs),
            Text(
              'Pilih tanggal acara dulu.',
              style: text.bodySmall?.copyWith(color: AppColors.danger),
            ),
          ],
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

  /// Occasion chips instead of a dropdown: one tap, no full-screen menu, and
  /// the six options stay visible so nobody has to guess what is available.
  Widget _eventTypePicker(TextTheme text) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              'Jenis acara',
              style: text.labelMedium?.copyWith(
                color: AppColors.inkMuted,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(width: 6),
            Text('opsional', style: text.bodySmall?.copyWith(fontSize: 11)),
          ],
        ),
        const SizedBox(height: Sp.sm),
        Wrap(
          spacing: Sp.sm,
          runSpacing: Sp.sm,
          children: [
            for (final label in _eventTypes)
              SelectChip(
                label: label,
                selected: _eventType == label,
                onTap: () => setState(() {
                  _eventType = _eventType == label ? null : label;
                }),
              ),
          ],
        ),
      ],
    );
  }

  Widget _locationBlock(TextTheme text) {
    final gpsMode = locationSupported && _locationMode == _LocationMode.gps;

    return SectionPanel(
      leading: const StepBadge(step: 2, icon: Icons.place_outlined),
      title: 'Lokasi acara',
      caption: 'Vendor memakai alamat ini untuk menemukan panggung.',
      padding: const EdgeInsets.all(Sp.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            controller: _place,
            textInputAction: TextInputAction.next,
            maxLength: 150,
            decoration: const InputDecoration(
              labelText: 'Nama tempat (opsional)',
              hintText: 'Contoh: Rumah Haji Sulaeman',
              counterText: '',
            ),
          ),
          if (locationSupported) ...[
            const SizedBox(height: Sp.md),
            SegmentBar(
              items: const ['Ketik alamat', 'Pakai GPS'],
              index: _locationMode.index,
              onChanged: (index) => setState(() {
                _locationMode = _LocationMode.values[index];
                _locationError = null;
              }),
            ),
          ],
          const SizedBox(height: Sp.md),
          if (!gpsMode)
            TextFormField(
              controller: _address,
              textInputAction: TextInputAction.next,
              minLines: 2,
              maxLines: 4,
              maxLength: 1000,
              decoration: const InputDecoration(
                labelText: 'Alamat & patokan',
                hintText: 'Kampung, jalan, dan patokan yang mudah dicari',
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
            )
          else ...[
            _gpsBlock(text),
            const SizedBox(height: Sp.md),
            TextFormField(
              controller: _patokan,
              textInputAction: TextInputAction.next,
              maxLength: 200,
              decoration: const InputDecoration(
                labelText: 'Patokan tambahan (opsional)',
                hintText: 'Contoh: rumah pagar hijau setelah jembatan',
                counterText: '',
              ),
            ),
          ],
          if (_locationError != null) ...[
            const SizedBox(height: Sp.sm),
            Semantics(
              liveRegion: true,
              child: Text(
                _locationError!,
                style: text.bodySmall?.copyWith(color: AppColors.danger),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _gpsBlock(TextTheme text) {
    final pin = _pin;
    if (pin == null) {
      return Container(
        padding: const EdgeInsets.all(Sp.md),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(Radii.lg),
          border: Border.all(color: AppColors.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const IconBadge(icon: Icons.my_location, size: 38),
                const SizedBox(width: Sp.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Ambil titik lokasi',
                        style: text.titleMedium?.copyWith(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.2,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Koordinat membantu vendor menemukan lokasi tepat. '
                        'Izin lokasi diminta sekali.',
                        style: text.bodySmall?.copyWith(height: 1.45),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: Sp.md),
            OutlinedButton.icon(
              onPressed: _locating ? null : _useCurrentLocation,
              icon: _locating
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.gps_fixed, size: 18),
              label: Text(
                _locating ? 'Mencari lokasi…' : 'Gunakan lokasi saat ini',
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(Sp.md),
      decoration: BoxDecoration(
        color: AppColors.ink,
        borderRadius: BorderRadius.circular(Radii.lg),
        boxShadow: const [
          BoxShadow(
            color: Color(0x240B1220),
            blurRadius: 20,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppColors.lime.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: AppColors.lime.withValues(alpha: 0.40),
                  ),
                ),
                child: const Icon(
                  Icons.my_location,
                  size: 18,
                  color: AppColors.lime,
                ),
              ),
              const SizedBox(width: Sp.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Titik lokasi tersimpan',
                      style: text.titleMedium?.copyWith(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      'Akurasi ±${pin.accuracyMeters.round()} m',
                      style: text.bodySmall?.copyWith(
                        fontSize: 11.5,
                        color: Colors.white.withValues(alpha: 0.56),
                      ),
                    ),
                  ],
                ),
              ),
              TextButton(
                onPressed: _locating ? null : _useCurrentLocation,
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.lime,
                  minimumSize: const Size(0, 44),
                  padding: const EdgeInsets.symmetric(horizontal: Sp.sm),
                  textStyle: text.labelMedium?.copyWith(
                    color: AppColors.lime,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                child: Text(_locating ? '…' : 'Perbarui'),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.place_outlined,
                  size: 16,
                  color: AppColors.lime,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    pin.coordinateText,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodyMedium?.copyWith(
                      color: Colors.white.withValues(alpha: 0.94),
                      fontWeight: FontWeight.w700,
                      fontFeatures: _tabularFigures,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _slotSummary(TextTheme text) {
    final date = _selectedDate;
    final parsed = date == null ? null : DateTime.tryParse(date);
    final uncertain = date != null && _dateUncertainOn(date);

    return Material(
      color: AppColors.card,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        side: BorderSide(color: _dateError ? AppColors.danger : AppColors.line),
      ),
      child: InkWell(
        onTap: _pickSlot,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 56),
          child: Padding(
            padding: const EdgeInsets.all(Sp.md),
            child: Row(
              children: [
                const Icon(
                  Icons.event_outlined,
                  size: 20,
                  color: AppColors.inkMuted,
                ),
                const SizedBox(width: Sp.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        parsed == null
                            ? 'Pilih tanggal acara'
                            : formatDate(parsed),
                        style: text.titleMedium?.copyWith(
                          color: parsed == null
                              ? AppColors.inkMuted
                              : AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        parsed == null
                            ? 'Dari jadwal vendor yang masih terbuka'
                            : 'Sehari penuh · satu panggung untuk acara ini'
                                  '${uncertain ? ' · belum dikonfirmasi' : ''}',
                        style: text.bodySmall?.copyWith(
                          color: uncertain ? AppColors.warning : null,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: Sp.sm),
                const Icon(
                  Icons.chevron_right,
                  size: 22,
                  color: AppColors.inkMuted,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _packageBlock(TextTheme text) {
    final package = _package;
    final vendor = _vendor;
    if (package == null || vendor == null) return const SizedBox.shrink();

    final meta = <String>[
      if (package.durationMinutes > 0) _duration(package.durationMinutes),
      if (package.personnelCount > 0) '${package.personnelCount} personel',
    ].join(' · ');

    return SectionPanel(
      leading: const StepBadge(step: 3, icon: Icons.inventory_2_outlined),
      title: 'Paket',
      caption: 'Satu grup, satu harga untuk sehari penuh.',
      padding: const EdgeInsets.all(Sp.md),
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
                      package.name,
                      style: text.titleLarge,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: Sp.xs),
                    Text(
                      vendor.displayName,
                      style: text.bodySmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (meta.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(meta, style: text.bodySmall),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: Sp.sm),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    rupiah(package.basePriceIdr),
                    style: text.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      fontFeatures: _tabularFigures,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'DP $_dpRatePercent%',
                    style: text.labelSmall?.copyWith(
                      color: AppColors.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ],
          ),
          if (package.inclusions.isNotEmpty) ...[
            const SizedBox(height: Sp.md),
            for (final item in package.inclusions)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding: EdgeInsets.only(top: 1),
                      child: Icon(
                        Icons.check_circle_outline,
                        size: 16,
                        color: AppColors.accent,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(child: Text(item, style: text.bodySmall)),
                  ],
                ),
              ),
          ],
          if (_serviceFee > 0) ...[
            const SizedBox(height: Sp.xs),
            Text(
              'Ditambah biaya layanan 1% (${rupiah(_serviceFee)}).',
              style: text.bodySmall,
            ),
          ],
          if (package.addons.isNotEmpty) ...[
            const SizedBox(height: Sp.lg),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Tambahan',
                    style: text.labelSmall?.copyWith(color: AppColors.inkMuted),
                  ),
                ),
                if (_addonTotal > 0)
                  Text(
                    rupiah(_addonTotal),
                    style: text.labelMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      fontFeatures: _tabularFigures,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: Sp.sm),
            for (var i = 0; i < package.addons.length; i++) ...[
              if (i > 0)
                const Divider(
                  height: Sp.lg,
                  color: AppColors.line,
                  thickness: 1,
                ),
              _AddonRow(
                addon: package.addons[i],
                qty: _qtyOf(package.addons[i]),
                maxQty: _maxQty(package.addons[i]),
                onChanged: (value) => _setQty(package.addons[i], value),
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _moneyBlock() {
    final package = _package;
    if (package == null) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const StepBadge(step: 4, icon: Icons.receipt_long_outlined),
            const SizedBox(width: Sp.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Ringkasan',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Total, DP, dan sisa setelah DP.',
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: AppColors.inkMuted),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: Sp.md),
        MoneyBlock(
          rows: [
            MoneyRow('Total acara', _total),
            MoneyRow('DP sekarang ($_dpRatePercent%)', _dpAmount),
          ],
          totalLabel: 'Sisa yang harus dibayar',
          totalIdr: _remaining,
          footnote: _dpRule,
        ),
        const SizedBox(height: Sp.md),
        const InfoStrip(
          message:
              'Pembayaran DP dibuka setelah vendor menerima booking. '
              'Total final dihitung sistem saat booking dikirim.',
          icon: Icons.schedule_outlined,
          tone: InfoTone.primary,
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

class _AddonRow extends StatelessWidget {
  const _AddonRow({
    required this.addon,
    required this.qty,
    required this.maxQty,
    required this.onChanged,
  });

  final Addon addon;
  final int qty;
  final int maxQty;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final unit = addon.unit.trim();
    final price = unit.isEmpty
        ? rupiah(addon.priceIdr)
        : '${rupiah(addon.priceIdr)} / $unit';

    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                addon.name,
                style: text.titleMedium,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Text(
                price,
                style: text.bodySmall?.copyWith(fontFeatures: _tabularFigures),
              ),
            ],
          ),
        ),
        const SizedBox(width: Sp.md),
        _QtyStepper(
          value: qty,
          max: maxQty,
          label: addon.name,
          onChanged: onChanged,
        ),
      ],
    );
  }
}

class _QtyStepper extends StatelessWidget {
  const _QtyStepper({
    required this.value,
    required this.max,
    required this.label,
    required this.onChanged,
  });

  final int value;
  final int max;
  final String label;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(Radii.pill),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            onPressed: value <= 0 ? null : () => onChanged(value - 1),
            tooltip: 'Kurangi $label',
            visualDensity: VisualDensity.compact,
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            icon: const Icon(Icons.remove, size: 18),
          ),
          SizedBox(
            width: 26,
            child: Text(
              '$value',
              textAlign: TextAlign.center,
              style: text.titleMedium?.copyWith(fontFeatures: _tabularFigures),
            ),
          ),
          IconButton(
            onPressed: value >= max ? null : () => onChanged(value + 1),
            tooltip: 'Tambah $label',
            visualDensity: VisualDensity.compact,
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            icon: const Icon(Icons.add, size: 18),
          ),
        ],
      ),
    );
  }
}

/// Date picker sheet. A booking is always a full day, so the sheet only asks
/// for the date; nothing is written back until the customer confirms.
class _SlotSheet extends StatefulWidget {
  const _SlotSheet({
    required this.dates,
    required this.availability,
    this.initialDate,
  });

  final List<String> dates;
  final Map<String, Map<String, String>> availability;
  final String? initialDate;

  @override
  State<_SlotSheet> createState() => _SlotSheetState();
}

class _SlotSheetState extends State<_SlotSheet> {
  String? _date;

  @override
  void initState() {
    super.initState();
    final date = widget.initialDate;
    if (date == null ||
        !widget.dates.contains(date) ||
        !_dateEnabled(widget.availability, date)) {
      return;
    }
    _date = date;
  }

  void _chooseDate(String date) => setState(() => _date = date);

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final date = _date;
    final uncertain = date != null && _dateUncertain(widget.availability, date);

    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.86,
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(Sp.xl, Sp.md, Sp.xl, Sp.xl),
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
                    borderRadius: BorderRadius.circular(Radii.pill),
                  ),
                ),
              ),
              const SizedBox(height: Sp.lg),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Pilih tanggal acara',
                          style: text.titleLarge?.copyWith(
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.3,
                          ),
                        ),
                        const SizedBox(height: Sp.xs),
                        Text(
                          'Booking berlaku sehari penuh. Vendor hanya menerima '
                          'satu acara per tanggal.',
                          style: text.bodySmall?.copyWith(
                            color: AppColors.inkMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (date != null && DateTime.tryParse(date) != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.primary,
                        borderRadius: BorderRadius.circular(Radii.sm),
                      ),
                      child: Text(
                        'Tahun ${DateTime.tryParse(date)!.year}',
                        style: text.labelSmall?.copyWith(
                          color: AppColors.onPrimary,
                          fontWeight: FontWeight.w700,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: Sp.lg),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final item in widget.dates) ...[
                      _DateButton(
                        date: item,
                        selected: item == date,
                        enabled: _dateEnabled(widget.availability, item),
                        uncertain: _dateUncertain(widget.availability, item),
                        onTap: () => _chooseDate(item),
                      ),
                      const SizedBox(width: Sp.sm),
                    ],
                  ],
                ),
              ),
              if (uncertain) ...[
                const SizedBox(height: Sp.md),
                const InfoStrip(
                  message:
                      'Vendor perlu mengecek tanggal ini. Kamu tetap bisa '
                      'memesan, tapi jadwal belum pasti.',
                  icon: Icons.help_outline,
                  tone: InfoTone.warning,
                ),
              ],
              const SizedBox(height: Sp.lg),
              PrimaryButton(
                label: 'Pakai tanggal ini',
                onPressed: date == null
                    ? null
                    : () =>
                          Navigator.pop(context, (date: date, session: 'full')),
              ),
            ],
          ),
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
          borderRadius: BorderRadius.circular(Radii.sm),
          child: Container(
            constraints: const BoxConstraints(minHeight: 52),
            padding: const EdgeInsets.symmetric(
              horizontal: Sp.md,
              vertical: Sp.sm,
            ),
            decoration: BoxDecoration(
              color: selected
                  ? AppColors.primary
                  : enabled
                  ? AppColors.card
                  : AppColors.neutralSoft,
              borderRadius: BorderRadius.circular(Radii.sm),
              border: Border.all(
                color: selected
                    ? AppColors.primary
                    : enabled
                    ? AppColors.line
                    : AppColors.line,
                width: selected ? 1.5 : 1,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (uncertain) ...[
                  Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: selected ? AppColors.onPrimary : AppColors.warning,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: Sp.xs + 2),
                ],
                Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          weekday.toUpperCase(),
                          style: text.labelSmall?.copyWith(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.5,
                            color: selected
                                ? AppColors.onPrimary.withValues(alpha: 0.8)
                                : AppColors.inkMuted,
                          ),
                        ),
                        if (parsed != null) ...[
                          const SizedBox(width: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 4,
                              vertical: 1,
                            ),
                            decoration: BoxDecoration(
                              color: selected
                                  ? AppColors.primaryContainer
                                  : AppColors.surfaceSoft,
                              borderRadius: BorderRadius.circular(3),
                            ),
                            child: Text(
                              '${parsed.year}',
                              style: text.labelSmall?.copyWith(
                                fontSize: 9,
                                fontWeight: FontWeight.w700,
                                color: selected
                                    ? AppColors.onPrimary
                                    : AppColors.inkMuted,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      parsed == null ? date : formatDayMonth(parsed),
                      style: text.titleMedium?.copyWith(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: selected
                            ? AppColors.onPrimary
                            : enabled
                            ? AppColors.ink
                            : AppColors.inkMuted,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
