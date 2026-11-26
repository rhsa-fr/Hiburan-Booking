import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../booking/booking_support.dart';
import 'vendor_header.dart';
import 'vendor_theme.dart';
import 'vendor_ui.dart';

/// Vendor booking detail, styled after the OpenDesign "Detail Pesanan" screen.
class VendorBookingDetailPage extends StatefulWidget {
  const VendorBookingDetailPage({super.key, required this.bookingId});

  final String bookingId;

  @override
  State<VendorBookingDetailPage> createState() =>
      _VendorBookingDetailPageState();
}

class _VendorBookingDetailPageState extends State<VendorBookingDetailPage> {
  Map<String, dynamic>? _booking;
  bool _loading = true;
  String? _error;
  bool _actionBusy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  Future<void> _load() async {
    final api = AppScope.of(context).api;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final raw = await api.get('/vendor/bookings/${widget.bookingId}');
      final payload = raw is Map ? raw.cast<String, dynamic>() : null;
      if (payload == null || payload.isEmpty) {
        throw const ApiException(
          code: 'NOT_FOUND',
          message: 'Data pesanan tidak ditemukan.',
        );
      }
      if (!mounted) return;
      setState(() {
        _booking = payload;
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
        _error = 'Gagal memuat pesanan: $error';
      });
    }
  }

  Future<void> _acceptBooking() async {
    if (_actionBusy) return;
    final api = AppScope.of(context).api;
    setState(() => _actionBusy = true);

    try {
      await api.post('/bookings/${widget.bookingId}/accept', body: {});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Booking berhasil diterima.')),
      );
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gagal menerima: ${apiMessage(error)}')),
      );
    } finally {
      if (mounted) setState(() => _actionBusy = false);
    }
  }

  Future<void> _checkIn() async {
    if (_actionBusy) return;
    final api = AppScope.of(context).api;
    setState(() => _actionBusy = true);

    try {
      await api.post('/bookings/${widget.bookingId}/checkin', body: {});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Check-in tercatat. Acara ditandai berlangsung.'),
        ),
      );
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gagal check-in: ${apiMessage(error)}')),
      );
    } finally {
      if (mounted) setState(() => _actionBusy = false);
    }
  }

  Future<void> _cancelBooking() async {
    if (_actionBusy) return;
    final code = _booking?['code']?.toString() ?? widget.bookingId;
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: VendorColors.cardWhite,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
      builder: (_) => VendorDeclineSheet(
        bookingCode: code,
        title: 'Batalkan Booking',
        confirmLabel: 'Konfirmasi Batalkan',
        warning:
            'Pembatalan tidak otomatis me-refund DP. Admin akan memproses '
            'refund sesuai kebijakan setelah pembatalan tercatat.',
      ),
    );
    if (result == null || !mounted) return;

    final api = AppScope.of(context).api;
    setState(() => _actionBusy = true);

    try {
      const reasonLabels = {
        'schedule_conflict': 'Jadwal bentrok',
        'price_mismatch': 'Harga tidak sesuai',
        'location_out_of_reach': 'Lokasi terlalu jauh',
        'other': 'Alasan lain',
      };
      final note = result['note']?.toString().trim() ?? '';
      final code = result['reason_code']?.toString() ?? 'other';
      await api.post(
        '/bookings/${widget.bookingId}/cancel',
        body: {
          'reason': note.isNotEmpty
              ? note
              : (reasonLabels[code] ?? 'Alasan lain'),
          'reason_code': code,
        },
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Booking dibatalkan. Admin akan menindaklanjuti refund.',
          ),
        ),
      );
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gagal membatalkan: ${apiMessage(error)}')),
      );
    } finally {
      if (mounted) setState(() => _actionBusy = false);
    }
  }

  Future<void> _declineBooking() async {
    if (_actionBusy) return;
    final code = _booking?['code']?.toString() ?? widget.bookingId;
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: VendorColors.cardWhite,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
      builder: (_) => VendorDeclineSheet(bookingCode: code),
    );
    if (result == null || !mounted) return;

    final api = AppScope.of(context).api;
    setState(() => _actionBusy = true);

    try {
      await api.post('/bookings/${widget.bookingId}/decline', body: result);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Booking telah ditolak.')));
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gagal menolak: ${apiMessage(error)}')),
      );
    } finally {
      if (mounted) setState(() => _actionBusy = false);
    }
  }

  void _openChat(String customerName) {
    Navigator.of(context).pushNamed(
      Routes.bookingChat,
      arguments: ChatArgs(
        bookingId: widget.bookingId,
        title: 'Chat pelanggan',
        subtitle: customerName,
      ),
    );
  }

  /// The vendor has no map picker, but a coordinate string or a written
  /// address is enough for Google Maps to put a pin on the stage.
  Future<void> _openMap(String address) async {
    final query = address.trim();
    if (query.isEmpty) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final opened = await launchUrl(
        Uri.parse(
          'https://www.google.com/maps/search/?api=1'
          '&query=${Uri.encodeComponent(query)}',
        ),
        mode: LaunchMode.externalApplication,
      );
      if (!opened) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Peta tidak bisa dibuka di sini.')),
        );
      }
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Peta tidak bisa dibuka di sini.')),
      );
    }
  }

  String _customerNameOf(Map<String, dynamic> booking) =>
      booking['customer_name']?.toString() ??
      (booking['customer'] is Map
          ? (booking['customer'] as Map)['name']?.toString()
          : null) ??
      'Pelanggan';

  @override
  Widget build(BuildContext context) {
    final booking = _booking;
    final code = booking?['code']?.toString() ?? widget.bookingId;
    final lifecycle = booking?['lifecycle_status']?.toString() ?? '';
    final isRequested = lifecycle == 'requested';
    final isConfirmed = lifecycle == 'confirmed';

    return Scaffold(
      backgroundColor: VendorColors.canvas,
      appBar: VendorHeader(
        title: 'Detail Pesanan',
        subtitle: code,
        showBack: true,
        trailing: booking == null
            ? null
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  VendorPill(
                    label: _headerStatus(lifecycle),
                    tone: vendorToneForStatus(lifecycle),
                  ),
                  const SizedBox(width: 6),
                  _HeaderChatButton(
                    onPressed: () => _openChat(_customerNameOf(booking)),
                  ),
                ],
              ),
      ),
      bottomNavigationBar:
          booking != null &&
              (isRequested || isConfirmed || lifecycle == 'accepted')
          ? _actionBar(booking)
          : null,
      body: ColoredBox(
        color: VendorColors.canvas,
        child: _loading
            ? const VendorLoading(rows: 4)
            : _error != null
            ? VendorError(message: _error!, onRetry: _load)
            : _content(booking!),
      ),
    );
  }

  Widget _content(Map<String, dynamic> booking) {
    final code = booking['code']?.toString() ?? '-';
    final lifecycle = booking['lifecycle_status']?.toString() ?? '';
    final payment = booking['payment_status']?.toString() ?? 'unpaid';
    final settlement = booking['settlement_status']?.toString() ?? '';
    final eventTitle =
        booking['event_title']?.toString() ??
        (booking['event'] is Map
            ? (booking['event'] as Map)['title']?.toString()
            : null) ??
        'Acara';
    final eventDate =
        booking['event_start_date']?.toString() ??
        (booking['event'] is Map
            ? (booking['event'] as Map)['start_date']?.toString()
            : null);
    final region =
        booking['event_region_code']?.toString() ??
        (booking['event'] is Map
            ? (booking['event'] as Map)['region_code']?.toString()
            : null) ??
        '-';
    final venueName = booking['event_venue_name']?.toString();
    final venueAddress = booking['event_venue_address']?.toString();
    final eventLocationLine = [
      if (venueName != null && venueName.isNotEmpty) venueName,
      if (venueAddress != null && venueAddress.isNotEmpty) venueAddress,
    ].join(' · ');
    final guests = booking['event_guest_estimate'] ?? booking['guest_count'];
    final packageName = booking['package_name']?.toString();
    final notes = booking['event_notes']?.toString();

    final customerName = _customerNameOf(booking);
    final customerPhone =
        booking['customer_phone']?.toString() ??
        (booking['customer'] is Map
            ? (booking['customer'] as Map)['phone']?.toString()
            : null);

    final total = moneyValue(booking, 'total_customer_idr') ?? 0;
    final dp = moneyValue(booking, 'dp_amount_idr') ?? 0;
    final entitlement = moneyValue(booking, 'vendor_entitlement_idr') ?? 0;
    final commission = moneyValue(booking, 'commission_idr') ?? 0;
    final dpPaid = isDpSettled(payment);
    final remaining = (total - dp).clamp(0, total);
    final released = settlement == 'released' || booking['released_at'] != null;
    final held = settlement == 'held';

    final parsedDate = eventDate == null ? null : DateTime.tryParse(eventDate);
    final startAt = DateTime.tryParse(
      booking['scheduled_start_at']?.toString() ?? '',
    );
    final endAt = DateTime.tryParse(
      booking['scheduled_end_at']?.toString() ?? '',
    );
    final timeText = startAt == null
        ? null
        : endAt == null
        ? formatTime(startAt)
        : '${formatTime(startAt)} – ${formatTime(endAt)}';

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        VendorSp.lg,
        14,
        VendorSp.lg,
        VendorSp.xl,
      ),
      children: [
        const VendorSectionTitle(label: 'INFORMASI ACARA'),
        VendorCard(
          padding: EdgeInsets.zero,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 8),
                decoration: BoxDecoration(
                  color: VendorColors.softRow,
                  border: Border(
                    bottom: BorderSide(color: VendorColors.lineSoft),
                  ),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'PESANAN MASUK',
                        style: vendorText(
                          size: 10.5,
                          weight: FontWeight.w700,
                          color: VendorColors.muted,
                          letterSpacing: 1.25,
                        ),
                      ),
                    ),
                    VendorPill(
                      label: paymentText(payment),
                      tone: vendorToneForStatus(payment),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      code,
                      style: vendorText(
                        size: 11,
                        weight: FontWeight.w700,
                        color: VendorColors.muted,
                        letterSpacing: 0.3,
                      ),
                    ),
                    const SizedBox(height: 6),
                    if (parsedDate != null) ...[
                      Text(
                        vendorFullDay(parsedDate).toUpperCase(),
                        style: vendorText(
                          size: 10.5,
                          weight: FontWeight.w700,
                          color: VendorColors.muted,
                          letterSpacing: 1.2,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        formatDate(parsedDate),
                        style: vendorText(
                          size: 25,
                          weight: FontWeight.w800,
                          letterSpacing: -0.9,
                          height: 1.04,
                        ),
                      ),
                      if (timeText != null) ...[
                        const SizedBox(height: 7),
                        Text(
                          timeText,
                          style: vendorText(
                            size: 14.5,
                            weight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ] else
                      Text(
                        eventTitle,
                        style: vendorText(size: 22, weight: FontWeight.w800),
                      ),
                    const SizedBox(height: 7),
                    Text(
                      region,
                      style: vendorText(
                        size: 14.5,
                        weight: FontWeight.w600,
                        color: VendorColors.ink,
                      ),
                    ),
                    Padding(
                      padding: EdgeInsets.symmetric(vertical: 11),
                      child: Divider(height: 1, color: VendorColors.lineSoft),
                    ),
                    Text(
                      packageName == null || packageName.isEmpty
                          ? eventTitle
                          : '$eventTitle — $packageName',
                      style: vendorText(size: 13, weight: FontWeight.w700),
                    ),
                    if (eventLocationLine.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.fromLTRB(10, 6, 4, 6),
                        decoration: BoxDecoration(
                          color: VendorColors.softRow,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: VendorColors.lineSoft),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              Icons.place_outlined,
                              size: 16,
                              color: VendorColors.muted,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                eventLocationLine,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: vendorText(
                                  size: 11.5,
                                  color: VendorColors.ink,
                                  height: 1.4,
                                ),
                              ),
                            ),
                            if (venueAddress != null && venueAddress.isNotEmpty)
                              TextButton(
                                onPressed: () => _openMap(venueAddress),
                                style: TextButton.styleFrom(
                                  foregroundColor: VendorColors.ink,
                                  minimumSize: const Size(0, 40),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                  ),
                                  textStyle: vendorText(
                                    size: 11,
                                    weight: FontWeight.w800,
                                  ),
                                ),
                                child: const Text('Peta'),
                              ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 3),
                    Text(
                      guests == null
                          ? '$customerName · $region'
                          : '$customerName · $region · $guests tamu',
                      style: vendorText(size: 11.5, color: VendorColors.muted),
                    ),
                    if (notes != null && notes.trim().isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        notes.trim(),
                        style: vendorText(
                          size: 11.5,
                          color: VendorColors.muted,
                          height: 1.5,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
        const VendorSectionTitle(label: 'STATUS DANA', trailing: 'H+3'),
        VendorCard(
          child: _MoneyStepper(
            dpDone: dpPaid,
            heldNow: !released && (held || dpPaid),
            released: released,
            dpDate: formatDateIso(
              booking['confirmed_at']?.toString() ??
                  booking['created_at']?.toString(),
            ),
            heldDate: held ? 'Sekarang' : 'Menunggu',
            releaseDate: formatDateIso(booking['released_at']?.toString()),
            lifecycle: lifecycle,
          ),
        ),
        VendorSectionTitle(
          label: 'RINCIAN BIAYA',
          trailing: paymentText(payment),
        ),
        VendorCard(
          padding: EdgeInsets.zero,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 11),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Dibayar pelanggan',
                            style: vendorText(
                              size: 11.5,
                              color: VendorColors.muted,
                            ),
                          ),
                        ),
                        Text(
                          dpPaid ? rupiahTight(dp) : 'Belum ada',
                          style: vendorText(
                            size: 11.5,
                            weight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 7),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(2),
                      child: LinearProgressIndicator(
                        value: total > 0 && dpPaid
                            ? (dp / total).clamp(0, 1)
                            : 0,
                        minHeight: 4,
                        backgroundColor: VendorColors.line,
                        valueColor: const AlwaysStoppedAnimation(
                          VendorColors.limeDark,
                        ),
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      dpPaid
                          ? remaining > 0
                                ? 'Sisa pelunasan ${rupiahTight(remaining)} sebelum hari H'
                                : 'Pembayaran sudah lunas'
                          : 'Menunggu pembayaran DP dari pelanggan',
                      style: vendorText(
                        size: 11,
                        color: VendorColors.muted,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  border: Border(top: BorderSide(color: VendorColors.lineSoft)),
                ),
                child: Column(
                  children: [
                    VendorLedgerRow(
                      label: 'Total pesanan',
                      value: rupiahTight(total),
                    ),
                    VendorLedgerRow(
                      label: 'Uang muka (DP)',
                      value: rupiahTight(dp),
                    ),
                    if (commission > 0)
                      VendorLedgerRow(
                        label: 'Komisi Tarlink',
                        value: '-${rupiahTight(commission)}',
                      ),
                    VendorLedgerRow(
                      label: 'Hak Vendor',
                      value: rupiahTight(entitlement),
                      valueColor: VendorColors.green,
                      emphasize: true,
                      showDivider: false,
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
                child: Text(
                  'Hak vendor dicairkan setelah acara selesai dan jendela '
                  'sengketa 7 hari lewat.',
                  style: vendorText(
                    size: 11,
                    color: VendorColors.muted,
                    height: 1.5,
                  ),
                ),
              ),
            ],
          ),
        ),
        const VendorSectionTitle(label: 'PELANGGAN'),
        VendorCard(
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: VendorColors.canvas,
                  borderRadius: BorderRadius.circular(7),
                  border: Border.all(color: VendorColors.line),
                ),
                child: Text(
                  vendorInitials(customerName),
                  style: vendorText(
                    size: 11,
                    weight: FontWeight.w800,
                    color: const Color(0xFF3F4A58),
                    letterSpacing: 0.4,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      customerName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: vendorText(size: 13, weight: FontWeight.w700),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      formatIndonesianPhone(customerPhone),
                      style: vendorText(size: 11.5, color: VendorColors.muted),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: VendorSp.sm),
              VendorButton(
                label: 'Chat pelanggan',
                icon: Icons.forum_outlined,
                kind: VendorButtonKind.secondary,
                small: true,
                onPressed: () => _openChat(customerName),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _actionBar(Map<String, dynamic> booking) {
    final lifecycle = booking['lifecycle_status']?.toString() ?? '';
    final isConfirmed = lifecycle == 'confirmed';
    final isAccepted = lifecycle == 'accepted';
    final deadline = DateTime.tryParse(
      booking['respond_deadline']?.toString() ?? '',
    );
    final remaining = deadline?.difference(DateTime.now());
    String? hint;
    if (isConfirmed) {
      hint = 'Tekan saat sudah tiba di lokasi acara.';
    } else if (isAccepted) {
      hint = 'Menunggu pembayaran DP. Pembatalan akan melepas slot.';
    } else if (remaining != null) {
      if (remaining.isNegative) {
        hint = 'Batas respons sudah lewat';
      } else if (remaining.inDays > 0) {
        hint =
            '${remaining.inDays} hari ${remaining.inHours % 24} jam lagi untuk menjawab';
      } else if (remaining.inHours > 0) {
        hint =
            '${remaining.inHours} jam ${remaining.inMinutes % 60} menit lagi untuk menjawab';
      } else {
        hint = '${remaining.inMinutes} menit lagi untuk menjawab';
      }
    }

    final bottom = MediaQuery.viewPaddingOf(context).bottom;
    return Container(
      decoration: BoxDecoration(
        color: VendorColors.stage,
        border: Border(top: BorderSide(color: VendorColors.lime, width: 2)),
      ),
      padding: EdgeInsets.fromLTRB(18, 10, 18, 15 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (hint != null) ...[
            Row(
              children: [
                Container(
                  width: 5,
                  height: 5,
                  decoration: const BoxDecoration(
                    color: VendorColors.lime,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    hint,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: vendorText(
                      size: 11.5,
                      weight: FontWeight.w500,
                      color: Colors.white.withValues(alpha: 0.65),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 9),
          ],
          if (isConfirmed) ...[
            VendorButton(
              label: 'Saya sudah sampai',
              onPressed: _actionBusy ? null : _checkIn,
            ),
            const SizedBox(height: 8),
            VendorButton(
              label: 'Batalkan Booking',
              kind: VendorButtonKind.outlineOnDark,
              onPressed: _actionBusy ? null : _cancelBooking,
            ),
          ] else if (isAccepted)
            VendorButton(
              label: 'Batalkan Booking',
              kind: VendorButtonKind.outlineOnDark,
              onPressed: _actionBusy ? null : _cancelBooking,
            )
          else
            Row(
              children: [
                Expanded(
                  child: VendorButton(
                    label: 'Tolak Booking',
                    kind: VendorButtonKind.outlineOnDark,
                    maxLines: 2,
                    onPressed: _actionBusy ? null : _declineBooking,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 2,
                  child: VendorButton(
                    label: 'Terima Booking',
                    onPressed: _actionBusy ? null : _acceptBooking,
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _MoneyStepper extends StatelessWidget {
  const _MoneyStepper({
    required this.dpDone,
    required this.heldNow,
    required this.released,
    required this.dpDate,
    required this.heldDate,
    required this.releaseDate,
    required this.lifecycle,
  });

  final bool dpDone;
  final bool heldNow;
  final bool released;
  final String dpDate;
  final String heldDate;
  final String releaseDate;
  final String lifecycle;

  @override
  Widget build(BuildContext context) {
    final steps = <({String date, String label, bool done, bool now})>[
      (date: dpDate, label: 'DP masuk', done: dpDone, now: !dpDone),
      (
        date: heldDate,
        label: 'Ditahan PJP',
        done: released,
        now: dpDone && !released && heldNow,
      ),
      (date: releaseDate, label: 'Cair', done: released, now: false),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Stack(
          children: [
            Positioned(
              left: 16.67,
              right: 16.67,
              top: 4,
              child: Container(height: 1, color: VendorColors.line),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 0),
              child: Row(
                children: [
                  for (var i = 0; i < steps.length; i++)
                    Expanded(
                      child: Column(
                        children: [
                          Container(
                            width: 9,
                            height: 9,
                            decoration: BoxDecoration(
                              color: steps[i].done
                                  ? VendorColors.ink
                                  : steps[i].now
                                  ? VendorColors.lime
                                  : VendorColors.cardWhite,
                              border: Border.all(
                                color: steps[i].done
                                    ? VendorColors.ink
                                    : steps[i].now
                                    ? VendorColors.limeDark
                                    : const Color(0xFFC0C3BC),
                                width: 1.5,
                              ),
                            ),
                          ),
                          const SizedBox(height: 7),
                          Text(
                            steps[i].date.toUpperCase(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: vendorText(
                              size: 10.5,
                              weight: FontWeight.w700,
                              color: VendorColors.muted,
                              letterSpacing: 0.4,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            steps[i].label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: vendorText(
                              size: 11.5,
                              weight: FontWeight.w600,
                              color: steps[i].done || steps[i].now
                                  ? VendorColors.ink
                                  : VendorColors.muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
        if (lifecycle == 'completed') ...[
          const SizedBox(height: VendorSp.sm),
          Text(
            'Pesanan sudah selesai.',
            style: vendorText(size: 11, color: VendorColors.muted),
          ),
        ],
      ],
    );
  }
}

String _headerStatus(String status) => switch (status.toLowerCase()) {
  'requested' => 'Menunggu',
  'accepted' => 'Diterima',
  'confirmed' => 'Terjadwal',
  'in_progress' => 'Berlangsung',
  'completed' => 'Selesai',
  'cancelled' || 'canceled' => 'Batal',
  'rejected' => 'Ditolak',
  'expired' => 'Kedaluwarsa',
  _ => lifecycleText(status),
};

/// Bottom sheet for declining a booking with a reason code.
class VendorDeclineSheet extends StatefulWidget {
  const VendorDeclineSheet({
    super.key,
    required this.bookingCode,
    this.title = 'Tolak Booking',
    this.confirmLabel = 'Konfirmasi Tolak',
    this.warning,
  });

  final String bookingCode;
  final String title;
  final String confirmLabel;
  final String? warning;

  @override
  State<VendorDeclineSheet> createState() => _VendorDeclineSheetState();
}

class _VendorDeclineSheetState extends State<VendorDeclineSheet> {
  String _reasonCode = 'schedule_conflict';
  final _noteController = TextEditingController();

  static const _reasons = <({String code, String title, String subtitle})>[
    (
      code: 'schedule_conflict',
      title: 'Jadwal bentrok',
      subtitle: 'Sudah ada acara di waktu yang sama',
    ),
    (
      code: 'price_mismatch',
      title: 'Harga tidak sesuai',
      subtitle: 'Permintaan di luar tarif standar',
    ),
    (
      code: 'location_out_of_reach',
      title: 'Lokasi terlalu jauh',
      subtitle: 'Di luar area jangkauan grup',
    ),
    (
      code: 'other',
      title: 'Alasan lain',
      subtitle: 'Kebutuhan khusus atau alasan lainnya',
    ),
  ];

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(18, 16, 18, 20 + bottomInset),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    widget.title,
                    style: vendorText(size: 17, weight: FontWeight.w800),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close, size: 20),
                  color: VendorColors.ink,
                ),
              ],
            ),
            Text(
              'Pesanan ${widget.bookingCode}',
              style: vendorText(size: 12, color: VendorColors.muted),
            ),
            if (widget.warning != null) ...[
              const SizedBox(height: VendorSp.sm),
              Container(
                padding: const EdgeInsets.all(VendorSp.sm),
                decoration: BoxDecoration(
                  color: VendorColors.softFill,
                  borderRadius: BorderRadius.circular(VendorRadii.sm),
                  border: Border.all(color: VendorColors.line),
                ),
                child: Text(
                  widget.warning!,
                  style: vendorText(size: 12, color: VendorColors.ink),
                ),
              ),
            ],
            const SizedBox(height: VendorSp.md),
            for (final reason in _reasons)
              Padding(
                padding: const EdgeInsets.only(bottom: VendorSp.sm),
                child: InkWell(
                  onTap: () => setState(() => _reasonCode = reason.code),
                  borderRadius: BorderRadius.circular(VendorRadii.sm),
                  child: Container(
                    padding: const EdgeInsets.all(VendorSp.md),
                    decoration: BoxDecoration(
                      color: _reasonCode == reason.code
                          ? VendorColors.softFill
                          : VendorColors.cardWhite,
                      borderRadius: BorderRadius.circular(VendorRadii.sm),
                      border: Border.all(
                        color: _reasonCode == reason.code
                            ? VendorColors.ink
                            : VendorColors.line,
                        width: _reasonCode == reason.code ? 1.5 : 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          _reasonCode == reason.code
                              ? Icons.radio_button_checked
                              : Icons.radio_button_off,
                          size: 18,
                          color: _reasonCode == reason.code
                              ? VendorColors.ink
                              : VendorColors.muted,
                        ),
                        const SizedBox(width: VendorSp.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                reason.title,
                                style: vendorText(
                                  size: 13,
                                  weight: _reasonCode == reason.code
                                      ? FontWeight.w700
                                      : FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                reason.subtitle,
                                style: vendorText(
                                  size: 11.5,
                                  color: VendorColors.muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            TextField(
              controller: _noteController,
              maxLines: 3,
              style: vendorText(size: 13),
              decoration: InputDecoration(
                hintText: 'Catatan tambahan (opsional)…',
                hintStyle: vendorText(size: 12, color: VendorColors.muted),
                filled: true,
                fillColor: VendorColors.softFill,
                contentPadding: const EdgeInsets.all(VendorSp.md),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(VendorRadii.sm),
                  borderSide: BorderSide(color: VendorColors.line),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(VendorRadii.sm),
                  borderSide: BorderSide(color: VendorColors.line),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(VendorRadii.sm),
                  borderSide: BorderSide(color: VendorColors.ink),
                ),
              ),
            ),
            const SizedBox(height: VendorSp.lg),
            SizedBox(
              height: 42,
              child: FilledButton(
                onPressed: () {
                  final note = _noteController.text.trim();
                  Navigator.pop(context, {
                    'reason_code': _reasonCode,
                    if (note.isNotEmpty) 'note': note,
                  });
                },
                style: FilledButton.styleFrom(
                  backgroundColor: VendorColors.amber,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(VendorRadii.sm),
                  ),
                ),
                child: Text(
                  widget.confirmLabel,
                  style: vendorText(
                    size: 13,
                    weight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Persistent chat shortcut in the dark header, next to the status pill.
class _HeaderChatButton extends StatelessWidget {
  const _HeaderChatButton({required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: 'Chat pelanggan',
      child: Semantics(
        button: true,
        label: 'Chat pelanggan',
        child: Material(
          color: Colors.white.withValues(alpha: 0.06),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: BorderSide(color: Colors.white.withValues(alpha: 0.16)),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onPressed,
            child: const SizedBox(
              width: 34,
              height: 34,
              child: Icon(
                Icons.forum_outlined,
                size: 17,
                color: VendorColors.lime,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
