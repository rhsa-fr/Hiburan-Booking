import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../app/app.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';
import '../booking/booking_support.dart';

const _targetLabels = {
  'review': 'Ulasan',
  'chat_message': 'Pesan chat',
  'vendor_media': 'Media vendor',
};

const _reasonLabels = {
  'spam': 'Spam',
  'harassment': 'Pelecehan',
  'fraud': 'Penipuan',
  'illegal': 'Konten ilegal',
  'copyright': 'Hak cipta',
  'impersonation': 'Peniruan identitas',
  'other': 'Lainnya',
};

/// Batas server: bukti banding disimpan sebagai gambar, divalidasi dari magic
/// bytes di backend. Klien hanya menyaring ukuran supaya unggahan tidak
/// dipotong di tengah jalan.
const int maxAppealEvidenceBytes = 5 * 1024 * 1024;

/// Berkas yang sudah dipilih pengguna, sebelum dikirim ke server.
class AppealEvidencePick {
  const AppealEvidencePick({required this.filename, required this.bytes});

  final String filename;
  final List<int> bytes;
}

/// Dipisah dari widget supaya test bisa mengganti galeri dengan berkas palsu.
typedef AppealEvidencePicker = Future<AppealEvidencePick?> Function();

Future<AppealEvidencePick?> pickAppealEvidenceFromGallery() async {
  final picked = await ImagePicker().pickImage(
    source: ImageSource.gallery,
    maxWidth: 1600,
    imageQuality: 80,
  );
  if (picked == null) return null;
  return AppealEvidencePick(
    filename: picked.name,
    bytes: await picked.readAsBytes(),
  );
}

/// FR-124: daftar konten milik pengguna yang diturunkan + pengajuan banding.
class AppealsPage extends StatefulWidget {
  const AppealsPage({super.key, this.pickEvidence = pickAppealEvidenceFromGallery});

  /// Galeri default; test mengganti ini dengan berkas palsu.
  final AppealEvidencePicker pickEvidence;

  @override
  State<AppealsPage> createState() => _AppealsPageState();
}

class _AppealsPageState extends State<AppealsPage> {
  List<OwnedTakedown> _items = const [];
  bool _loading = true;
  String? _error;
  String? _uploadingReportId;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_loading && _items.isEmpty && _error == null) {
      _load();
    }
  }

  Future<void> _load() async {
    final api = AppScope.of(context).api;
    try {
      final raw = await api.get(
        '/reports/against-me',
        query: const {'page': '1', 'page_size': '50'},
      );
      final data = raw is Map ? raw : null;
      if (data is! Map) {
        throw const ApiException(
          code: 'INTERNAL_ERROR',
          message: 'Daftar banding tidak lengkap.',
        );
      }
      final page = PageResult<OwnedTakedown>.fromJson(
        data.cast<String, dynamic>(),
        OwnedTakedown.fromJson,
      );
      if (!mounted) return;
      setState(() {
        _items = page.items;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = apiMessage(error);
      });
    }
  }

  Future<void> _retry() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    await _load();
  }

  Future<void> _appeal(OwnedTakedown item) async {
    final submitted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.lg)),
      ),
      builder: (_) => _AppealSheet(takedown: item),
    );
    if (submitted != true || !mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Banding terkirim. Admin akan meninjau keputusanmu.'),
      ),
    );
    await _load();
  }

  /// Melampirkan satu berkas bukti privat ke banding yang masih `pending`.
  Future<void> _attachEvidence(OwnedTakedown item) async {
    if (_uploadingReportId != null) return;
    final api = AppScope.of(context).api;
    AppealEvidencePick? picked;
    try {
      picked = await widget.pickEvidence();
    } catch (_) {
      if (!mounted) return;
      _showMessage('Tidak bisa membuka galeri. Coba lagi.');
      return;
    }
    if (picked == null || !mounted) return;
    if (picked.bytes.length > maxAppealEvidenceBytes) {
      _showMessage('Ukuran gambar maksimal 5 MB.');
      return;
    }

    setState(() => _uploadingReportId = item.reportId);
    try {
      await api.uploadFile(
        '/reports/${item.reportId}/appeal/evidence',
        filename: picked.filename,
        bytes: picked.bytes,
      );
      if (!mounted) return;
      _showMessage(
        'Bukti berkas terlampir. Hanya kamu dan admin yang bisa melihatnya.',
      );
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      _showMessage(apiMessage(error));
    } finally {
      if (mounted) setState(() => _uploadingReportId = null);
    }
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Banding konten')),
      body: _loading
          ? const AppLoading(rows: 4, label: 'Memuat konten diturunkan')
          : _error != null
          ? AppError(message: _error!, onRetry: _retry)
          : _items.isEmpty
          ? const AppEmpty(
              message:
                  'Belum ada kontenmu yang diturunkan. Kalau konten diturunkan, '
                  'kamu bisa mengajukan banding di sini.',
              icon: Icons.gavel_outlined,
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(Sp.lg),
                children: [
                  InfoStrip(
                    message:
                        'Banding berlaku maksimal 30 hari setelah konten diturunkan. '
                        'Keputusan admin bersifat final.',
                    icon: Icons.gavel_outlined,
                  ),
                  const SizedBox(height: Sp.lg),
                  const SectionHeader(title: 'Konten yang diturunkan'),
                  const SizedBox(height: Sp.md),
                  for (final item in _items) ...[
                    _TakedownCard(
                      item: item,
                      onAppeal: _appeal,
                      onAttachEvidence: _attachEvidence,
                      uploading: _uploadingReportId == item.reportId,
                    ),
                    const SizedBox(height: Sp.md),
                  ],
                ],
              ),
            ),
    );
  }
}

class _TakedownCard extends StatelessWidget {
  const _TakedownCard({
    required this.item,
    required this.onAppeal,
    required this.onAttachEvidence,
    required this.uploading,
  });

  final OwnedTakedown item;
  final Future<void> Function(OwnedTakedown) onAppeal;
  final Future<void> Function(OwnedTakedown) onAttachEvidence;
  final bool uploading;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final status = item.appealStatus;
    final deadlinePassed = !item.canAppeal && !item.hasAppeal;
    return Material(
      color: AppColors.card,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        side: const BorderSide(color: AppColors.line),
      ),
      child: Padding(
        padding: const EdgeInsets.all(Sp.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _targetLabels[item.targetType] ?? 'Konten',
                    style: text.titleMedium,
                  ),
                ),
                if (status != null)
                  StatusPill(
                    label: switch (status) {
                      'accepted' => 'Diterima',
                      'rejected' => 'Ditolak',
                      _ => 'Menunggu',
                    },
                    tone: switch (status) {
                      'accepted' => PillTone.success,
                      'rejected' => PillTone.neutral,
                      _ => PillTone.warning,
                    },
                  ),
              ],
            ),
            const SizedBox(height: Sp.xs),
            Text(
              'Alasan: ${_reasonLabels[item.reason] ?? item.reason} · '
              'diturunkan ${formatDateIso(item.resolvedAt)}',
              style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
            ),
            if (item.hasAppeal) ...[
              const SizedBox(height: Sp.sm),
              Text(
                item.appealDecisionNote ??
                    'Banding sedang ditinjau admin. Kamu akan menerima notifikasi.',
                style: text.bodyMedium,
              ),
              if (status == 'pending') ...[
                const SizedBox(height: Sp.md),
                Text(
                  item.hasEvidenceFile
                      ? 'Bukti berkas: terlampir.'
                      : 'Belum ada bukti berkas. Bukti hanya terlihat olehmu dan admin.',
                  style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
                ),
                const SizedBox(height: Sp.sm),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: uploading ? null : () => onAttachEvidence(item),
                    icon: uploading
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.attach_file, size: 18),
                    label: Text(
                      uploading
                          ? 'Mengunggah…'
                          : item.hasEvidenceFile
                          ? 'Ganti bukti berkas'
                          : 'Lampirkan bukti berkas',
                    ),
                  ),
                ),
                const SizedBox(height: Sp.xs),
                Text(
                  'JPG, PNG, atau WebP · maksimal 5 MB.',
                  style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
                ),
              ],
            ] else if (deadlinePassed) ...[
              const SizedBox(height: Sp.sm),
              Text(
                'Batas banding sudah lewat.',
                style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
              ),
            ] else ...[
              const SizedBox(height: Sp.sm),
              Text(
                'Batas banding ${formatDateIso(item.appealDeadlineAt)}.',
                style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
              ),
              const SizedBox(height: Sp.md),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => onAppeal(item),
                  icon: const Icon(Icons.gavel_outlined, size: 18),
                  label: const Text('Ajukan banding'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _AppealSheet extends StatefulWidget {
  const _AppealSheet({required this.takedown});

  final OwnedTakedown takedown;

  @override
  State<_AppealSheet> createState() => _AppealSheetState();
}

class _AppealSheetState extends State<_AppealSheet> {
  final _reason = TextEditingController();
  final _evidence = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    _evidence.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final reason = _reason.text.trim();
    if (reason.length < 20) {
      setState(() => _error = 'Alasan banding minimal 20 karakter.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    final api = AppScope.of(context).api;
    try {
      await api.post(
        '/reports/${widget.takedown.reportId}/appeal',
        body: {
          'reason': reason,
          if (_evidence.text.trim().isNotEmpty)
            'evidence_url': _evidence.text.trim(),
        },
      );
      if (!mounted) return;
      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = apiMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        Sp.lg,
        Sp.lg,
        Sp.lg,
        Sp.lg + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Ajukan banding', style: text.titleLarge),
            const SizedBox(height: Sp.xs),
            Text(
              'Jelaskan mengapa konten ini tidak melanggar. Sertakan tautan '
              'pendukung bila ada; berkas gambar bisa dilampirkan setelah '
              'banding terkirim.',
              style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
            ),
            const SizedBox(height: Sp.lg),
            TextField(
              controller: _reason,
              minLines: 4,
              maxLines: 7,
              maxLength: 2000,
              textInputAction: TextInputAction.newline,
              decoration: const InputDecoration(
                labelText: 'Alasan banding',
                hintText: 'Contoh: konten ini saya buat sendiri dan tidak melanggar hak cipta.',
              ),
            ),
            const SizedBox(height: Sp.md),
            TextField(
              controller: _evidence,
              keyboardType: TextInputType.url,
              textInputAction: TextInputAction.done,
              decoration: const InputDecoration(
                labelText: 'Tautan bukti (opsional)',
                hintText: 'https://...',
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: Sp.md),
              AppError(message: _error!, compact: true),
            ],
            const SizedBox(height: Sp.lg),
            PrimaryButton(
              label: 'Kirim banding',
              onPressed: _submitting ? null : _submit,
              loading: _submitting,
              loadingLabel: 'Mengirim…',
            ),
            const SizedBox(height: Sp.sm),
            TextButton(
              onPressed: _submitting ? null : () => Navigator.pop(context, false),
              child: const Text('Batal'),
            ),
          ],
        ),
      ),
    );
  }
}
