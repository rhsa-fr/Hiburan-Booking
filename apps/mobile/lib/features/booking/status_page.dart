import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/app.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/widgets.dart';
import 'booking_support.dart';

const _terminalStatuses = {
  'completed',
  'cancelled',
  'canceled',
  'rejected',
  'expired',
};

const _paymentMethods = <({String value, String label})>[
  (value: 'qris', label: 'QRIS'),
  (value: 'va_bca', label: 'BCA Virtual Account'),
  (value: 'va_bni', label: 'BNI Virtual Account'),
  (value: 'va_bri', label: 'BRI Virtual Account'),
  (value: 'va_mandiri', label: 'Mandiri Virtual Account'),
];

const _steps = <({String title, String body})>[
  (
    title: 'Menunggu vendor menerima',
    body: 'Vendor menjawab permintaanmu dulu. Kamu belum perlu membayar.',
  ),
  (
    title: 'Vendor menerima — bayar DP',
    body: 'Bayar DP supaya tanggal dan sesi dikunci untukmu.',
  ),
  (
    title: 'DP dibayar, jadwal dikunci',
    body:
        'Acara sudah pasti. Sisa tagihan dibayar ke vendor sesuai kesepakatan.',
  ),
  (title: 'Acara selesai', body: 'Booking ditutup setelah acara berjalan.'),
];

Map<String, dynamic> _asMap(dynamic value) =>
    value is Map ? value.cast<String, dynamic>() : const <String, dynamic>{};

bool _isNetwork(ApiException error) =>
    error.code == 'NETWORK_ERROR' || error.code == 'TIMEOUT';

class BookingStatusPage extends StatefulWidget {
  const BookingStatusPage({super.key, required this.bookingId});

  final String bookingId;

  @override
  State<BookingStatusPage> createState() => _BookingStatusPageState();
}

class _BookingStatusPageState extends State<BookingStatusPage>
    with WidgetsBindingObserver {
  BookingView? _booking;
  PaymentView? _payment;

  bool _loading = true;
  bool _fetching = false;
  bool _restoring = false;
  String? _loadError;
  bool _weakSignal = false;
  bool _resumed = true;

  bool _paying = false;
  String? _payError;
  String _method = 'qris';
  String? _idempotencyKey;
  String? _keyMethod;

  bool _cancelBusy = false;
  String? _cancelError;

  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _fetch();
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _resumed = state == AppLifecycleState.resumed;
    if (_resumed) _poll();
  }

  Future<void> _fetch({bool silent = false}) async {
    if (_fetching || !mounted) return;
    _fetching = true;
    final api = AppScope.of(context).api;
    if (!silent) {
      setState(() {
        _loading = _booking == null;
        _loadError = null;
      });
    }
    try {
      final raw = await api.get('/bookings/${widget.bookingId}');
      final next = BookingView.fromJson(_asMap(raw));
      if (!mounted) return;
      setState(() {
        _booking = next;
        _loading = false;
        _loadError = null;
        _weakSignal = false;
        if (isDpSettled(next.paymentStatus) ||
            next.paymentStatus == 'refunded' ||
            _terminalStatuses.contains(next.lifecycleStatus)) {
          _payment = null;
        }
      });
      if (!silent &&
          next.lifecycleStatus == 'accepted' &&
          next.paymentStatus == 'unpaid') {
        await _restoreInstruction();
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      if (silent) {
        if (_isNetwork(error)) setState(() => _weakSignal = true);
      } else {
        setState(() {
          _loading = false;
          _loadError = apiMessage(error);
        });
      }
    } finally {
      _fetching = false;
      if (mounted) _syncPolling();
    }
  }

  Future<void> _restoreInstruction() async {
    if (_restoring || !mounted) return;
    _restoring = true;
    final api = AppScope.of(context).api;
    try {
      final raw = await api.get('/payments/by-booking/${widget.bookingId}');
      final restored = PaymentView.fromJson(_asMap(raw));
      if (!mounted) return;
      if (restored.instruction != null) {
        setState(() {
          _payment = restored;
          _weakSignal = false;
        });
      }
    } on ApiException catch (error) {
      // No DP invoice yet is a normal state, not an error for the customer.
      if (_isNetwork(error) && mounted) {
        setState(() => _weakSignal = true);
      }
    } finally {
      _restoring = false;
    }
  }

  void _syncPolling() {
    final booking = _booking;
    final shouldPoll =
        booking != null &&
        !_terminalStatuses.contains(booking.lifecycleStatus) &&
        !isDpSettled(booking.paymentStatus) &&
        booking.paymentStatus != 'refunded';
    if (!shouldPoll) {
      _pollTimer?.cancel();
      _pollTimer = null;
      return;
    }
    _pollTimer ??= Timer.periodic(const Duration(seconds: 15), (_) => _poll());
  }

  Future<void> _poll() async {
    if (!mounted || !_resumed || _fetching) return;
    final route = ModalRoute.of(context);
    if (route != null && !route.isCurrent) return;
    await _fetch(silent: true);
  }

  Future<void> _refresh() => _fetch(silent: true);

  bool get _canPay {
    final booking = _booking;
    return booking != null &&
        booking.lifecycleStatus == 'accepted' &&
        booking.paymentStatus == 'unpaid';
  }

  bool get _canCancel {
    final booking = _booking;
    if (booking == null) return false;
    switch (booking.lifecycleStatus) {
      case 'requested':
        return true;
      case 'accepted':
        return booking.paymentStatus == 'unpaid';
      case 'confirmed':
        final start = DateTime.tryParse(booking.event.startDate);
        if (start == null) return false;
        return start.isAfter(DateTime.now().add(const Duration(hours: 24)));
      default:
        return false;
    }
  }

  Future<void> _pay() async {
    final booking = _booking;
    if (booking == null || _paying) return;
    if (_idempotencyKey == null || _keyMethod != _method) {
      _idempotencyKey = uuidV4();
      _keyMethod = _method;
    }
    final key = _idempotencyKey!;
    final api = AppScope.of(context).api;
    setState(() {
      _paying = true;
      _payError = null;
    });
    try {
      final raw = await api.post(
        '/payments/dp',
        headers: {'Idempotency-Key': key},
        body: {'booking_id': booking.id, 'method': _method},
      );
      final data = _asMap(raw);
      final result = PaymentView(
        payment: Payment.fromJson(data),
        instruction: data['payment_instruction'] == null
            ? null
            : PaymentInstruction.fromJson(_asMap(data['payment_instruction'])),
      );
      if (!mounted) return;
      setState(() {
        _payment = result;
        _paying = false;
        _idempotencyKey = null;
        _keyMethod = null;
        _weakSignal = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _paying = false;
        _payError = error.message;
      });
    }
  }

  Future<void> _cancel() async {
    final booking = _booking;
    if (booking == null || _cancelBusy) return;
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _CancelDialog(),
    );
    if (reason == null || !mounted) return;
    final api = AppScope.of(context).api;
    setState(() {
      _cancelBusy = true;
      _cancelError = null;
    });
    try {
      final raw = await api.post(
        '/bookings/${booking.id}/cancel',
        body: {'reason': reason},
      );
      final next = BookingView.fromJson(_asMap(raw));
      if (!mounted) return;
      setState(() {
        _booking = next;
        _cancelBusy = false;
        _payment = null;
      });
      _syncPolling();
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Booking dibatalkan.')));
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _cancelBusy = false;
        _cancelError = error.message;
      });
    }
  }

  Future<void> _openWhatsApp() async {
    final digits = whatsappDigits(_booking?.vendor.whatsapp);
    if (digits == null) return;
    final opened = await launchUrl(
      Uri.parse('https://wa.me/$digits'),
      mode: LaunchMode.externalApplication,
    );
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('WhatsApp tidak bisa dibuka di perangkat ini.'),
        ),
      );
    }
  }

  Future<void> _copyCode() async {
    final code = _booking?.code;
    if (code == null) return;
    await Clipboard.setData(ClipboardData(text: code));
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Kode booking disalin.')));
  }

  Future<void> _copyText(String value, String message) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Status booking')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: _loading
              ? const Padding(
                  padding: EdgeInsets.all(Sp.lg),
                  child: AppLoading(rows: 3, label: 'Memuat status booking'),
                )
              : _loadError != null
              ? AppError(
                  message: _loadError!,
                  onRetry: () {
                    setState(() => _loading = true);
                    _fetch();
                  },
                )
              : _body(text),
        ),
      ),
    );
  }

  Widget _body(TextTheme text) {
    final booking = _booking!;
    final terminal = _terminalStatuses.contains(booking.lifecycleStatus);
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, Sp.xl),
        children: [
          if (_weakSignal) ...[
            _WeakSignalBanner(onRetry: _refresh),
            const SizedBox(height: Sp.md),
          ],
          Text(_headline(booking), style: text.displaySmall),
          const SizedBox(height: Sp.sm),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Kode ${booking.code}',
                  style: text.bodyMedium?.copyWith(
                    color: AppColors.inkMuted,
                    letterSpacing: 0.3,
                  ),
                ),
              ),
              IconButton(
                onPressed: _copyCode,
                tooltip: 'Salin kode booking',
                icon: const Icon(Icons.copy, size: 20),
              ),
            ],
          ),
          const SizedBox(height: Sp.xs),
          Wrap(
            spacing: Sp.sm,
            runSpacing: Sp.sm,
            children: [
              BookingStatusChip(booking.lifecycleStatus),
              BookingStatusChip(
                booking.paymentStatus,
                kind: BookingChipKind.payment,
              ),
            ],
          ),
          const SizedBox(height: Sp.xl),
          if (terminal)
            _terminalPanel(booking, text)
          else
            BookingSection(
              title: 'Apa yang terjadi',
              child: BookingPanel(child: _timeline(booking, text)),
            ),
          const SizedBox(height: Sp.xl),
          _moneySection(booking, text),
          if (isDpSettled(booking.paymentStatus)) ...[
            const SizedBox(height: Sp.xl),
            _paidPanel(booking, text),
          ] else if (_canPay || _payment != null) ...[
            const SizedBox(height: Sp.xl),
            _paymentSection(booking, text),
          ],
          const SizedBox(height: Sp.xl),
          _actionSection(booking, text),
        ],
      ),
    );
  }

  String _headline(BookingView booking) => switch (booking.lifecycleStatus) {
    'requested' => 'Menunggu vendor menerima',
    'accepted' => 'Vendor menerima — bayar DP',
    'confirmed' => 'Jadwalmu sudah dikunci',
    'in_progress' => 'Acara sedang berlangsung',
    'completed' => 'Acara selesai',
    'cancelled' || 'canceled' => 'Booking dibatalkan',
    'rejected' => 'Booking ditolak vendor',
    'expired' => 'Booking kedaluwarsa',
    'countered' => 'Vendor mengajukan perubahan',
    _ => lifecycleText(booking.lifecycleStatus),
  };

  Widget _timeline(BookingView booking, TextTheme text) {
    final current = switch (booking.lifecycleStatus) {
      'requested' || 'countered' => 0,
      'accepted' => 1,
      'confirmed' || 'in_progress' => 2,
      'completed' => 3,
      _ => 0,
    };
    return Column(
      children: [
        for (var i = 0; i < _steps.length; i++)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: 24,
                  child: Column(
                    children: [
                      _StepDot(
                        done:
                            i < current ||
                            booking.lifecycleStatus == 'completed',
                        current:
                            i == current &&
                            booking.lifecycleStatus != 'completed',
                      ),
                      if (i < _steps.length - 1)
                        Expanded(
                          child: Container(width: 2, color: AppColors.line),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: Sp.md),
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(
                      bottom: i < _steps.length - 1 ? Sp.lg : 0,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _steps[i].title,
                          style: text.titleMedium?.copyWith(
                            color: i == current
                                ? AppColors.primary
                                : i < current
                                ? AppColors.ink
                                : AppColors.inkMuted,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(_steps[i].body, style: text.bodySmall),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _terminalPanel(BookingView booking, TextTheme text) {
    final (message, tone, icon) = switch (booking.lifecycleStatus) {
      'rejected' => (
        'Vendor menolak booking ini. Cari vendor lain untuk tanggal yang sama.',
        AppColors.warningSoft,
        Icons.info_outline,
      ),
      'expired' => (
        'Batas waktu booking ini sudah lewat. Silakan buat booking baru.',
        AppColors.dangerSoft,
        Icons.schedule,
      ),
      _ => (
        'Booking ini sudah dibatalkan. Kalau ada pembayaran, hubungi vendor atau Tarlink.',
        AppColors.dangerSoft,
        Icons.cancel_outlined,
      ),
    };
    return BookingPanel(
      color: tone,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 22, color: AppColors.ink),
          const SizedBox(width: Sp.md),
          Expanded(child: Text(message, style: text.bodyMedium)),
        ],
      ),
    );
  }

  Widget _moneySection(BookingView booking, TextTheme text) {
    final total = moneyValue(booking.pricing, 'total_customer_idr');
    final dp = moneyValue(booking.pricing, 'dp_amount_idr');
    final outstanding = booking.outstandingIdr;
    return BookingSection(
      title: 'Rincian biaya',
      child: BookingPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (total != null)
              MoneyLine(label: 'Total acara', value: rupiah(total)),
            if (dp != null) ...[
              const SizedBox(height: Sp.sm),
              MoneyLine(
                label: isDpSettled(booking.paymentStatus)
                    ? 'DP sudah dibayar'
                    : booking.lifecycleStatus == 'requested'
                    ? 'DP setelah vendor menerima'
                    : 'DP yang harus dibayar',
                value: rupiah(dp),
              ),
            ],
            const SizedBox(height: Sp.md),
            const Divider(height: 1),
            const SizedBox(height: Sp.md),
            // `outstanding_idr` mengikuti status: belum bayar = total penuh,
            // DP lunas = total dikurangi DP, lunas = 0. Labelnya harus ikut,
            // kalau tidak "setelah DP" menampilkan angka total.
            if (outstanding > 0)
              MoneyLine(
                label: booking.paymentStatus == 'unpaid'
                    ? 'Total yang harus dibayar'
                    : 'Sisa tagihan setelah DP',
                value: rupiah(outstanding),
                emphasis: true,
              ),
            if (isFullySettled(booking.paymentStatus)) ...[
              const SizedBox(height: Sp.sm),
              MoneyLine(
                label: 'Lunas',
                value: rupiah(total ?? booking.totalCustomerIdr),
                emphasis: true,
              ),
            ],
            if (outstanding > 0) ...[
              const SizedBox(height: Sp.sm),
              Text(
                'Sisa dibayar ke vendor sesuai kesepakatan.',
                style: text.bodySmall,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _paidPanel(BookingView booking, TextTheme text) {
    final fullyPaid = isFullySettled(booking.paymentStatus);
    final outstanding = booking.outstandingIdr;
    return BookingPanel(
      color: AppColors.accentSoft,
      borderColor: AppColors.accentSoft,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.check_circle_outline,
            size: 26,
            color: AppColors.accent,
          ),
          const SizedBox(width: Sp.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  fullyPaid ? 'Pembayaran lunas' : 'DP diterima',
                  style: text.titleLarge?.copyWith(color: AppColors.accent),
                ),
                const SizedBox(height: Sp.xs),
                Text(
                  fullyPaid
                      ? 'Booking ${booking.code} sudah dibayar penuh.'
                      : 'Booking ${booking.code} sudah dikunci.',
                  style: text.bodyMedium,
                ),
                if (!fullyPaid && outstanding > 0) ...[
                  const SizedBox(height: Sp.xs),
                  Text(
                    'Sisa ${rupiah(outstanding)} dibayar ke vendor sesuai kesepakatan.',
                    style: text.bodySmall,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _paymentSection(BookingView booking, TextTheme text) {
    final pending = _payment;
    if (pending != null) {
      return BookingSection(
        title: 'Instruksi pembayaran',
        child: BookingPanel(child: _instructionView(pending, text)),
      );
    }
    return BookingSection(
      title: 'Bayar DP',
      hint: 'Pilih cara bayar. Setelah DP masuk, jadwal langsung dikunci.',
      child: BookingPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final method in _paymentMethods) ...[
              _MethodOption(
                label: method.label,
                selected: _method == method.value,
                onTap: _paying
                    ? null
                    : () => setState(() {
                        _method = method.value;
                        _payError = null;
                        _idempotencyKey = null;
                        _keyMethod = null;
                      }),
              ),
              const SizedBox(height: Sp.sm),
            ],
            if (_payError != null) ...[
              const SizedBox(height: Sp.xs),
              Semantics(
                liveRegion: true,
                child: AppError(message: _payError!, compact: true),
              ),
              const SizedBox(height: Sp.md),
            ],
            PrimaryButton(
              label: 'Bayar DP',
              loadingLabel: 'Membuat tagihan…',
              loading: _paying,
              onPressed: _pay,
            ),
            const SizedBox(height: Sp.sm),
            Text(
              'Jangan tutup layar ini saat tagihan dibuat.',
              style: text.bodySmall,
            ),
          ],
        ),
      ),
    );
  }

  Widget _instructionView(PaymentView payment, TextTheme text) {
    final instruction = payment.instruction;
    if (instruction == null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Instruksi pembayaran belum tersedia. Muat ulang sebentar lagi.',
            style: text.bodyMedium,
          ),
          const SizedBox(height: Sp.md),
          TextButton.icon(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
            label: const Text('Muat ulang'),
          ),
        ],
      );
    }
    final expiry = _expiryText(
      instruction.expiresAt ?? payment.payment.expiresAt,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Bayar ${rupiah(payment.payment.amountIdr)}',
          style: text.titleLarge,
        ),
        const SizedBox(height: Sp.xs),
        Text('DP untuk booking ${_booking?.code ?? ''}', style: text.bodySmall),
        const SizedBox(height: Sp.lg),
        if (instruction.type == 'qris' && instruction.qrString != null)
          _qrisView(instruction.qrString!, text)
        else if (instruction.type == 'va' && instruction.vaNumber != null)
          _vaView(instruction, text)
        else
          Text(
            'Instruksi pembayaran tidak dikenali. Muat ulang atau pilih metode lain.',
            style: text.bodyMedium,
          ),
        if (expiry != null) ...[
          const SizedBox(height: Sp.md),
          Row(
            children: [
              const Icon(Icons.schedule, size: 18, color: AppColors.warning),
              const SizedBox(width: Sp.sm),
              Expanded(
                child: Text(
                  expiry,
                  style: text.bodyMedium?.copyWith(color: AppColors.warning),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _qrisView(String qrString, TextTheme text) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Container(
            padding: const EdgeInsets.all(Sp.sm),
            decoration: BoxDecoration(
              color: AppColors.card,
              borderRadius: BorderRadius.circular(Radii.sm),
              border: Border.all(color: AppColors.line),
            ),
            child: QrImageView(
              data: qrString,
              version: QrVersions.auto,
              size: 200,
              backgroundColor: AppColors.card,
              eyeStyle: const QrEyeStyle(
                eyeShape: QrEyeShape.square,
                color: AppColors.ink,
              ),
              dataModuleStyle: const QrDataModuleStyle(
                dataModuleShape: QrDataModuleShape.square,
                color: AppColors.ink,
              ),
              semanticsLabel: 'Kode QRIS pembayaran DP',
            ),
          ),
        ),
        const SizedBox(height: Sp.sm),
        Text(
          'Scan dengan aplikasi bank atau e-wallet yang mendukung QRIS.',
          textAlign: TextAlign.center,
          style: text.bodySmall,
        ),
        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          childrenPadding: const EdgeInsets.only(bottom: Sp.sm),
          title: Text('Kode cadangan', style: text.labelMedium),
          children: [
            SelectableText(
              qrString,
              style: text.bodySmall?.copyWith(fontFamily: 'monospace'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _vaView(PaymentInstruction instruction, TextTheme text) {
    final number = instruction.vaNumber!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          (instruction.bank ?? 'Virtual Account').toUpperCase(),
          style: text.bodySmall,
        ),
        const SizedBox(height: Sp.xs),
        Text(
          number,
          textAlign: TextAlign.center,
          style: text.titleLarge?.copyWith(
            fontFamily: 'monospace',
            letterSpacing: 0.5,
          ),
        ),
        const SizedBox(height: Sp.sm),
        Center(
          child: TextButton.icon(
            onPressed: () => _copyText(number, 'Nomor VA disalin.'),
            icon: const Icon(Icons.copy, size: 18),
            label: const Text('Salin nomor VA'),
          ),
        ),
      ],
    );
  }

  String? _expiryText(String? iso) {
    if (iso == null) return null;
    final parsed = DateTime.tryParse(iso)?.toLocal();
    if (parsed == null) return null;
    final now = DateTime.now();
    final sameDay =
        parsed.year == now.year &&
        parsed.month == now.month &&
        parsed.day == now.day;
    final date = sameDay ? '' : '${formatDayMonth(parsed)} ';
    return 'Berlaku sampai $date${formatTime(parsed)}';
  }

  Widget _actionSection(BookingView booking, TextTheme text) {
    final digits = whatsappDigits(booking.vendor.whatsapp);
    return BookingSection(
      title: 'Butuh bantuan?',
      child: BookingPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (digits != null) ...[
              OutlinedButton.icon(
                onPressed: _openWhatsApp,
                icon: const Icon(Icons.chat_outlined, size: 20),
                label: const Text('Chat vendor di WhatsApp'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                  foregroundColor: AppColors.primary,
                  side: const BorderSide(color: AppColors.line),
                ),
              ),
              const SizedBox(height: Sp.sm),
            ],
            TextButton.icon(
              onPressed: _copyCode,
              icon: const Icon(Icons.copy, size: 18),
              label: const Text('Salin kode booking'),
            ),
            if (_canCancel) ...[
              const SizedBox(height: Sp.xs),
              const Divider(height: 1),
              const SizedBox(height: Sp.xs),
              TextButton.icon(
                onPressed: _cancelBusy ? null : _cancel,
                icon: const Icon(Icons.close, size: 18),
                label: Text(_cancelBusy ? 'Membatalkan…' : 'Batalkan booking'),
                style: TextButton.styleFrom(foregroundColor: AppColors.danger),
              ),
            ],
            if (_cancelError != null) ...[
              const SizedBox(height: Sp.sm),
              Semantics(
                liveRegion: true,
                child: AppError(message: _cancelError!, compact: true),
              ),
            ],
            if (digits == null)
              Padding(
                padding: const EdgeInsets.only(top: Sp.sm),
                child: Text(
                  'Nomor WhatsApp vendor belum tersedia.',
                  style: text.bodySmall,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _StepDot extends StatelessWidget {
  const _StepDot({required this.done, required this.current});

  final bool done;
  final bool current;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 24,
      height: 24,
      decoration: BoxDecoration(
        color: done
            ? AppColors.accentSoft
            : current
            ? AppColors.primary
            : AppColors.neutralSoft,
        shape: BoxShape.circle,
      ),
      child: Icon(
        done ? Icons.check : Icons.circle,
        size: done ? 15 : 8,
        color: done
            ? AppColors.accent
            : current
            ? AppColors.onPrimary
            : AppColors.inkMuted,
      ),
    );
  }
}

class _MethodOption extends StatelessWidget {
  const _MethodOption({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
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
                color: selected ? AppColors.primary : AppColors.inkMuted,
              ),
              const SizedBox(width: Sp.md),
              Expanded(child: Text(label, style: text.titleMedium)),
            ],
          ),
        ),
      ),
    );
  }
}

class _WeakSignalBanner extends StatelessWidget {
  const _WeakSignalBanner({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(Sp.md, Sp.xs, Sp.xs, Sp.xs),
      decoration: BoxDecoration(
        color: AppColors.warningSoft,
        borderRadius: BorderRadius.circular(Radii.sm),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.wifi_off_outlined,
            size: 20,
            color: AppColors.warning,
          ),
          const SizedBox(width: Sp.sm),
          Expanded(
            child: Text(
              'Sinyal lemah — mencoba lagi',
              style: text.bodyMedium?.copyWith(color: AppColors.warning),
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('Coba lagi')),
        ],
      ),
    );
  }
}

class _CancelDialog extends StatefulWidget {
  const _CancelDialog();

  @override
  State<_CancelDialog> createState() => _CancelDialogState();
}

class _CancelDialogState extends State<_CancelDialog> {
  final _reason = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _reason.text.trim();
    if (value.length < 10) {
      setState(() => _error = 'Alasan minimal 10 karakter.');
      return;
    }
    Navigator.pop(context, value);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return AlertDialog(
      scrollable: true,
      title: const Text('Batalkan booking?'),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Vendor akan melihat alasan ini. Tulis alasan minimal 10 karakter.',
            style: text.bodyMedium,
          ),
          const SizedBox(height: Sp.md),
          TextField(
            controller: _reason,
            autofocus: true,
            minLines: 2,
            maxLines: 4,
            maxLength: 500,
            decoration: InputDecoration(
              labelText: 'Alasan pembatalan',
              errorText: _error,
              counterText: '',
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Kembali'),
        ),
        FilledButton(
          onPressed: _submit,
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.danger,
            foregroundColor: AppColors.onPrimary,
          ),
          child: const Text('Batalkan booking'),
        ),
      ],
    );
  }
}
