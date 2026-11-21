import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'session.dart';

/// Compile-time FCM configuration. No `google-services.json` ships with the
/// repository: the four values arrive as `--dart-define`, and an empty value
/// disables push instead of crashing the first frame.
const _apiKey = String.fromEnvironment('FCM_API_KEY');
const _appId = String.fromEnvironment('FCM_APP_ID');
const _senderId = String.fromEnvironment('FCM_MESSAGING_SENDER_ID');
const _projectId = String.fromEnvironment('FCM_PROJECT_ID');

/// Pure gate in front of `Firebase.initializeApp`. Returns `null` when any of
/// the four values is missing, which keeps a config-less build working and lets
/// the test suite cover the decision without touching Firebase.
FirebaseOptions? firebaseOptionsFrom({
  String apiKey = _apiKey,
  String appId = _appId,
  String messagingSenderId = _senderId,
  String projectId = _projectId,
}) {
  final key = apiKey.trim();
  final id = appId.trim();
  final sender = messagingSenderId.trim();
  final project = projectId.trim();
  if (key.isEmpty || id.isEmpty || sender.isEmpty || project.isEmpty) {
    return null;
  }
  return FirebaseOptions(
    apiKey: key,
    appId: id,
    messagingSenderId: sender,
    projectId: project,
  );
}

/// Runs in its own isolate for messages that arrive while the app is in the
/// background or terminated. It re-creates Firebase from the same dart-defines
/// and only records the message id; the in-app inbox stays owned by the poller.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  final options = firebaseOptionsFrom();
  if (options == null) return;
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(options: options);
    }
  } catch (error) {
    debugPrint('Push: latar belakang tidak bisa memakai Firebase '
        '(${error.runtimeType}).');
    return;
  }
  debugPrint('Push: pesan latar ${message.messageId ?? '-'} diterima.');
}

/// FCM client: registers the device token, forwards foreground messages to the
/// existing SnackBar, and routes notification taps to the related booking.
///
/// Nothing here is allowed to break the app. A missing Play Services install, a
/// build without the dart-defines, or an unreachable API all degrade to "no
/// push" with one debug line — never a crash and never a token in a log.
class PushService {
  PushService({this.onForeground});

  /// Called for foreground messages so the app can reuse its in-app popup.
  final void Function(String title, String body, String? bookingId)? onForeground;

  ApiClient? _api;
  StreamSubscription<String>? _tokenChanges;
  StreamSubscription<RemoteMessage>? _messages;
  StreamSubscription<RemoteMessage>? _opened;
  String? _lastToken;
  bool _started = false;

  /// `true` once Firebase was initialised in this process.
  bool get started => _started;

  Future<void> start({
    required Session session,
    required ApiClient api,
    required void Function(String bookingId) onOpenBooking,
  }) async {
    if (kIsWeb) {
      debugPrint('Push: dilewati di web (notifikasi in-app tetap berjalan).');
      return;
    }
    if (_started) return;
    final options = firebaseOptionsFrom();
    if (options == null) {
      debugPrint(
        'Push: FCM_API_KEY/FCM_APP_ID/FCM_MESSAGING_SENDER_ID/FCM_PROJECT_ID '
        'kosong; notifikasi push dilewati.',
      );
      return;
    }
    // Registering a device without a session would 401 and leave a token that
    // nobody owns, so wait for the signed-in state.
    if (!session.authorized) return;

    _api = api;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(options: options);
      }
      // Only registered once Firebase exists: without options the plugin is
      // never touched, so a config-less build has no background entry point.
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();
      final token = await messaging.getToken();
      if (token != null && token.isNotEmpty) await _register(api, token);
    } catch (error) {
      // Missing Play Services, a blocked permission, or a bad config all land
      // here. In-app notifications keep working.
      debugPrint('Push: Firebase tidak bisa disiapkan di perangkat ini '
          '(${error.runtimeType}).');
      await _cancelSubscriptions();
      _api = null;
      return;
    }

    _started = true;
    _tokenChanges = FirebaseMessaging.instance.onTokenRefresh.listen((next) {
      _register(api, next);
    });
    _messages = FirebaseMessaging.onMessage.listen(_handleForeground);
    _opened = FirebaseMessaging.onMessageOpenedApp.listen((message) {
      final bookingId = _bookingIdOf(message);
      if (bookingId != null) onOpenBooking(bookingId);
    });

    try {
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      final bookingId = initial == null ? null : _bookingIdOf(initial);
      if (bookingId != null) onOpenBooking(bookingId);
    } catch (error) {
      debugPrint('Push: pesan pembuka tidak bisa dibaca '
          '(${error.runtimeType}).');
    }
  }

  /// Sign-out path: drop the server row for the last token, then the streams.
  Future<void> stop() async {
    await _cancelSubscriptions();
    final api = _api;
    final token = _lastToken;
    _api = null;
    _lastToken = null;
    _started = false;
    if (api == null || token == null) return;
    try {
      await api.delete('/devices/${Uri.encodeComponent(token)}');
    } catch (_) {
      // Best effort by contract: signing out must never wait on the network.
    }
  }

  void _handleForeground(RemoteMessage message) {
    final callback = onForeground;
    if (callback == null) return;
    final notification = message.notification;
    final title = notification?.title?.trim() ?? '';
    final body = notification?.body?.trim() ?? '';
    if (title.isEmpty && body.isEmpty) return;
    callback(
      title.isEmpty ? 'Notifikasi' : title,
      body,
      _bookingIdOf(message),
    );
  }

  /// A push only counts as a deep link when `booking_id` is a non-empty string;
  /// anything else (numbers, maps, blank values) is ignored.
  String? _bookingIdOf(RemoteMessage message) {
    final value = message.data['booking_id'];
    if (value is! String) return null;
    final id = value.trim();
    return id.isEmpty ? null : id;
  }

  Future<void> _register(ApiClient api, String token) async {
    final value = token.trim();
    if (value.isEmpty) return;
    _lastToken = value;
    try {
      await api.post('/devices', body: {'token': value, 'platform': 'android'});
    } catch (_) {
      // The next token refresh or cold start retries. No token in the log.
      debugPrint('Push: token perangkat belum terdaftar di server.');
    }
  }

  Future<void> _cancelSubscriptions() async {
    final changes = _tokenChanges;
    final messages = _messages;
    final opened = _opened;
    _tokenChanges = null;
    _messages = null;
    _opened = null;
    await changes?.cancel();
    await messages?.cancel();
    await opened?.cancel();
  }
}
