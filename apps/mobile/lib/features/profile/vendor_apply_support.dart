/// Pure model + validation layer for the vendor application wizard.
///
/// No Flutter widgets live here: the wizard host, the step widgets, and the
/// unit tests all share these parsers, validators, and the JSON mapper, so the
/// 5-step form and the frozen `POST /vendor-applications` body never drift.
library;

import '../../core/api_exception.dart';
import '../../core/models.dart';

/// Judul langkah; indeks 0 = langkah 1.
const vendorApplyStepTitles = <String>[
  'Ketentuan Mitra',
  'Profil grup',
  'Legalitas',
  'Operasional',
  'Ringkasan',
];

const int vendorApplyStepCount = 5;

const int vendorDescriptionMin = 40;
const int vendorDescriptionMax = 1000;
const int vendorEquipmentMin = 20;
const int vendorEquipmentMax = 1000;
const int vendorPortfolioMax = 300;
const int vendorYearsActiveMax = 80;
const int vendorPersonnelMax = 1000;

const _nikPattern = r'^[0-9]{16}$';

Map<String, dynamic> asJsonMap(dynamic value) =>
    value is Map ? value.cast<String, dynamic>() : const <String, dynamic>{};

List<Map<String, dynamic>> asJsonMapList(dynamic value) => value is List
    ? value.whereType<Map>().map((row) => row.cast<String, dynamic>()).toList(
        growable: false,
      )
    : const <Map<String, dynamic>>[];

String _string(dynamic value) => value?.toString().trim() ?? '';

String? _stringOrNull(dynamic value) {
  final text = _string(value);
  return text.isEmpty ? null : text;
}

int? _intOrNull(dynamic value) {
  if (value is num) return value.toInt();
  if (value == null) return null;
  return int.tryParse('$value'.trim());
}

/// One blocking reason from `GET /vendor-applications/eligibility`.
class VendorBlocker {
  const VendorBlocker({required this.code, required this.message});

  factory VendorBlocker.fromJson(Map<String, dynamic> json) => VendorBlocker(
    code: _string(json['code']),
    message: _string(json['message']),
  );

  final String code;
  final String message;

  /// Server copy when present; a readable Indonesian fallback otherwise so a
  /// blocked account never sees a raw enum.
  String get label {
    if (message.isNotEmpty) return message;
    return switch (code) {
      'ACCOUNT_INACTIVE' => 'Akun kamu belum aktif.',
      'NAME_MISSING' => 'Lengkapi nama di profil sebelum mengajukan.',
      'PHONE_MISSING' => 'Lengkapi nomor WhatsApp di profil.',
      'EMAIL_NOT_VERIFIED' => 'Verifikasi email kamu dulu.',
      'VENDOR_ACCOUNT_EXISTS' => 'Akun ini sudah terdaftar sebagai vendor.',
      'APPLICATION_OPEN' => 'Pengajuan sebelumnya masih diproses admin.',
      'POLICY_UNAVAILABLE' => 'Ketentuan Mitra belum tersedia. Coba lagi nanti.',
      _ => 'Akun ini belum memenuhi syarat pengajuan vendor.',
    };
  }
}

/// Account summary the eligibility endpoint returns for the gate copy.
class VendorApplicantAccount {
  const VendorApplicantAccount({
    this.name,
    this.phone,
    this.email,
    this.emailVerified = false,
  });

  factory VendorApplicantAccount.fromJson(Map<String, dynamic> json) =>
      VendorApplicantAccount(
        name: _stringOrNull(json['name']),
        phone: _stringOrNull(json['phone']),
        email: _stringOrNull(json['email']),
        emailVerified: json['email_verified'] == true,
      );

  final String? name;
  final String? phone;
  final String? email;
  final bool emailVerified;

  String get displayEmail => email ?? 'email belum diisi';
}

/// Category chip in step 2.
class VendorApplicationCategory {
  const VendorApplicationCategory({required this.slug, required this.name});

  factory VendorApplicationCategory.fromJson(Map<String, dynamic> json) =>
      VendorApplicationCategory(
        slug: _string(json['slug']),
        name: _string(json['name']),
      );

  final String slug;
  final String name;
}

/// One region row for the step-3 dropdown.
class VendorRegion {
  const VendorRegion({required this.code, required this.name, this.level});

  factory VendorRegion.fromJson(Map<String, dynamic> json) => VendorRegion(
    code: _string(json['code']),
    name: _string(json['name']),
    level: _stringOrNull(json['level']),
  );

  final String code;
  final String name;
  final String? level;
}

/// `GET /vendor-applications/me` and the `application` field of eligibility.
///
/// `nik` is masked by the server, so the wizard keeps it blank on resubmit and
/// asks for the 16 digits again.
class VendorApplicationView {
  const VendorApplicationView({
    required this.id,
    required this.status,
    required this.displayName,
    required this.legalName,
    required this.nik,
    required this.regionCode,
    required this.baseAddress,
    this.categorySlug,
    this.categoryName,
    this.description,
    this.yearsActive,
    this.personnelCount,
    this.equipmentSummary,
    this.portfolioUrl,
    this.formVersion,
    this.agreementVersion,
    this.reviewNote,
    this.vendorId,
    this.createdAt,
    this.reviewedAt,
  });

  factory VendorApplicationView.fromJson(Map<String, dynamic> json) =>
      VendorApplicationView(
        id: _string(json['id']),
        status: _string(json['status']),
        displayName: _string(json['display_name']),
        legalName: _string(json['legal_name']),
        nik: _string(json['nik']),
        regionCode: _string(json['region_code']),
        baseAddress: _string(json['base_address']),
        categorySlug: _stringOrNull(json['category_slug']),
        categoryName: _stringOrNull(json['category_name']),
        description: _stringOrNull(json['description']),
        yearsActive: _intOrNull(json['years_active']),
        personnelCount: _intOrNull(json['personnel_count']),
        equipmentSummary: _stringOrNull(json['equipment_summary']),
        portfolioUrl: _stringOrNull(json['portfolio_url']),
        formVersion: _intOrNull(json['form_version']),
        agreementVersion: _intOrNull(json['agreement_version']),
        reviewNote: _stringOrNull(json['review_note']),
        vendorId: _stringOrNull(json['vendor_id']),
        createdAt: _stringOrNull(json['created_at']),
        reviewedAt: _stringOrNull(json['reviewed_at']),
      );

  final String id;
  final String status;
  final String displayName;
  final String legalName;
  final String nik;
  final String regionCode;
  final String baseAddress;
  final String? categorySlug;
  final String? categoryName;
  final String? description;
  final int? yearsActive;
  final int? personnelCount;
  final String? equipmentSummary;
  final String? portfolioUrl;
  final int? formVersion;
  final int? agreementVersion;
  final String? reviewNote;
  final String? vendorId;
  final String? createdAt;
  final String? reviewedAt;

  bool get isRejected => status == 'rejected';
  bool get isApproved => status == 'approved';
  bool get isOpen => status == 'submitted' || status == 'draft';
}

/// `GET /vendor-applications/eligibility` as a typed value.
class VendorEligibility {
  const VendorEligibility({
    required this.canSubmit,
    required this.blockers,
    required this.account,
    required this.categories,
    this.application,
    this.policy,
  });

  factory VendorEligibility.fromJson(Map<String, dynamic> json) =>
      VendorEligibility(
        canSubmit: json['can_submit'] == true,
        blockers: asJsonMapList(
          json['blockers'],
        ).map(VendorBlocker.fromJson).toList(growable: false),
        account: VendorApplicantAccount.fromJson(asJsonMap(json['account'])),
        categories: asJsonMapList(
          json['categories'],
        ).map(VendorApplicationCategory.fromJson).toList(growable: false),
        application: json['application'] == null
            ? null
            : VendorApplicationView.fromJson(asJsonMap(json['application'])),
        policy: json['policy'] == null
            ? null
            : Policy.fromJson(asJsonMap(json['policy'])),
      );

  final bool canSubmit;
  final List<VendorBlocker> blockers;
  final VendorApplicantAccount account;
  final List<VendorApplicationCategory> categories;
  final VendorApplicationView? application;
  final Policy? policy;

  bool hasBlocker(String code) => blockers.any((row) => row.code == code);

  String? get categoryName {
    final slug = application?.categorySlug;
    if (slug == null) return null;
    for (final category in categories) {
      if (category.slug == slug) return category.name;
    }
    return application?.categoryName;
  }
}

/// Editable form state, held as text so `TextEditingController` stays in the
/// widget layer. [toJson] is the single source for the request body.
class VendorApplicationDraft {
  const VendorApplicationDraft({
    this.displayName = '',
    this.legalName = '',
    this.nik = '',
    this.regionCode,
    this.baseAddress = '',
    this.categorySlug,
    this.description = '',
    this.yearsActive = '',
    this.personnelCount = '',
    this.equipmentSummary = '',
    this.portfolioUrl = '',
  });

  /// Prefill after a rejection: the server masks `nik`, and the KTP file must
  /// be uploaded again, so both stay empty here.
  factory VendorApplicationDraft.fromApplication(VendorApplicationView view) =>
      VendorApplicationDraft(
        displayName: view.displayName,
        legalName: view.legalName,
        regionCode: view.regionCode.isEmpty ? null : view.regionCode,
        baseAddress: view.baseAddress,
        categorySlug: view.categorySlug,
        description: view.description ?? '',
        yearsActive: view.yearsActive?.toString() ?? '',
        personnelCount: view.personnelCount?.toString() ?? '',
        equipmentSummary: view.equipmentSummary ?? '',
        portfolioUrl: view.portfolioUrl ?? '',
      );

  final String displayName;
  final String legalName;
  final String nik;
  final String? regionCode;
  final String baseAddress;
  final String? categorySlug;
  final String description;
  final String yearsActive;
  final String personnelCount;
  final String equipmentSummary;
  final String portfolioUrl;

  int get yearsActiveValue => int.tryParse(yearsActive.trim()) ?? 0;
  int get personnelCountValue => int.tryParse(personnelCount.trim()) ?? 0;

  /// Frozen request body. `years_active`/`personnel_count` stay integers and an
  /// empty portfolio is `null`, never `''`.
  Map<String, dynamic> toJson(String agreementPolicyVersionId) => {
    'display_name': displayName.trim(),
    'legal_name': legalName.trim(),
    'nik': nik.trim(),
    'region_code': regionCode?.trim() ?? '',
    'base_address': baseAddress.trim(),
    'category_slug': categorySlug?.trim() ?? '',
    'years_active': yearsActiveValue,
    'description': description.trim(),
    'personnel_count': personnelCountValue,
    'equipment_summary': equipmentSummary.trim(),
    'portfolio_url': portfolioUrl.trim().isEmpty ? null : portfolioUrl.trim(),
    'agreement_policy_version_id': agreementPolicyVersionId,
  };

  /// Field errors for one wizard step, keyed by wire name.
  Map<String, String> validateStep(int step) {
    switch (step) {
      case 2:
        return _collect({
          'display_name': validateDisplayName(displayName),
          'category_slug': validateCategory(categorySlug),
          'description': validateDescription(description),
          'years_active': validateYearsActive(yearsActive),
          'personnel_count': validatePersonnelCount(personnelCount),
        });
      case 3:
        return _collect({
          'legal_name': validateLegalName(legalName),
          'nik': validateNik(nik),
          'region_code': validateRegion(regionCode),
          'base_address': validateBaseAddress(baseAddress),
        });
      case 4:
        return _collect({
          'equipment_summary': validateEquipment(equipmentSummary),
          'portfolio_url': validatePortfolioUrl(portfolioUrl),
        });
      default:
        return const <String, String>{};
    }
  }

  /// Every step's errors at once; submit jumps to the first failing step.
  Map<String, String> validateAll() => {
    ...validateStep(2),
    ...validateStep(3),
    ...validateStep(4),
  };

  Map<String, String> _collect(Map<String, String?> raw) => {
    for (final entry in raw.entries)
      if (entry.value != null) entry.key: entry.value!,
  };
}

String? validateDisplayName(String value) {
  final text = value.trim();
  if (text.isEmpty) return 'Nama grup wajib diisi.';
  if (text.length < 2) return 'Nama grup minimal 2 karakter.';
  if (text.length > 150) return 'Nama grup maksimal 150 karakter.';
  return null;
}

String? validateLegalName(String value) {
  final text = value.trim();
  if (text.isEmpty) return 'Nama legal wajib diisi.';
  if (text.length < 2) return 'Nama legal minimal 2 karakter.';
  if (text.length > 150) return 'Nama legal maksimal 150 karakter.';
  return null;
}

String? validateNik(String value) {
  final text = value.trim();
  if (text.isEmpty) return 'NIK wajib diisi.';
  if (!RegExp(_nikPattern).hasMatch(text)) return 'NIK harus 16 digit angka.';
  return null;
}

String? validateRegion(String? value) {
  if (value == null || value.trim().isEmpty) return 'Pilih wilayah basis.';
  return null;
}

String? validateBaseAddress(String value) {
  final text = value.trim();
  if (text.isEmpty) return 'Alamat basis wajib diisi.';
  if (text.length < 10) return 'Alamat minimal 10 karakter.';
  if (text.length > 1000) return 'Alamat maksimal 1.000 karakter.';
  return null;
}

String? validateCategory(String? value) {
  if (value == null || value.trim().isEmpty) return 'Pilih kategori vendor.';
  return null;
}

String? validateDescription(String value) {
  final text = value.trim();
  if (text.isEmpty) return 'Deskripsi wajib diisi.';
  if (text.length < vendorDescriptionMin) {
    return 'Deskripsi minimal $vendorDescriptionMin karakter.';
  }
  if (text.length > vendorDescriptionMax) {
    return 'Deskripsi maksimal 1.000 karakter.';
  }
  return null;
}

String? validateYearsActive(String value) {
  final text = value.trim();
  if (text.isEmpty) return 'Isi berapa tahun sudah aktif.';
  final years = int.tryParse(text);
  if (years == null) return 'Gunakan angka bulat.';
  if (years < 0 || years > vendorYearsActiveMax) {
    return 'Tahun aktif antara 0 dan $vendorYearsActiveMax.';
  }
  return null;
}

String? validatePersonnelCount(String value) {
  final text = value.trim();
  if (text.isEmpty) return 'Isi jumlah personel.';
  final count = int.tryParse(text);
  if (count == null) return 'Gunakan angka bulat.';
  if (count < 1 || count > vendorPersonnelMax) {
    return 'Jumlah personel antara 1 dan 1.000.';
  }
  return null;
}

String? validateEquipment(String value) {
  final text = value.trim();
  if (text.isEmpty) return 'Rangkum peralatan yang kamu bawa.';
  if (text.length < vendorEquipmentMin) {
    return 'Rangkuman peralatan minimal $vendorEquipmentMin karakter.';
  }
  if (text.length > vendorEquipmentMax) {
    return 'Rangkuman peralatan maksimal 1.000 karakter.';
  }
  return null;
}

String? validatePortfolioUrl(String value) {
  final text = value.trim();
  if (text.isEmpty) return null;
  if (text.length > vendorPortfolioMax) {
    return 'Tautan maksimal $vendorPortfolioMax karakter.';
  }
  final uri = Uri.tryParse(text);
  if (uri == null || !text.startsWith('https://') || uri.host.isEmpty) {
    return 'Tautan harus berupa alamat https:// yang valid.';
  }
  return null;
}

/// Why a submit failed, so the wizard can pick the right recovery path.
enum VendorSubmitFailure {
  policyStale,
  applicationOpen,
  emailNotVerified,
  resubmitLimit,
  categoryInvalid,
  regionInvalid,
  retryable,
  other,
}

/// `details.reason` from the error envelope, when the server sent one.
String? vendorErrorReason(ApiException error) {
  final details = error.details;
  if (details is Map) {
    final reason = details['reason'];
    final text = reason?.toString().trim() ?? '';
    if (text.isNotEmpty) return text;
  }
  return null;
}

VendorSubmitFailure classifyVendorSubmitError(ApiException error) {
  final reason = vendorErrorReason(error);
  final code = error.code;
  bool matches(String token) => code == token || reason == token;

  if (matches('POLICY_VERSION_STALE')) return VendorSubmitFailure.policyStale;
  if (matches('APPLICATION_OPEN')) return VendorSubmitFailure.applicationOpen;
  if (matches('EMAIL_NOT_VERIFIED')) {
    return VendorSubmitFailure.emailNotVerified;
  }
  if (matches('RESUBMIT_LIMIT')) return VendorSubmitFailure.resubmitLimit;
  if (matches('CATEGORY_INACTIVE') || matches('CATEGORY_UNKNOWN')) {
    return VendorSubmitFailure.categoryInvalid;
  }
  if (matches('REGION_UNKNOWN')) return VendorSubmitFailure.regionInvalid;
  final status = error.statusCode;
  if (status == null ||
      status >= 500 ||
      code == 'NETWORK_ERROR' ||
      code == 'TIMEOUT' ||
      code == 'UPSTREAM_ERROR') {
    return VendorSubmitFailure.retryable;
  }
  return VendorSubmitFailure.other;
}

/// "Coba lagi dalam 2 jam." when the server sent `details.retry_after_seconds`
/// (or the older `details.retry_after`); `null` when it sent neither, so the
/// copy never invents a wait time.
String? vendorRetryAfterText(ApiException error) {
  final details = error.details;
  if (details is! Map) return null;
  dynamic raw = details['retry_after_seconds'];
  if (raw == null || (raw is String && raw.trim().isEmpty)) {
    raw = details['retry_after'];
  }
  Duration? wait;
  if (raw is num) {
    wait = Duration(seconds: raw.toInt());
  } else if (raw is String) {
    final seconds = int.tryParse(raw.trim());
    if (seconds != null) {
      wait = Duration(seconds: seconds);
    } else {
      final at = DateTime.tryParse(raw.trim());
      if (at != null) {
        final diff = at.difference(DateTime.now());
        if (diff.isNegative) {
          wait = Duration.zero;
        } else {
          wait = diff;
        }
      }
    }
  }
  if (wait == null) return null;
  if (wait.inMinutes < 1) return 'Coba lagi dalam 1 menit.';
  if (wait.inHours < 1) return 'Coba lagi dalam ${wait.inMinutes} menit.';
  if (wait.inDays < 1) return 'Coba lagi dalam ${wait.inHours} jam.';
  return 'Coba lagi dalam ${wait.inDays} hari.';
}
