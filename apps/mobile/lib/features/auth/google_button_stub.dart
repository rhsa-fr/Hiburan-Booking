import 'package:flutter/material.dart';

/// Placeholder untuk platform non-web. Di Android/iOS login Google memakai
/// tombol custom + `GoogleAuth.idToken()`, bukan widget GIS.
class GoogleSignInWebButton extends StatelessWidget {
  const GoogleSignInWebButton({super.key, required this.onIdToken});

  final ValueChanged<String?> onIdToken;

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
