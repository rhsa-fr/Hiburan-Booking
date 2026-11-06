import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../../app/app.dart';
import '../../app/theme.dart';
import '../../core/api_exception.dart';
import '../../core/chat.dart';
import '../../core/chat_socket.dart';
import '../../core/format.dart';
import '../../core/ui.dart';
import '../../core/widgets.dart';

/// Thread chat per booking. History comes from REST; new messages arrive on the
/// WebSocket and are also stored by the API before the server broadcasts them.
class ChatPage extends StatefulWidget {
  const ChatPage({
    super.key,
    required this.bookingId,
    required this.title,
    this.subtitle,
  });

  final String bookingId;
  final String title;
  final String? subtitle;

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _input = TextEditingController();
  final _scroll = ScrollController();

  final List<ChatMessage> _messages = <ChatMessage>[];
  bool _loading = true;
  bool _loadingOlder = false;
  bool _sending = false;
  bool _connecting = false;
  bool _connected = false;
  String? _error;
  String? _sendError;
  String? _nextBefore;

  ChatSocket? _socket;
  Timer? _reconnectTimer;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _load();
      _connect();
    });
  }

  @override
  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _socket?.close();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final api = AppScope.of(context).api;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final raw = await api.get(
        '/bookings/${widget.bookingId}/chat/messages',
        query: const {'limit': '50'},
      );
      final data = raw is Map ? raw : const <String, dynamic>{};
      final items = data['items'] is List ? data['items'] as List : const [];
      final parsed = <ChatMessage>[];
      for (final item in items) {
        if (item is! Map) continue;
        final message = ChatMessage.fromJson(item.cast<String, dynamic>());
        if (message != null) parsed.add(message);
      }
      if (!mounted) return;
      setState(() {
        _messages
          ..clear()
          ..addAll(parsed);
        _nextBefore = data['next_before'] is String
            ? data['next_before'] as String
            : null;
        _loading = false;
      });
      _scrollToBottom();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _messageFor(error);
      });
    }
  }

  Future<void> _loadOlder() async {
    final before = _nextBefore;
    if (before == null || _loadingOlder) return;
    final api = AppScope.of(context).api;
    setState(() => _loadingOlder = true);
    try {
      final raw = await api.get(
        '/bookings/${widget.bookingId}/chat/messages',
        query: {'limit': '50', 'before': before},
      );
      final data = raw is Map ? raw : const <String, dynamic>{};
      final items = data['items'] is List ? data['items'] as List : const [];
      final parsed = <ChatMessage>[];
      for (final item in items) {
        if (item is! Map) continue;
        final message = ChatMessage.fromJson(item.cast<String, dynamic>());
        if (message != null) parsed.add(message);
      }
      final previousExtent = _scroll.hasClients
          ? _scroll.position.maxScrollExtent
          : 0.0;
      if (!mounted) return;
      setState(() {
        _messages.insertAll(0, parsed);
        _nextBefore = data['next_before'] is String
            ? data['next_before'] as String
            : null;
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!_scroll.hasClients) return;
        final delta = _scroll.position.maxScrollExtent - previousExtent;
        if (delta > 0) _scroll.jumpTo(_scroll.position.pixels + delta);
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _sendError = _messageFor(error));
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  Future<void> _connect() async {
    if (_disposed || _connecting || _socket != null) return;
    final scope = AppScope.of(context);
    final token = scope.session.token;
    if (token == null) return;

    _connecting = true;
    try {
      final socket = await connectChatSocket(
        chatSocketUri(scope.api.baseUrl, token).toString(),
        onMessage: _onSocketData,
        onDone: _onSocketDone,
      );
      if (_disposed || !mounted) {
        await socket.close();
        return;
      }
      _socket = socket;
      socket.send(
        jsonEncode({'type': 'subscribe', 'booking_id': widget.bookingId}),
      );
    } catch (_) {
      _scheduleReconnect();
    } finally {
      _connecting = false;
    }
  }

  void _onSocketData(String raw) {
    dynamic decoded;
    try {
      decoded = jsonDecode(raw);
    } catch (_) {
      return;
    }
    if (decoded is! Map) return;
    final data = decoded.cast<String, dynamic>();

    switch (data['type']) {
      case 'subscribed':
        if (mounted) setState(() => _connected = true);
      case 'message' || 'sent':
        final payload = data['message'];
        if (payload is! Map) return;
        final message = ChatMessage.fromJson(payload.cast<String, dynamic>());
        if (message != null) _upsert(message);
      case 'error':
        final text = data['message'];
        if (text is String && text.isNotEmpty && mounted) {
          setState(() => _sendError = text);
        }
    }
  }

  void _onSocketDone() {
    _socket = null;
    if (mounted) {
      setState(() => _connected = false);
    } else {
      _connected = false;
    }
    if (!_disposed) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_disposed || _reconnectTimer != null) return;
    _reconnectTimer = Timer(const Duration(seconds: 4), () {
      _reconnectTimer = null;
      if (!mounted) return;
      _connect();
    });
  }

  void _upsert(ChatMessage message) {
    if (_messages.any((existing) => existing.id == message.id)) return;
    setState(() {
      _messages.add(message);
      _messages.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    });
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _send() async {
    final body = _input.text.trim();
    if (body.isEmpty || _sending) return;
    final api = AppScope.of(context).api;
    setState(() {
      _sending = true;
      _sendError = null;
    });
    try {
      final raw = await api.post(
        '/bookings/${widget.bookingId}/chat/messages',
        body: {'body': body},
      );
      if (!mounted) return;
      final message = raw is Map
          ? ChatMessage.fromJson(raw.cast<String, dynamic>())
          : null;
      _input.clear();
      if (message != null) _upsert(message);
      setState(() => _sending = false);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _sendError = _messageFor(error);
      });
    }
  }

  String _messageFor(ApiException error) {
    final status = error.statusCode;
    if (status != null && status >= 400 && status < 500) return error.message;
    return error.userMessage;
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final ownId = AppScope.of(context).session.user?.id;

    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Column(
            children: [
              StageHeader.back(
                context: context,
                title: widget.title,
                subtitle: widget.subtitle,
              ),
              if (!_connected && !_loading)
                Padding(
                  padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.sm, Sp.lg, 0),
                  child: InfoStrip(
                    message: 'Menyambung ulang… pesan tetap bisa dikirim.',
                    icon: Icons.cloud_off_outlined,
                    tone: InfoTone.neutral,
                  ),
                ),
              Expanded(child: _body(text, ownId)),
            ],
          ),
        ),
      ),
      bottomNavigationBar: _composer(text),
    );
  }

  Widget _body(TextTheme text, String? ownId) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.all(Sp.lg),
        child: AppLoading(rows: 4, label: 'Memuat percakapan'),
      );
    }
    if (_error != null && _messages.isEmpty) {
      return AppError(
        message: _error!,
        onRetry: _load,
      );
    }
    if (_messages.isEmpty) {
      return const AppEmpty(
        message:
            'Belum ada pesan. Mulai dengan menyapa dan sebutkan kode booking.',
        icon: Icons.forum_outlined,
      );
    }

    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(Sp.lg, Sp.md, Sp.lg, Sp.md),
      itemCount: _messages.length + (_nextBefore == null ? 0 : 1),
      itemBuilder: (context, index) {
        if (_nextBefore != null && index == 0) {
          return Center(
            child: TextButton(
              onPressed: _loadingOlder ? null : _loadOlder,
              child: Text(_loadingOlder ? 'Memuat…' : 'Muat pesan lama'),
            ),
          );
        }
        final message = _messages[index - (_nextBefore == null ? 0 : 1)];
        return _Bubble(
          message: message,
          own: ownId != null && message.senderId == ownId,
          text: text,
        );
      },
    );
  }

  Widget _composer(TextTheme text) {
    return SafeArea(
      top: false,
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.card,
          border: Border(top: BorderSide(color: AppColors.line)),
        ),
        padding: const EdgeInsets.fromLTRB(Sp.md, Sp.sm, Sp.md, Sp.sm),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_sendError != null) ...[
              AppError(message: _sendError!, compact: true),
              const SizedBox(height: Sp.sm),
            ],
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 4,
                    maxLength: 2000,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                    decoration: InputDecoration(
                      hintText: 'Tulis pesan…',
                      counterText: '',
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: Sp.md,
                        vertical: Sp.sm,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(Radii.sm),
                        borderSide: const BorderSide(color: AppColors.line),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(Radii.sm),
                        borderSide: const BorderSide(color: AppColors.line),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: Sp.sm),
                SizedBox(
                  width: 48,
                  height: 48,
                  child: FilledButton(
                    onPressed: _sending ? null : _send,
                    style: FilledButton.styleFrom(
                      padding: EdgeInsets.zero,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(Radii.sm),
                      ),
                    ),
                    child: _sending
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send_rounded, size: 20),
                  ),
                ),
              ],
            ),
            const SizedBox(height: Sp.xs),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Pesan tersimpan untuk keperluan sengketa.',
                style: text.labelSmall?.copyWith(color: AppColors.inkMuted),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({
    required this.message,
    required this.own,
    required this.text,
  });

  final ChatMessage message;
  final bool own;
  final TextTheme text;

  @override
  Widget build(BuildContext context) {
    final background = own ? AppColors.primary : AppColors.card;
    final foreground = own ? AppColors.onPrimary : AppColors.ink;

    return Padding(
      padding: const EdgeInsets.only(bottom: Sp.sm),
      child: Align(
        alignment: own ? Alignment.centerRight : Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 320),
          child: Container(
            padding: const EdgeInsets.fromLTRB(Sp.md, Sp.sm, Sp.md, Sp.sm),
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(Radii.xl),
              border: own ? null : Border.all(color: AppColors.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (!own)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Text(
                      message.roleLabel,
                      style: text.labelSmall?.copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                Text(
                  message.body,
                  style: text.bodyMedium?.copyWith(color: foreground),
                ),
                const SizedBox(height: 2),
                Text(
                  formatTime(message.createdAt),
                  style: text.labelSmall?.copyWith(
                    color: own
                        ? AppColors.onPrimary.withValues(alpha: 0.72)
                        : AppColors.inkMuted,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
