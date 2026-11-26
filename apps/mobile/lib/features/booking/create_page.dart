import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/geo/geo.dart';
import '../../core/geo/geo_native_geocode.dart';
import '../../core/models.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';
import 'booking_support.dart';

const _weekdays = <String>['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const _allowedStates = {'available', 'unconfirmed', 'stale'};
const _tabularFigures = <FontFeature>[FontFeature.tabularFigures()];

/// The server decides whether a booked day can still be taken; the form only
/// warns, it never blocks the customer.
const _bookedDateWarning =
    'Tanggal ini sudah terisi. Booking bisa ditolak vendor.';
const _outsideCalendarWarning = 'Kalender vendor belum mencakup tanggal ini.';

/// How far ahead a booking may be requested. The vendor calendar is loaded for
/// 45 days, but a date outside it is unknown, not forbidden.
const _bookingHorizonYears = 10;

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

/// A date inside the loaded window carries a state; anything else is unknown,
/// not blocked. Unknown dates stay bookable and are labelled as such.
String? _dateWarning(
  Map<String, Map<String, String>> availability,
  String date,
) {
  if (!availability.containsKey(date)) return _outsideCalendarWarning;
  return _dateEnabled(availability, date) ? null : _bookedDateWarning;
}

/// The calendar blocks past days; this also rejects a stale date carried over
/// from the vendor page so the form never submits an event in the past.
bool _isPastDay(DateTime date) {
  final now = DateTime.now();
  return date.isBefore(DateTime(now.year, now.month, now.day));
}

/// One scrollable screen, three numbered blocks: event, package/add-ons, money.
/// The API still computes the final number; this page never invents a total.
class CreateBookingPage extends StatefulWidget {
  const CreateBookingPage({
    super.key,
    required this.args,
    this.locationReader,
    this.addressResolver,
    this.settingsOpener,
  });

  final BookCreateArgs args;

  /// The plugin-backed helpers cannot run in widget tests; production leaves
  /// these null and the page uses `geolocator` / `geocoding` directly.
  @visibleForTesting
  final Future<GeoReading> Function()? locationReader;
  @visibleForTesting
  final Future<String?> Function(GeoReading reading)? addressResolver;
  @visibleForTesting
  final Future<bool> Function()? settingsOpener;

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
  String? _addressSuggestion;
  bool _locating = false;
  GeoFailure? _locationFailure;
  String? _locationError;

  bool _loading = true;
  String? _loadError;
  bool _submitting = false;
  String? _submitError;
  bool _dateError = false;

  @override
  void initState() {
    super.initState();
    final carried = widget.args.date;
    final parsed = carried == null ? null : DateTime.tryParse(carried);
    _selectedDate = parsed == null || _isPastDay(parsed) ? null : carried;
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

  String? _dateWarningFor(String date) => _dateWarning(_availability, date);

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
      _locationFailure = null;
    });
    try {
      final reading = await (widget.locationReader ?? readCurrentLocation)();
      String? suggestion;
      try {
        suggestion = await (widget.addressResolver ?? reverseGeocodeAddress)(
          reading,
        );
      } catch (_) {
        // Geocoding is only a suggestion; a failure must not lose the fix.
        suggestion = null;
      }
      if (!mounted) return;
      setState(() {
        _pin = reading;
        _addressSuggestion = suggestion;
        _locating = false;
        // A typed address always wins; only an empty field gets the coordinate.
        if (_address.text.trim().isEmpty) {
          _address.text = reading.coordinateText;
        }
      });
    } on GeoException catch (error) {
      if (!mounted) return;
      setState(() {
        _locating = false;
        _locationFailure = error.failure;
        _locationError = switch (error.failure) {
          GeoFailure.denied =>
            'Izin lokasi ditolak. Aktifkan izin lokasi aplikasi, lalu coba lagi.',
          GeoFailure.deniedForever =>
            'Izin lokasi diblokir. Buka pengaturan aplikasi, izinkan lokasi, '
                'lalu coba lagi.',
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

  /// Only offered when the permission is blocked for good, because that is the
  /// one case the in-app prompt can no longer fix.
  Future<void> _openLocationSettings() async {
    try {
      await (widget.settingsOpener ?? Geolocator.openAppSettings)();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _locationError =
            'Pengaturan aplikasi tidak bisa dibuka. Izinkan lokasi dari '
            'pengaturan HP.';
      });
    }
  }

  /// Turns the reverse-geocoded suggestion into the typed address so it can be
  /// corrected, and keeps the pin: the coordinates are still the customer's.
  void _acceptSuggestion() {
    final suggestion = _addressSuggestion;
    if (suggestion == null) return;
    setState(() {
      _address.text = suggestion;
      _locationMode = _LocationMode.typed;
    });
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
            // Titik ini dikirim setiap kali pelanggan benar-benar mengambilnya
            // lewat GPS, termasuk setelah alamat hasil geocoding dipakai.
            if (_pin != null)
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
                    : _compactFieldTheme(
                        Form(
                          key: _formKey,
                          autovalidateMode: AutovalidateMode.onUserInteraction,
                          child: ListView(
                            // 120 clears the 46px submit bar (12 + 46 + 12) plus
                            // a small gap once the list is scrolled to the end.
                            padding: const EdgeInsets.fromLTRB(
                              Sp.lg,
                              Sp.sm,
                              Sp.lg,
                              120,
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
                dense: true,
              ),
            )
          : null,
    );
  }

  /// Compact form chrome for this screen only: dense fields (~42px single line,
  /// ~64px two-line) with 12px radius and 12/10 padding. Colours, borders, and
  /// error styling are copied from the global theme so the rest of the app keeps
  /// its 52-56px fields.
  Widget _compactFieldTheme(Widget child) {
    final theme = Theme.of(context);
    final label = theme.textTheme.labelMedium;
    final radius = BorderRadius.circular(12);
    OutlineInputBorder outline(Color color, [double width = 1]) =>
        OutlineInputBorder(
          borderRadius: radius,
          borderSide: BorderSide(color: color, width: width),
        );

    return Theme(
      data: theme.copyWith(
        inputDecorationTheme: theme.inputDecorationTheme.copyWith(
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: Sp.md,
            vertical: 10,
          ),
          labelStyle: label?.copyWith(fontSize: 12, color: AppColors.inkMuted),
          floatingLabelStyle: label?.copyWith(
            fontSize: 11.5,
            color: AppColors.ink,
            fontWeight: FontWeight.w700,
          ),
          border: outline(AppColors.line),
          enabledBorder: outline(AppColors.line),
          focusedBorder: outline(AppColors.limeDark, 1.8),
          errorBorder: outline(AppColors.danger, 1.5),
          focusedErrorBorder: outline(AppColors.danger, 1.8),
        ),
      ),
      child: child,
    );
  }

  /// Label + requirement marker, rendered inside the decoration so the marker
  /// cannot become a second line that adds height. Material's floating label
  /// scales the pair as one unit.
  Widget _fieldLabel(TextTheme text, String label, {bool mandatory = true}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(
          child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
        const SizedBox(width: 6),
        _requirementMark(text, mandatory: mandatory),
      ],
    );
  }

  InputDecoration _fieldDecoration(
    TextTheme text,
    String label, {
    String? hint,
    bool mandatory = true,
  }) {
    return InputDecoration(
      label: _fieldLabel(text, label, mandatory: mandatory),
      hintText: hint,
      counterText: '',
    );
  }

  /// Same marker above controls that are not text fields (the event chips).
  Widget _pickerLabel(TextTheme text, String label, {bool mandatory = false}) {
    return Row(
      children: [
        Text(
          label,
          style: text.labelMedium?.copyWith(
            color: AppColors.inkMuted,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(width: 6),
        _requirementMark(text, mandatory: mandatory),
      ],
    );
  }

  /// Compact order rail: package + DP visible before the first field so the
  /// page never opens on a wall of empty inputs.
  Widget _summaryStrip(TextTheme text) {
    final package = _package;
    if (package == null) return const SizedBox.shrink();
    final meta = <String>[
      if (package.durationMinutes > 0) packageDurationLabel(package.durationMinutes),
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
    return _CheckoutSection(
      title: 'Acara',
      caption: 'Dipakai vendor untuk menyiapkan acara.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            controller: _title,
            textInputAction: TextInputAction.next,
            maxLength: 150,
            decoration: _fieldDecoration(
              text,
              'Nama acara',
              hint: 'Contoh: Hajatan keluarga di rumah',
            ),
            validator: (value) {
              final trimmed = value?.trim() ?? '';
              if (trimmed.isEmpty) return 'Nama acara wajib diisi.';
              if (trimmed.length > 150) return 'Nama maksimal 150 karakter.';
              return null;
            },
          ),
          const SizedBox(height: Sp.sm),
          _eventTypePicker(text),
          if (_eventType == 'Lainnya') ...[
            const SizedBox(height: Sp.sm),
            TextFormField(
              controller: _eventOther,
              textInputAction: TextInputAction.next,
              maxLength: 50,
              decoration: _fieldDecoration(
                text,
                'Sebutkan jenis acara',
                hint: 'Contoh: Kenduri keluarga besar',
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
          const SizedBox(height: Sp.sm),
          if (_dates.isEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: Sp.sm),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const InfoStrip(
                    message:
                        'Jadwal vendor belum tersedia untuk 45 hari ke depan. '
                        'Kamu tetap bisa memilih tanggal; vendor yang '
                        'mengonfirmasi.',
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
              ),
            ),
          _slotSummary(text),
          if (_dateError) ...[
            const SizedBox(height: Sp.xs),
            Text(
              'Pilih tanggal acara dulu.',
              style: text.bodySmall?.copyWith(color: AppColors.danger),
            ),
          ],
          const SizedBox(height: Sp.sm),
          TextFormField(
            controller: _guests,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.next,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: _fieldDecoration(
              text,
              'Perkiraan jumlah tamu',
              hint: 'Contoh: 120',
              mandatory: false,
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
          const SizedBox(height: Sp.sm),
          TextFormField(
            controller: _notes,
            minLines: 2,
            maxLines: 4,
            maxLength: 2000,
            decoration: _fieldDecoration(
              text,
              'Catatan untuk vendor',
              hint: 'Contoh: listrik tersedia, panggung di halaman',
              mandatory: false,
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
        _pickerLabel(text, 'Jenis acara'),
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

    return _CheckoutSection(
      title: 'Lokasi acara',
      caption: 'Dipakai vendor untuk menemukan panggung.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            controller: _place,
            textInputAction: TextInputAction.next,
            maxLength: 150,
            decoration: _fieldDecoration(
              text,
              'Nama tempat',
              hint: 'Contoh: Rumah Haji Sulaeman',
              mandatory: false,
            ),
          ),
          if (locationSupported) ...[
            const SizedBox(height: Sp.sm),
            SegmentBar(
              items: const ['Ketik alamat', 'Pakai GPS'],
              index: _locationMode.index,
              onChanged: (index) => setState(() {
                _locationMode = _LocationMode.values[index];
                _locationError = null;
                _locationFailure = null;
              }),
            ),
          ],
          const SizedBox(height: Sp.sm),
          if (!gpsMode)
            TextFormField(
              controller: _address,
              textInputAction: TextInputAction.next,
              minLines: 2,
              maxLines: 4,
              maxLength: 1000,
              decoration: _fieldDecoration(
                text,
                'Alamat & patokan',
                hint: 'Kampung, jalan, dan patokan yang mudah dicari',
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
            const SizedBox(height: Sp.sm),
            TextFormField(
              controller: _patokan,
              textInputAction: TextInputAction.next,
              maxLength: 200,
              decoration: _fieldDecoration(
                text,
                'Patokan tambahan',
                hint: 'Contoh: rumah pagar hijau setelah jembatan',
                mandatory: false,
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
            if (_locationFailure == GeoFailure.deniedForever)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _openLocationSettings,
                  icon: const Icon(Icons.settings_outlined, size: 18),
                  label: const Text('Buka pengaturan'),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.ink,
                    minimumSize: const Size(0, 44),
                    padding: EdgeInsets.zero,
                    textStyle: text.labelMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _gpsBlock(TextTheme text) {
    final pin = _pin;
    final suggestion = _addressSuggestion;
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
          if (suggestion != null) ...[
            const SizedBox(height: 12),
            Divider(
              height: 1,
              thickness: 1,
              color: Colors.white.withValues(alpha: 0.12),
            ),
            const SizedBox(height: 10),
            Text(
              'Alamat di titik ini',
              style: text.labelSmall?.copyWith(
                fontSize: 10,
                letterSpacing: 0.6,
                fontWeight: FontWeight.w700,
                color: Colors.white.withValues(alpha: 0.56),
              ),
            ),
            const SizedBox(height: 3),
            Text(
              suggestion,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: text.bodyMedium?.copyWith(
                fontSize: 13,
                height: 1.4,
                color: Colors.white.withValues(alpha: 0.92),
              ),
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: _acceptSuggestion,
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.lime,
                  minimumSize: const Size(0, 44),
                  padding: EdgeInsets.zero,
                  textStyle: text.labelMedium?.copyWith(
                    color: AppColors.lime,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                child: const Text('Pakai alamat ini'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _slotSummary(TextTheme text) {
    final date = _selectedDate;
    final parsed = date == null ? null : DateTime.tryParse(date);
    final uncertain = date != null && _dateUncertainOn(date);
    final warning = date == null ? null : _dateWarningFor(date);

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
          constraints: const BoxConstraints(minHeight: 48),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: Sp.md,
              vertical: 10,
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.event_outlined,
                  size: 18,
                  color: AppColors.inkMuted,
                ),
                const SizedBox(width: Sp.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              parsed == null
                                  ? 'Pilih tanggal acara'
                                  : formatDate(parsed),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: text.titleMedium?.copyWith(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                                color: parsed == null
                                    ? AppColors.inkMuted
                                    : AppColors.ink,
                              ),
                            ),
                          ),
                          // The date is the one required picker without a text
                          // field, so it carries the same marker until chosen.
                          if (parsed == null) ...[
                            const SizedBox(width: 6),
                            _requirementMark(text),
                          ],
                        ],
                      ),
                      const SizedBox(height: 1),
                      Text(
                        warning ??
                            (parsed == null
                                ? (_dates.isEmpty
                                      ? 'Kalender vendor belum dimuat; pilih '
                                            'tanggal lalu vendor mengonfirmasi'
                                      : 'Dari jadwal vendor yang masih terbuka')
                                : 'Sehari penuh · satu panggung untuk acara '
                                      'ini'
                                      '${uncertain ? ' · belum dikonfirmasi' : ''}'),
                        style: text.bodySmall?.copyWith(
                          color: warning != null || uncertain
                              ? AppColors.warning
                              : null,
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
      if (package.durationMinutes > 0) packageDurationLabel(package.durationMinutes),
      if (package.personnelCount > 0) '${package.personnelCount} personel',
    ].join(' · ');

    return _CheckoutSection(
      title: 'Paket',
      caption: 'Satu grup, satu harga untuk sehari penuh.',
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
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: text.labelLarge?.copyWith(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.2,
                      ),
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
                    style: text.labelLarge?.copyWith(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
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
            const SizedBox(height: Sp.sm),
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
            const SizedBox(height: Sp.md),
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
                  height: Sp.md,
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
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(
          title: 'Ringkasan',
          caption: 'Total, DP, dan sisa setelah DP.',
          dense: true,
        ),
        const SizedBox(height: Sp.md),
        // The dark money card is shared; this local type scale keeps its total
        // the most prominent figure while dropping it to checkout size.
        Theme(
          data: theme.copyWith(
            textTheme: theme.textTheme.copyWith(
              displaySmall: theme.textTheme.displaySmall?.copyWith(
                fontSize: 19,
              ),
              bodyMedium: theme.textTheme.bodyMedium?.copyWith(fontSize: 12),
            ),
          ),
          child: MoneyBlock(
            rows: [
              MoneyRow('Total acara', _total),
              MoneyRow('DP sekarang ($_dpRatePercent%)', _dpAmount),
            ],
            totalLabel: 'Sisa yang harus dibayar',
            totalIdr: _remaining,
            footnote: _dpRule,
          ),
        ),
        const SizedBox(height: Sp.sm),
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

/// Inline requirement marker. Words instead of an asterisk, so nobody has to
/// find a legend: required labels read darker, optional ones stay muted.
Widget _requirementMark(TextTheme text, {bool mandatory = true}) {
  return Text(
    mandatory ? 'Wajib' : 'Opsional',
    maxLines: 1,
    style: text.labelSmall?.copyWith(
      fontSize: 11,
      height: 1.2,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.1,
      color: mandatory ? AppColors.ink : AppColors.muted2,
    ),
  );
}

/// Checkout section surface: one card, dense header, 12px inset. This screen
/// replaced the heavier [SectionPanel] (icon badge + 16.5px title) so the form
/// scans like a checkout instead of a marketing page.
class _CheckoutSection extends StatelessWidget {
  const _CheckoutSection({
    required this.title,
    required this.caption,
    required this.child,
  });

  final String title;
  final String caption;
  final Widget child;

  @override
  Widget build(BuildContext context) {
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(title: title, caption: caption, dense: true),
          const SizedBox(height: Sp.md),
          child,
        ],
      ),
    );
  }
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
                style: text.labelLarge?.copyWith(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Text(
                price,
                style: text.bodySmall?.copyWith(
                  fontSize: 11.5,
                  fontFeatures: _tabularFigures,
                ),
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
    // A carried date is honoured even outside the loaded calendar or on a
    // booked day: only the past is refused.
    final date = widget.initialDate;
    final parsed = date == null ? null : DateTime.tryParse(date);
    if (parsed == null || _isPastDay(parsed)) return;
    _date = date;
  }

  void _chooseDate(String date) => setState(() => _date = date);

  /// The vendor calendar covers 45 days; the rest of the horizon (up to ten
  /// years) comes from this picker, with past days disabled.
  Future<void> _pickFromCalendar() async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final selected = _date == null ? null : DateTime.tryParse(_date!);
    final picked = await showTarlinkDatePicker(
      context: context,
      initialDate: selected == null || _isPastDay(selected) ? today : selected,
      firstDate: today,
      lastDate: DateTime(
        today.year + _bookingHorizonYears,
        today.month,
        today.day,
      ),
    );
    if (picked == null || !mounted) return;
    _chooseDate(isoDate(picked));
  }

  /// One honest line per case: booked, outside the loaded calendar, or the
  /// vendor's calendar is merely old. Nothing is invented for unknown days.
  ({String message, IconData icon})? _warningFor(String date) {
    final warning = _dateWarning(widget.availability, date);
    if (warning == _bookedDateWarning) {
      return (message: warning!, icon: Icons.event_busy_outlined);
    }
    if (warning != null) {
      return (message: warning, icon: Icons.calendar_month_outlined);
    }
    if (_dateUncertain(widget.availability, date)) {
      return (
        message:
            'Vendor perlu mengecek tanggal ini. Kamu tetap bisa memesan, '
            'tapi jadwal belum pasti.',
        icon: Icons.help_outline,
      );
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final date = _date;
    final warning = date == null ? null : _warningFor(date);

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
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: _pickFromCalendar,
                  icon: const Icon(Icons.calendar_month_outlined, size: 18),
                  label: const Text('Pilih dari kalender'),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.ink,
                    backgroundColor: AppColors.primarySoft,
                    minimumSize: const Size(0, 44),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    textStyle: text.labelMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
              if (widget.dates.isNotEmpty) ...[
                const SizedBox(height: Sp.sm),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (final item in widget.dates) ...[
                        _DateButton(
                          date: item,
                          selected: item == date,
                          booked: !_dateEnabled(widget.availability, item),
                          uncertain: _dateUncertain(widget.availability, item),
                          onTap: () => _chooseDate(item),
                        ),
                        const SizedBox(width: Sp.sm),
                      ],
                    ],
                  ),
                ),
              ],
              if (warning != null) ...[
                const SizedBox(height: Sp.md),
                InfoStrip(
                  message: warning.message,
                  icon: warning.icon,
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
    required this.booked,
    required this.uncertain,
    required this.onTap,
  });

  final String date;
  final bool selected;

  /// Booked or blocked days stay tappable: the server decides, the form warns.
  final bool booked;
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
      enabled: true,
      label:
          '${parsed == null ? date : formatDate(parsed)}'
          '${booked
              ? ', sudah terisi'
              : uncertain
              ? ', belum dikonfirmasi'
              : ''}',
      excludeSemantics: true,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
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
                  : booked
                  ? AppColors.neutralSoft
                  : AppColors.card,
              borderRadius: BorderRadius.circular(Radii.sm),
              border: Border.all(
                color: selected ? AppColors.primary : AppColors.line,
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
                                fontSize: 10,
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
                            : booked
                            ? AppColors.inkMuted
                            : AppColors.ink,
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
