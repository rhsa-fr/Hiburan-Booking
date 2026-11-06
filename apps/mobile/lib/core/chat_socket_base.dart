/// Minimal WebSocket handle used by the chat screen.
///
/// Implemented per platform (`dart:io` on mobile/desktop, `dart:html` on web)
/// so the app keeps its dependency list unchanged.
abstract class ChatSocket {
  void send(String data);

  Future<void> close();
}
