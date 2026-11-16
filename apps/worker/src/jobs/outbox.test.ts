import { describe, expect, it, vi } from 'vitest';
import { CompositeMessageSink, type MessageSink, type OutboxMessage } from './outbox';

const message: OutboxMessage = {
  id: '11111111-1111-1111-1111-111111111111',
  aggregate_type: 'booking',
  aggregate_id: '22222222-2222-2222-2222-222222222222',
  event_type: 'booking.accepted',
  payload: { booking_id: '22222222-2222-2222-2222-222222222222' },
  attempts: 0
};

const sink = (behaviour: () => void | Promise<void>): MessageSink & { calls: number } => {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async send() {
      state.calls += 1;
      await behaviour();
    }
  };
};

describe('CompositeMessageSink', () => {
  it('delivers to every channel', async () => {
    const inApp = sink(() => undefined);
    const email = sink(() => undefined);

    await new CompositeMessageSink([inApp, email]).send(message);

    expect([inApp.calls, email.calls]).toEqual([1, 1]);
  });

  it('still runs later channels when an earlier one fails, then rethrows', async () => {
    const inApp = sink(() => {
      throw new Error('db down');
    });
    const email = sink(() => undefined);

    await expect(new CompositeMessageSink([inApp, email]).send(message)).rejects.toThrow(
      'db down'
    );
    expect(email.calls).toBe(1);
  });

  it('joins every failure into one retry reason', async () => {
    const first = sink(() => {
      throw new Error('a');
    });
    const second = sink(() => {
      throw new Error('b');
    });

    await expect(new CompositeMessageSink([first, second]).send(message)).rejects.toThrow('a | b');
  });

  it('treats an empty sink list as a no-op', async () => {
    const log = vi.fn();
    await expect(new CompositeMessageSink([]).send(message)).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });
});
