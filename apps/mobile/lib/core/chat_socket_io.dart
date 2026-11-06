import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'chat_socket_base.dart';

/// Native implementation (Android, iOS, desktop, `flutter test`).
Future<ChatSocket> connectChatSocket(
  String url, {
  required void Function(String data) onMessage,
  required void Function() onDone,
}) async {
  final socket = await WebSocket.connect(url);
  socket.listen(
    (data) {
      if (data is String) {
        onMessage(data);
      } else if (data is List<int>) {
        onMessage(utf8.decode(data));
      }
    },
    onDone: onDone,
    onError: (Object _) => onDone(),
    cancelOnError: true,
  );
  return _IoChatSocket(socket);
}

class _IoChatSocket implements ChatSocket {
  _IoChatSocket(this._socket);

  final WebSocket _socket;

  @override
  void send(String data) {
    if (_socket.readyState == WebSocket.open) _socket.add(data);
  }

  @override
  Future<void> close() => _socket.close();
}
