import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Notification, Pool, PoolClient } from 'pg';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { AppError } from '@tarlink/core/errors';
import {
  isSessionActive,
  verifyAccessToken,
  type AccessTokenClaims,
  type Role
} from '@tarlink/platform/auth';
import type { ChatMessageView, ChatRole } from './chat.contracts';
import { ChatService } from './chat.service';

/** Path is outside Nest's HTTP router: the upgrade is handled here. */
export const CHAT_WS_PATH = '/v1/chat/ws';
export const CHAT_CHANNEL = 'tarlink_chat';

/** A socket may follow several bookings, but not unboundedly many. */
const MAX_ROOMS_PER_SOCKET = 20;

export type ChatClientEvent =
  | { type: 'subscribe'; booking_id: string }
  | { type: 'unsubscribe'; booking_id: string }
  | { type: 'message'; booking_id: string; body: string }
  | { type: 'ping' };

export interface ChatGatewayOptions {
  service: ChatService;
  /** Used only for the dedicated LISTEN connection. */
  pool: Pool;
  jwtSecret: string;
  allowedOrigins?: readonly string[];
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function isChatRole(value: unknown): value is ChatRole {
  return value === 'customer' || value === 'vendor' || value === 'admin';
}

/** Validates one client frame. Any malformed frame is a validation error. */
export function parseChatClientEvent(raw: string): ChatClientEvent {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Pesan WebSocket harus JSON');
  }
  if (typeof value !== 'object' || value === null) {
    throw new AppError('VALIDATION_ERROR', 'Pesan WebSocket tidak valid');
  }
  const record = value as Record<string, unknown>;

  if (record.type === 'ping') return { type: 'ping' };

  if (record.type === 'subscribe' || record.type === 'unsubscribe') {
    if (typeof record.booking_id !== 'string' || record.booking_id.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'booking_id wajib diisi');
    }
    return { type: record.type, booking_id: record.booking_id };
  }

  if (record.type === 'message') {
    if (typeof record.booking_id !== 'string' || record.booking_id.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'booking_id wajib diisi');
    }
    if (typeof record.body !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'Pesan wajib berupa teks');
    }
    return { type: 'message', booking_id: record.booking_id, body: record.body };
  }

  throw new AppError('VALIDATION_ERROR', 'Tipe event chat tidak dikenal');
}

/** Browser WebSocket cannot set an Authorization header, so `?token=` wins. */
export function extractChatToken(
  request: { headers: Record<string, string | string[] | undefined> },
  url: URL
): string | null {
  const fromQuery = url.searchParams.get('token');
  if (fromQuery && fromQuery.length > 0) return fromQuery;
  const header = request.headers['authorization'];
  const match = /^Bearer\s+(.+)$/i.exec(typeof header === 'string' ? header : '');
  return match?.[1] ?? null;
}

/** An empty allowlist means "no origin restriction" (non-browser clients). */
export function isChatOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[]
): boolean {
  if (allowedOrigins.length === 0) return true;
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

/** The NOTIFY payload is the stored row, already in view shape. */
export function parseChatNotification(payload: string): ChatMessageView | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.booking_id !== 'string' ||
    typeof record.sender_id !== 'string' ||
    typeof record.body !== 'string' ||
    !isChatRole(record.sender_role)
  ) {
    return null;
  }
  const createdAt = record.created_at;
  const iso =
    typeof createdAt === 'string'
      ? createdAt
      : createdAt instanceof Date
        ? createdAt.toISOString()
        : null;
  if (!iso) return null;

  return {
    id: record.id,
    booking_id: record.booking_id,
    sender_id: record.sender_id,
    sender_role: record.sender_role,
    body: record.body,
    created_at: iso
  };
}

interface ClientState {
  userId: string;
  roles: Role[];
  /** Session id from the token; re-checked per event so logout closes the socket. */
  jti: string;
  rooms: Set<string>;
}

/**
 * WebSocket endpoint for chat. Delivery is DB-driven: every insert fires the
 * `tarlink_chat` NOTIFY, and each API instance forwards it to the sockets that
 * subscribed to that booking. No Redis, no broker.
 */
export class ChatGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private listenClient: PoolClient | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    private readonly server: Server,
    private readonly options: ChatGatewayOptions
  ) {
    server.on('upgrade', this.handleUpgrade);
    void this.startListening();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.server.off('upgrade', this.handleUpgrade);
    this.releaseListenClient();
    for (const socket of this.clients.keys()) {
      socket.close(1001, 'server shutdown');
    }
    this.clients.clear();
    this.rooms.clear();
    this.wss.close();
  }

  /**
   * Validates everything that can still reject the upgrade. Returns the claims
   * to accept with, or null after the socket has already been rejected.
   */
  private async authorizeUpgrade(
    request: IncomingMessage,
    socket: Duplex
  ): Promise<(AccessTokenClaims & { jti: string }) | null> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== CHAT_WS_PATH) {
      // No other WebSocket endpoint exists; leaving the socket open would leak.
      this.rejectUpgrade(socket, 404, 'Not Found');
      return null;
    }

    const origin =
      typeof request.headers['origin'] === 'string' ? request.headers['origin'] : undefined;
    if (!isChatOriginAllowed(origin, this.options.allowedOrigins ?? [])) {
      this.rejectUpgrade(socket, 403, 'Forbidden');
      return null;
    }

    const token = extractChatToken(request, url);
    if (!token) {
      this.rejectUpgrade(socket, 401, 'Unauthorized');
      return null;
    }

    let claims: AccessTokenClaims;
    try {
      claims = verifyAccessToken(token, this.options.jwtSecret);
    } catch {
      this.rejectUpgrade(socket, 401, 'Unauthorized');
      return null;
    }

    // A signature only proves the token was minted; without a session id the
    // revocation check cannot run, so the upgrade fails closed.
    const { jti } = claims;
    if (!jti) {
      this.rejectUpgrade(socket, 401, 'Unauthorized');
      return null;
    }

    let active: boolean;
    try {
      active = await isSessionActive(claims.sub, jti);
    } catch {
      // Database unavailable: never let a logout survive on an outage.
      this.rejectUpgrade(socket, 401, 'Unauthorized');
      return null;
    }
    if (!active) {
      this.rejectUpgrade(socket, 401, 'Unauthorized');
      return null;
    }

    return { ...claims, jti };
  }

  private readonly handleUpgrade = async (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): Promise<void> => {
    let claims: (AccessTokenClaims & { jti: string }) | null;
    try {
      claims = await this.authorizeUpgrade(request, socket);
    } catch {
      // `server.on('upgrade')` ignores the returned promise; an escaping error
      // would become an unhandled rejection instead of a clean 401.
      if (!socket.destroyed) this.rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    if (!claims) return;

    const accepted = claims;
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.onConnection(ws, accepted.sub, accepted.roles, accepted.jti);
    });
  };

  private rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    // The client may disconnect while the awaited session query runs; writing to
    // a destroyed socket throws out of a fire-and-forget upgrade listener.
    if (socket.destroyed) return;
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    );
    socket.destroy();
  }

  private onConnection(ws: WebSocket, userId: string, roles: Role[], jti: string): void {
    this.clients.set(ws, { userId, roles, jti, rooms: new Set() });
    ws.on('message', (data) => {
      void this.onMessage(ws, data);
    });
    ws.on('close', () => this.dropClient(ws));
    ws.on('error', () => this.dropClient(ws));
    this.send(ws, { type: 'ready' });
  }

  private async onMessage(ws: WebSocket, data: RawData): Promise<void> {
    const state = this.clients.get(ws);
    if (!state) return;

    try {
      const event = parseChatClientEvent(rawToString(data));

      // `ping` stays unauthenticated: keeping the socket warm must not cost a
      // database round trip.
      if (event.type === 'ping') {
        this.send(ws, { type: 'pong' });
        return;
      }

      // The upgrade only proved the session was active then. Logout or account
      // deletion mid-session must stop this socket, so every other event
      // re-checks before it can read or write chat data.
      let active: boolean;
      try {
        active = await isSessionActive(state.userId, state.jti);
      } catch {
        // Database unavailable: fail closed instead of trusting a stale socket.
        active = false;
      }
      if (!active) {
        ws.close(4401, 'session revoked');
        this.dropClient(ws);
        return;
      }

      if (event.type === 'unsubscribe') {
        this.leaveRoom(ws, state, event.booking_id);
        this.send(ws, { type: 'unsubscribed', booking_id: event.booking_id });
        return;
      }

      if (event.type === 'subscribe') {
        if (state.rooms.size >= MAX_ROOMS_PER_SOCKET) {
          throw new AppError('RATE_LIMITED', 'Terlalu banyak percakapan yang diikuti');
        }
        const role = await this.options.service.resolveRole(event.booking_id, {
          id: state.userId,
          roles: state.roles
        });
        this.joinRoom(ws, state, event.booking_id);
        this.send(ws, { type: 'subscribed', booking_id: event.booking_id, role });
        return;
      }

      const message = await this.options.service.send(
        event.booking_id,
        { id: state.userId, roles: state.roles },
        event.body
      );
      this.send(ws, { type: 'sent', message });
    } catch (error) {
      this.sendError(ws, error);
    }
  }

  private joinRoom(ws: WebSocket, state: ClientState, bookingId: string): void {
    state.rooms.add(bookingId);
    const room = this.rooms.get(bookingId);
    if (room) {
      room.add(ws);
      return;
    }
    this.rooms.set(bookingId, new Set([ws]));
  }

  private leaveRoom(ws: WebSocket, state: ClientState, bookingId: string): void {
    state.rooms.delete(bookingId);
    const room = this.rooms.get(bookingId);
    if (!room) return;
    room.delete(ws);
    if (room.size === 0) this.rooms.delete(bookingId);
  }

  private dropClient(ws: WebSocket): void {
    const state = this.clients.get(ws);
    if (!state) return;
    for (const bookingId of state.rooms) this.leaveRoom(ws, state, bookingId);
    this.clients.delete(ws);
  }

  private send(ws: WebSocket, event: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(event));
  }

  private sendError(ws: WebSocket, error: unknown): void {
    if (error instanceof AppError) {
      this.send(ws, { type: 'error', code: error.code, message: error.message });
      return;
    }
    this.send(ws, {
      type: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Terjadi kesalahan pada chat'
    });
  }

  private async startListening(): Promise<void> {
    if (this.closed || this.listenClient) return;
    try {
      const client = await this.options.pool.connect();
      this.listenClient = client;
      await client.query(`LISTEN ${CHAT_CHANNEL}`);
      client.on('notification', this.onNotification);
      client.once('end', () => this.handleListenFailure(client));
      client.on('error', () => this.handleListenFailure(client));
    } catch {
      this.scheduleReconnect();
    }
  }

  private readonly onNotification = (notification: Notification): void => {
    if (notification.channel !== CHAT_CHANNEL || !notification.payload) return;
    const message = parseChatNotification(notification.payload);
    if (message) this.broadcast(message);
  };

  private broadcast(message: ChatMessageView): void {
    const targets = this.rooms.get(message.booking_id);
    if (!targets) return;
    const payload = JSON.stringify({ type: 'message', message });
    for (const socket of targets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  private handleListenFailure(client: PoolClient): void {
    if (this.listenClient !== client) return;
    this.listenClient = null;
    client.removeListener('notification', this.onNotification);
    try {
      client.release(true);
    } catch {
      // Already released by the pool after a connection error.
    }
    this.scheduleReconnect();
  }

  private releaseListenClient(): void {
    const client = this.listenClient;
    this.listenClient = null;
    if (!client) return;
    client.removeListener('notification', this.onNotification);
    try {
      client.release();
    } catch {
      // Nothing to release.
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.startListening();
    }, 1000);
    this.reconnectTimer.unref?.();
  }
}

export function attachChatGateway(server: Server, options: ChatGatewayOptions): ChatGateway {
  return new ChatGateway(server, options);
}
