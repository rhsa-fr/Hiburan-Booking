export { ChatModule } from './chat.module';
export { ChatController } from './chat.controller';
export { ChatService, decodeChatCursor, encodeChatCursor, normalizeChatBody } from './chat.service';
export type { ChatUser } from './chat.service';
export {
  ChatRepository,
  READ_NOTIFY_BATCH_SIZE,
  buildChatReadNotification,
  toChatMessageView
} from './chat.repository';
export type {
  ChatHistoryOptions,
  ChatMessageRow,
  ChatParticipantRow,
  ChatReadResult,
  NewChatMessage
} from './chat.repository';
export {
  CHAT_CHANNEL,
  LIST_CHAT_MESSAGES_QUERY,
  SEND_CHAT_MESSAGE_SCHEMA
} from './chat.contracts';
export type {
  ChatMessagePage,
  ChatMessageView,
  ChatReadNotification,
  ChatReadReceipt,
  ChatRole,
  ListChatMessagesQuery,
  SendChatMessageInput
} from './chat.contracts';
export {
  attachChatGateway,
  ChatGateway,
  CHAT_WS_PATH,
  extractChatToken,
  isChatOriginAllowed,
  parseChatClientEvent,
  parseChatNotification,
  parseChatReadNotification
} from './chat.gateway';
export type { ChatClientEvent, ChatGatewayOptions } from './chat.gateway';
