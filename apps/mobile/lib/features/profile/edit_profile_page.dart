import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';

/// Editable personal profile, shared by the customer tab and vendor portal.
/// Email is read-only: changing a login email needs a fresh verification code.
class EditProfilePage extends StatefulWidget {
  const EditProfilePage({super.key});

  @override
  State<EditProfilePage> createState() => _EditProfilePageState();
}

class _EditProfilePageState extends State<EditProfilePage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _email;
  bool _loaded = false;
  bool _saving = false;
  String? _error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_loaded) return;
    _loaded = true;
    final user = AppScope.of(context).session.user;
    _name = TextEditingController(text: user?.fullName ?? '');
    _phone = TextEditingController(text: user?.phone ?? '');
    _email = TextEditingController(text: user?.email ?? '');
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving || !_formKey.currentState!.validate()) return;
    final scope = AppScope.of(context);
    setState(() {
      _saving = true;
      _error = null;
    });

    final phone = _phone.text.trim();
    try {
      final raw = await scope.api.patch(
        '/auth/me',
        body: {
          'full_name': _name.text.trim(),
          if (phone.isNotEmpty) 'phone': phone,
        },
      );
      final payload = raw is Map ? raw.cast<String, dynamic>() : null;
      final user = payload?['user'];
      if (user is Map) {
        await scope.session.updateUser(user.cast<String, dynamic>());
      }
      if (!mounted) return;
      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error.userMessage;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'Profil tidak bisa disimpan. Periksa sinyal lalu coba lagi.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: Column(
        children: [
          StageHeader.back(
            context: context,
            title: 'Edit profil',
            subtitle: 'Nama dan nomor yang dipakai vendor menghubungimu',
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(Sp.lg),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (_error != null) ...[
                          InfoStrip(
                            message: _error!,
                            icon: Icons.error_outline,
                            tone: InfoTone.danger,
                          ),
                          const SizedBox(height: Sp.md),
                        ],
                        Container(
                          padding: const EdgeInsets.all(Sp.lg),
                          decoration: BoxDecoration(
                            color: AppColors.card,
                            borderRadius: BorderRadius.circular(Radii.lg),
                            border: Border.all(color: AppColors.line),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              TextFormField(
                                controller: _name,
                                textInputAction: TextInputAction.next,
                                decoration: const InputDecoration(
                                  labelText: 'Nama lengkap',
                                  hintText: 'Nama yang tampil di profil',
                                ),
                                validator: (value) {
                                  final v = (value ?? '').trim();
                                  if (v.isEmpty) return 'Nama wajib diisi.';
                                  if (v.length > 100) {
                                    return 'Nama maksimal 100 karakter.';
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: Sp.md),
                              TextFormField(
                                controller: _phone,
                                keyboardType: TextInputType.phone,
                                textInputAction: TextInputAction.next,
                                decoration: const InputDecoration(
                                  labelText: 'Nomor WhatsApp',
                                  hintText: '08xx atau 62xx',
                                ),
                                validator: (value) {
                                  final v = (value ?? '').trim();
                                  if (v.isEmpty) return null;
                                  final digits = v.replaceAll(RegExp(r'\D'), '');
                                  if (digits.length < 9 || digits.length > 15) {
                                    return 'Nomor tidak valid.';
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: Sp.md),
                              TextFormField(
                                controller: _email,
                                readOnly: true,
                                enabled: false,
                                decoration: const InputDecoration(
                                  labelText: 'Email',
                                  helperText:
                                      'Email dipakai untuk login dan tidak bisa '
                                      'diubah di sini.',
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: Sp.lg),
                        PrimaryButton(
                          label: 'Simpan profil',
                          loading: _saving,
                          loadingLabel: 'Menyimpan…',
                          onPressed: _saving ? null : _save,
                        ),
                        const SizedBox(height: Sp.sm),
                        Text(
                          'Perubahan langsung berlaku di aplikasi pelanggan '
                          'maupun mode vendor.',
                          textAlign: TextAlign.center,
                          style: text.bodySmall?.copyWith(
                            color: AppColors.inkMuted,
                          ),
                        ),
                      ],
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
