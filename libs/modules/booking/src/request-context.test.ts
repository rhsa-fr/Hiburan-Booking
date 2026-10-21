import { describe, expect, it } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { currentRequestId, RequestIdInterceptor, runWithRequestScope } from './request-context';

function fakeContext(headers: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers })
    })
  } as unknown as ExecutionContext;
}

describe('request scope', () => {
  it('is empty outside a request', () => {
    expect(currentRequestId()).toBeNull();
  });

  it('exposes the request id while the scope is open', () => {
    runWithRequestScope({ requestId: 'req-1' }, () => {
      expect(currentRequestId()).toBe('req-1');
    });
    expect(currentRequestId()).toBeNull();
  });
});

describe('RequestIdInterceptor', () => {
  const interceptor = new RequestIdInterceptor();

  async function requestIdSeenByTheHandler(headers: Record<string, unknown>): Promise<string | null> {
    let seen: string | null = null;
    const handler: CallHandler = {
      handle: () => {
        seen = currentRequestId();
        return of(null);
      }
    };
    await lastValueFrom(interceptor.intercept(fakeContext(headers), handler));
    return seen;
  }

  it('reads the x-request-id header', async () => {
    expect(await requestIdSeenByTheHandler({ 'x-request-id': 'req-42' })).toBe('req-42');
  });

  it('leaves the request id null when the header is absent', async () => {
    expect(await requestIdSeenByTheHandler({})).toBeNull();
  });

  it('truncates the request id to the column width (VARCHAR(40))', async () => {
    const long = 'r'.repeat(80);
    expect(await requestIdSeenByTheHandler({ 'x-request-id': long })).toHaveLength(40);
  });

  it('ignores a blank header', async () => {
    expect(await requestIdSeenByTheHandler({ 'x-request-id': '   ' })).toBeNull();
  });
});
