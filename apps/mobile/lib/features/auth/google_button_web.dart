import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:google_sign_in_web/web_only.dart' as gsi_web;

import 'google_auth.dart';

/// Tombol resmi Google Identity Services untuk build web.
///
/// `google_sign_in` 7.x menolak `authenticate()` di web
/// (`UnimplementedError`), jadi web wajib memakai tombol yang dirender GIS.
/// Token diambil dari stream `authenticationEvents`, bukan dari nilai balik
/// tombol.
class GoogleSignInWebButton extends StatefulWidget {
  const GoogleSignInWebButton({super.key, required this.onIdToken});

  /// Dipanggil dengan ID token Google, atau `null` bila tidak ada token.
  final ValueChanged<String?> onIdToken;

  @override
  State<GoogleSignInWebButton> createState() => _GoogleSignInWebButtonState();
}

class _GoogleSignInWebButtonState extends State<GoogleSignInWebButton> {
  StreamSubscription<GoogleSignInAuthenticationEvent>? _subscription;
  late final Future<void> _ready = GoogleAuth.ensureInitialized();

  @override
  void initState() {
    super.initState();
    _subscription = GoogleSignIn.instance.authenticationEvents.listen((event) {
      if (event is GoogleSignInAuthenticationEventSignIn) {
        widget.onIdToken(event.user.authentication.idToken);
      }
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<void>(
      future: _ready,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Text(
            'Google belum siap: ${snapshot.error}',
            style: Theme.of(context).textTheme.bodySmall,
          );
        }
        if (snapshot.connectionState != ConnectionState.done) {
          return const SizedBox(
            height: 52,
            child: Center(
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          );
        }
        return SizedBox(
          height: 52,
          child: gsi_web.renderButton(
            configuration: gsi_web.GSIButtonConfiguration(
              size: gsi_web.GSIButtonSize.large,
              text: gsi_web.GSIButtonText.signinWith,
              shape: gsi_web.GSIButtonShape.pill,
              theme: gsi_web.GSIButtonTheme.outline,
              logoAlignment: gsi_web.GSIButtonLogoAlignment.center,
            ),
          ),
        );
      },
    );
  }
}
