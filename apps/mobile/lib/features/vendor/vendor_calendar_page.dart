import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../booking/booking_support.dart';
import 'vendor_header.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// Month calendar for the vendor: real availability slots plus booked agenda.
class VendorCalendarPage extends StatefulWidget {
  const VendorCalendarPage({super.key});

  @override
  State<VendorCalendarPage> createState() => _VendorCalendarPageState();
}

class _VendorCalendarPageState extends State<VendorCalendarPage> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _selected = DateTime.now();
  String? _vendorId;
  bool _loading = true;
  String? _error;

  String? _calendarUpdatedAt;
  bool _stale = false;
  final Map<String, String> _availability = {};
  List<Map<String, dynamic>> _bookings = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _init();
    });
  }

  Future<void> _init() async {
    final api = AppScope.of(context).api;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      if (_vendorId == null) {
        final meRaw = await api.get('/vendor/me');
        final me = meRaw is Map ? meRaw.cast<String, dynamic>() : null;
        _vendorId = me?['id']?.toString();
      }
      if (_vendorId == null || _vendorId!.isEmpty) {
        throw const ApiException(
          code: 'VENDOR_NOT_FOUND',
          message: 'Data vendor tidak ditemukan.',
        );
      }

      final bookingsRaw = await _quiet(
        () => api.get(
          '/vendor/bookings',
          query: {'page': '1', 'page_size': '100'},
        ),
      );
      final bookingsPayload = bookingsRaw is Map
          ? bookingsRaw.cast<String, dynamic>()
          : null;
      final itemsRaw = bookingsPayload?['items'] is List
          ? bookingsPayload!['items'] as List
          : const [];
      _bookings = itemsRaw
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList();

      await _fetchMonth();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = apiMessage(error);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Gagal memuat kalender: $error';
      });
    }
  }

  Future<dynamic> _quiet(Future<dynamic> Function() call) async {
    try {
      return await call();
    } catch (_) {
      return null;
    }
  }

  Future<void> _fetchMonth() async {
    final vendorId = _vendorId;
    if (vendorId == null) return;
    final api = AppScope.of(context).api;
    final from = DateTime(_month.year, _month.month, 1);
    final to = DateTime(_month.year, _month.month + 1, 0);

    try {
      final raw = await api.get(
        '/vendors/$vendorId/availability',
        query: {'from': isoDate(from), 'to': isoDate(to)},
      );
      final payload = raw is Map ? raw.cast<String, dynamic>() : null;
      final days = payload?['days'] is List
          ? payload!['days'] as List
          : const [];

      final map = <String, String>{};
      for (final item in days) {
        if (item is Map) {
          final date = item['date']?.toString();
          final session = item['session']?.toString() ?? '';
          final state = item['availability_state']?.toString() ?? '';
          if (date != null && session.isNotEmpty) {
            map['$date|$session'] = state;
          }
        }
      }

      if (!mounted) return;
      setState(() {
        _availability
          ..clear()
          ..addAll(map);
        _calendarUpdatedAt = payload?['calendar_updated_at']?.toString();
        _stale = payload?['stale'] == true;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = apiMessage(error);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Gagal memuat jadwal: $error';
      });
    }
  }

  void _shiftMonth(int delta) {
    final next = DateTime(_month.year, _month.month + delta, 1);
    setState(() {
      _month = next;
      _selected = next;
      _loading = true;
    });
    _fetchMonth();
  }

  Future<void> _openAvailabilitySheet() async {
    var from = DateTime(_selected.year, _selected.month, _selected.day);
    var to = from;
    var sessions = <String>{'day', 'night'};
    var status = 'available';
    var saving = false;

    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: VendorColors.cardWhite,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) {
          Future<void> pickDate({required bool isFrom}) async {
            final picked = await showDatePicker(
              context: context,
              initialDate: isFrom ? from : to,
              firstDate: DateTime.now().subtract(const Duration(days: 365)),
              lastDate: DateTime.now().add(const Duration(days: 730)),
              builder: (ctx, child) => Theme(
                data: ThemeData(
                  colorScheme: const ColorScheme.light(
                    primary: VendorColors.ink,
                    onPrimary: Colors.white,
                    surface: VendorColors.cardWhite,
                    onSurface: VendorColors.ink,
                  ),
                  textButtonTheme: TextButtonThemeData(
                    style: TextButton.styleFrom(
                      foregroundColor: VendorColors.ink,
                    ),
                  ),
                ),
                child: child!,
              ),
            );
            if (picked == null) return;
            setSheetState(() {
              if (isFrom) {
                from = picked;
                if (to.isBefore(from)) to = from;
              } else {
                to = picked;
                if (to.isBefore(from)) from = to;
              }
            });
          }

          Future<void> submit() async {
            if (sessions.isEmpty) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Pilih minimal satu sesi.')),
              );
              return;
            }
            if (to.difference(from).inDays + 1 > 366) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Rentang maksimal 366 hari.'),
                ),
              );
              return;
            }
            setSheetState(() => saving = true);
            try {
              final result = await AppScope.of(context).api.put(
                '/vendor/calendar',
                body: {
                  'from': isoDate(from),
                  'to': isoDate(to),
                  'status': status,
                  'sessions': sessions.toList(),
                },
              );
              if (!sheetContext.mounted) return;
              Navigator.pop(sheetContext, true);
              final updated = result is Map
                  ? (result['updated'] as num?)?.toInt()
                  : null;
              if (!mounted) return;
              ScaffoldMessenger.of(this.context).showSnackBar(
                SnackBar(
                  content: Text(
                    updated == null
                        ? 'Ketersediaan disimpan.'
                        : '$updated slot diperbarui.',
                  ),
                ),
              );
              await _fetchMonth();
            } on ApiException catch (error) {
              if (!context.mounted) return;
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(SnackBar(content: Text(apiMessage(error))));
              setSheetState(() => saving = false);
            } catch (error) {
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Gagal menyimpan: $error')),
              );
              setSheetState(() => saving = false);
            }
          }

          return SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Atur ketersediaan',
                    style: vendorText(size: 16, weight: FontWeight.w800),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    'Slot yang sudah dibooking atau ditahan tidak akan berubah.',
                    style: vendorText(
                      size: 11.5,
                      color: VendorColors.muted,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: VendorSp.lg),
                  Row(
                    children: [
                      Expanded(
                        child: _DateField(
                          label: 'Dari',
                          date: from,
                          onTap: () => pickDate(isFrom: true),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _DateField(
                          label: 'Sampai',
                          date: to,
                          onTap: () => pickDate(isFrom: false),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: VendorSp.md),
                  Text(
                    'Sesi',
                    style: vendorText(
                      size: 10.5,
                      weight: FontWeight.w700,
                      letterSpacing: 0.5,
                      color: VendorColors.muted,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    children: [
                      _ChoiceChip(
                        label: 'Siang',
                        selected: sessions.contains('day'),
                        onTap: () => setSheetState(() {
                          if (!sessions.add('day')) sessions.remove('day');
                        }),
                      ),
                      _ChoiceChip(
                        label: 'Malam',
                        selected: sessions.contains('night'),
                        onTap: () => setSheetState(() {
                          if (!sessions.add('night')) sessions.remove('night');
                        }),
                      ),
                    ],
                  ),
                  const SizedBox(height: VendorSp.md),
                  Text(
                    'Status',
                    style: vendorText(
                      size: 10.5,
                      weight: FontWeight.w700,
                      letterSpacing: 0.5,
                      color: VendorColors.muted,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: _ChoiceChip(
                          label: 'Tersedia',
                          selected: status == 'available',
                          onTap: () =>
                              setSheetState(() => status = 'available'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _ChoiceChip(
                          label: 'Tutup',
                          selected: status == 'blocked',
                          onTap: () => setSheetState(() => status = 'blocked'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: VendorSp.lg),
                  VendorButton(
                    label: saving ? 'Menyimpan...' : 'Simpan ketersediaan',
                    onPressed: saving ? null : submit,
                  ),
                  const SizedBox(height: VendorSp.sm),
                  VendorButton(
                    label: 'Batal',
                    kind: VendorButtonKind.secondary,
                    onPressed: saving
                        ? null
                        : () => Navigator.pop(sheetContext, false),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final monthLabel = '${vendorMonthName(_month.month)} ${_month.year}';

    return Scaffold(
      backgroundColor: VendorColors.canvas,
      appBar: VendorHeader(
        kicker: 'Jadwal',
        title: monthLabel,
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _HeaderIcon(
              icon: Icons.chevron_left,
              label: 'Bulan sebelumnya',
              onTap: () => _shiftMonth(-1),
            ),
            const SizedBox(width: 6),
            _HeaderIcon(
              icon: Icons.chevron_right,
              label: 'Bulan berikutnya',
              onTap: () => _shiftMonth(1),
            ),
          ],
        ),
      ),
      body: ColoredBox(
        color: VendorColors.canvas,
        child: _loading
            ? const VendorLoading(rows: 3)
            : _error != null
            ? VendorError(message: _error!, onRetry: _init)
            : _content(),
      ),
    );
  }

  Widget _content() {
    final year = _month.year;
    final month = _month.month;
    final daysInMonth = DateTime(year, month + 1, 0).day;

    var filled = 0;
    for (var day = 1; day <= daysInMonth; day++) {
      final key = isoDate(DateTime(year, month, day));
      final dayState = _availability['$key|day'];
      final nightState = _availability['$key|night'];
      if (_isFilled(dayState) || _isFilled(nightState)) filled++;
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        VendorSp.lg,
        14,
        VendorSp.lg,
        VendorSp.xl,
      ),
      children: [
        if (_stale) ...[
          Container(
            padding: const EdgeInsets.all(VendorSp.md),
            decoration: BoxDecoration(
              color: VendorColors.waitBg,
              borderRadius: BorderRadius.circular(VendorRadii.sm),
              border: Border.all(
                color: VendorColors.waitFg.withValues(alpha: 0.25),
              ),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.schedule,
                  size: 16,
                  color: VendorColors.waitFg,
                ),
                const SizedBox(width: VendorSp.sm),
                Expanded(
                  child: Text(
                    relativeFreshness(_calendarUpdatedAt),
                    style: vendorText(
                      size: 11.5,
                      weight: FontWeight.w600,
                      color: VendorColors.waitFg,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: VendorSp.md),
        ],
        VendorButton(
          label: 'Atur ketersediaan',
          icon: Icons.edit_calendar_outlined,
          kind: VendorButtonKind.secondary,
          onPressed: _openAvailabilitySheet,
        ),
        const SizedBox(height: VendorSp.md),
        const VendorSectionTitle(
          label: 'Kalender',
          trailing: 'Hari terisi bertanda',
        ),
        VendorCard(
          padding: const EdgeInsets.fromLTRB(10, 12, 10, 10),
          child: Column(
            children: [
              Row(
                children: [
                  for (var i = 1; i <= 7; i++)
                    Expanded(
                      child: Text(
                        vendorWeekdayShort(i).toUpperCase(),
                        textAlign: TextAlign.center,
                        style: vendorText(
                          size: 10,
                          weight: FontWeight.w700,
                          color: VendorColors.muted,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              Container(height: 1, color: VendorColors.lineSoft),
              const SizedBox(height: 5),
              ..._monthRows(year, month, daysInMonth),
              const SizedBox(height: 10),
              Container(height: 1, color: VendorColors.lineSoft),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '$filled dari $daysInMonth hari terisi',
                          style: vendorText(
                            size: 11.5,
                            weight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 6),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(2),
                          child: LinearProgressIndicator(
                            value: daysInMonth == 0 ? 0 : filled / daysInMonth,
                            minHeight: 4,
                            backgroundColor: const Color(0xFFE3E4DE),
                            valueColor: const AlwaysStoppedAnimation(
                              VendorColors.ink,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: VendorSp.md),
                  VendorPill(
                    label: 'Terisi $filled hari',
                    tone: filled > 0 ? VendorPillTone.ok : VendorPillTone.done,
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: VendorSp.sm),
        const Wrap(
          spacing: 12,
          runSpacing: 5,
          children: [
            _Legend(color: VendorColors.limeDark, label: 'Tersedia'),
            _Legend(color: VendorColors.amber, label: 'Ditahan'),
            _Legend(color: VendorColors.ink, label: 'Dipesan'),
            _Legend(color: VendorColors.danger, label: 'Tutup'),
            _Legend(color: VendorColors.line, label: 'Belum diisi'),
          ],
        ),
        VendorSectionTitle(label: 'Agenda', trailing: formatDate(_selected)),
        _agenda(),
        const SizedBox(height: VendorSp.md),
        Text(
          'Agenda mengikuti pesanan yang sudah masuk. Ketuk tanggal untuk '
          'melihat hari lain.',
          style: vendorText(size: 11, color: VendorColors.muted, height: 1.5),
        ),
      ],
    );
  }

  List<Widget> _monthRows(int year, int month, int daysInMonth) {
    final firstWeekday = DateTime(year, month, 1).weekday - 1;
    final total = firstWeekday + daysInMonth;
    final rows = ((total + 6) ~/ 7) * 7;
    final widgets = <Widget>[];

    for (var row = 0; row < rows ~/ 7; row++) {
      widgets.add(
        Row(
          children: [
            for (var col = 0; col < 7; col++)
              Expanded(
                child: _dayCell(
                  year,
                  month,
                  daysInMonth,
                  row * 7 + col - firstWeekday + 1,
                ),
              ),
          ],
        ),
      );
    }
    return widgets;
  }

  Widget _dayCell(int year, int month, int daysInMonth, int day) {
    if (day < 1 || day > daysInMonth) {
      return const SizedBox(height: 46);
    }
    final date = DateTime(year, month, day);
    final key = isoDate(date);
    final selected = _sameDay(date, _selected);
    final dayState = _availability['$key|day'];
    final nightState = _availability['$key|night'];

    return Padding(
      padding: const EdgeInsets.all(1),
      child: Semantics(
        button: true,
        selected: selected,
        label: 'Tanggal ${formatDate(date)}',
        child: InkWell(
          onTap: () => setState(() => _selected = date),
          borderRadius: BorderRadius.circular(7),
          child: Container(
            height: 46,
            padding: const EdgeInsets.symmetric(vertical: 5),
            decoration: BoxDecoration(
              color: selected ? VendorColors.ink : Colors.transparent,
              borderRadius: BorderRadius.circular(7),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '$day',
                  style: vendorText(
                    size: 12.5,
                    weight: selected ? FontWeight.w700 : FontWeight.w600,
                    color: selected ? Colors.white : VendorColors.ink,
                  ),
                ),
                const SizedBox(height: 5),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _SlotDot(state: dayState, selected: selected),
                    const SizedBox(width: 2),
                    _SlotDot(state: nightState, selected: selected),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _agenda() {
    final key = isoDate(_selected);
    final items = _bookings
        .where((item) => item['event_start_date']?.toString() == key)
        .toList();

    if (items.isEmpty) {
      return const VendorEmpty(
        title: 'Belum ada acara',
        message:
            'Tanggal ini masih kosong. Pesanan baru muncul di sini setelah '
            'DP masuk.',
      );
    }

    return Column(
      children: [
        for (var i = 0; i < items.length; i++) ...[
          if (i > 0) const SizedBox(height: VendorSp.sm),
          _AgendaRow(item: items[i], onTap: () => _openDetail(items[i])),
        ],
      ],
    );
  }

  Future<void> _openDetail(Map<String, dynamic> item) async {
    final id = item['id']?.toString() ?? '';
    if (id.isEmpty) return;
    await Navigator.pushNamed(
      context,
      Routes.vendorBookingDetail,
      arguments: id,
    );
    if (mounted) _init();
  }

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  static bool _isFilled(String? state) =>
      state == 'booked' || state == 'held' || state == 'blocked';
}

class _AgendaRow extends StatelessWidget {
  const _AgendaRow({required this.item, required this.onTap});

  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name = item['customer_name']?.toString() ?? 'Pelanggan';
    final title = item['event_title']?.toString() ?? 'Acara';
    final region = item['event_region_code']?.toString() ?? '';
    final status = item['lifecycle_status']?.toString() ?? '';
    final value = moneyValue(item, 'total_customer_idr') ?? 0;

    return VendorCard(
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: vendorText(
                    size: 13.5,
                    weight: FontWeight.w700,
                    letterSpacing: -0.1,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  region.isEmpty ? title : '$title · $region',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: vendorText(size: 11.5, color: VendorColors.muted),
                ),
                const SizedBox(height: 6),
                Text(
                  rupiahTight(value),
                  style: vendorText(size: 12.5, weight: FontWeight.w700),
                ),
              ],
            ),
          ),
          const SizedBox(width: VendorSp.sm),
          VendorPill(
            label: lifecycleText(status),
            tone: vendorToneForStatus(status),
          ),
        ],
      ),
    );
  }
}

class _SlotDot extends StatelessWidget {
  const _SlotDot({required this.state, required this.selected});

  final String? state;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 4,
      height: 4,
      decoration: BoxDecoration(
        color: _slotColor(state, selected),
        shape: BoxShape.circle,
      ),
    );
  }
}

Color _slotColor(String? state, bool selected) {
  if (selected) {
    return switch (state) {
      'available' => VendorColors.lime,
      'held' => VendorColors.amber,
      'booked' => Colors.white,
      'unconfirmed' || 'stale' => Colors.white54,
      _ => Colors.white24,
    };
  }
  return switch (state) {
    'available' => VendorColors.limeDark,
    'held' => VendorColors.amber,
    'booked' => VendorColors.ink,
    'blocked' => VendorColors.danger,
    'unconfirmed' || 'stale' => VendorColors.line,
    _ => VendorColors.line,
  };
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 4),
        Text(label, style: vendorText(size: 11, color: VendorColors.muted)),
      ],
    );
  }
}

class _DateField extends StatelessWidget {
  const _DateField({
    required this.label,
    required this.date,
    required this.onTap,
  });

  final String label;
  final DateTime date;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: vendorText(
            size: 10.5,
            weight: FontWeight.w700,
            letterSpacing: 0.5,
            color: VendorColors.muted,
          ),
        ),
        const SizedBox(height: 5),
        Material(
          color: VendorColors.cardWhite,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(VendorRadii.sm),
            side: const BorderSide(color: VendorColors.line),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 11),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      formatDate(date),
                      style: vendorText(size: 12.5, weight: FontWeight.w600),
                    ),
                  ),
                  const Icon(
                    Icons.calendar_today_outlined,
                    size: 15,
                    color: VendorColors.muted,
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ChoiceChip extends StatelessWidget {
  const _ChoiceChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? VendorColors.ink : VendorColors.cardWhite,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(VendorRadii.sm),
        side: BorderSide(
          color: selected ? VendorColors.ink : VendorColors.line,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: vendorText(
              size: 11.5,
              weight: FontWeight.w700,
              color: selected ? Colors.white : VendorColors.ink,
            ),
          ),
        ),
      ),
    );
  }
}

class _HeaderIcon extends StatelessWidget {
  const _HeaderIcon({
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
        color: Colors.white.withValues(alpha: 0.04),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(7),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.16)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            width: 32,
            height: 32,
            child: Icon(icon, size: 18, color: Colors.white),
          ),
        ),
      ),
    );
  }
}
