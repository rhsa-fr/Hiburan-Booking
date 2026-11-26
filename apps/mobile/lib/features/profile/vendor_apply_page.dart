import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../app/app.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';
import '../booking/booking_support.dart';
import 'policy_sheet.dart';
import 'vendor_apply_steps.dart';
import 'vendor_apply_support.dart';

/// Gallery picker the wizard uses by default; tests inject their own.
Future<XFile?> pickVendorKtpFromGallery() => ImagePicker().pickImage(
  source: ImageSource.gallery,
  imageQuality: 85,
);

/// FR-002/FR-003: a customer applies to become a vendor through a 5-step
/// wizard gated by the Ketentuan Mitra policy.
///
/// The KTP is uploaded to the private endpoint first; the returned opaque key
/// is what the application body carries. The file never becomes a public
/// `/v1/media` URL.
class VendorApplyPage extends StatefulWidget {
  const VendorApplyPage({super.key, this.pickKtp});

  /// Defaults to the gallery; tests pass a fake so no platform channel opens.
  final Future<XFile?> Function()? pickKtp;

  @override
  State<VendorApplyPage> createState() => _VendorApplyPageState();
}

class _VendorApplyPageState extends State<VendorApplyPage> {
  final _displayName = TextEditingController();
  final _legalName = TextEditingController();
  final _nik = TextEditingController();
  final _address = TextEditingController();
  final _description = TextEditingController();
  final _yearsActive = TextEditingController();
  final _personnelCount = TextEditingController();
  final _equipment = TextEditingController();
  final _portfolio = TextEditingController();
  final _scroll = ScrollController();

  VendorEligibility? _eligibility;
  VendorApplicationView? _application;
  List<VendorRegion> _regions = const [];

  bool _started = false;
  bool _loading = true;
  bool _submitting = false;
  bool _pickingKtp = false;
  bool _wizardOpen = false;
  bool _agreed = false;
  int _step = 1;

  String? _error;
  String? _categorySlug;
  String? _regionCode;
  XFile? _ktp;
  Uint8List? _ktpBytes;
  String? _ktpObjectKey;
  Map<String, String> _errors = const {};
  _Banner? _banner;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _load();
  }

  @override
  void dispose() {
    for (final controller in [
      _displayName,
      _legalName,
      _nik,
      _address,
      _description,
      _yearsActive,
      _personnelCount,
      _equipment,
      _portfolio,
    ]) {
      controller.dispose();
    }
    _scroll.dispose();
    super.dispose();
  }

  VendorApplicationDraft get _draft => VendorApplicationDraft(
    displayName: _displayName.text,
    legalName: _legalName.text,
    nik: _nik.text,
    regionCode: _regionCode,
    baseAddress: _address.text,
    categorySlug: _categorySlug,
    description: _description.text,
    yearsActive: _yearsActive.text,
    personnelCount: _personnelCount.text,
    equipmentSummary: _equipment.text,
    portfolioUrl: _portfolio.text,
  );

  bool get _isDirty =>
      _ktp != null ||
      _categorySlug != null ||
      [
        _displayName,
        _legalName,
        _nik,
        _address,
        _description,
        _yearsActive,
        _personnelCount,
        _equipment,
        _portfolio,
      ].any((controller) => controller.text.trim().isNotEmpty);

  String? get _regionName {
    final code = _regionCode;
    if (code == null) return null;
    for (final region in _regions) {
      if (region.code == code) return region.name;
    }
    return null;
  }

  bool get _canAdvance {
    if (_submitting || _loading) return false;
    if (_step == 1) {
      final eligibility = _eligibility;
      return eligibility != null &&
          eligibility.canSubmit &&
          eligibility.policy != null &&
          _agreed;
    }
    return true;
  }

  Future<void> _load() async {
    final api = AppScope.of(context).api;
    try {
      final results = await Future.wait([
        api.get('/vendor-applications/eligibility'),
        api.get('/regions', auth: false),
      ]);
      if (!mounted) return;
      final eligibility = VendorEligibility.fromJson(asJsonMap(results[0]));
      final regions = asJsonMapList(
        asJsonMap(results[1])['items'],
      ).map(VendorRegion.fromJson).toList(growable: false);
      setState(() {
        _eligibility = eligibility;
        _application = eligibility.application;
        _regions = regions;
        _regionCode ??= regions.isNotEmpty ? regions.first.code : null;
        _wizardOpen = eligibility.application == null;
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

  /// Reloads only the gate after a 409/403, keeping the typed draft intact.
  Future<void> _reloadEligibility() async {
    final api = AppScope.of(context).api;
    try {
      final raw = await api.get('/vendor-applications/eligibility');
      if (!mounted) return;
      final eligibility = VendorEligibility.fromJson(asJsonMap(raw));
      setState(() {
        _eligibility = eligibility;
        if (eligibility.application != null) {
          _application = eligibility.application;
        }
      });
    } on ApiException {
      // The gate copy stays from the previous load; the banner explains the
      // failure the user just hit.
    }
  }

  void _scrollTop() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scroll.hasClients) _scroll.jumpTo(0);
    });
  }

  void _onFieldChanged(String key) {
    setState(() {
      if (_errors.containsKey(key)) {
        _errors = Map<String, String>.from(_errors)..remove(key);
      }
    });
  }

  void _onCategorySelected(String slug) {
    setState(() {
      _categorySlug = slug;
      if (_errors.containsKey('category_slug')) {
        _errors = Map<String, String>.from(_errors)..remove('category_slug');
      }
    });
  }

  void _onAgreedChanged(bool value) {
    setState(() {
      _agreed = value;
      if (value && _errors.containsKey('agreement')) {
        _errors = Map<String, String>.from(_errors)..remove('agreement');
      }
    });
  }

  void _onRegionChanged(String? value) {
    if (value == null) return;
    setState(() {
      _regionCode = value;
      if (_errors.containsKey('region_code')) {
        _errors = Map<String, String>.from(_errors)..remove('region_code');
      }
    });
  }

  Future<void> _pickKtp() async {
    if (_pickingKtp) return;
    setState(() => _pickingKtp = true);
    try {
      final picker = widget.pickKtp ?? pickVendorKtpFromGallery;
      final picked = await picker();
      if (!mounted) return;
      if (picked != null) {
        final bytes = await picked.readAsBytes();
        if (!mounted) return;
        setState(() {
          _ktp = picked;
          _ktpBytes = bytes;
          _ktpObjectKey = null;
          _errors = Map<String, String>.from(_errors)..remove('ktp');
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(
        () => _banner = const _Banner(
          'Gagal membuka galeri. Coba lagi.',
          InfoTone.danger,
        ),
      );
    } finally {
      if (mounted) setState(() => _pickingKtp = false);
    }
  }

  void _openTerms() {
    final policy = _eligibility?.policy;
    if (policy == null) return;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.lg)),
      ),
      builder: (_) => PolicySheet(
        code: policy.code,
        title: 'Ketentuan Mitra',
        preloaded: policy,
      ),
    );
  }

  bool _validateCurrent() {
    final errors = Map<String, String>.from(_draft.validateStep(_step));
    if (_step == 1 && !_agreed) {
      errors['agreement'] = 'Centang persetujuan Ketentuan Mitra dulu.';
    }
    if (_step == 3 && _ktp == null) {
      errors['ktp'] = 'Foto KTP wajib diunggah.';
    }
    setState(() => _errors = errors);
    return errors.isEmpty;
  }

  void _next() {
    if (!_validateCurrent()) return;
    if (_step >= vendorApplyStepCount) return;
    setState(() {
      _step += 1;
      _errors = const {};
    });
    _scrollTop();
  }

  Future<void> _back() async {
    if (_submitting) return;
    if (_wizardOpen && _step > 1) {
      setState(() {
        _step -= 1;
        _errors = const {};
      });
      _scrollTop();
      return;
    }
    await _requestExit();
  }

  void _handleSystemBack() {
    if (_submitting) return;
    if (_wizardOpen && _step > 1) {
      setState(() {
        _step -= 1;
        _errors = const {};
      });
      _scrollTop();
      return;
    }
    unawaited(_requestExit());
  }

  Future<void> _requestExit() async {
    if (!_isDirty) {
      Navigator.of(context).pop();
      return;
    }
    final leave = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Keluar?'),
        content: const Text('Isian tidak disimpan.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: FilledButton.styleFrom(
              minimumSize: const Size(96, 48),
              backgroundColor: AppColors.danger,
              foregroundColor: AppColors.onPrimary,
            ),
            child: const Text('Keluar'),
          ),
        ],
      ),
    );
    if (leave == true && mounted) Navigator.of(context).pop();
  }

  void _startResubmit() {
    final application = _application;
    if (application == null) return;
    final draft = VendorApplicationDraft.fromApplication(application);
    _displayName.text = draft.displayName;
    _legalName.text = draft.legalName;
    _nik.clear();
    _address.text = draft.baseAddress;
    _description.text = draft.description;
    _yearsActive.text = draft.yearsActive;
    _personnelCount.text = draft.personnelCount;
    _equipment.text = draft.equipmentSummary;
    _portfolio.text = draft.portfolioUrl;
    final prefilledRegion = draft.regionCode;
    final regionExists =
        prefilledRegion != null &&
        _regions.any((region) => region.code == prefilledRegion);
    final prefilledCategory = draft.categorySlug;
    final categoryExists =
        prefilledCategory != null &&
        (_eligibility?.categories ?? const <VendorApplicationCategory>[]).any(
          (category) => category.slug == prefilledCategory,
        );
    setState(() {
      _wizardOpen = true;
      _step = 1;
      _agreed = false;
      _errors = const {};
      _banner = null;
      _categorySlug = categoryExists ? prefilledCategory : null;
      if (regionExists) _regionCode = prefilledRegion;
      _ktp = null;
      _ktpBytes = null;
      _ktpObjectKey = null;
    });
    _scrollTop();
  }

  int _firstFailingStep(Map<String, String> errors, bool ktpMissing) {
    const profileKeys = {
      'display_name',
      'category_slug',
      'description',
      'years_active',
      'personnel_count',
    };
    const legalityKeys = {'legal_name', 'nik', 'region_code', 'base_address'};
    if (errors.keys.any(profileKeys.contains)) return 2;
    if (ktpMissing || errors.keys.any(legalityKeys.contains)) return 3;
    return 4;
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final errors = _draft.validateAll();
    final ktpMissing = _ktp == null;
    if (errors.isNotEmpty || ktpMissing) {
      final failing = _firstFailingStep(errors, ktpMissing);
      setState(() {
        _errors = {
          ...errors,
          if (ktpMissing) 'ktp': 'Foto KTP wajib diunggah.',
        };
        _step = failing;
      });
      _scrollTop();
      return;
    }
    final policy = _eligibility?.policy;
    if (policy == null) {
      setState(
        () => _banner = const _Banner(
          'Ketentuan Mitra belum tersedia. Muat ulang lalu coba lagi.',
          InfoTone.warning,
        ),
      );
      return;
    }

    final api = AppScope.of(context).api;
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _submitting = true;
      _banner = null;
    });
    try {
      var key = _ktpObjectKey;
      if (key == null || key.isEmpty) {
        final bytes = _ktpBytes ?? await _ktp!.readAsBytes();
        final upload = asJsonMap(
          await api.uploadFile(
            '/vendor-applications/ktp',
            filename: _ktp!.name,
            bytes: bytes,
          ),
        );
        final uploaded = upload['ktp_object_key'];
        if (uploaded is! String || uploaded.isEmpty) {
          throw const ApiException(
            code: 'INTERNAL_ERROR',
            message: 'Unggahan KTP tidak menghasilkan kunci.',
          );
        }
        key = uploaded;
        // A retry after a network failure must not upload the same private
        // file twice; the key stays valid until the 24h cleanup.
        _ktpObjectKey = key;
      }
      final created = await api.post(
        '/vendor-applications',
        body: {..._draft.toJson(policy.id), 'ktp_object_key': key},
      );
      if (!mounted) return;
      setState(() {
        _application = VendorApplicationView.fromJson(asJsonMap(created));
        _wizardOpen = false;
        _submitting = false;
        _errors = const {};
        _banner = null;
        _ktpObjectKey = null;
      });
      messenger.showSnackBar(
        const SnackBar(content: Text('Pengajuan vendor terkirim.')),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      await _handleSubmitError(error, messenger);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _banner = const _Banner(
          'Tidak bisa mengirim pengajuan. Isian tetap di sini — coba lagi.',
          InfoTone.danger,
        );
      });
    }
  }

  Future<void> _handleSubmitError(
    ApiException error,
    ScaffoldMessengerState messenger,
  ) async {
    switch (classifyVendorSubmitError(error)) {
      case VendorSubmitFailure.policyStale:
        await _reloadEligibility();
        if (!mounted) return;
        setState(() {
          _submitting = false;
          _step = 1;
          _agreed = false;
          _errors = const {};
          _banner = const _Banner(
            'Ketentuan Mitra diperbarui. Baca ulang, lalu setujui versi '
            'terbaru sebelum mengirim.',
            InfoTone.warning,
          );
        });
        _scrollTop();
      case VendorSubmitFailure.applicationOpen:
        await _reloadEligibility();
        if (!mounted) return;
        setState(() {
          _submitting = false;
          _wizardOpen = false;
          _banner = null;
        });
        messenger.showSnackBar(
          const SnackBar(
            content: Text('Pengajuan sebelumnya masih diproses admin.'),
          ),
        );
      case VendorSubmitFailure.emailNotVerified:
        await _reloadEligibility();
        if (!mounted) return;
        setState(() {
          _submitting = false;
          _step = 1;
          _errors = const {};
          _banner = _Banner(
            error.message.trim().isEmpty
                ? 'Verifikasi email dulu sebelum mengirim pengajuan.'
                : error.message,
            InfoTone.danger,
          );
        });
        _scrollTop();
      case VendorSubmitFailure.categoryInvalid:
        setState(() {
          _submitting = false;
          _step = 2;
          _errors = const {
            'category_slug': 'Kategori ini sudah tidak aktif. Pilih kategori lain.',
          };
          _banner = null;
        });
        _scrollTop();
      case VendorSubmitFailure.regionInvalid:
        setState(() {
          _submitting = false;
          _step = 3;
          _errors = const {
            'region_code': 'Wilayah ini sudah tidak aktif. Pilih wilayah lain.',
          };
          _banner = null;
        });
        _scrollTop();
      case VendorSubmitFailure.resubmitLimit:
        final retry = vendorRetryAfterText(error);
        setState(() {
          _submitting = false;
          _banner = _Banner(
            'Batas pengajuan ulang tercapai.${retry == null ? '' : ' $retry'}',
            InfoTone.warning,
          );
        });
      case VendorSubmitFailure.retryable:
        setState(() {
          _submitting = false;
          _banner = const _Banner(
            'Koneksi ke server gagal. Isian tetap di sini — tekan kirim lagi.',
            InfoTone.danger,
          );
        });
      case VendorSubmitFailure.other:
        setState(() {
          _submitting = false;
          _banner = _Banner(apiMessage(error), InfoTone.danger);
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final showWizard = _wizardOpen && !_loading && _error == null;
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        _handleSystemBack();
      },
      child: Scaffold(
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            StageHeader.back(
              context: context,
              title: 'Daftar jadi vendor',
              onBack: () => _back(),
            ),
            if (showWizard) _progress(context),
            Expanded(child: _body(context, bottomInset)),
          ],
        ),
        bottomNavigationBar: showWizard ? _bottomBar(context) : null,
      ),
    );
  }

  Widget _progress(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final active = AppColors.isDark ? AppColors.limeDark : AppColors.primary;
    return Padding(
      padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, 0),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Langkah $_step dari $vendorApplyStepCount · '
                '${vendorApplyStepTitles[_step - 1]}',
                style: text.labelMedium?.copyWith(
                  color: AppColors.ink,
                  fontWeight: FontWeight.w700,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: Sp.sm),
              Row(
                children: [
                  for (var index = 0; index < vendorApplyStepCount; index++) ...[
                    if (index > 0) const SizedBox(width: Sp.xs),
                    Expanded(
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        curve: Curves.easeOut,
                        height: 4,
                        decoration: BoxDecoration(
                          color: index < _step ? active : AppColors.line,
                          borderRadius: BorderRadius.circular(Radii.pill),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, double bottomInset) {
    if (_loading) {
      return const AppLoading(label: 'Memuat pengajuan');
    }
    final error = _error;
    if (error != null) {
      return AppError(message: error, onRetry: _retry);
    }
    final banner = _banner;
    return SingleChildScrollView(
      controller: _scroll,
      padding: EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, Sp.xxl + bottomInset),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (banner != null) ...[
                InfoStrip(
                  message: banner.message,
                  icon: _bannerIcon(banner.tone),
                  tone: banner.tone,
                ),
                const SizedBox(height: Sp.lg),
              ],
              if (!_wizardOpen) _statusCard(context) else _stepBody(context),
            ],
          ),
        ),
      ),
    );
  }

  IconData _bannerIcon(InfoTone tone) => switch (tone) {
    InfoTone.danger => Icons.error_outline,
    InfoTone.warning => Icons.info_outline,
    InfoTone.success => Icons.check_circle_outline,
    _ => Icons.shield_outlined,
  };

  Widget _stepBody(BuildContext context) {
    final eligibility = _eligibility;
    if (eligibility == null) return const SizedBox.shrink();
    switch (_step) {
      case 1:
        return VendorTermsStep(
          eligibility: eligibility,
          agreed: _agreed,
          agreementError: _errors['agreement'],
          onAgreedChanged: _onAgreedChanged,
          onReadTerms: _openTerms,
        );
      case 2:
        return VendorProfileStep(
          displayName: _displayName,
          categories: eligibility.categories,
          categorySlug: _categorySlug,
          description: _description,
          yearsActive: _yearsActive,
          personnelCount: _personnelCount,
          errors: _errors,
          onCategorySelected: _onCategorySelected,
          onFieldChanged: _onFieldChanged,
        );
      case 3:
        return VendorLegalityStep(
          legalName: _legalName,
          nik: _nik,
          address: _address,
          regions: _regions,
          regionCode: _regionCode,
          errors: _errors,
          ktpBytes: _ktpBytes,
          ktpName: _ktp?.name,
          pickingKtp: _pickingKtp,
          onRegionChanged: _onRegionChanged,
          onPickKtp: _pickKtp,
          onFieldChanged: _onFieldChanged,
        );
      case 4:
        return VendorOperationsStep(
          equipmentSummary: _equipment,
          portfolioUrl: _portfolio,
          errors: _errors,
          onFieldChanged: _onFieldChanged,
        );
      default:
        return VendorReviewStep(
          draft: _draft,
          agreed: _agreed,
          policyVersion: eligibility.policy?.version,
          categoryName: eligibility.categoryName,
          regionName: _regionName,
          ktpReady: _ktp != null,
          onEditStep: (step) {
            setState(() {
              _step = step;
              _errors = const {};
            });
            _scrollTop();
          },
        );
    }
  }

  Widget _statusCard(BuildContext context) {
    final application = _application;
    final rawStatus = application?.status.trim() ?? '';
    final status = rawStatus.isEmpty ? 'submitted' : rawStatus;
    final labels = {
      'submitted': 'Menunggu pemeriksaan admin',
      'approved': 'Disetujui',
      'rejected': 'Ditolak',
      'draft': 'Draf pengajuan',
    };
    final tone = status == 'approved'
        ? InfoTone.success
        : status == 'rejected'
        ? InfoTone.danger
        : InfoTone.warning;
    final icon = status == 'approved'
        ? Icons.verified_outlined
        : status == 'rejected'
        ? Icons.cancel_outlined
        : Icons.hourglass_empty;
    final text = Theme.of(context).textTheme;
    final note = application?.reviewNote;
    final name = application?.displayName.trim() ?? '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InfoStrip(
          message: labels[status] ?? status,
          icon: icon,
          tone: tone,
        ),
        if (name.isNotEmpty) ...[
          const SizedBox(height: Sp.md),
          Text(
            'Pengajuan: $name',
            style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
          ),
        ],
        if (note != null && note.trim().isNotEmpty) ...[
          const SizedBox(height: Sp.md),
          Text(
            'Catatan admin: ${note.trim()}',
            style: text.bodyMedium?.copyWith(height: 1.5),
          ),
        ],
        if (status == 'rejected') ...[
          const SizedBox(height: Sp.lg),
          FilledButton(
            onPressed: _startResubmit,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
            ),
            child: const Text('Ajukan ulang'),
          ),
          const SizedBox(height: Sp.sm),
          Text(
            'NIK dan foto KTP tidak ditampilkan server. Isi ulang NIK dan '
            'unggah ulang foto KTP saat mengajukan kembali.',
            style: text.bodySmall?.copyWith(
              color: AppColors.inkMuted,
              height: 1.45,
            ),
          ),
        ],
      ],
    );
  }

  Widget _bottomBar(BuildContext context) {
    return StickyActionBar(
      leading: OutlinedButton(
        onPressed: _submitting ? null : () => _back(),
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          foregroundColor: AppColors.ink,
          side: BorderSide(color: AppColors.line),
        ),
        child: const Text('Kembali'),
      ),
      child: FilledButton(
        onPressed: _canAdvance
            ? (_step == vendorApplyStepCount ? _submit : _next)
            : null,
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
        child: _submitting
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Text(
                _step == vendorApplyStepCount ? 'Kirim pengajuan' : 'Lanjut',
              ),
      ),
    );
  }
}

class _Banner {
  const _Banner(this.message, this.tone);

  final String message;
  final InfoTone tone;
}
