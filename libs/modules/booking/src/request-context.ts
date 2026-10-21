/**
 * Request-scoped context for `booking_status_history.request_id` (P3).
 *
 * `booking_status_history.request_id` mirrors the `X-Request-Id` header the
 * client sends (TECH-DESIGN §7.1). The booking service methods keep their
 * frozen signatures, so the request id travels through an
 * `AsyncLocalStorage` instead of an extra parameter: the interceptor opens
 * the scope, the service reads it while writing the history rows.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor
} from '@nestjs/common';
import { Observable } from 'rxjs';

/** `booking_status_history.request_id` is VARCHAR(40). */
const MAX_REQUEST_ID_LENGTH = 40;

export interface RequestScope {
  requestId: string | null;
}

const scope = new AsyncLocalStorage<RequestScope>();

/** Runs `fn` with the given request scope attached. */
export function runWithRequestScope<T>(value: RequestScope, fn: () => T): T {
  return scope.run(value, fn);
}

/** The `X-Request-Id` of the current request, or null when absent. */
export function currentRequestId(): string | null {
  return scope.getStore()?.requestId ?? null;
}

function readRequestId(headers: Record<string, unknown>): string | null {
  const raw = headers['x-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_REQUEST_ID_LENGTH);
}

/**
 * Opens the request scope for the whole handler call, so the history rows
 * written deep inside the service can still see the request id.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();
    const requestId = readRequestId(request.headers ?? {});

    return new Observable((subscriber) => {
      const subscription = runWithRequestScope({ requestId }, () =>
        next.handle().subscribe(subscriber)
      );
      return () => subscription.unsubscribe();
    });
  }
}
