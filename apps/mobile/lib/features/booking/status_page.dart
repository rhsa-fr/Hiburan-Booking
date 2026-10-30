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
import '../../core/ui.dart';
import '../../core/widgets.dart';
import 'booking_support.dart';

const _closedLifecycles = {'cancelled', 'canceled', 'rejected', 'expired'};

const _paymentMethods = <({String value, String label})>[
  (value: 'qris', label: 'QRIS'),
  (value: 'va_bca', label: 'BCA Virtual Account'),
  (value: 'va_bni', label: 'BNI Virtual Account'),
  (value: 'va_bri', label: 'BRI Virtual Account'),
  (value: 'va_mandiri', label: 'Mandiri Virtual Account'),
];

const _tabularFigures = <FontFeature>[FontFeature.tabularFigures()];

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
  Timer? _tickTimer;

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
    _tickTimer?.cancel();
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
            _closedLifecycles.contains(next.lifecycleStatus) ||
            next.lifecycleStatus == 'completed') {
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
      if (mounted) {
        _syncPolling();
        _syncTick();
      }
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
      _syncTick();
    }
  }

  void _syncPolling() {
    final booking = _booking;
    final shouldPoll =
        booking != null &&
        !_closedLifecycles.contains(booking.lifecycleStatus) &&
        booking.lifecycleStatus != 'completed' &&
        !isDpSettled(booking.paymentStatus) &&
        booking.paymentStatus != 'refunded';
    if (!shouldPoll) {
      _pollTimer?.cancel();
      _pollTimer = null;
      return;
    }
    _pollTimer ??= Timer.periodic(const Duration(seconds: 15), (_) => _poll());
  }

  /// A one-second tick only while a live payment instruction is on screen.
  void _syncTick() {
    final booking = _booking;
    final needsTick =
        _payment?.instruction != null &&
        booking != null &&
        booking.paymentStatus == 'unpaid';
    if (!needsTick) {
      _tickTimer?.cancel();
      _tickTimer = null;
      return;
    }
    _tickTimer ??= Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {});
    });
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
      _syncTick();
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
    final reason = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.lg)),
      ),
      builder: (_) =>
          _CancelSheet(booking: booking, consequence: _cancelConsequence()),
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
      _syncTick();
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

  /// The truth as the API writes it: cancelling never refunds by itself.
  String _cancelConsequence() {
    final booking = _booking!;
    final total =
        moneyValue(booking.pricing, 'total_customer_idr') ??
        booking.totalCustomerIdr;
    final dp =
        moneyValue(booking.pricing, 'dp_amount_idr') ?? booking.dpAmountIdr;
    final paid = isFullySettled(booking.paymentStatus)
        ? total
        : isDpSettled(booking.paymentStatus)
        ? dp
        : 0;
    if (paid <= 0) {
      return 'Kamu belum membayar DP, jadi tidak ada dana yang perlu '
          'dikembalikan.';
    }
    return 'Pembayaran ${rupiah(paid)} yang sudah masuk tidak otomatis kembali '
        'kalau booking dibatalkan. Hubungi vendor atau Tarlink untuk mengurus '
        'pengembaliannya.';
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
    final booking = _booking;

    if (booking == null) {
      return Scaffold(
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              children: [
                StageHeader.back(
                  context: context,
                  title: 'Detail pesanan',
                ),
                Expanded(
                  child: _loading
                      ? const Padding(
                          padding: EdgeInsets.all(Sp.lg),
                          child: AppLoading(rows: 3, label: 'Memuat status booking'),
                        )
                      : AppError(
                          message: _loadError ?? 'Booking belum bisa dimuat.',
                          onRetry: () {
                            setState(() => _loading = true);
                            _fetch();
                          },
                        ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Column(
            children: [
              _header(booking, text),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(
                      Sp.lg,
                      Sp.lg,
                      Sp.lg,
                      160,
                    ),
                    children: _body(booking, text),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: _actionBar(booking, text),
    );
  }

  Widget _header(BookingView booking, TextTheme text) {
    return StageHeader.back(
      context: context,
      title: 'Detail Pesanan',
      subtitle: booking.vendor.displayName,
      trailing: Material(
        color: AppColors.card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.sm),
          side: const BorderSide(color: AppColors.line),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: _copyCode,
          child: const SizedBox(
            width: 38,
            height: 38,
            child: Center(
              child: Icon(Icons.copy_rounded, size: 18, color: AppColors.ink),
            ),
          ),
        ),
      ),
      bottom: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: Sp.sm,
              vertical: 5,
            ),
            decoration: BoxDecoration(
              color: AppColors.surfaceTint,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Text(
                  booking.code,
                  style: text.labelSmall?.copyWith(
                    letterSpacing: 0.4,
                    fontFeatures: _tabularFigures,
                    color: AppColors.inkMuted,
                  ),
                ),
                const SizedBox(width: 4),
                GestureDetector(
                  onTap: _copyCode,
                  child: const Icon(
                    Icons.copy,
                    size: 14,
                    color: AppColors.inkMuted,
                  ),
                ),
              ],
            ),
          ),
          const Spacer(),
          StatusPill(
            label: paymentText(booking.paymentStatus),
            tone: bookingPillTone(booking.paymentStatus),
          ),
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

  List<Widget> _body(BookingView booking, TextTheme text) {
    final digits = whatsappDigits(booking.vendor.whatsapp);
    return [
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              _headline(booking),
              style: text.headlineSmall?.copyWith(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.3,
              ),
            ),
          ),
          const SizedBox(width: Sp.sm),
          StatusPill(
            label: lifecycleText(booking.lifecycleStatus),
            tone: bookingPillTone(booking.lifecycleStatus),
          ),
        ],
      ),
      const SizedBox(height: Sp.md),
      if (_weakSignal) ...[
        InfoStrip(
          message: 'Sinyal lemah — mencoba lagi.',
          icon: Icons.wifi_off_outlined,
          tone: InfoTone.warning,
          actionLabel: 'Coba lagi',
          onAction: _refresh,
        ),
        const SizedBox(height: Sp.md),
      ],
      _moneyBlock(booking),
      const SizedBox(height: Sp.lg),
      if (booking.lifecycleStatus == 'requested') ...[
        const InfoStrip(
          message: 'Menunggu vendor menerima. Kamu belum perlu membayar.',
          icon: Icons.schedule,
          tone: InfoTone.primary,
        ),
        const SizedBox(height: Sp.lg),
      ],
      if (_terminalMessage(booking) != null) ...[
        InfoStrip(
          message: _terminalMessage(booking)!,
          icon: Icons.info_outline,
          tone: booking.lifecycleStatus == 'rejected'
              ? InfoTone.warning
              : InfoTone.danger,
        ),
        const SizedBox(height: Sp.lg),
      ],
      if (_canPay || _payment != null) ...[
        _paymentSection(booking, text),
        const SizedBox(height: Sp.xl),
      ],
      SectionHeader(
        title: 'Perjalanan booking',
        caption: 'Diperbarui mengikuti status dari sistem.',
      ),
      const SizedBox(height: Sp.md),
      BookingPanel(child: _timeline(booking, text)),
      const SizedBox(height: Sp.xl),
      const SectionHeader(title: 'Detail acara'),
      const SizedBox(height: Sp.md),
      BookingPanel(child: _detail(booking, text)),
      if (digits == null) ...[
        const SizedBox(height: Sp.md),
        const InfoStrip(
          message: 'Nomor WhatsApp vendor belum tersedia.',
          icon: Icons.chat_outlined,
          tone: InfoTone.neutral,
        ),
      ],
      if (_cancelError != null) ...[
        const SizedBox(height: Sp.md),
        Semantics(
          liveRegion: true,
          child: AppError(message: _cancelError!, compact: true),
        ),
      ],
    ];
  }

  String? _terminalMessage(
    BookingView booking,
  ) => switch (booking.lifecycleStatus) {
    'cancelled' || 'canceled' =>
      'Booking ini sudah dibatalkan. Kalau ada pembayaran, hubungi vendor '
          'atau Tarlink.',
    'rejected' =>
      'Vendor menolak booking ini. Cari vendor lain untuk tanggal yang sama.',
    'expired' =>
      'Batas waktu booking ini sudah lewat. Buat booking baru untuk '
          'tanggal lain.',
    _ => null,
  };

  Widget _moneyBlock(BookingView booking) {
    final total =
        moneyValue(booking.pricing, 'total_customer_idr') ??
        booking.totalCustomerIdr;
    final dp =
        moneyValue(booking.pricing, 'dp_amount_idr') ?? booking.dpAmountIdr;
    final status = booking.paymentStatus;

    if (isFullySettled(status)) {
      return MoneyBlock(
        rows: [MoneyRow('Total acara', total)],
        totalLabel: 'Lunas',
        totalIdr: total,
        tone: MoneyTone.accent,
        footnote: 'Pembayaran lunas',
      );
    }

    if (status == 'refunded') {
      return MoneyBlock(
        rows: [MoneyRow('Total acara', total)],
        totalLabel: 'Dana dikembalikan',
        totalIdr: dp > 0 ? dp : total,
        tone: MoneyTone.ink,
        footnote: 'Tidak ada tagihan sisa untuk booking ini.',
      );
    }

    if (_closedLifecycles.contains(booking.lifecycleStatus)) {
      return MoneyBlock(
        rows: const [],
        totalLabel: 'Total acara',
        totalIdr: total,
      );
    }

    final paid = isDpSettled(status);
    return MoneyBlock(
      rows: [
        if (paid) MoneyRow('Total acara', total),
        if (paid) MoneyRow('Sudah dibayar (DP)', -dp),
      ],
      totalLabel: paid ? 'Sisa yang harus dibayar' : 'Total yang harus dibayar',
      totalIdr: paid ? booking.outstandingIdr : total,
      footnote: paid
          ? 'DP sudah masuk'
          : 'Sisa dibayar ke vendor sesuai kesepakatan.',
    );
  }

  Widget _paymentSection(BookingView booking, TextTheme text) {
    final view = _payment;
    final instruction = view?.instruction;
    if (view != null && instruction != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            title: 'Instruksi pembayaran',
            caption: 'Booking ${booking.code}',
          ),
          const SizedBox(height: Sp.md),
          BookingPanel(child: _instructionView(view, text)),
        ],
      );
    }

    if (view != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionHeader(title: 'Instruksi pembayaran'),
          const SizedBox(height: Sp.md),
          BookingPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Instruksi pembayaran belum tersedia. Muat ulang sebentar '
                  'lagi.',
                  style: text.bodyMedium,
                ),
                const SizedBox(height: Sp.md),
                TextButton.icon(
                  onPressed: _refresh,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Muat ulang'),
                ),
              ],
            ),
          ),
        ],
      );
    }

    final dp =
        moneyValue(booking.pricing, 'dp_amount_idr') ?? booking.dpAmountIdr;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(
          title: 'Bayar DP',
          caption: 'Setelah DP masuk, jadwal langsung dikunci.',
        ),
        const SizedBox(height: Sp.md),
        BookingPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Text('DP', style: text.bodySmall),
                  const Spacer(),
                  Text(
                    rupiah(dp),
                    style: text.titleLarge?.copyWith(
                      fontFeatures: _tabularFigures,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: Sp.md),
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
      ],
    );
  }

  Widget _instructionView(PaymentView view, TextTheme text) {
    final instruction = view.instruction!;
    final expires = _expiryMoment(view);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Bayar DP', style: text.bodySmall),
        const SizedBox(height: 2),
        Text(
          rupiah(view.payment.amountIdr),
          style: text.titleLarge?.copyWith(fontFeatures: _tabularFigures),
        ),
        if (expires != null) ...[
          const SizedBox(height: Sp.md),
          _Countdown(expires: expires),
        ],
        const SizedBox(height: Sp.lg),
        const Divider(height: 1),
        const SizedBox(height: Sp.lg),
        if (instruction.type == 'qris' && instruction.qrString != null)
          _qrisBlock(instruction.qrString!, text)
        else if (instruction.type == 'va' && instruction.vaNumber != null)
          _vaBlock(instruction, text)
        else
          Text(
            'Instruksi pembayaran tidak dikenali. Muat ulang atau pilih metode '
            'lain.',
            style: text.bodyMedium,
          ),
      ],
    );
  }

  DateTime? _expiryMoment(PaymentView view) {
    final iso = view.instruction?.expiresAt ?? view.payment.expiresAt;
    if (iso == null) return null;
    return DateTime.tryParse(iso)?.toLocal();
  }

  Widget _qrisBlock(String qrString, TextTheme text) {
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
          'Scan pakai aplikasi bank yang mendukung QRIS.',
          textAlign: TextAlign.center,
          style: text.bodySmall,
        ),
        const SizedBox(height: Sp.md),
        OutlinedButton.icon(
          onPressed: () => _showQrSheet(qrString, text),
          icon: const Icon(Icons.download_outlined, size: 20),
          label: const Text('Simpan kode QR'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
            foregroundColor: AppColors.primary,
            side: const BorderSide(color: AppColors.line),
          ),
        ),
      ],
    );
  }

  Widget _vaBlock(PaymentInstruction instruction, TextTheme text) {
    final number = instruction.vaNumber!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          (instruction.bank ?? 'Virtual Account').toUpperCase(),
          style: text.labelSmall?.copyWith(color: AppColors.inkMuted),
        ),
        const SizedBox(height: Sp.xs),
        SelectableText(
          number,
          style: text.titleLarge?.copyWith(
            fontFamily: 'monospace',
            fontWeight: FontWeight.w600,
            letterSpacing: 1.1,
            fontFeatures: _tabularFigures,
          ),
        ),
        const SizedBox(height: Sp.md),
        OutlinedButton.icon(
          onPressed: () => _copyText(number, 'Nomor VA disalin.'),
          icon: const Icon(Icons.copy, size: 20),
          label: const Text('Salin nomor VA'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
            foregroundColor: AppColors.primary,
            side: const BorderSide(color: AppColors.line),
          ),
        ),
      ],
    );
  }

  Future<void> _showQrSheet(String qrString, TextTheme text) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.lg)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(Sp.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Simpan kode QR', style: text.titleLarge),
              const SizedBox(height: Sp.lg),
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
                    size: 240,
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
              const SizedBox(height: Sp.lg),
              Text(
                'Screenshot layar ini untuk menyimpan kode QR. Kode ini dipakai '
                'sekali untuk membayar DP.',
                textAlign: TextAlign.center,
                style: text.bodyMedium,
              ),
              const SizedBox(height: Sp.lg),
              PrimaryButton(
                label: 'Tutup',
                onPressed: () => Navigator.pop(sheetContext),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _timeline(BookingView booking, TextTheme text) {
    final lifecycle = booking.lifecycleStatus;
    final dpDone = isDpSettled(booking.paymentStatus);
    final confirmed = {
      'confirmed',
      'in_progress',
      'completed',
    }.contains(lifecycle);
    final eventDone = lifecycle == 'completed';
    final closed = _closedLifecycles.contains(lifecycle);

    final steps = <({String title, String? caption, _StepState state})>[
      (
        title: 'Booking dibuat',
        caption: formatDateIso(booking.createdAt),
        state: _StepState.done,
      ),
      (
        title: 'DP diterima',
        caption: null,
        state: dpDone
            ? _StepState.done
            : closed
            ? _StepState.pending
            : _StepState.active,
      ),
      (
        title: 'Dikonfirmasi vendor',
        caption: null,
        state: confirmed
            ? _StepState.done
            : dpDone && !closed
            ? _StepState.active
            : _StepState.pending,
      ),
      (
        title: 'Acara',
        caption: null,
        state: eventDone
            ? _StepState.done
            : confirmed && !closed
            ? _StepState.active
            : _StepState.pending,
      ),
    ];

    return Column(
      children: [
        for (var index = 0; index < steps.length; index++)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: 24,
                  child: Column(
                    children: [
                      _StepDot(state: steps[index].state),
                      if (index < steps.length - 1)
                        Expanded(
                          child: Container(
                            width: 2,
                            color: steps[index].state == _StepState.done
                                ? AppColors.accent
                                : AppColors.line,
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: Sp.md),
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(
                      bottom: index < steps.length - 1 ? Sp.lg : 0,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                steps[index].title,
                                style: text.titleMedium?.copyWith(
                                  color: switch (steps[index].state) {
                                    _StepState.active => AppColors.primary,
                                    _StepState.done => AppColors.ink,
                                    _StepState.pending => AppColors.inkMuted,
                                  },
                                ),
                              ),
                            ),
                            if (steps[index].state == _StepState.active) ...[
                              const SizedBox(width: Sp.sm),
                              const StatusPill(
                                label: 'Sekarang',
                                tone: PillTone.brand,
                              ),
                            ],
                          ],
                        ),
                        if (steps[index].caption != null) ...[
                          const SizedBox(height: 2),
                          Text(steps[index].caption!, style: text.bodySmall),
                        ],
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

  Widget _detail(BookingView booking, TextTheme text) {
    final slot = booking.slots.isEmpty ? null : booking.slots.first;
    final rows = <({IconData icon, String label, String value})>[
      (
        icon: Icons.storefront_outlined,
        label: 'Vendor',
        value: booking.vendor.displayName,
      ),
      (
        icon: Icons.event_outlined,
        label: 'Tanggal',
        value: formatDateIso(booking.event.startDate),
      ),
      if (slot != null)
        (icon: Icons.schedule, label: 'Sesi', value: sessionText(slot.session)),
      if (booking.event.venueAddress.trim().isNotEmpty)
        (
          icon: Icons.place_outlined,
          label: 'Alamat',
          value: booking.event.venueAddress,
        ),
    ];

    return Column(
      children: [
        for (var index = 0; index < rows.length; index++) ...[
          if (index > 0)
            const Divider(height: Sp.xl, color: AppColors.line, thickness: 1),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(rows[index].icon, size: 18, color: AppColors.inkMuted),
              const SizedBox(width: Sp.md),
              SizedBox(
                width: 64,
                child: Text(rows[index].label, style: text.bodySmall),
              ),
              const SizedBox(width: Sp.sm),
              Expanded(
                child: Text(
                  rows[index].value,
                  style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _actionBar(BookingView booking, TextTheme text) {
    final digits = whatsappDigits(booking.vendor.whatsapp);
    return StickyActionBar(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PrimaryButton(
            label: 'Hubungi vendor (WhatsApp)',
            icon: Icons.chat_outlined,
            onPressed: digits == null ? null : _openWhatsApp,
          ),
          if (_canCancel) ...[
            const SizedBox(height: Sp.sm),
            OutlinedButton.icon(
              onPressed: _cancelBusy ? null : _cancel,
              icon: const Icon(Icons.close, size: 20),
              label: Text(_cancelBusy ? 'Membatalkan…' : 'Batalkan booking'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                foregroundColor: AppColors.danger,
                side: const BorderSide(color: AppColors.danger),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(Radii.sm),
                ),
                textStyle: text.labelLarge?.copyWith(color: AppColors.danger),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

enum _StepState { done, active, pending }

class _StepDot extends StatelessWidget {
  const _StepDot({required this.state});

  final _StepState state;

  @override
  Widget build(BuildContext context) {
    final (background, child) = switch (state) {
      _StepState.done => (
        AppColors.accent,
        const Icon(Icons.check, size: 14, color: AppColors.onPrimary),
      ),
      _StepState.active => (
        AppColors.primary,
        Container(
          width: 8,
          height: 8,
          decoration: const BoxDecoration(
            color: AppColors.onPrimary,
            shape: BoxShape.circle,
          ),
        ),
      ),
      _StepState.pending => (
        AppColors.neutralSoft,
        Container(
          width: 8,
          height: 8,
          decoration: const BoxDecoration(
            color: AppColors.line,
            shape: BoxShape.circle,
          ),
        ),
      ),
    };
    return Container(
      width: 22,
      height: 22,
      decoration: BoxDecoration(color: background, shape: BoxShape.circle),
      child: Center(child: child),
    );
  }
}

class _Countdown extends StatelessWidget {
  const _Countdown({required this.expires});

  final DateTime expires;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final left = expires.difference(DateTime.now());
    final expired = left <= Duration.zero;
    final remaining = expired
        ? 'Waktu pembayaran sudah lewat.'
        : '${left.inHours.toString().padLeft(2, '0')}:'
              '${(left.inMinutes % 60).toString().padLeft(2, '0')}:'
              '${(left.inSeconds % 60).toString().padLeft(2, '0')} lagi';

    return Container(
      padding: const EdgeInsets.all(Sp.md),
      decoration: BoxDecoration(
        color: AppColors.warningSoft,
        borderRadius: BorderRadius.circular(Radii.sm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 1),
            child: Icon(Icons.schedule, size: 18, color: AppColors.warning),
          ),
          const SizedBox(width: Sp.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Selesaikan sebelum ${formatTime(expires)}',
                  style: text.bodyMedium?.copyWith(
                    color: AppColors.warning,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  remaining,
                  style: text.labelSmall?.copyWith(
                    color: AppColors.warning,
                    fontFeatures: _tabularFigures,
                  ),
                ),
              ],
            ),
          ),
        ],
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

class _CancelSheet extends StatefulWidget {
  const _CancelSheet({required this.booking, required this.consequence});

  final BookingView booking;
  final String consequence;

  @override
  State<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends State<_CancelSheet> {
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
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(Sp.xl, Sp.xl, Sp.xl, Sp.xl + bottomInset),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Batalkan booking?', style: text.titleLarge),
            const SizedBox(height: Sp.xs),
            Text(
              '${widget.booking.code} · ${widget.booking.vendor.displayName}',
              style: text.bodySmall,
            ),
            const SizedBox(height: Sp.lg),
            InfoStrip(
              message: widget.consequence,
              icon: Icons.info_outline,
              tone: InfoTone.warning,
            ),
            const SizedBox(height: Sp.lg),
            TextField(
              controller: _reason,
              autofocus: true,
              minLines: 2,
              maxLines: 4,
              maxLength: 500,
              decoration: InputDecoration(
                labelText: 'Alasan pembatalan',
                hintText: 'Tulis alasan minimal 10 karakter',
                errorText: _error,
                counterText: '',
              ),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
            ),
            const SizedBox(height: Sp.sm),
            Row(
              children: [
                Expanded(
                  child: TextButton(
                    onPressed: () => Navigator.pop(context),
                    style: TextButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                    ),
                    child: const Text('Kembali'),
                  ),
                ),
                const SizedBox(width: Sp.sm),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: _submit,
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.danger,
                      foregroundColor: AppColors.onPrimary,
                      minimumSize: const Size.fromHeight(48),
                    ),
                    child: const Text('Batalkan booking'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
