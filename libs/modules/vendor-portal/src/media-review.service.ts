import { Injectable } from '@nestjs/common';
import { withTransaction } from '@tarlink/core/db';
import { AppError } from '@tarlink/core/errors';
import {
  ADMIN_MEDIA_REJECT_BODY,
  type AdminMediaQueueQuery,
  type AdminMediaQueueResult,
  type MediaRow
} from './media.contracts';
import { MediaRepository, isUuid } from './media.repository';
import { parseBody } from './vendor-portal.dto';

@Injectable()
export class MediaReviewService {
  constructor(private readonly repo: MediaRepository) {}

  async approve(id: string, reviewerId: string): Promise<MediaRow> {
    if (!isUuid(id)) {
      throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
    }
    return withTransaction(async (client) => {
      const media = await this.repo.findByIdForUpdate(client, id);
      if (!media) {
        throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
      }
      if (media.status !== 'pending') {
        throw new AppError('CONFLICT', 'Media sudah diproses sebelumnya');
      }

      await this.repo.applyToPublicColumn(client, media);

      return this.repo.updateStatus(client, id, {
        status: 'approved',
        reviewed_by: reviewerId,
        review_note: media.review_note ?? null
      });
    });
  }

  async reject(id: string, reviewerId: string, note: string): Promise<MediaRow> {
    if (!isUuid(id)) {
      throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
    }
    const input = parseBody(
      ADMIN_MEDIA_REJECT_BODY,
      { note },
      'Alasan penolakan tidak valid'
    );
    return withTransaction(async (client) => {
      const media = await this.repo.findByIdForUpdate(client, id);
      if (!media) {
        throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
      }
      if (media.status !== 'pending') {
        throw new AppError('CONFLICT', 'Media sudah diproses sebelumnya');
      }

      return this.repo.updateStatus(client, id, {
        status: 'rejected',
        reviewed_by: reviewerId,
        review_note: input.note
      });
    });
  }

  async listQueue(query: AdminMediaQueueQuery): Promise<AdminMediaQueueResult> {
    return this.repo.listQueue(query);
  }
}
