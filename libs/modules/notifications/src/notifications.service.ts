import { AppError } from '@tarlink/core/errors';
import type {
  ListNotificationsQuery,
  NotificationPage,
  NotificationView
} from './notifications.contracts';
import {
  NotificationsRepository,
  type NotificationRow
} from './notifications.repository';

function toView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payload,
    read_at: row.read_at === null ? null : row.read_at.toISOString(),
    created_at: row.created_at.toISOString()
  };
}

export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  async list(userId: string, query: ListNotificationsQuery): Promise<NotificationPage> {
    const { rows, total } = await this.repository.list(userId, {
      unreadOnly: query.unread_only === 'true',
      page: query.page,
      pageSize: query.page_size
    });

    return {
      items: rows.map(toView),
      total,
      page: query.page,
      page_size: query.page_size
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.repository.unreadCount(userId);
  }

  async markRead(userId: string, id: string): Promise<NotificationView> {
    const row = await this.repository.markRead(userId, id);
    if (!row) throw new AppError('NOT_FOUND', 'Notifikasi tidak ditemukan');
    return toView(row);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    return { updated: await this.repository.markAllRead(userId) };
  }
}
