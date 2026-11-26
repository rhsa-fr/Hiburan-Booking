import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/theme.dart';
import '../../core/api_client.dart';
import '../../core/api_exception.dart';

/// FR-123: jenis konten yang bisa dilaporkan dari dalam aplikasi.
///
/// Nilai `wireValue` harus sama dengan CHECK di migrasi `027_content_reports`;
/// kalau salah satu berubah, keduanya harus berubah bersama.
enum ReportTargetKind {
  vendor('vendor', 'vendor'),
  review('review', 'ulasan'),
  chatMessage('chat_message', 'pesan chat'),
  vendorMedia('vendor_media', 'media vendor');

  const ReportTargetKind(this.wireValue, this.label);

  final String wireValue;
  final String label;
}

class _Reason {
  const _Reason(this.value, this.label);

  final String value;
  final String label;
}

const List<_Reason> _reasons = <_Reason>[
  _Reason('spam', 'Spam atau promosi'),
  _Reason('harassment', 'Pelecehan atau ancaman'),
  _Reason('fraud', 'Penipuan atau minta transfer di luar platform'),
  _Reason('illegal', 'Konten ilegal'),
  _Reason('copyright', 'Pelanggaran hak cipta'),
  _Reason('impersonation', 'Peniruan identitas'),
  _Reason('other', 'Lainnya'),
];

const int _minDetailLength = 10;

/// Lembar pelaporan konten. Mengembalikan `true` bila laporan terkirim.
///
/// Alurnya dua ketukan (Laporkan → Kirim), jadi masih di bawah batas tiga
/// ketukan yang diminta FR-123.
Future<bool> showReportSheet(
  BuildContext context, {
  required ReportTargetKind targetKind,
  required String targetId,
  String? targetLabel,
  String? bookingId,
}) async {
  final api = AppScope.of(context).api;
  final submitted = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: AppColors.card,
    builder: (sheetContext) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
      ),
      child: _ReportSheet(
        api: api,
        targetKind: targetKind,
        targetId: targetId,
        targetLabel: targetLabel,
        bookingId: bookingId,
      ),
    ),
  );

  if (submitted == true) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Laporan terkirim. Admin meninjau maksimal 1×24 jam dan statusnya bisa kamu lihat di sini lagi.',
          ),
        ),
      );
    }
    return true;
  }
  return false;
}

class _ReportSheet extends StatefulWidget {
  const _ReportSheet({
    required this.api,
    required this.targetKind,
    required this.targetId,
    this.targetLabel,
    this.bookingId,
  });

  final ApiClient api;
  final ReportTargetKind targetKind;
  final String targetId;
  final String? targetLabel;
  final String? bookingId;

  @override
  State<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends State<_ReportSheet> {
  final _detail = TextEditingController();
  String _reason = _reasons.first.value;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _detail.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final detail = _detail.text.trim();
    if (detail.length < _minDetailLength) {
      setState(() {
        _error = 'Tulis kronologi singkat, minimal $_minDetailLength karakter.';
      });
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await widget.api.post(
        '/reports',
        body: <String, Object?>{
          'target_type': widget.targetKind.wireValue,
          'target_id': widget.targetId,
          'reason': _reason,
          'detail': detail,
          if (widget.bookingId != null) 'booking_id': widget.bookingId,
        },
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final label = widget.targetLabel?.trim();

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.lg, Sp.lg, Sp.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Laporkan ${widget.targetKind.label}',
            style: text.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          if (label != null && label.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
              ),
            ),
          const SizedBox(height: Sp.md),
          DropdownButtonFormField<String>(
            initialValue: _reason,
            decoration: const InputDecoration(labelText: 'Alasan'),
            items: [
              for (final reason in _reasons)
                DropdownMenuItem<String>(
                  value: reason.value,
                  child: Text(reason.label),
                ),
            ],
            onChanged: _busy
                ? null
                : (value) {
                    if (value == null) return;
                    setState(() => _reason = value);
                  },
          ),
          const SizedBox(height: Sp.md),
          TextField(
            controller: _detail,
            minLines: 3,
            maxLines: 6,
            maxLength: 2000,
            enabled: !_busy,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'Apa yang terjadi?',
              hintText:
                  'Sebutkan tanggal, apa yang diminta, dan bukti yang kamu punya.',
              counterText: '',
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: Sp.sm),
            Text(
              _error!,
              style: text.bodySmall?.copyWith(color: AppColors.danger),
            ),
          ],
          const SizedBox(height: Sp.md),
          Text(
            'Laporan palsu bisa membuat akunmu dibatasi. Data yang kamu kirim '
            'hanya dibaca moderator.',
            style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
          ),
          const SizedBox(height: Sp.md),
          ElevatedButton(
            onPressed: _busy ? null : _submit,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.lime,
              foregroundColor: AppColors.onLime,
              minimumSize: const Size.fromHeight(48),
            ),
            child: Text(_busy ? 'Mengirim…' : 'Kirim laporan'),
          ),
          const SizedBox(height: Sp.sm),
          TextButton(
            onPressed: _busy ? null : () => Navigator.of(context).pop(false),
            child: const Text('Batal'),
          ),
        ],
      ),
    );
  }
}

/// FR-142: minta konfirmasi lalu blokir pengguna. Mengembalikan `true` bila
/// blokir tersimpan, supaya pemanggil bisa memuat ulang daftar pesan.
Future<bool> confirmAndBlockUser(
  BuildContext context, {
  required String userId,
  String? name,
}) async {
  final api = AppScope.of(context).api;
  final label = (name ?? '').trim();
  final messenger = ScaffoldMessenger.of(context);

  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Blokir pengguna ini?'),
      content: Text(
        'Pesan dari ${label.isEmpty ? 'pengguna ini' : label} tidak akan '
        'ditampilkan lagi di chat. Booking dan pembayaran yang sudah berjalan '
        'tidak terpengaruh.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Batal'),
        ),
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: const Text('Blokir'),
        ),
      ],
    ),
  );

  if (confirmed != true) return false;

  try {
    await api.post('/blocks', body: <String, Object?>{'user_id': userId});
    messenger.showSnackBar(
      const SnackBar(content: Text('Pengguna diblokir.')),
    );
    return true;
  } on ApiException catch (error) {
    messenger.showSnackBar(SnackBar(content: Text(error.message)));
    return false;
  }
}
