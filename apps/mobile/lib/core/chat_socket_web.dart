// Flutter web keeps `dart:html` for WebSocket; using it avoids adding the
// `web_socket_channel` package (ADR 0003: no new mobile dependencies).
// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter

import 'dart:async';
import 'dart:html' as html;

import 'chat_socket_base.dart';

Future<ChatSocket> connectChatSocket(
  String url, {
  required void Function(String data) onMessage,
  required void Function() onDone,
}) {
  final socket = html.WebSocket(url);
  final ready = Completer<ChatSocket>();

  void fail() {
    if (!ready.isCompleted) {
      ready.completeError(StateError('Koneksi chat gagal'));
    }
  }

  socket.onOpen.listen((_) {
    if (!ready.isCompleted) ready.complete(_WebChatSocket(socket));
  });
  socket.onError.listen((_) => fail());
  socket.onClose.listen((_) {
    fail();
    onDone();
  });
  socket.onMessage.listen((event) {
    final data = event.data;
    if (data is String) onMessage(data);
  });

  return ready.future;
}

class _WebChatSocket implements ChatSocket {
  _WebChatSocket(this._socket);

  final html.WebSocket _socket;

  @override
  void send(String data) {
    if (_socket.readyState == html.WebSocket.OPEN) _socket.send(data);
  }

  @override
  Future<void> close() async => _socket.close();
}
