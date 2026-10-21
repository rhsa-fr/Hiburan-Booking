import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { AppError } from '../../../../apps/api/src/core/errors';
import type { AuthenticatedUser } from '../../../platform/auth/src/index';

/**
 * The identity of the caller. There is exactly one shape in the platform
 * (`AuthenticatedUser`), populated by `AuthGuard` from the verified access
 * token — never from a request header.
 */
export type AuthUser = AuthenticatedUser;

interface RequestWithUser {
  user?: AuthUser;
}

/**
 * Reads the authenticated user attached by `AuthGuard`.
 * It refuses to invent an identity: without a verified token there is no user.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new AppError('UNAUTHENTICATED', 'Sesi tidak ditemukan');
    }
    return request.user;
  }
);
