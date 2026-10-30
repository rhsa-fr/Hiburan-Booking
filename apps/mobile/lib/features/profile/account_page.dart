import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/app.dart';
import '../../app/routes.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';
import '../booking/booking_support.dart';

/// Support line the customer can reach from the account tab.
const _supportWhatsApp = '6281234567890';
const _supportMessage = 'Halo Tarlink, saya butuh bantuan soal akun saya.';

class AccountPage extends StatefulWidget {
  const AccountPage({super.key});

  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> {
  AppUser? _user;
  bool _loading = true;
  String? _error;
  bool _started = false;
  bool _signingOut = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    _user = AppScope.of(context).session.user;
    _load();
  }

  Future<void> _load() async {
    final api = AppScope.of(context).api;
    try {
      final raw = await api.get('/auth/me');
      final data = raw is Map ? raw.cast<String, dynamic>() : null;
      final user = data?['user'];
      if (user is! Map) {
        throw const ApiException(
          code: 'INTERNAL_ERROR',
          message: 'Profil tidak lengkap.',
        );
      }
      if (!mounted) return;
      setState(() {
        _user = AppUser.fromJson(user.cast<String, dynamic>());
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

  void _retry() {
    setState(() {
      _loading = true;
      _error = null;
    });
    _load();
  }

  Future<void> _openPolicy(String code, String title) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.lg)),
      ),
      builder: (_) => _PolicySheet(code: code, title: title),
    );
  }

  Future<void> _openWhatsApp() async {
    final digits = whatsappDigits(_supportWhatsApp);
    if (digits == null) return;
    final uri = Uri.parse(
      'https://wa.me/$digits?text=${Uri.encodeComponent(_supportMessage)}',
    );
    var opened = false;
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
    if (!mounted || opened) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('WhatsApp tidak bisa dibuka di perangkat ini.'),
      ),
    );
  }

  /// Revoke the token best effort, then always clear locally and go to login.
  Future<void> _confirmSignOut() async {
    if (_signingOut) return;
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      useSafeArea: true,
      backgroundColor: AppColors.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.lg)),
      ),
      builder: (_) => const _SignOutSheet(),
    );
    if (confirmed != true || !mounted) return;

    final scope = AppScope.of(context);
    setState(() => _signingOut = true);
    try {
      await scope.api.post('/auth/logout');
    } on ApiException {
      // Revocation is best effort; the local session must go either way.
    }
    await scope.session.signOut();
    if (!mounted) return;
    Navigator.pushNamedAndRemoveUntil(context, Routes.login, (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    final user = _user;
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;

    return Scaffold(
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const StageHeader(
            title: 'Profil Pengguna',
            subtitle: 'Pengaturan akun dan sesi Tarlink',
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(
                Sp.lg,
                Sp.xl,
                Sp.lg,
                Sp.xl + bottomInset,
              ),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (user == null)
                        if (_loading)
                          const AppLoading(rows: 2, label: 'Memuat profil')
                        else
                          AppError(
                            message:
                                _error ??
                                'Profil tidak bisa dimuat. Periksa sinyal, '
                                    'lalu coba lagi.',
                            onRetry: _retry,
                          )
                      else ...[
                        _IdentityCard(user: user),
                        if (_error != null) ...[
                          const SizedBox(height: Sp.md),
                          InfoStrip(
                            message: _error!,
                            icon: Icons.cloud_off_outlined,
                            tone: InfoTone.danger,
                            actionLabel: 'Coba lagi',
                            onAction: _retry,
                          ),
                        ],
                      ],
                      const SizedBox(height: Sp.xl),
                      const SectionHeader(title: 'Bantuan & kebijakan'),
                      const SizedBox(height: Sp.md),
                      _menuCard(),
                      const SizedBox(height: Sp.xl),
                      Text(
                        'Tarlink · Versi 0.1.0',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppColors.inkMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _menuCard() {
    return Material(
      color: AppColors.card,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Radii.lg),
        side: const BorderSide(color: AppColors.line),
      ),
      child: Column(
        children: [
          _MenuRow(
            icon: Icons.assignment_return_outlined,
            label: 'Kebijakan pembatalan',
            onTap: () => _openPolicy('cancellation', 'Kebijakan pembatalan'),
          ),
          const Divider(height: 1, thickness: 1, color: AppColors.line),
          _MenuRow(
            icon: Icons.privacy_tip_outlined,
            label: 'Kebijakan privasi',
            onTap: () => _openPolicy('privacy', 'Kebijakan privasi'),
          ),
          const Divider(height: 1, thickness: 1, color: AppColors.line),
          _MenuRow(
            icon: Icons.chat_bubble_outline,
            label: 'Bantuan via WhatsApp',
            onTap: _openWhatsApp,
          ),
          const Divider(height: 1, thickness: 1, color: AppColors.line),
          _MenuRow(
            icon: Icons.logout,
            label: 'Keluar',
            danger: true,
            onTap: _signingOut ? null : _confirmSignOut,
            trailing: _signingOut
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : null,
          ),
        ],
      ),
    );
  }
}

class _IdentityCard extends StatelessWidget {
  const _IdentityCard({required this.user});

  final AppUser user;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final name = user.fullName?.trim() ?? '';
    final phone = _formatPhone(user.phone);
    final email = user.email?.trim() ?? '';
    final title = name.isNotEmpty ? name : phone;
    final showPhone = name.isNotEmpty && phone.isNotEmpty;

    return Container(
      padding: const EdgeInsets.all(Sp.lg),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(Radii.lg),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: AppColors.primarySoft,
              shape: BoxShape.circle,
            ),
            child: Text(
              _monogram(user),
              style: const TextStyle(
                fontSize: 18,
                height: 1,
                fontWeight: FontWeight.w700,
                color: AppColors.primary,
              ),
            ),
          ),
          const SizedBox(width: Sp.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title.isEmpty ? 'Akun Tarlink' : title,
                  style: text.titleLarge,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (showPhone) ...[
                  const SizedBox(height: Sp.xs),
                  Text(
                    phone,
                    style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                if (email.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    email,
                    style: text.bodySmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MenuRow extends StatelessWidget {
  const _MenuRow({
    required this.icon,
    required this.label,
    required this.onTap,
    this.danger = false,
    this.trailing,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool danger;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final color = danger ? AppColors.danger : AppColors.ink;
    return Semantics(
      button: true,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 56,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: Sp.lg),
            child: Row(
              children: [
                Icon(
                  icon,
                  size: 20,
                  color: danger ? AppColors.danger : AppColors.inkMuted,
                ),
                const SizedBox(width: Sp.md),
                Expanded(
                  child: Text(
                    label,
                    style: text.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: color,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (trailing != null)
                  trailing!
                else
                  const Icon(
                    Icons.chevron_right,
                    size: 20,
                    color: AppColors.inkMuted,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SignOutSheet extends StatelessWidget {
  const _SignOutSheet();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Sp.xl, Sp.sm, Sp.xl, Sp.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
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
            const SizedBox(height: Sp.xl),
            Text('Keluar dari akun?', style: text.titleLarge),
            const SizedBox(height: Sp.sm),
            Text(
              'Kamu perlu masuk lagi untuk melihat booking.',
              style: text.bodyMedium?.copyWith(color: AppColors.inkMuted),
            ),
            const SizedBox(height: Sp.xl),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context, false),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      foregroundColor: AppColors.ink,
                      side: const BorderSide(color: AppColors.line),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(Radii.sm),
                      ),
                    ),
                    child: const Text('Batal'),
                  ),
                ),
                const SizedBox(width: Sp.md),
                Expanded(
                  child: FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      backgroundColor: AppColors.danger,
                      foregroundColor: AppColors.onPrimary,
                    ),
                    child: const Text('Keluar'),
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

class _PolicySheet extends StatefulWidget {
  const _PolicySheet({required this.code, required this.title});

  final String code;
  final String title;

  @override
  State<_PolicySheet> createState() => _PolicySheetState();
}

class _PolicySheetState extends State<_PolicySheet> {
  Policy? _policy;
  bool _loading = true;
  String? _error;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
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
            const Divider(height: 1, thickness: 1, color: AppColors.line),
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
              color: AppColors.primary,
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

/// `6281234567890` → `+62 812-3456-7890`; other shapes keep their digits.
String _formatPhone(String raw) {
  var digits = raw.replaceAll(RegExp(r'\D'), '');
  if (digits.isEmpty) return '';
  if (digits.startsWith('0')) {
    digits = '62${digits.substring(1)}';
  } else if (!digits.startsWith('62')) {
    digits = '62$digits';
  }
  if (digits.length <= 2) return '+$digits';

  final national = digits.substring(2);
  if (national.length < 7) return '+62 $national';

  final parts = <String>[national.substring(0, 3)];
  final rest = national.substring(3);
  for (var index = 0; index < rest.length; index += 4) {
    final end = index + 4 <= rest.length ? index + 4 : rest.length;
    parts.add(rest.substring(index, end));
  }
  return '+62 ${parts.join('-')}';
}

String _monogram(AppUser user) {
  final name = user.fullName?.trim() ?? '';
  if (name.isNotEmpty) {
    final words = name
        .split(RegExp(r'\s+'))
        .where((word) => word.isNotEmpty)
        .toList(growable: false);
    if (words.length == 1) {
      return words.first.length >= 2
          ? words.first.substring(0, 2).toUpperCase()
          : words.first.toUpperCase();
    }
    return (words.first.substring(0, 1) + words.last.substring(0, 1))
        .toUpperCase();
  }
  final digits = user.phone.replaceAll(RegExp(r'\D'), '');
  if (digits.length >= 2) return digits.substring(digits.length - 2);
  return 'T';
}
