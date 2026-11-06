import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import {
  LIST_NOTIFICATIONS_QUERY,
  type NotificationPage,
  type NotificationView
} from './notifications.contracts';
import { NotificationsService } from './notifications.service';

const UUID = z.string().uuid();

function requireUser(request: AuthenticatedRequest): string {
  if (!request.user) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  return request.user.id;
}

/** In-app notification inbox. Always scoped to the authenticated account. */
@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  async list(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: NotificationPage }> {
    const parsed = LIST_NOTIFICATIONS_QUERY.safeParse(query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Filter notifikasi tidak valid', parsed.error.issues);
    }
    return { data: await this.notifications.list(requireUser(request), parsed.data) };
  }

  @Get('notifications/unread-count')
  async unreadCount(
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: { unread: number } }> {
    return { data: { unread: await this.notifications.unreadCount(requireUser(request)) } };
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async markRead(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: NotificationView }> {
    const parsed = UUID.safeParse(id);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'invalid notification id');
    return { data: await this.notifications.markRead(requireUser(request), parsed.data) };
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async markAllRead(
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: { updated: number } }> {
    return { data: await this.notifications.markAllRead(requireUser(request)) };
  }
}
