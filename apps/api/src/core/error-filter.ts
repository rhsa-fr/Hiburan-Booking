/**
 * Single error shape for the whole API (TECH-DESIGN §7.1):
 * { "error": { "code", "message", "request_id", "details" } }
 *
 * Kept in its own module (not inline in `app.module.ts`) so the status mapping
 * can be unit-tested without booting the Nest application or touching the
 * database. The HTTP status is the contract clients branch on: `NOT_FOUND` must
 * become 404 (never 403) for "you may not see this", otherwise the response
 * confirms that the resource exists.
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { AppError, type ErrorEnvelope } from '@tarlink/core/errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<{ id?: string }>();

    let status = 500;
    let code: ErrorEnvelope['error']['code'] = 'INTERNAL_ERROR';
    let message = 'Terjadi kesalahan. Coba lagi sebentar lagi.';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code =
        status === 400
          ? 'VALIDATION_ERROR'
          : status === 401
            ? 'UNAUTHENTICATED'
            : status === 403
              ? 'FORBIDDEN'
              : status === 404
                ? 'NOT_FOUND'
                : status === 409
                  ? 'CONFLICT'
                  : status === 429
                    ? 'RATE_LIMITED'
                    : 'INTERNAL_ERROR';
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : ((body as { message?: string })?.message ?? message);
    } else if (exception instanceof Error && exception.name === 'MulterError') {
      status = 400;
      code = 'VALIDATION_ERROR';
      const multerCode = (exception as Error & { code?: string }).code;
      message =
        multerCode === 'LIMIT_FILE_SIZE'
          ? 'Ukuran gambar maksimal 5 MB'
          : 'Upload gambar tidak valid';
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json({
      error: {
        code,
        message,
        request_id: request?.id,
        details
      }
    } satisfies ErrorEnvelope);
  }
}
