/**
 * The HTTP status is part of the public contract: clients branch on it, and a
 * 403 where a 404 is expected confirms that the resource exists. These tests
 * lock the mapping without booting Nest or touching PostgreSQL — the filter is
 * the only place where `AppError.code` becomes a status code.
 */
import type { ArgumentsHost } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import { AllExceptionsFilter } from './error-filter';

interface Captured {
  status?: number;
  body?: {
    error?: {
      code?: string;
      message?: string;
      request_id?: string;
      details?: unknown;
    };
  };
}

function invoke(exception: unknown): Captured {
  const captured: Captured = {};
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body as Captured['body'];
      return this;
    }
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ id: 'req-test-1' })
    })
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return captured;
}

describe('AllExceptionsFilter status mapping', () => {
  it.each([
    ['NOT_FOUND', 404],
    ['FORBIDDEN', 403],
    ['VALIDATION_ERROR', 400],
    ['UNAUTHENTICATED', 401],
    ['CONFLICT', 409],
    ['RATE_LIMITED', 429]
  ] as const)('maps AppError %s to HTTP %i', (appCode, expectedStatus) => {
    const result = invoke(new AppError(appCode, 'pesan uji'));

    expect(result.status).toBe(expectedStatus);
    expect(result.body?.error).toMatchObject({
      code: appCode,
      message: 'pesan uji',
      request_id: 'req-test-1'
    });
  });

  it('keeps details when an AppError carries them', () => {
    const result = invoke(new AppError('VALIDATION_ERROR', 'invalid', [{ path: 'email' }]));

    expect(result.status).toBe(400);
    expect(result.body?.error?.details).toEqual([{ path: 'email' }]);
  });

  it('maps a Nest HttpException 404 to NOT_FOUND', () => {
    const result = invoke(new HttpException('tidak ada', 404));

    expect(result.status).toBe(404);
    expect(result.body?.error?.code).toBe('NOT_FOUND');
  });

  it('maps a Multer file-size rejection to a validation error', () => {
    const error = Object.assign(new Error('File too large'), {
      name: 'MulterError',
      code: 'LIMIT_FILE_SIZE'
    });
    const result = invoke(error);

    expect(result.status).toBe(400);
    expect(result.body?.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Ukuran gambar maksimal 5 MB'
    });
  });

  it('fails closed with 500 for an unexpected error', () => {
    const result = invoke(new Error('boom'));

    expect(result.status).toBe(500);
    expect(result.body?.error?.code).toBe('INTERNAL_ERROR');
  });
});
