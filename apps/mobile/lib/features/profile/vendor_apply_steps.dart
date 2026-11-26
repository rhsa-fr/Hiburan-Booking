import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/theme.dart';
import '../../core/format.dart';
import '../../core/ui.dart';
import 'vendor_apply_support.dart';

/// Step 1 — the Ketentuan Mitra gate plus the account blockers.
class VendorTermsStep extends StatelessWidget {
  const VendorTermsStep({
    super.key,
    required this.eligibility,
    required this.agreed,
    required this.onAgreedChanged,
    required this.onReadTerms,
    this.agreementError,
  });

  final VendorEligibility eligibility;
  final bool agreed;
  final String? agreementError;
  final ValueChanged<bool> onAgreedChanged;
  final VoidCallback onReadTerms;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final policy = eligibility.policy;
    final blockers = eligibility.blockers;
    final account = eligibility.account;
    final accountLine = [
      if (account.name != null) account.name!,
      account.displayEmail,
      if (!account.emailVerified) 'email belum diverifikasi',
    ].join(' · ');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Sebelum mengirim, baca Ketentuan Mitra dan periksa kesiapan akun. '
          'Admin memeriksa pengajuan. Status dan catatan penolakan tampil di '
          'halaman ini.',
          style: text.bodyMedium?.copyWith(color: AppColors.inkMuted, height: 1.55),
        ),
        const SizedBox(height: Sp.lg),
        if (blockers.isNotEmpty) ...[
          InfoStrip(
            message: blockers.map((row) => '• ${row.label}').join('\n'),
            icon: Icons.error_outline,
            tone: InfoTone.danger,
          ),
          const SizedBox(height: Sp.md),
        ],
        InfoStrip(
          message: accountLine,
          icon: account.emailVerified
              ? Icons.verified_user_outlined
              : Icons.alternate_email,
          tone: account.emailVerified ? InfoTone.neutral : InfoTone.warning,
        ),
        const SizedBox(height: Sp.lg),
        Container(
          padding: const EdgeInsets.all(Sp.lg),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(Radii.xxl),
            border: Border.all(color: AppColors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const IconBadge(icon: Icons.gavel_outlined),
                  const SizedBox(width: Sp.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Ketentuan Mitra',
                          style: text.titleMedium?.copyWith(
                            fontSize: 16.5,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.25,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          policy == null
                              ? 'Belum tersedia di server'
                              : 'Versi ${policy.version}'
                                    '${policy.effectiveFrom.trim().isEmpty ? '' : ' · berlaku ${formatDateIso(policy.effectiveFrom)}'}',
                          style: text.bodySmall?.copyWith(
                            color: AppColors.inkMuted,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: Sp.md),
              OutlinedButton(
                onPressed: policy == null ? null : onReadTerms,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                  foregroundColor: AppColors.ink,
                  side: BorderSide(color: AppColors.line),
                ),
                child: const Text('Baca ketentuan'),
              ),
            ],
          ),
        ),
        const SizedBox(height: Sp.sm),
        CheckboxListTile(
          value: agreed,
          onChanged: (value) => onAgreedChanged(value ?? false),
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
          visualDensity: VisualDensity.compact,
          title: Text(
            policy == null
                ? 'Saya menyetujui Ketentuan Mitra.'
                : 'Saya telah membaca dan menyetujui Ketentuan Mitra '
                      'v${policy.version}.',
            style: text.bodyMedium?.copyWith(height: 1.45),
          ),
        ),
        if (agreementError != null) ...[
          const SizedBox(height: Sp.xs),
          Text(
            agreementError!,
            style: text.bodySmall?.copyWith(color: AppColors.danger),
          ),
        ],
      ],
    );
  }
}

/// Step 2 — what the grup is called, what it does, and how big it is.
class VendorProfileStep extends StatelessWidget {
  const VendorProfileStep({
    super.key,
    required this.displayName,
    required this.categories,
    required this.categorySlug,
    required this.description,
    required this.yearsActive,
    required this.personnelCount,
    required this.errors,
    required this.onCategorySelected,
    required this.onFieldChanged,
  });

  final TextEditingController displayName;
  final List<VendorApplicationCategory> categories;
  final String? categorySlug;
  final TextEditingController description;
  final TextEditingController yearsActive;
  final TextEditingController personnelCount;
  final Map<String, String> errors;
  final ValueChanged<String> onCategorySelected;
  final ValueChanged<String> onFieldChanged;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Nama ini yang dilihat pelanggan di katalog. Kategori menentukan '
          'filter pencarian.',
          style: text.bodyMedium?.copyWith(color: AppColors.inkMuted, height: 1.55),
        ),
        const SizedBox(height: Sp.lg),
        _ApplyTextField(
          controller: displayName,
          label: 'Nama grup / vendor',
          error: errors['display_name'],
          maxLength: 150,
          textInputAction: TextInputAction.next,
          onChanged: () => onFieldChanged('display_name'),
        ),
        const SizedBox(height: Sp.lg),
        _SectionLabel('Kategori vendor', required: true),
        const SizedBox(height: Sp.sm),
        Wrap(
          spacing: Sp.sm,
          runSpacing: Sp.sm,
          children: [
            for (final category in categories)
              _CategoryChip(
                label: category.name,
                selected: category.slug == categorySlug,
                onTap: () => onCategorySelected(category.slug),
              ),
          ],
        ),
        if (errors['category_slug'] != null) ...[
          const SizedBox(height: Sp.xs),
          Text(
            errors['category_slug']!,
            style: text.bodySmall?.copyWith(color: AppColors.danger),
          ),
        ],
        const SizedBox(height: Sp.lg),
        _ApplyTextField(
          controller: description,
          label: 'Deskripsi singkat',
          helper: 'Ceritakan gaya pentas, formasi, dan wilayah layanan.',
          error: errors['description'],
          maxLength: vendorDescriptionMax,
          minLines: 4,
          maxLines: 6,
          textCapitalization: TextCapitalization.sentences,
          onChanged: () => onFieldChanged('description'),
        ),
        _CharacterMeter(
          value: description.text.trim().length,
          max: vendorDescriptionMax,
          min: vendorDescriptionMin,
          label: 'karakter',
        ),
        const SizedBox(height: Sp.lg),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _ApplyTextField(
                controller: yearsActive,
                label: 'Tahun aktif',
                helper: '0–$vendorYearsActiveMax tahun',
                error: errors['years_active'],
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                textInputAction: TextInputAction.next,
                onChanged: () => onFieldChanged('years_active'),
              ),
            ),
            const SizedBox(width: Sp.md),
            Expanded(
              child: _ApplyTextField(
                controller: personnelCount,
                label: 'Jumlah personel',
                helper: '1–1.000 orang',
                error: errors['personnel_count'],
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                textInputAction: TextInputAction.done,
                onChanged: () => onFieldChanged('personnel_count'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Step 3 — legal identity, base region, and the private KTP file.
class VendorLegalityStep extends StatelessWidget {
  const VendorLegalityStep({
    super.key,
    required this.legalName,
    required this.nik,
    required this.address,
    required this.regions,
    required this.regionCode,
    required this.errors,
    required this.ktpBytes,
    required this.ktpName,
    required this.pickingKtp,
    required this.onRegionChanged,
    required this.onPickKtp,
    required this.onFieldChanged,
  });

  final TextEditingController legalName;
  final TextEditingController nik;
  final TextEditingController address;
  final List<VendorRegion> regions;
  final String? regionCode;
  final Map<String, String> errors;
  final Uint8List? ktpBytes;
  final String? ktpName;
  final bool pickingKtp;
  final ValueChanged<String?> onRegionChanged;
  final VoidCallback onPickKtp;
  final ValueChanged<String> onFieldChanged;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Data ini dipakai untuk verifikasi identitas pemilik usaha. Pastikan '
          'sama dengan KTP.',
          style: text.bodyMedium?.copyWith(color: AppColors.inkMuted, height: 1.55),
        ),
        const SizedBox(height: Sp.lg),
        _ApplyTextField(
          controller: legalName,
          label: 'Nama legal (sesuai KTP)',
          error: errors['legal_name'],
          maxLength: 150,
          textInputAction: TextInputAction.next,
          textCapitalization: TextCapitalization.words,
          onChanged: () => onFieldChanged('legal_name'),
        ),
        const SizedBox(height: Sp.lg),
        _ApplyTextField(
          controller: nik,
          label: 'NIK pimpinan',
          helper: '16 digit angka, tanpa spasi',
          error: errors['nik'],
          maxLength: 16,
          keyboardType: TextInputType.number,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(16),
          ],
          textInputAction: TextInputAction.next,
          onChanged: () => onFieldChanged('nik'),
        ),
        const SizedBox(height: Sp.lg),
        DropdownButtonFormField<String>(
          key: ValueKey('region-${regionCode ?? 'none'}'),
          initialValue: regionCode,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: 'Wilayah basis',
            errorText: errors['region_code'],
            border: const OutlineInputBorder(),
          ),
          items: regions
              .map(
                (region) => DropdownMenuItem(
                  value: region.code,
                  child: Text(region.name, overflow: TextOverflow.ellipsis),
                ),
              )
              .toList(growable: false),
          onChanged: onRegionChanged,
        ),
        const SizedBox(height: Sp.lg),
        _ApplyTextField(
          controller: address,
          label: 'Alamat basis',
          helper: 'Alamat yang bisa dikunjungi vendor saat dihubungi.',
          error: errors['base_address'],
          maxLength: 1000,
          minLines: 3,
          maxLines: 4,
          textCapitalization: TextCapitalization.sentences,
          onChanged: () => onFieldChanged('base_address'),
        ),
        const SizedBox(height: Sp.lg),
        _SectionLabel('Foto KTP pimpinan', required: true),
        const SizedBox(height: Sp.sm),
        Container(
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(Radii.xxl),
            border: Border.all(
              color: errors['ktp'] == null ? AppColors.line : AppColors.danger,
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (ktpBytes != null)
                Image.memory(
                  ktpBytes!,
                  height: 168,
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) =>
                      _KtpPlaceholder(hasFile: true),
                )
              else
                _KtpPlaceholder(hasFile: false),
              Padding(
                padding: const EdgeInsets.all(Sp.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      ktpName == null
                          ? 'Foto KTP belum dipilih.'
                          : 'File: $ktpName',
                      style: text.bodySmall?.copyWith(
                        color: ktpName == null
                            ? AppColors.inkMuted
                            : AppColors.ink,
                        fontWeight: ktpName == null
                            ? FontWeight.w400
                            : FontWeight.w600,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: Sp.sm),
                    OutlinedButton.icon(
                      onPressed: pickingKtp ? null : onPickKtp,
                      icon: const Icon(Icons.photo_library_outlined, size: 18),
                      label: Text(
                        ktpBytes == null ? 'Pilih foto KTP' : 'Ganti foto KTP',
                      ),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        foregroundColor: AppColors.ink,
                        side: BorderSide(color: AppColors.line),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (errors['ktp'] != null) ...[
          const SizedBox(height: Sp.xs),
          Text(
            errors['ktp']!,
            style: text.bodySmall?.copyWith(color: AppColors.danger),
          ),
        ],
        const SizedBox(height: Sp.sm),
        Text(
          'KTP disimpan privat: hanya admin verifikasi yang bisa membukanya '
          'dan tidak tampil ke pelanggan. Kalau pengajuan ditolak, unggah '
          'ulang foto KTP saat mengajukan kembali.',
          style: text.bodySmall?.copyWith(color: AppColors.inkMuted, height: 1.45),
        ),
      ],
    );
  }
}

/// Step 4 — equipment and optional portfolio link.
class VendorOperationsStep extends StatelessWidget {
  const VendorOperationsStep({
    super.key,
    required this.equipmentSummary,
    required this.portfolioUrl,
    required this.errors,
    required this.onFieldChanged,
  });

  final TextEditingController equipmentSummary;
  final TextEditingController portfolioUrl;
  final Map<String, String> errors;
  final ValueChanged<String> onFieldChanged;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Tuliskan perlengkapan yang kamu bawa sendiri, bukan yang disewa '
          'per acara. Ini membantu admin menilai kesiapan operasional.',
          style: text.bodyMedium?.copyWith(color: AppColors.inkMuted, height: 1.55),
        ),
        const SizedBox(height: Sp.lg),
        _ApplyTextField(
          controller: equipmentSummary,
          label: 'Peralatan yang dimiliki',
          helper: 'Contoh: 2 set sound 2.000 watt, 6 lampu par, 1 genset.',
          error: errors['equipment_summary'],
          maxLength: vendorEquipmentMax,
          minLines: 4,
          maxLines: 6,
          textCapitalization: TextCapitalization.sentences,
          onChanged: () => onFieldChanged('equipment_summary'),
        ),
        _CharacterMeter(
          value: equipmentSummary.text.trim().length,
          max: vendorEquipmentMax,
          min: vendorEquipmentMin,
          label: 'karakter',
        ),
        const SizedBox(height: Sp.lg),
        _ApplyTextField(
          controller: portfolioUrl,
          label: 'Tautan portofolio (opsional)',
          helper: 'Video atau akun media sosial, diawali https://',
          error: errors['portfolio_url'],
          maxLength: vendorPortfolioMax,
          keyboardType: TextInputType.url,
          textInputAction: TextInputAction.done,
          onChanged: () => onFieldChanged('portfolio_url'),
        ),
      ],
    );
  }
}

/// Step 5 — read-only summary grouped by section, each with an Ubah link.
class VendorReviewStep extends StatelessWidget {
  const VendorReviewStep({
    super.key,
    required this.draft,
    required this.agreed,
    required this.categoryName,
    required this.regionName,
    required this.ktpReady,
    required this.onEditStep,
    this.policyVersion,
  });

  final VendorApplicationDraft draft;
  final bool agreed;
  final String? policyVersion;
  final String? categoryName;
  final String? regionName;
  final bool ktpReady;
  final ValueChanged<int> onEditStep;

  String get _policyLine {
    if (!agreed) return 'Belum disetujui';
    final version = policyVersion;
    return version == null
        ? 'Disetujui: Ketentuan Mitra'
        : 'Disetujui: Ketentuan Mitra v$version';
  }

  @override
  Widget build(BuildContext context) {
    final years = draft.yearsActive.trim();
    final personnel = draft.personnelCount.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ReviewGroup(
          title: 'Ketentuan',
          onEdit: () => onEditStep(1),
          rows: [_ReviewRow(label: 'Persetujuan', value: _policyLine)],
        ),
        const SizedBox(height: Sp.md),
        _ReviewGroup(
          title: 'Profil grup',
          onEdit: () => onEditStep(2),
          rows: [
            _ReviewRow(label: 'Nama grup', value: draft.displayName.trim()),
            _ReviewRow(
              label: 'Kategori',
              value: categoryName?.trim().isNotEmpty == true
                  ? categoryName!.trim()
                  : draft.categorySlug?.trim() ?? '',
            ),
            _ReviewRow(label: 'Deskripsi', value: draft.description.trim()),
            _ReviewRow(
              label: 'Tahun aktif',
              value: years.isEmpty ? '' : '$years tahun',
            ),
            _ReviewRow(
              label: 'Jumlah personel',
              value: personnel.isEmpty ? '' : '$personnel orang',
            ),
          ],
        ),
        const SizedBox(height: Sp.md),
        _ReviewGroup(
          title: 'Legalitas',
          onEdit: () => onEditStep(3),
          rows: [
            _ReviewRow(label: 'Nama legal', value: draft.legalName.trim()),
            _ReviewRow(label: 'NIK', value: draft.nik.trim()),
            _ReviewRow(
              label: 'Wilayah basis',
              value: regionName?.trim().isNotEmpty == true
                  ? regionName!.trim()
                  : draft.regionCode ?? '',
            ),
            _ReviewRow(label: 'Alamat basis', value: draft.baseAddress.trim()),
            _ReviewRow(
              label: 'Foto KTP',
              value: ktpReady ? 'Siap diunggah (privat)' : 'Belum dipilih',
            ),
          ],
        ),
        const SizedBox(height: Sp.md),
        _ReviewGroup(
          title: 'Operasional',
          onEdit: () => onEditStep(4),
          rows: [
            _ReviewRow(
              label: 'Peralatan',
              value: draft.equipmentSummary.trim(),
            ),
            _ReviewRow(
              label: 'Portofolio',
              value: draft.portfolioUrl.trim().isEmpty
                  ? 'Tidak diisi'
                  : draft.portfolioUrl.trim(),
            ),
          ],
        ),
        const SizedBox(height: Sp.lg),
        InfoStrip(
          message:
              'Periksa sekali lagi. Setelah dikirim, data tidak bisa diubah '
              'sampai admin memutuskan.',
          icon: Icons.rule_outlined,
          tone: InfoTone.primary,
        ),
      ],
    );
  }
}

class _ApplyTextField extends StatelessWidget {
  const _ApplyTextField({
    required this.controller,
    required this.label,
    required this.onChanged,
    this.helper,
    this.error,
    this.maxLength,
    this.minLines,
    this.maxLines = 1,
    this.keyboardType,
    this.inputFormatters,
    this.textInputAction,
    this.textCapitalization = TextCapitalization.none,
  });

  final TextEditingController controller;
  final String label;
  final VoidCallback onChanged;
  final String? helper;
  final String? error;
  final int? maxLength;
  final int? minLines;
  final int maxLines;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final TextInputAction? textInputAction;
  final TextCapitalization textCapitalization;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      minLines: minLines,
      maxLines: maxLines,
      keyboardType: keyboardType,
      inputFormatters: inputFormatters,
      textInputAction: textInputAction,
      textCapitalization: textCapitalization,
      onChanged: (_) => onChanged(),
      decoration: InputDecoration(
        labelText: label,
        helperText: helper,
        helperMaxLines: 2,
        errorText: error,
        errorMaxLines: 3,
        border: const OutlineInputBorder(),
        counterText: '',
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.label, {this.required = false});

  final String label;
  final bool required;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Row(
      children: [
        Text(
          label,
          style: text.labelMedium?.copyWith(
            color: AppColors.ink,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (required)
          Text(
            ' *',
            style: text.labelMedium?.copyWith(color: AppColors.danger),
          ),
      ],
    );
  }
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? AppColors.stage : AppColors.card,
        borderRadius: BorderRadius.circular(Radii.pill),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(Radii.pill),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(
              horizontal: Sp.lg,
              vertical: Sp.sm,
            ),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Radii.pill),
              border: Border.all(
                color: selected ? AppColors.stage : AppColors.line,
              ),
            ),
            alignment: Alignment.center,
            child: Text(
              label,
              style: text.labelLarge?.copyWith(
                fontSize: 13.5,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                color: selected ? AppColors.lime : AppColors.ink,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CharacterMeter extends StatelessWidget {
  const _CharacterMeter({
    required this.value,
    required this.max,
    required this.min,
    required this.label,
  });

  final int value;
  final int max;
  final int min;
  final String label;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final reached = value >= min;
    return Padding(
      padding: const EdgeInsets.only(top: Sp.xs, left: Sp.xs, right: Sp.xs),
      child: Row(
        children: [
          Expanded(
            child: Text(
              reached ? 'Sudah cukup panjang' : 'Minimal $min $label',
              style: text.bodySmall?.copyWith(
                color: reached ? AppColors.inkMuted : AppColors.muted2,
              ),
            ),
          ),
          Text(
            '$value/$max',
            style: text.bodySmall?.copyWith(
              color: value > max ? AppColors.danger : AppColors.inkMuted,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _KtpPlaceholder extends StatelessWidget {
  const _KtpPlaceholder({required this.hasFile});

  final bool hasFile;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 168,
      color: AppColors.surfaceSoft,
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            hasFile ? Icons.image_outlined : Icons.badge_outlined,
            size: 30,
            color: AppColors.muted2,
          ),
          const SizedBox(height: Sp.sm),
          Text(
            hasFile ? 'Pratinjau tidak tersedia' : 'Belum ada foto',
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: AppColors.inkMuted),
          ),
        ],
      ),
    );
  }
}

class _ReviewGroup extends StatelessWidget {
  const _ReviewGroup({
    required this.title,
    required this.rows,
    required this.onEdit,
  });

  final String title;
  final List<Widget> rows;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.sm, Sp.lg),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(Radii.xxl),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: text.titleMedium?.copyWith(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.2,
                  ),
                ),
              ),
              TextButton(
                onPressed: onEdit,
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.ink,
                  minimumSize: const Size(48, 48),
                  padding: const EdgeInsets.symmetric(horizontal: Sp.sm),
                  textStyle: text.labelMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                child: const Text('Ubah'),
              ),
            ],
          ),
          const SizedBox(height: Sp.xs),
          Padding(
            padding: const EdgeInsets.only(right: Sp.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < rows.length; i++) ...[
                  if (i > 0) const SizedBox(height: Sp.sm),
                  rows[i],
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final shown = value.trim().isEmpty ? '—' : value.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
        ),
        const SizedBox(height: 1),
        Text(
          shown,
          style: text.bodyMedium?.copyWith(
            color: shown == '—' ? AppColors.muted2 : AppColors.ink,
            fontWeight: FontWeight.w600,
            height: 1.45,
          ),
        ),
      ],
    );
  }
}
