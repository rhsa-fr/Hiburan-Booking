export { ChatModule } from './chat.module';
export { ChatController } from './chat.controller';
export { ChatService, decodeChatCursor, encodeChatCursor, normalizeChatBody } from './chat.service';
export type { ChatUser } from './chat.service';
export { ChatRepository, toChatMessageView } from './chat.repository';
export type {
  ChatHistoryOptions,
  ChatMessageRow,
  ChatParticipantRow,
  NewChatMessage
} from './chat.repository';
export {
  SEND_CHAT_MESSAGE_SCHEMA,
  LIST_CHAT_MESSAGES_QUERY
} from './chat.contracts';
export type {
  ChatMessagePage,
  ChatMessageView,
  ChatRole,
  ListChatMessagesQuery,
  SendChatMessageInput
} from './chat.contracts';
export {
  attachChatGateway,
  ChatGateway,
  CHAT_CHANNEL,
  CHAT_WS_PATH,
  extractChatToken,
  isChatOriginAllowed,
  parseChatClientEvent,
  parseChatNotification
} from './chat.gateway';
export type { ChatClientEvent, ChatGatewayOptions } from './chat.gateway';
