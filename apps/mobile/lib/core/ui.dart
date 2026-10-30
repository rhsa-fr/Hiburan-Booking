import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../app/theme.dart';
import 'format.dart';
import 'models.dart';

const _tabularFigures = <FontFeature>[FontFeature.tabularFigures()];

/// `1500000` → `Rp1.500.000`, the tighter form DESIGN.md asks for.
/// Reuses [rupiah] so grouping rules stay in one place.
String _rupiah(int amount) => rupiah(amount).replaceFirst('Rp ', 'Rp');

/// FNV-1a over the name. Same vendor always gets the same poster, offline.
int _stableHash(String value) {
  var hash = 0x811c9dc5;
  for (final unit in value.codeUnits) {
    hash ^= unit;
    hash = (hash * 0x01000193) & 0x7fffffff;
  }
  return hash;
}

/// Theatrical stage curtain and royal gamelan tones for poster backdrops.
List<Color> _posterGradient(int seed) {
  return switch (seed % 6) {
    0 => const <Color>[Color(0xFF7A1B2E), Color(0xFF571020)],
    1 => const <Color>[Color(0xFF571020), Color(0xFF380812)],
    2 => const <Color>[Color(0xFF1E6B4E), Color(0xFF0F3D2C)],
    3 => const <Color>[Color(0xFF7A1B2E), Color(0xFF3D2500)],
    4 => const <Color>[Color(0xFF571020), Color(0xFF1E6B4E)],
    _ => const <Color>[Color(0xFF380812), Color(0xFF7A1B2E)],
  };
}

/// 2–3 initials, skipping blank words. `Grup Tarling Nada` → `GTN`.
String _monogram(String name) {
  final words = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .toList(growable: false);
  if (words.isEmpty) return '·';
  if (words.length == 1) {
    final word = words.first;
    return (word.length >= 2 ? word.substring(0, 2) : word).toUpperCase();
  }
  final take = words.length >= 3 ? 3 : 2;
  return words
      .take(take)
      .map((word) => word.substring(0, 1))
      .join()
      .toUpperCase();
}

/// Clean minimalist header with architectural 1px hairline border,
/// high-contrast typography, and tactile button containers.
class StageHeader extends StatelessWidget {
  const StageHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.bottom,
    this.height = 0,
    this.showDivider = true,
  });

  /// Standard screen header with a framed minimalist back button.
  factory StageHeader.back({
    Key? key,
    required BuildContext context,
    required String title,
    String? subtitle,
    Widget? trailing,
    Widget? bottom,
    VoidCallback? onBack,
    bool showDivider = true,
  }) {
    return StageHeader(
      key: key,
      title: title,
      subtitle: subtitle,
      leading: Material(
        color: Colors.white.withValues(alpha: 0.12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.sm),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.16)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onBack ?? () => Navigator.maybePop(context),
          child: const SizedBox(
            width: 38,
            height: 38,
            child: Center(
              child: Icon(
                Icons.arrow_back,
                size: 20,
                color: AppColors.onPrimary,
              ),
            ),
          ),
        ),
      ),
      trailing: trailing,
      bottom: bottom,
      showDivider: showDivider,
    );
  }

  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;
  final Widget? bottom;
  final double height;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final topInset = MediaQuery.paddingOf(context).top;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Semantics(
        header: true,
        child: Container(
          constraints: BoxConstraints(minHeight: height),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: AppColors.primaryDeepEnd,
            ),
            border: showDivider
                ? const Border(
                    bottom: BorderSide(color: AppColors.lime, width: 2),
                  )
                : null,
          ),
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              Sp.lg,
              topInset + Sp.sm,
              Sp.lg,
              Sp.md,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    if (leading != null) ...[
                      leading!,
                      const SizedBox(width: Sp.md),
                    ],
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            title,
                            style: (leading != null
                                    ? text.titleLarge
                                    : text.headlineSmall)
                                ?.copyWith(
                                  fontSize: leading != null ? 18 : 22,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: -0.4,
                                  color: AppColors.onPrimary,
                                ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          if (subtitle != null) ...[
                            const SizedBox(height: 2),
                            Text(
                              subtitle!,
                              style: text.bodySmall?.copyWith(
                                color: Colors.white.withValues(alpha: 0.62),
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (trailing != null) ...[
                      const SizedBox(width: Sp.sm),
                      trailing!,
                    ],
                  ],
                ),
                if (bottom != null) ...[
                  const SizedBox(height: Sp.md),
                  bottom!,
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Poster with photo or procedural fallback: deterministic maroon gradient,
/// monogram, and stage-light bands when photo is absent.
class PosterTile extends StatelessWidget {
  const PosterTile({
    super.key,
    required this.name,
    this.imageUrl,
    this.height = 168,
    this.aspectRatio,
    this.radius = 12,
    this.badges = const <String>[],
    this.compact = false,
    this.heroTag,
  });

  final String name;
  final String? imageUrl;
  final double height;
  final double? aspectRatio;
  final double radius;
  final List<String> badges;
  final bool compact;
  final String? heroTag;

  Widget _proceduralStage(int seed, BorderRadius borderRadius) {
    return Stack(
      fit: StackFit.expand,
      children: [
        CustomPaint(
          painter: _StageBandsPainter(seed: seed, compact: compact),
        ),
        if (!compact)
          Positioned.fill(
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    stops: const [0.4, 1.0],
                    colors: [
                      Colors.transparent,
                      AppColors.ink.withValues(alpha: 0.28),
                    ],
                  ),
                ),
              ),
            ),
          ),
        Center(
          child: Padding(
            padding: const EdgeInsets.all(Sp.sm),
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                _monogram(name),
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: 'Plus Jakarta Sans',
                  fontFamilyFallback: const ['PlusJakartaSans', 'sans-serif'],
                  fontSize: compact ? 20 : 42,
                  height: 1,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.5,
                  color: AppColors.onPrimary.withValues(alpha: 0.92),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final seed = _stableHash(name);
    final side = compact ? 64.0 : height;
    final corner = compact ? Radii.sm : radius;
    final borderRadius = BorderRadius.circular(corner);
    final hasImg = imageUrl != null && imageUrl!.trim().isNotEmpty;
    final tile = LayoutBuilder(
      builder: (context, constraints) {
        final width = compact
            ? side
            : constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : side * 1.6;
        final content = DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: borderRadius,
            gradient: LinearGradient(
              begin: seed.isEven ? Alignment.topLeft : Alignment.bottomLeft,
              end: seed.isEven ? Alignment.bottomRight : Alignment.topRight,
              colors: _posterGradient(seed),
            ),
          ),
          child: ClipRRect(
            borderRadius: borderRadius,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (hasImg)
                  Image.network(
                    imageUrl!.trim(),
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) =>
                        _proceduralStage(seed, borderRadius),
                    loadingBuilder: (context, child, progress) {
                      if (progress == null) return child;
                      return _proceduralStage(seed, borderRadius);
                    },
                  )
                else
                  _proceduralStage(seed, borderRadius),
                if (!compact && hasImg)
                  Positioned.fill(
                    child: IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            stops: const [0.3, 1.0],
                            colors: [
                              Colors.transparent,
                              AppColors.ink.withValues(alpha: 0.5),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                if (!compact && badges.isNotEmpty)
                  Positioned(
                    top: Sp.sm,
                    left: Sp.sm,
                    right: Sp.sm,
                    child: Wrap(
                      spacing: Sp.xs + 2,
                      runSpacing: Sp.xs,
                      children: [
                        for (final badge in badges)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: Sp.sm + 2,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.4),
                              borderRadius: BorderRadius.circular(Radii.pill),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.25),
                              ),
                            ),
                            child: Text(
                              badge,
                              style: const TextStyle(
                                fontSize: 11,
                                height: 1.2,
                                fontWeight: FontWeight.w600,
                                color: AppColors.onPrimary,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                Positioned.fill(
                  child: IgnorePointer(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: borderRadius,
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.12),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );

        if (aspectRatio != null && !compact) {
          return AspectRatio(
            aspectRatio: aspectRatio!,
            child: content,
          );
        }

        return SizedBox(
          width: width,
          height: side,
          child: content,
        );
      },
    );

    final wrapped = heroTag != null
        ? Hero(
            tag: heroTag!,
            child: Material(type: MaterialType.transparency, child: tile),
          )
        : tile;

    return Semantics(
      label: name,
      image: true,
      child: ExcludeSemantics(child: wrapped),
    );
  }
}

/// Section title with an optional one-line caption and a maroon text action.
class SectionHeader extends StatelessWidget {
  const SectionHeader({
    super.key,
    required this.title,
    this.caption,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? caption;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: text.titleLarge,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (caption != null) ...[
                const SizedBox(height: 2),
                Text(
                  caption!,
                  style: text.bodySmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ],
          ),
        ),
        if (actionLabel != null)
          Padding(
            padding: const EdgeInsets.only(left: Sp.sm),
            child: TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                foregroundColor: AppColors.primary,
                padding: const EdgeInsets.symmetric(horizontal: Sp.sm),
                minimumSize: const Size(0, 44),
                tapTargetSize: MaterialTapTargetSize.padded,
                textStyle: text.labelMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.primary,
                ),
              ),
              child: Text(actionLabel!),
            ),
          ),
      ],
    );
  }
}

/// Vendor summary with a deterministic poster. Ratings, response rate, and
/// category are rendered only when the API actually returns them.
class VendorCard extends StatelessWidget {
  const VendorCard({
    super.key,
    required this.vendor,
    required this.onTap,
    this.compact = false,
  });

  final VendorSummary vendor;
  final VoidCallback onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final meta = <String>[
      if (vendor.categoryName?.trim().isNotEmpty ?? false)
        vendor.categoryName!.trim(),
      if (vendor.regionName.trim().isNotEmpty) vendor.regionName,
      '${vendor.packageCount} paket',
    ].join(' · ');
    final rating = vendor.rating;
    final responseRate = vendor.responseRateBp;
    final ratingText = rating == null || vendor.ratingCount == 0
        ? null
        : '${rating.toStringAsFixed(1)} (${vendor.ratingCount})';
    final responseText = responseRate == null
        ? null
        : 'Respons ${(responseRate / 100).round()}%';

    final price = vendor.startingPriceIdr > 0
        ? Text(
            _rupiah(vendor.startingPriceIdr),
            style: text.displaySmall?.copyWith(
              fontSize: 24,
              color: AppColors.primary,
              fontWeight: FontWeight.w700,
              fontFeatures: _tabularFigures,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          )
        : Text(
            'Harga belum diisi',
            style: text.titleMedium?.copyWith(fontSize: 16),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          );

    final details = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          vendor.displayName,
          style: text.titleMedium?.copyWith(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            height: 1.3,
          ),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: Sp.xs),
        Text(
          meta,
          style: text.bodySmall,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        if (ratingText != null || responseText != null) ...[
          const SizedBox(height: Sp.xs),
          Row(
            children: [
              if (ratingText != null) ...[
                const Icon(
                  Icons.star_rounded,
                  size: 16,
                  color: AppColors.tertiary,
                ),
                const SizedBox(width: 2),
                Text(
                  ratingText,
                  style: text.bodySmall?.copyWith(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              if (ratingText != null && responseText != null)
                Text(' · ', style: text.bodySmall),
              if (responseText != null)
                Flexible(
                  child: Text(
                    responseText,
                    style: text.bodySmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
          ),
        ],
        const SizedBox(height: Sp.md),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Mulai dari',
                    style: text.bodySmall?.copyWith(fontSize: 11),
                  ),
                  price,
                ],
              ),
            ),
            if (vendor.minDpBp > 0) ...[
              const SizedBox(width: Sp.sm),
              _DpPill(percent: (vendor.minDpBp / 100).round()),
            ],
          ],
        ),
      ],
    );

    return Semantics(
      button: true,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: const BorderRadius.all(Radius.circular(Radii.lg)),
          border: Border.all(color: AppColors.line),
          boxShadow: const [
            BoxShadow(
              color: Color(0x060F172A),
              blurRadius: 8,
              offset: Offset(0, 2),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            child: compact
                ? Padding(
                    padding: const EdgeInsets.all(Sp.md),
                    child: Row(
                      children: [
                        PosterTile(
                          name: vendor.displayName,
                          imageUrl: vendor.avatarUrl ?? vendor.bannerUrl,
                          compact: true,
                          radius: Radii.sm,
                          heroTag: 'vendor-poster-${vendor.id}',
                        ),
                        const SizedBox(width: Sp.md),
                        Expanded(child: details),
                      ],
                    ),
                  )
                : Padding(
                    padding: const EdgeInsets.all(Sp.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        PosterTile(
                          name: vendor.displayName,
                          imageUrl: vendor.bannerUrl ?? vendor.avatarUrl,
                          heroTag: 'vendor-poster-${vendor.id}',
                          badges: [
                            if (vendor.categoryName?.trim().isNotEmpty ?? false)
                              vendor.categoryName!.trim(),
                            if (vendor.regionName.trim().isNotEmpty)
                              vendor.regionName,
                            if (vendor.videoUrl != null &&
                                vendor.videoUrl!.trim().isNotEmpty)
                              '▶ Video Pentas',
                          ],
                        ),
                        const SizedBox(height: Sp.md),
                        details,
                        const SizedBox(height: Sp.md),
                        FilledButton(
                          onPressed: onTap,
                          style: FilledButton.styleFrom(
                            minimumSize: const Size.fromHeight(46),
                            padding: const EdgeInsets.symmetric(
                              horizontal: Sp.md,
                            ),
                            textStyle: text.labelLarge?.copyWith(
                              fontSize: 13,
                            ),
                          ),
                          child: const Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text('Lihat Jadwal & Paket'),
                              SizedBox(width: Sp.xs),
                              Icon(Icons.arrow_forward, size: 18),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

class _DpPill extends StatelessWidget {
  const _DpPill({required this.percent});

  final int percent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: Sp.sm + 2,
        vertical: Sp.xs,
      ),
      decoration: BoxDecoration(
        color: AppColors.primarySoft,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: AppColors.primary.withValues(alpha: 0.3),
        ),
      ),
      child: Text(
        'DP $percent%',
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: AppColors.secondary,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

enum MoneyTone { ink, primary, accent, danger }

/// A label/value pair inside [MoneyBlock]. Negative values render with a
/// proper minus sign (`−Rp1.500.000`).
class MoneyRow {
  const MoneyRow(this.label, this.idr);

  final String label;
  final int idr;
}

/// Receipt-style money card: rows, a divider, then exactly one large number.
class MoneyBlock extends StatelessWidget {
  const MoneyBlock({
    super.key,
    required this.rows,
    required this.totalLabel,
    required this.totalIdr,
    this.footnote,
    this.tone = MoneyTone.ink,
  });

  final List<MoneyRow> rows;
  final String totalLabel;
  final int totalIdr;
  final String? footnote;
  final MoneyTone tone;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(Sp.lg),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(Radii.lg),
        border: Border.all(color: AppColors.line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x060F172A),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0)
              const Divider(height: Sp.xl, color: AppColors.line, thickness: 1),
            _MoneyLine(row: rows[i], text: text),
          ],
          if (rows.isNotEmpty)
            const Divider(height: Sp.xl, color: AppColors.line, thickness: 1),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(child: Text(totalLabel, style: text.bodySmall)),
              const SizedBox(width: Sp.md),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerRight,
                  child: Text(
                    _rupiah(totalIdr),
                    style: text.displaySmall?.copyWith(
                      color: _moneyToneColor(tone),
                      fontFeatures: _tabularFigures,
                    ),
                  ),
                ),
              ),
            ],
          ),
          if (footnote != null) ...[
            const SizedBox(height: Sp.sm),
            Text(footnote!, style: text.bodySmall),
          ],
        ],
      ),
    );
  }
}

class _MoneyLine extends StatelessWidget {
  const _MoneyLine({required this.row, required this.text});

  final MoneyRow row;
  final TextTheme text;

  @override
  Widget build(BuildContext context) {
    final value = row.idr < 0 ? '−${_rupiah(-row.idr)}' : _rupiah(row.idr);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Text(
            row.label,
            style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        const SizedBox(width: Sp.md),
        Text(
          value,
          style: text.bodyMedium?.copyWith(
            fontWeight: FontWeight.w600,
            fontFeatures: _tabularFigures,
          ),
        ),
      ],
    );
  }
}

Color _moneyToneColor(MoneyTone tone) => switch (tone) {
  MoneyTone.ink => AppColors.ink,
  MoneyTone.primary => AppColors.primary,
  MoneyTone.accent => AppColors.accent,
  MoneyTone.danger => AppColors.danger,
};

/// Bottom action bar: card background, 1px top line, safe-area padding.
/// The host screen still owes 96px of bottom content padding.
///
/// Scaffold lays the bottom bar out with the full screen height available, so
/// `leading` and `child` must shrink-wrap. An `Align`/`Center` without a
/// height factor expands to that full height and squeezes the body to 0px.
class StickyActionBar extends StatelessWidget {
  const StickyActionBar({super.key, this.leading, required this.child});

  final Widget? leading;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;
    return Material(
      color: AppColors.card,
      elevation: 0,
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.card,
          border: Border(top: BorderSide(color: AppColors.line)),
          boxShadow: [
            BoxShadow(
              color: Color(0x06000000),
              blurRadius: 10,
              offset: Offset(0, -3),
            ),
          ],
        ),
        padding: EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, Sp.md + bottomInset),
        child: leading == null
            ? child
            : Row(
                children: [
                  Expanded(flex: 2, child: leading!),
                  const SizedBox(width: Sp.md),
                  Expanded(flex: 3, child: child),
                ],
              ),
      ),
    );
  }
}

/// Selectable choice chip used for sessions, filters, and add-ons.
class SelectChip extends StatelessWidget {
  const SelectChip({
    super.key,
    required this.label,
    required this.selected,
    this.onTap,
    this.icon,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final foreground = selected ? AppColors.onPrimary : AppColors.ink;
    final background = selected ? AppColors.primary : AppColors.surfaceTint;
    final border = selected ? AppColors.primary : AppColors.line;
    return Semantics(
      button: onTap != null,
      selected: selected,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(Radii.sm),
          border: Border.all(color: border),
          boxShadow: selected
              ? const [
                  BoxShadow(
                    color: Color(0x120F172A),
                    blurRadius: 6,
                    offset: Offset(0, 2),
                  ),
                ]
              : null,
        ),
        clipBehavior: Clip.antiAlias,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: Sp.md,
                  vertical: Sp.sm,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (icon != null) ...[
                      Icon(icon, size: 18, color: foreground),
                      const SizedBox(width: Sp.sm),
                    ],
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 200),
                      child: Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.labelMedium?.copyWith(
                          color: foreground,
                          fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Pill segmented control. Selected segment is a white card inside a
/// neutral-soft track, no sliding animation, so it stays cheap on 2 GB phones.
class SegmentBar extends StatelessWidget {
  const SegmentBar({
    super.key,
    required this.items,
    required this.index,
    required this.onChanged,
  });

  final List<String> items;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(Sp.xs),
      decoration: BoxDecoration(
        color: AppColors.surfaceTint,
        borderRadius: BorderRadius.circular(Radii.sm),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          for (var i = 0; i < items.length; i++)
            Expanded(
              child: Semantics(
                button: true,
                selected: i == index,
                child: Material(
                  color: i == index ? AppColors.primary : Colors.transparent,
                  clipBehavior: Clip.antiAlias,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: InkWell(
                    onTap: () => onChanged(i),
                    borderRadius: BorderRadius.circular(8),
                    child: SizedBox(
                      height: 46,
                      child: Center(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: Sp.sm,
                          ),
                          child: Text(
                            items[i],
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: text.labelMedium?.copyWith(
                              fontSize: 12,
                              color: i == index
                                  ? AppColors.onPrimary
                                  : AppColors.inkMuted,
                              fontWeight: i == index
                                  ? FontWeight.w700
                                  : FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

enum InfoTone { primary, success, warning, danger, neutral }

/// Soft tinted strip for guarantees, offline notes, and stale-data warnings.
class InfoStrip extends StatelessWidget {
  const InfoStrip({
    super.key,
    required this.message,
    this.icon = Icons.shield_outlined,
    this.tone = InfoTone.primary,
    this.actionLabel,
    this.onAction,
  });

  final String message;
  final IconData icon;
  final InfoTone tone;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final colors = _infoColors(tone);
    return Container(
      padding: const EdgeInsets.all(Sp.md),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(Radii.sm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(icon, size: 20, color: colors.foreground),
          ),
          const SizedBox(width: Sp.md),
          Expanded(
            child: Text(
              message,
              style: text.bodyMedium?.copyWith(fontSize: 13, height: 1.4),
            ),
          ),
          if (actionLabel != null) ...[
            const SizedBox(width: Sp.sm),
            TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                foregroundColor: colors.foreground,
                padding: const EdgeInsets.symmetric(horizontal: Sp.sm),
                minimumSize: const Size(0, 48),
                textStyle: text.labelSmall?.copyWith(
                  color: colors.foreground,
                  fontWeight: FontWeight.w700,
                ),
              ),
              child: Text(actionLabel!),
            ),
          ],
        ],
      ),
    );
  }
}

({Color background, Color foreground}) _infoColors(InfoTone tone) =>
    switch (tone) {
      InfoTone.primary => (
        background: AppColors.surfaceTint,
        foreground: AppColors.secondary,
      ),
      InfoTone.success => (
        background: AppColors.accentSoft,
        foreground: AppColors.accent,
      ),
      InfoTone.warning => (
        background: AppColors.warningSoft,
        foreground: AppColors.warning,
      ),
      InfoTone.danger => (
        background: AppColors.dangerSoft,
        foreground: AppColors.danger,
      ),
      InfoTone.neutral => (
        background: AppColors.neutralSoft,
        foreground: AppColors.inkMuted,
      ),
    };

enum PillTone { success, warning, danger, neutral, brand }

/// Compact status pill for booking, payment, and availability states.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.tone});

  final String label;
  final PillTone tone;

  @override
  Widget build(BuildContext context) {
    final colors = _pillColors(tone);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: Sp.sm,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: colors.foreground.withValues(alpha: 0.22),
        ),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: colors.foreground,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

({Color background, Color foreground}) _pillColors(PillTone tone) =>
    switch (tone) {
      PillTone.success => (
        background: AppColors.accentSoft,
        foreground: AppColors.accent,
      ),
      PillTone.warning => (
        background: AppColors.warningSoft,
        foreground: AppColors.warning,
      ),
      PillTone.danger => (
        background: AppColors.dangerSoft,
        foreground: AppColors.danger,
      ),
      PillTone.neutral => (
        background: AppColors.neutralSoft,
        foreground: AppColors.inkMuted,
      ),
      PillTone.brand => (
        background: AppColors.primarySoft,
        foreground: AppColors.primary,
      ),
    };

/// Fullscreen photo inspector dialog.
void showPhotoLightbox(BuildContext context, String url) {
  showDialog<void>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.9),
    builder: (context) => Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(Sp.md),
      child: Stack(
        alignment: Alignment.center,
        children: [
          InteractiveViewer(
            clipBehavior: Clip.none,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(Radii.lg),
              child: Image.network(
                url,
                fit: BoxFit.contain,
                errorBuilder: (context, error, stackTrace) => Container(
                  padding: const EdgeInsets.all(Sp.xl),
                  color: AppColors.card,
                  child: const Text('Foto tidak dapat dimuat.'),
                ),
              ),
            ),
          ),
          Positioned(
            top: 0,
            right: 0,
            child: IconButton(
              icon: const Icon(Icons.close, color: Colors.white, size: 28),
              onPressed: () => Navigator.of(context).pop(),
            ),
          ),
        ],
      ),
    ),
  );
}

/// Horizontal media reel for stage and vendor showcase photos.
class MediaGalleryReel extends StatelessWidget {
  const MediaGalleryReel({
    super.key,
    required this.photoUrls,
    this.title = 'Galeri Pentas & Panggung',
  });

  final List<String> photoUrls;
  final String title;

  @override
  Widget build(BuildContext context) {
    if (photoUrls.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.photo_library_outlined, size: 20, color: AppColors.primary),
            const SizedBox(width: Sp.xs + 2),
            Text(
              title,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                  ),
            ),
            const Spacer(),
            Text(
              '${photoUrls.length} Foto',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: AppColors.inkMuted,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ],
        ),
        const SizedBox(height: Sp.sm),
        SizedBox(
          height: 140,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: photoUrls.length,
            separatorBuilder: (_, __) => const SizedBox(width: Sp.sm),
            itemBuilder: (context, index) {
              final url = photoUrls[index];
              return InkWell(
                onTap: () => showPhotoLightbox(context, url),
                borderRadius: BorderRadius.circular(Radii.lg),
                child: Container(
                  width: 200,
                  height: 140,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(Radii.lg),
                    border: Border.all(color: AppColors.line),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      Image.network(
                        url,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                          color: AppColors.surfaceSoft,
                          child: const Icon(Icons.broken_image_outlined, color: AppColors.inkMuted),
                        ),
                      ),
                      Positioned(
                        bottom: Sp.xs,
                        right: Sp.xs,
                        child: Container(
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.6),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.fullscreen, color: Colors.white, size: 16),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

/// 16:9 Card displaying video teaser with play icon that launches external URL.
class StageVideoCard extends StatelessWidget {
  const StageVideoCard({
    super.key,
    required this.videoUrl,
    this.thumbnailUrl,
    this.vendorName = 'Penampilan Pentas',
    required this.onOpenVideo,
  });

  final String videoUrl;
  final String? thumbnailUrl;
  final String vendorName;
  final VoidCallback onOpenVideo;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.videocam_outlined, size: 20, color: AppColors.primary),
            const SizedBox(width: Sp.xs + 2),
            Text(
              'Cuplikan Video Pentas',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                  ),
            ),
          ],
        ),
        const SizedBox(height: Sp.sm),
        InkWell(
          onTap: onOpenVideo,
          borderRadius: BorderRadius.circular(Radii.lg),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Radii.lg),
              border: Border.all(color: AppColors.line),
              color: AppColors.card,
              boxShadow: const [
                BoxShadow(
                  color: Color(0x18000000),
                  blurRadius: 12,
                  offset: Offset(0, 4),
                ),
              ],
            ),
            clipBehavior: Clip.antiAlias,
            child: AspectRatio(
              aspectRatio: 16 / 9,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (thumbnailUrl != null && thumbnailUrl!.trim().isNotEmpty)
                    Image.network(
                      thumbnailUrl!.trim(),
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [Color(0xFF2A1B18), Color(0xFF140D0C)],
                          ),
                        ),
                      ),
                    )
                  else
                    const DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [Color(0xFF2A1B18), Color(0xFF140D0C)],
                        ),
                      ),
                    ),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        stops: const [0.3, 1.0],
                        colors: [
                          Colors.black.withValues(alpha: 0.2),
                          Colors.black.withValues(alpha: 0.75),
                        ],
                      ),
                    ),
                  ),
                  Center(
                    child: Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        color: AppColors.primary.withValues(alpha: 0.95),
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.primary.withValues(alpha: 0.4),
                            blurRadius: 16,
                            spreadRadius: 2,
                          ),
                        ],
                      ),
                      child: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 36),
                    ),
                  ),
                  Positioned(
                    bottom: Sp.md,
                    left: Sp.md,
                    right: Sp.md,
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(
                                'Putar Cuplikan Panggung',
                                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w700,
                                    ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Buka tautan pentas langsung',
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: Colors.white.withValues(alpha: 0.8),
                                      fontSize: 11,
                                    ),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.25),
                            borderRadius: BorderRadius.circular(Radii.pill),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.open_in_new, color: Colors.white, size: 13),
                              SizedBox(width: 4),
                              Text(
                                'Tonton',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
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
            ),
          ),
        ),
      ],
    );
  }
}

/// Rounded emblem used wherever the app needs a small brand mark.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(size * 0.25),
      child: Image.asset(
        'assets/images/logo_mark.png',
        width: size,
        height: size,
        fit: BoxFit.cover,
        semanticLabel: 'Logo Tarlink',
      ),
    );
  }
}

/// Brand lockup from the Stitch login: the Venue emblem in a soft badge, bold
/// wordmark, and the small "TANGGAP HIBURAN" caption. Reused by Login and Register.
class BrandLockup extends StatelessWidget {
  const BrandLockup({super.key, this.name = 'Tarlink', this.light = false});

  final String name;
  final bool light;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const BrandMark(),
        const SizedBox(width: Sp.sm),
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              name,
              style: text.titleMedium?.copyWith(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                height: 1.1,
                letterSpacing: -0.2,
                color: light ? AppColors.onPrimary : AppColors.ink,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              'TANGGAP HIBURAN',
              style: text.labelSmall?.copyWith(
                fontSize: 8,
                letterSpacing: 1.3,
                color: light
                    ? Colors.white.withValues(alpha: 0.55)
                    : AppColors.inkMuted,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Diagonal stage-light bands, generated from the same hash as the gradient so
/// every poster is consistent across launches and devices.
class _StageBandsPainter extends CustomPainter {
  const _StageBandsPainter({required this.seed, this.compact = false});

  final int seed;
  final bool compact;

  @override
  void paint(Canvas canvas, Size size) {
    final spotCenter = Offset(size.width * 0.35, -size.height * 0.1);
    final spotRadius = size.longestSide * 0.9;
    final spot = Paint()
      ..shader = RadialGradient(
        colors: [
          Colors.white.withValues(alpha: compact ? 0.08 : 0.14),
          Colors.white.withValues(alpha: 0),
        ],
      ).createShader(Rect.fromCircle(center: spotCenter, radius: spotRadius));
    canvas.drawCircle(spotCenter, spotRadius, spot);

    final paint = Paint()..style = PaintingStyle.fill;
    final slant = size.height * 0.55;
    final bandCount = compact ? 2 : 3;
    for (var i = 0; i < bandCount; i++) {
      final jitter = ((seed >> (i * 5)) & 0x7) / 7;
      final base = size.width * (0.22 + 0.26 * i) + jitter * size.width * 0.06;
      final width = size.width * (i == 1 ? 0.20 : 0.12);
      final path = Path()
        ..moveTo(base, size.height)
        ..lineTo(base + width, size.height)
        ..lineTo(base + width + slant, 0)
        ..lineTo(base + slant, 0)
        ..close();
      paint.color = Colors.white.withValues(alpha: 0.05 + i * 0.015);
      canvas.drawPath(path, paint);
    }

    if (!compact) {
      final particle = Paint()..style = PaintingStyle.fill;
      for (var i = 0; i < 18; i++) {
        final px = (((seed * 31 + i * 97) & 0x7fffffff) % 1000) / 1000.0 * size.width;
        final py = (((seed * 59 + i * 43) & 0x7fffffff) % 1000) / 1000.0 * size.height;
        final pr = 1.0 + (i % 3) * 0.6;
        final alpha = 0.08 + (i % 4) * 0.04;
        particle.color = Colors.white.withValues(alpha: alpha);
        canvas.drawCircle(Offset(px, py), pr, particle);
      }
    }

    final floorRect = Rect.fromLTWH(
      0,
      size.height * 0.55,
      size.width,
      size.height * 0.45,
    );
    final floor = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Colors.white.withValues(alpha: 0),
          Colors.white.withValues(alpha: 0.09),
        ],
      ).createShader(floorRect);
    canvas.drawRect(floorRect, floor);
  }

  @override
  bool shouldRepaint(_StageBandsPainter oldDelegate) =>
      oldDelegate.seed != seed || oldDelegate.compact != compact;
}

/// Modal bottom sheet date picker with Year, Month, and Calendar day selection.
/// Directly supports future event booking (e.g. next year or two years ahead).
Future<DateTime?> showTarlinkDatePicker({
  required BuildContext context,
  DateTime? initialDate,
  DateTime? firstDate,
  DateTime? lastDate,
}) {
  final now = DateTime.now();
  final start = firstDate ?? DateTime(now.year, now.month, now.day);
  final end = lastDate ?? DateTime(now.year + 3, 12, 31);
  final current = initialDate ?? start;

  return showModalBottomSheet<DateTime>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.card,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.xl)),
    ),
    builder: (_) => _TarlinkDatePickerSheet(
      initialDate: current,
      firstDate: start,
      lastDate: end,
    ),
  );
}

class _TarlinkDatePickerSheet extends StatefulWidget {
  const _TarlinkDatePickerSheet({
    required this.initialDate,
    required this.firstDate,
    required this.lastDate,
  });

  final DateTime initialDate;
  final DateTime firstDate;
  final DateTime lastDate;

  @override
  State<_TarlinkDatePickerSheet> createState() => _TarlinkDatePickerSheetState();
}

class _TarlinkDatePickerSheetState extends State<_TarlinkDatePickerSheet> {
  static const _months = <String>[
    'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
    'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
  ];
  static const _weekdays = <String>['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

  late int _selectedYear;
  late int _selectedMonth;
  late DateTime? _selectedDate;

  @override
  void initState() {
    super.initState();
    _selectedYear = widget.initialDate.year;
    _selectedMonth = widget.initialDate.month;
    _selectedDate = widget.initialDate;
  }

  void _onYearChanged(int year) {
    setState(() {
      _selectedYear = year;
      if (year == widget.firstDate.year && _selectedMonth < widget.firstDate.month) {
        _selectedMonth = widget.firstDate.month;
      }
      if (year == widget.lastDate.year && _selectedMonth > widget.lastDate.month) {
        _selectedMonth = widget.lastDate.month;
      }
      if (_selectedDate != null &&
          (_selectedDate!.year != _selectedYear || _selectedDate!.month != _selectedMonth)) {
        final days = DateTime(_selectedYear, _selectedMonth + 1, 0).day;
        final day = _selectedDate!.day.clamp(1, days);
        final candidate = DateTime(_selectedYear, _selectedMonth, day);
        if (!candidate.isBefore(widget.firstDate) && !candidate.isAfter(widget.lastDate)) {
          _selectedDate = candidate;
        } else {
          _selectedDate = null;
        }
      }
    });
  }

  void _onMonthChanged(int month) {
    setState(() {
      _selectedMonth = month;
      if (_selectedDate != null) {
        final days = DateTime(_selectedYear, _selectedMonth + 1, 0).day;
        final day = _selectedDate!.day.clamp(1, days);
        final candidate = DateTime(_selectedYear, _selectedMonth, day);
        if (!candidate.isBefore(widget.firstDate) && !candidate.isAfter(widget.lastDate)) {
          _selectedDate = candidate;
        } else {
          _selectedDate = null;
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final years = [
      for (var y = widget.firstDate.year; y <= widget.lastDate.year; y++) y
    ];

    final daysInMonth = DateTime(_selectedYear, _selectedMonth + 1, 0).day;
    final firstWeekday = DateTime(_selectedYear, _selectedMonth, 1).weekday;
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, Sp.md + bottomInset),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Pilih Tanggal Acara',
                        style: text.titleMedium?.copyWith(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Tentukan tahun, bulan, dan hari sewa hiburan.',
                        style: text.bodySmall?.copyWith(color: AppColors.inkMuted),
                      ),
                    ],
                  ),
                ),
                Material(
                  color: AppColors.surfaceSoft,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Radii.sm),
                    side: const BorderSide(color: AppColors.line),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: () => Navigator.pop(context),
                    child: const SizedBox(
                      width: 34,
                      height: 34,
                      child: Center(
                        child: Icon(Icons.close, size: 18, color: AppColors.ink),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: Sp.md),
            // Live Selected Date Banner with prominent YEAR
            Container(
              padding: const EdgeInsets.symmetric(horizontal: Sp.md, vertical: Sp.sm + 2),
              decoration: BoxDecoration(
                color: AppColors.surfaceSoft,
                borderRadius: BorderRadius.circular(Radii.sm),
                border: Border.all(color: AppColors.line),
              ),
              child: Row(
                children: [
                  const Icon(Icons.event_outlined, size: 18, color: AppColors.primary),
                  const SizedBox(width: Sp.sm),
                  Expanded(
                    child: Text(
                      _selectedDate != null
                          ? '${_weekdays[_selectedDate!.weekday - 1]}, ${formatDate(_selectedDate!)}'
                          : 'Pilih hari pada kalender',
                      style: text.labelMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: _selectedDate != null ? AppColors.ink : AppColors.inkMuted,
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.circular(Radii.sm),
                    ),
                    child: Text(
                      'Tahun $_selectedYear',
                      style: text.labelSmall?.copyWith(
                        color: AppColors.onPrimary,
                        fontWeight: FontWeight.w700,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: Sp.md),
            Row(
              children: [
                Text(
                  'Tahun:',
                  style: text.labelSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.5,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(width: Sp.sm),
                Expanded(
                  child: SizedBox(
                    height: 38,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: years.length,
                      separatorBuilder: (_, _) => const SizedBox(width: Sp.xs),
                      itemBuilder: (context, index) {
                        final y = years[index];
                        final isSelected = y == _selectedYear;
                        return ChoiceChip(
                          label: Text('$y'),
                          selected: isSelected,
                          onSelected: (_) => _onYearChanged(y),
                          selectedColor: AppColors.primary,
                          labelStyle: TextStyle(
                            color: isSelected ? AppColors.onPrimary : AppColors.ink,
                            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w600,
                            fontSize: 13,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(Radii.sm),
                            side: BorderSide(
                              color: isSelected ? AppColors.primary : AppColors.line,
                            ),
                          ),
                          visualDensity: VisualDensity.compact,
                        );
                      },
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: Sp.sm),
            SizedBox(
              height: 40,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: 12,
                separatorBuilder: (_, _) => const SizedBox(width: Sp.xs),
                itemBuilder: (context, index) {
                  final m = index + 1;
                  final isSelected = m == _selectedMonth;
                  final isDisabled = (_selectedYear == widget.firstDate.year && m < widget.firstDate.month) ||
                      (_selectedYear == widget.lastDate.year && m > widget.lastDate.month);
                  return ChoiceChip(
                    label: Text(_months[index]),
                    selected: isSelected,
                    onSelected: isDisabled ? null : (_) => _onMonthChanged(m),
                    selectedColor: AppColors.primaryContainer,
                    labelStyle: TextStyle(
                      color: isDisabled
                          ? AppColors.lineStrong.withValues(alpha: 0.5)
                          : (isSelected ? AppColors.onPrimary : AppColors.ink),
                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                      fontSize: 13,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(Radii.sm),
                      side: BorderSide(
                        color: isSelected ? AppColors.primaryContainer : AppColors.line,
                      ),
                    ),
                    visualDensity: VisualDensity.compact,
                  );
                },
              ),
            ),
            const SizedBox(height: Sp.md),
            Row(
              children: [
                for (final w in _weekdays)
                  Expanded(
                    child: Center(
                      child: Text(
                        w,
                        style: text.labelSmall?.copyWith(
                          color: AppColors.inkMuted,
                          fontWeight: FontWeight.w600,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: Sp.xs),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 210),
              child: GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 7,
                  mainAxisSpacing: 2,
                  crossAxisSpacing: 2,
                  childAspectRatio: 1.35,
                ),
                itemCount: (firstWeekday - 1) + daysInMonth,
                itemBuilder: (context, index) {
                  if (index < firstWeekday - 1) {
                    return const SizedBox.shrink();
                  }
                  final day = index - (firstWeekday - 1) + 1;
                  final date = DateTime(_selectedYear, _selectedMonth, day);
                  final isPast = date.isBefore(widget.firstDate);
                  final isAfterLast = date.isAfter(widget.lastDate);
                  final isDisabled = isPast || isAfterLast;
                  final isSelected = _selectedDate != null &&
                      _selectedDate!.year == _selectedYear &&
                      _selectedDate!.month == _selectedMonth &&
                      _selectedDate!.day == day;

                  return Material(
                    color: isSelected ? AppColors.primary : Colors.transparent,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                      side: isSelected
                          ? const BorderSide(color: AppColors.primary)
                          : BorderSide.none,
                    ),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: isDisabled
                          ? null
                          : () => setState(() => _selectedDate = date),
                      child: Center(
                        child: Text(
                          '$day',
                          style: TextStyle(
                            fontSize: 13,
                            fontFamily: 'Plus Jakarta Sans',
                            fontFamilyFallback: const ['PlusJakartaSans', 'sans-serif'],
                            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                            color: isSelected
                                ? AppColors.onPrimary
                                : (isDisabled ? AppColors.line : AppColors.ink),
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: Sp.md),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(Radii.sm),
                      ),
                    ),
                    child: const Text('Batal'),
                  ),
                ),
                const SizedBox(width: Sp.md),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: _selectedDate == null
                        ? null
                        : () => Navigator.pop(context, _selectedDate),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(Radii.sm),
                      ),
                    ),
                    child: Text(
                      _selectedDate == null
                          ? 'Pilih tanggal'
                          : 'Pilih ${formatDate(_selectedDate!)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
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
