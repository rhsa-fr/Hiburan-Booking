import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawData, WebSocket } from 'ws';
import type { AccessTokenPayload, Role, SessionChecker } from '@tarlink/platform/auth';
import { configureSessionChecker, signAccessToken } from '@tarlink/platform/auth';
import {
  CHAT_WS_PATH,
  ChatGateway,
  extractChatToken,
  isChatOriginAllowed,
  parseChatClientEvent,
  parseChatNotification
} from './chat.gateway';
import type { ChatService } from './chat.service';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';

function url(query: string): URL {
  return new URL(`/v1/chat/ws${query}`, 'http://localhost:3001');
}

describe('parseChatClientEvent', () => {
  it('accepts subscribe, unsubscribe, message and ping', () => {
    expect(parseChatClientEvent(JSON.stringify({ type: 'subscribe', booking_id: BOOKING_ID }))).toEqual({
      type: 'subscribe',
      booking_id: BOOKING_ID
    });
    expect(parseChatClientEvent(JSON.stringify({ type: 'unsubscribe', booking_id: BOOKING_ID }))).toEqual({
      type: 'unsubscribe',
      booking_id: BOOKING_ID
    });
    expect(
      parseChatClientEvent(JSON.stringify({ type: 'message', booking_id: BOOKING_ID, body: 'halo' }))
    ).toEqual({ type: 'message', booking_id: BOOKING_ID, body: 'halo' });
    expect(parseChatClientEvent(JSON.stringify({ type: 'ping' }))).toEqual({ type: 'ping' });
  });

  it('rejects malformed frames', () => {
    expect(() => parseChatClientEvent('{')).toThrow('harus JSON');
    expect(() => parseChatClientEvent(JSON.stringify({ type: 'subscribe' }))).toThrow('booking_id');
    expect(() =>
      parseChatClientEvent(JSON.stringify({ type: 'message', booking_id: BOOKING_ID }))
    ).toThrow('Pesan wajib berupa teks');
    expect(() => parseChatClientEvent(JSON.stringify({ type: 'nope' }))).toThrow('tidak dikenal');
  });
});

describe('extractChatToken', () => {
  it('prefers the query token used by browsers', () => {
    expect(extractChatToken({ headers: {} }, url('?token=abc'))).toBe('abc');
  });

  it('accepts a Bearer header for native clients', () => {
    expect(
      extractChatToken({ headers: { authorization: 'Bearer xyz' } }, url(''))
    ).toBe('xyz');
  });

  it('returns null when no credential is present', () => {
    expect(extractChatToken({ headers: {} }, url(''))).toBeNull();
  });
});

describe('isChatOriginAllowed', () => {
  it('allows every origin when the allowlist is empty', () => {
    expect(isChatOriginAllowed('http://localhost:8080', [])).toBe(true);
  });

  it('requires a listed browser origin but allows non-browser clients', () => {
    const allowed = ['http://localhost:8080'];
    expect(isChatOriginAllowed('http://localhost:8080', allowed)).toBe(true);
    expect(isChatOriginAllowed('http://evil.example', allowed)).toBe(false);
    expect(isChatOriginAllowed(undefined, allowed)).toBe(true);
  });
});

describe('parseChatNotification', () => {
  it('parses the trigger payload into a message view', () => {
    const payload = JSON.stringify({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      booking_id: BOOKING_ID,
      sender_id: '22222222-2222-4222-8222-222222222222',
      sender_role: 'vendor',
      body: 'siap',
      created_at: '2026-11-05T10:00:00.000Z'
    });
    expect(parseChatNotification(payload)).toMatchObject({
      booking_id: BOOKING_ID,
      sender_role: 'vendor',
      body: 'siap'
    });
  });

  it('ignores payloads that are not chat rows', () => {
    expect(parseChatNotification('not json')).toBeNull();
    expect(parseChatNotification(JSON.stringify({ booking_id: BOOKING_ID }))).toBeNull();
    expect(
      parseChatNotification(
        JSON.stringify({
          id: 'x',
          booking_id: BOOKING_ID,
          sender_id: 'y',
          sender_role: 'robot',
          body: 'z',
          created_at: '2026-11-05T10:00:00.000Z'
        })
      )
    ).toBeNull();
  });
});

const CHAT_SECRET = 'unit-test-secret-chat-0001';
const CHAT_USER_ID = 'user-1';
const CHAT_JTI = 'session-1';

type UpgradeListener = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
) => void | Promise<void>;

interface FakeSocket {
  destroyed: boolean;
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    destroyed: false,
    write: vi.fn(() => true),
    destroy: vi.fn(() => {
      socket.destroyed = true;
    })
  };
  return socket;
}

function chatToken(withJti = true): string {
  const payload: AccessTokenPayload = {
    sub: CHAT_USER_ID,
    roles: ['customer'],
    ...(withJti ? { jti: CHAT_JTI } : {})
  };
  return signAccessToken(payload, CHAT_SECRET, 900);
}

function sessionChecker(isActive: SessionChecker['isActive']): SessionChecker {
  return { isActive };
}

/**
 * No HTTP server and no Postgres: the gateway only needs the `upgrade` listener
 * it registers, and the real handshake is replaced with a spy.
 */
function createGateway(service: ChatService = {} as unknown as ChatService): {
  gateway: ChatGateway;
  handleUpgrade: ReturnType<typeof vi.fn>;
  upgrade: (socket: FakeSocket, token: string) => Promise<void>;
} {
  let listener: UpgradeListener | undefined;
  const server = {
    on: (event: string, handler: UpgradeListener) => {
      if (event === 'upgrade') listener = handler;
    },
    off: () => undefined
  } as unknown as Server;
  const pool = {
    connect: () => Promise.reject(new Error('unit test: no database'))
  } as unknown as Pool;

  const gateway = new ChatGateway(server, {
    service,
    pool,
    jwtSecret: CHAT_SECRET
  });

  const handleUpgrade = vi.fn();
  (gateway as unknown as { wss: { handleUpgrade: unknown } }).wss.handleUpgrade = handleUpgrade;

  return {
    gateway,
    handleUpgrade,
    upgrade: async (socket, token) => {
      if (!listener) throw new Error('gateway registered no upgrade listener');
      const request = {
        url: `${CHAT_WS_PATH}?token=${token}`,
        headers: {}
      } as unknown as IncomingMessage;
      await listener(request, socket as unknown as Duplex, Buffer.alloc(0));
    }
  };
}

describe('ChatGateway upgrade session check', () => {
  let created: ChatGateway | null = null;

  function setup(): ReturnType<typeof createGateway> {
    const harness = createGateway();
    created = harness.gateway;
    return harness;
  }

  beforeEach(() => configureSessionChecker(null));

  afterEach(() => {
    configureSessionChecker(null);
    created?.close();
    created = null;
  });

  it('rejects a revoked session with 401 before upgrading', async () => {
    const isActive = vi.fn(async () => false);
    configureSessionChecker(sessionChecker(isActive));
    const harness = setup();
    const socket = fakeSocket();

    await harness.upgrade(socket, chatToken());

    expect(isActive).toHaveBeenCalledWith(CHAT_USER_ID, CHAT_JTI);
    expect(harness.handleUpgrade).not.toHaveBeenCalled();
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('HTTP/1.1 401'));
    expect(socket.destroyed).toBe(true);
  });

  it('upgrades while the session is still active', async () => {
    const isActive = vi.fn(async () => true);
    configureSessionChecker(sessionChecker(isActive));
    const harness = setup();
    const socket = fakeSocket();

    await harness.upgrade(socket, chatToken());

    expect(harness.handleUpgrade).toHaveBeenCalledTimes(1);
    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroyed).toBe(false);
  });

  it('upgrades when no session checker is configured', async () => {
    const harness = setup();
    const socket = fakeSocket();

    await harness.upgrade(socket, chatToken());

    expect(harness.handleUpgrade).toHaveBeenCalledTimes(1);
    expect(socket.write).not.toHaveBeenCalled();
  });

  it('rejects a token without a session id', async () => {
    const isActive = vi.fn(async () => true);
    configureSessionChecker(sessionChecker(isActive));
    const harness = setup();
    const socket = fakeSocket();

    await harness.upgrade(socket, chatToken(false));

    expect(isActive).not.toHaveBeenCalled();
    expect(harness.handleUpgrade).not.toHaveBeenCalled();
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('HTTP/1.1 401'));
    expect(socket.destroyed).toBe(true);
  });

  it('fails closed when the session checker throws', async () => {
    const isActive = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    configureSessionChecker(sessionChecker(isActive));
    const harness = setup();
    const socket = fakeSocket();

    await harness.upgrade(socket, chatToken());

    expect(harness.handleUpgrade).not.toHaveBeenCalled();
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('HTTP/1.1 401'));
    expect(socket.destroyed).toBe(true);
  });
});

interface FakeWebSocket {
  readyState: number;
  sent: unknown[];
  closedWith: { code: number; reason: string } | null;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  send: (payload: string) => void;
  close: (code?: number, reason?: string) => void;
}

/** Minimal stand-in for a `ws` socket: enough for `send` and `close` assertions. */
function fakeWebSocket(): FakeWebSocket {
  const ws: FakeWebSocket = {
    readyState: 1, // WebSocket.OPEN
    sent: [],
    closedWith: null,
    on: vi.fn(),
    send: vi.fn((payload: string) => {
      ws.sent.push(JSON.parse(payload));
    }),
    close: vi.fn((code?: number, reason?: string) => {
      ws.closedWith = { code: code ?? 1000, reason: reason ?? '' };
      ws.readyState = 3; // WebSocket.CLOSED
    })
  };
  return ws;
}

type GatewayInternals = {
  onConnection(ws: WebSocket, userId: string, roles: Role[], jti: string): void;
  onMessage(ws: WebSocket, data: RawData): Promise<void>;
  rejectUpgrade(socket: Duplex, status: number, reason: string): void;
  clients: Map<WebSocket, unknown>;
};

function internalsOf(gateway: ChatGateway): GatewayInternals {
  return gateway as unknown as GatewayInternals;
}

describe('ChatGateway per-event session check', () => {
  const send = vi.fn(async () => ({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    booking_id: BOOKING_ID,
    sender_id: CHAT_USER_ID,
    sender_role: 'customer' as const,
    body: 'halo',
    created_at: '2026-11-05T10:00:00.000Z'
  }));
  const resolveRole = vi.fn(async () => 'customer' as const);
  const service = { send, resolveRole } as unknown as ChatService;

  let gateway: ChatGateway | null = null;

  beforeEach(() => {
    configureSessionChecker(null);
    send.mockClear();
    resolveRole.mockClear();
  });

  afterEach(() => {
    configureSessionChecker(null);
    gateway?.close();
    gateway = null;
  });

  function start(): { gateway: ChatGateway; ws: FakeWebSocket } {
    const started = createGateway(service).gateway;
    gateway = started;
    const ws = fakeWebSocket();
    internalsOf(started).onConnection(
      ws as unknown as WebSocket,
      CHAT_USER_ID,
      ['customer'],
      CHAT_JTI
    );
    return { gateway: started, ws };
  }

  async function deliver(
    target: ChatGateway,
    ws: FakeWebSocket,
    event: unknown
  ): Promise<void> {
    await internalsOf(target).onMessage(
      ws as unknown as WebSocket,
      Buffer.from(JSON.stringify(event))
    );
  }

  function sentTypes(ws: FakeWebSocket): string[] {
    return (ws.sent as Array<{ type: string }>).map((event) => event.type);
  }

  it('closes with 4401 and ignores a message once the session is revoked', async () => {
    let active = true;
    configureSessionChecker(sessionChecker(async () => active));
    const { gateway: started, ws } = start();

    active = false;
    await deliver(started, ws, { type: 'message', booking_id: BOOKING_ID, body: 'halo' });

    expect(ws.closedWith).toEqual({ code: 4401, reason: 'session revoked' });
    expect(send).not.toHaveBeenCalled();
    expect(internalsOf(started).clients.size).toBe(0);
  });

  it('closes with 4401 before subscribing a revoked session', async () => {
    configureSessionChecker(sessionChecker(async () => false));
    const { gateway: started, ws } = start();

    await deliver(started, ws, { type: 'subscribe', booking_id: BOOKING_ID });

    expect(ws.closedWith).toEqual({ code: 4401, reason: 'session revoked' });
    expect(resolveRole).not.toHaveBeenCalled();
  });

  it('processes a message while the session is active', async () => {
    configureSessionChecker(sessionChecker(async () => true));
    const { gateway: started, ws } = start();

    await deliver(started, ws, { type: 'message', booking_id: BOOKING_ID, body: 'halo' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(ws.closedWith).toBeNull();
    expect(sentTypes(ws)).toEqual(['ready', 'sent']);
  });

  it('answers ping with pong without a session lookup', async () => {
    const isActive = vi.fn(async () => false);
    configureSessionChecker(sessionChecker(isActive));
    const { gateway: started, ws } = start();

    await deliver(started, ws, { type: 'ping' });

    expect(isActive).not.toHaveBeenCalled();
    expect(ws.closedWith).toBeNull();
    expect(sentTypes(ws)).toEqual(['ready', 'pong']);
  });

  it('does not write to an already-destroyed socket when rejecting an upgrade', () => {
    const started = createGateway(service).gateway;
    gateway = started;
    const socket = fakeSocket();
    socket.destroyed = true;

    expect(() =>
      internalsOf(started).rejectUpgrade(socket as unknown as Duplex, 401, 'Unauthorized')
    ).not.toThrow();
    expect(socket.write).not.toHaveBeenCalled();
  });
});
