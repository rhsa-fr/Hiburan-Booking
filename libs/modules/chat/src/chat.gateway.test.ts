import { describe, expect, it } from 'vitest';
import {
  extractChatToken,
  isChatOriginAllowed,
  parseChatClientEvent,
  parseChatNotification
} from './chat.gateway';

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
