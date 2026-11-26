import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/widgets.dart';
import '../booking/booking_support.dart';

/// Scrollable policy bottom sheet shared by Profil and the vendor wizard.
///
/// `tos`/`privacy`/`cancellation` keep their tier rendering; long-form policies
/// (Ketentuan Mitra) send `body.sections`, which renders as headed paragraphs
/// instead of a generic key/value dump. [preloaded] skips the network call when
/// the eligibility response already carried the policy body.
class PolicySheet extends StatefulWidget {
  const PolicySheet({
    super.key,
    required this.code,
    required this.title,
    this.preloaded,
  });

  final String code;
  final String title;
  final Policy? preloaded;

  @override
  State<PolicySheet> createState() => _PolicySheetState();
}

class _PolicySheetState extends State<PolicySheet> {
  Policy? _policy;
  bool _loading = true;
  String? _error;
  bool _started = false;

  @override
  void initState() {
    super.initState();
    final preloaded = widget.preloaded;
    _policy = preloaded;
    _loading = preloaded == null;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started || !_loading) return;
    _started = true;
    _load();
  }

  Future<void> _load() async {
    final api = AppScope.of(context).api;
    try {
      final raw = await api.get('/policies/${widget.code}');
      if (!mounted) return;
      setState(() {
        _policy = Policy.fromJson(_asMap(raw));
        _loading = false;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.statusCode == 404
            ? 'Kebijakan ini belum tersedia di server.'
            : apiMessage(error);
      });
    }
  }

  void _retry() {
    setState(() {
      _loading = true;
      _error = null;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.78,
      child: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: Sp.sm),
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.neutralSoft,
                  borderRadius: BorderRadius.circular(Radii.pill),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.sm, Sp.sm),
              child: Row(
                children: [
                  Expanded(child: Text(widget.title, style: text.titleLarge)),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    tooltip: 'Tutup',
                    icon: const Icon(Icons.close, size: 20),
                    color: AppColors.inkMuted,
                    constraints: const BoxConstraints(
                      minWidth: 48,
                      minHeight: 48,
                    ),
                  ),
                ],
              ),
            ),
            Divider(height: 1, thickness: 1, color: AppColors.line),
            Expanded(child: _content(context)),
          ],
        ),
      ),
    );
  }

  Widget _content(BuildContext context) {
    if (_loading) {
      return const SingleChildScrollView(
        padding: EdgeInsets.all(Sp.lg),
        child: AppLoading(label: 'Memuat kebijakan'),
      );
    }
    final message = _error;
    if (message != null) {
      return AppError(message: message, onRetry: _retry);
    }
    final policy = _policy;
    if (policy == null) {
      return const SizedBox.shrink();
    }

    final text = Theme.of(context).textTheme;
    final effective = policy.effectiveFrom.trim();
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, Sp.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (effective.isNotEmpty) ...[
            Text(
              'Berlaku sejak ${formatDateIso(effective)} · Versi '
              '${policy.version}',
              style: text.bodySmall,
            ),
            const SizedBox(height: Sp.lg),
          ],
          ..._bodyWidgets(context, policy),
        ],
      ),
    );
  }

  List<Widget> _bodyWidgets(BuildContext context, Policy policy) {
    final text = Theme.of(context).textTheme;
    final widgets = <Widget>[];
    final body = policy.body;

    void paragraph(String value) {
      widgets.add(Text(value, style: text.bodyMedium?.copyWith(height: 1.6)));
    }

    void heading(String value) {
      widgets.add(
        Text(
          value,
          style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
        ),
      );
      widgets.add(const SizedBox(height: Sp.sm));
    }

    if (body is String && body.trim().isNotEmpty) {
      paragraph(body.trim());
    } else if (body is Map) {
      final map = <String, dynamic>{};
      body.forEach((key, value) => map['$key'] = value);

      final sections = map['sections'];
      if (sections is List && sections.isNotEmpty) {
        final summary = map['ringkasan'];
        if (summary is String && summary.trim().isNotEmpty) {
          paragraph(summary.trim());
          widgets.add(const SizedBox(height: Sp.md));
        }
        for (final raw in sections.whereType<Map>()) {
          final sectionHeading = '${raw['heading'] ?? ''}'.trim();
          if (sectionHeading.isNotEmpty) heading(sectionHeading);
          final sectionBody = '${raw['body'] ?? ''}'.trim();
          if (sectionBody.isNotEmpty) {
            paragraph(sectionBody);
            widgets.add(const SizedBox(height: Sp.md));
          }
        }
        if (widgets.isNotEmpty) return widgets;
      }

      final tiers = map['tiers'];
      if (tiers is List && tiers.isNotEmpty) {
        final entries = tiers.whereType<Map>().toList()
          ..sort(
            (a, b) => _intValue(
              b['min_days_before'],
            ).compareTo(_intValue(a['min_days_before'])),
          );
        final positive =
            entries
                .map((entry) => _intValue(entry['min_days_before']))
                .where((days) => days > 0)
                .toList()
              ..sort();

        heading('Pengembalian DP');
        for (final entry in entries) {
          final days = _intValue(entry['min_days_before']);
          final when = days > 0
              ? 'Dibatalkan $days hari atau lebih sebelum acara'
              : positive.isEmpty
              ? 'Dibatalkan pada hari acara'
              : 'Dibatalkan kurang dari ${positive.first} hari '
                    'sebelum acara';
          widgets.add(
            _PolicyPair(
              label: when,
              value: _refundLabel(_intValue(entry['refund_percent_bp'])),
            ),
          );
        }
        widgets.add(const SizedBox(height: Sp.sm));
      }

      final vendorCancel = map['vendor_cancel'];
      if (vendorCancel is Map && vendorCancel['refund_percent_bp'] is num) {
        widgets.add(
          _PolicyPair(
            label: 'Jika vendor membatalkan',
            value: _refundLabel(_intValue(vendorCancel['refund_percent_bp'])),
          ),
        );
        widgets.add(const SizedBox(height: Sp.sm));
      }

      if (widgets.isEmpty) {
        for (final entry in map.entries) {
          final value = entry.value;
          if (value is String && value.trim().isNotEmpty) {
            widgets.add(
              _PolicyPair(label: _humanizeKey(entry.key), value: value.trim()),
            );
          } else if (value is num || value is bool) {
            widgets.add(
              _PolicyPair(label: _humanizeKey(entry.key), value: '$value'),
            );
          }
        }
      }
    }

    if (widgets.isEmpty) {
      widgets.add(
        Text(
          'Isi kebijakan belum bisa ditampilkan.',
          style: text.bodyMedium?.copyWith(color: AppColors.danger),
        ),
      );
    }
    return widgets;
  }
}

class _PolicyPair extends StatelessWidget {
  const _PolicyPair({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Sp.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
            ),
          ),
          const SizedBox(width: Sp.md),
          Text(
            value,
            textAlign: TextAlign.end,
            style: text.bodyMedium?.copyWith(
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
        ],
      ),
    );
  }
}

Map<String, dynamic> _asMap(dynamic value) =>
    value is Map ? value.cast<String, dynamic>() : const <String, dynamic>{};

int _intValue(dynamic value) {
  if (value is num) return value.toInt();
  return int.tryParse('$value') ?? 0;
}

String _refundLabel(int basisPoints) {
  final percent = basisPoints / 100;
  if (percent >= 100) return 'DP dikembalikan penuh';
  if (percent <= 0) return 'DP tidak dikembalikan';
  return 'DP dikembalikan ${_percentText(percent)}%';
}

String _percentText(double value) => value == value.roundToDouble()
    ? '${value.round()}'
    : value.toStringAsFixed(1).replaceAll('.', ',');

String _humanizeKey(String key) {
  final words = key.replaceAll(RegExp(r'[_-]+'), ' ').trim();
  if (words.isEmpty) return key;
  return words[0].toUpperCase() + words.substring(1);
}
