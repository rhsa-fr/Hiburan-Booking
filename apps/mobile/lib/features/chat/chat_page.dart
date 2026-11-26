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
import '../moderation/report_sheet.dart';

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
  bool _markingRead = false;
  bool _markReadQueued = false;

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
      _markRead();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _messageFor(error);
      });
    }
  }

  /// Marks every message the other party sent as read. A receipt is cosmetic:
  /// failures are swallowed so a flaky network never blocks the chat.
  Future<void> _markRead() async {
    if (_markingRead) {
      _markReadQueued = true;
      return;
    }
    final api = AppScope.of(context).api;
    _markingRead = true;
    try {
      final raw = await api.post(
        '/bookings/${widget.bookingId}/chat/messages/read',
        body: const <String, dynamic>{},
      );
      if (!mounted || raw is! Map) return;
      final idsRaw = raw['read_ids'];
      final readAtRaw = raw['read_at'];
      final readAt = readAtRaw is String ? DateTime.tryParse(readAtRaw) : null;
      if (readAt == null || idsRaw is! List) return;
      final ids = idsRaw.whereType<String>().toSet();
      if (ids.isEmpty) return;
      setState(() {
        for (var i = 0; i < _messages.length; i++) {
          final message = _messages[i];
          if (message.readAt == null && ids.contains(message.id)) {
            _messages[i] = message.withReadAt(readAt.toLocal());
          }
        }
      });
    } on ApiException {
      // Read ticks are cosmetic; leave the thread usable.
    } finally {
      _markingRead = false;
      if (_markReadQueued) {
        _markReadQueued = false;
        if (mounted && !_disposed) unawaited(_markRead());
      }
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
        if (message != null) {
          _upsert(message);
          // The thread is on screen: whatever the other side just sent is read
          // as soon as it lands, so the sender's tick flips right away.
          if (mounted &&
              message.senderId != AppScope.of(context).session.user?.id) {
            _markRead();
          }
        }
      case 'read':
        _applyReadReceipt(data);
      case 'error':
        final text = data['message'];
        if (text is String && text.isNotEmpty && mounted) {
          setState(() => _sendError = text);
        }
    }
  }

  /// `{"type":"read","message_ids":[...]}` — the other party read these rows,
  /// so their author sees two ticks instead of one.
  void _applyReadReceipt(Map<String, dynamic> data) {
    final bookingId = data['booking_id'];
    if (bookingId is String && bookingId != widget.bookingId) return;
    final idsRaw = data['message_ids'];
    final readAtRaw = data['read_at'];
    final readAt = readAtRaw is String ? DateTime.tryParse(readAtRaw) : null;
    if (readAt == null || idsRaw is! List) return;
    final ids = idsRaw.whereType<String>().toSet();
    if (ids.isEmpty || !mounted) return;
    setState(() {
      for (var i = 0; i < _messages.length; i++) {
        final message = _messages[i];
        if (message.readAt == null && ids.contains(message.id)) {
          _messages[i] = message.withReadAt(readAt.toLocal());
        }
      }
    });
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

  /// Menu moderasi untuk satu pesan: laporkan isinya (FR-123) atau blokir
  /// pengirimnya (FR-142).
  Future<void> _openMessageActions(ChatMessage message) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      backgroundColor: AppColors.card,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.flag_outlined),
              title: const Text('Laporkan pesan ini'),
              subtitle: const Text('Ditinjau moderator maksimal 1×24 jam'),
              onTap: () => Navigator.of(sheetContext).pop('report'),
            ),
            ListTile(
              leading: const Icon(Icons.block_outlined),
              title: const Text('Blokir pengirim'),
              subtitle: const Text('Pesannya tidak ditampilkan lagi'),
              onTap: () => Navigator.of(sheetContext).pop('block'),
            ),
          ],
        ),
      ),
    );

    if (!mounted || action == null) return;

    if (action == 'report') {
      await showReportSheet(
        context,
        targetKind: ReportTargetKind.chatMessage,
        targetId: message.id,
        targetLabel: 'Pesan ${message.roleLabel}',
        bookingId: widget.bookingId,
      );
      return;
    }

    final blocked = await confirmAndBlockUser(
      context,
      userId: message.senderId,
      name: message.roleLabel,
    );
    if (blocked && mounted) {
      await _load();
    }
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
        final own = ownId != null && message.senderId == ownId;
        final bubble = _Bubble(message: message, own: own, text: text);
        if (own) return bubble;
        // FR-123/FR-142: tekan lama pesan orang lain untuk melaporkan isinya
        // atau memblokir pengirimnya.
        return GestureDetector(
          onLongPress: () => _openMessageActions(message),
          child: bubble,
        );
      },
    );
  }

  Widget _composer(TextTheme text) {
    return SafeArea(
      top: false,
      // A Scaffold's bottomNavigationBar is not lifted by the keyboard, so the
      // inset is applied here; closed, it is zero and adds no double gap.
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Container(
          decoration: BoxDecoration(
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
                          borderSide: BorderSide(color: AppColors.line),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(Radii.sm),
                          borderSide: BorderSide(color: AppColors.line),
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
                        color: AppColors.accent,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                Text(
                  message.body,
                  style: text.bodyMedium?.copyWith(color: foreground),
                ),
                const SizedBox(height: 2),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      formatTime(message.createdAt),
                      style: text.labelSmall?.copyWith(
                        color: own
                            ? AppColors.onPrimary.withValues(alpha: 0.72)
                            : AppColors.inkMuted,
                      ),
                    ),
                    // Delivery state belongs to the sender only: one tick for
                    // sent, two for read.
                    if (own) ...[
                      const SizedBox(width: 4),
                      Icon(
                        message.readAt != null ? Icons.done_all : Icons.done,
                        size: 14,
                        color: AppColors.onPrimary.withValues(alpha: 0.72),
                        semanticLabel: message.readAt != null
                            ? 'dibaca'
                            : 'terkirim',
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
