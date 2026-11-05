import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { AuthGuard, Roles, RolesGuard } from '@tarlink/platform/auth';
import { AppError } from '@tarlink/core/errors';
import { CurrentUser, type AuthUser as BookingAuthUser } from '../../booking/src/current-user.decorator';
import {
  ADMIN_MEDIA_QUEUE_QUERY,
  ADMIN_MEDIA_REJECT_BODY
} from './media.contracts';
import { MediaReviewService } from './media-review.service';
import { isUuid } from './media.repository';
import { parseBody } from './vendor-portal.dto';

export type AuthUser = BookingAuthUser & { sub?: string };

@Controller('admin/media')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin_support', 'admin_super')
export class MediaAdminController {
  constructor(private readonly reviewService: MediaReviewService) {}

  @Get()
  async listQueue(@Query() query: unknown) {
    const parsed = ADMIN_MEDIA_QUEUE_QUERY.safeParse(query ?? {});
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Parameter query antrean media tidak valid',
        parsed.error.issues
      );
    }
    return { data: await this.reviewService.listQueue(parsed.data) };
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    if (!isUuid(id)) {
      throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
    }
    const media = await this.reviewService.approve(id, user.sub ?? user.id);
    return { data: { media } };
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser
  ) {
    if (!isUuid(id)) {
      throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
    }
    const input = parseBody(ADMIN_MEDIA_REJECT_BODY, body, 'Alasan penolakan tidak valid');
    const media = await this.reviewService.reject(id, user.sub ?? user.id, input.note);
    return { data: { media } };
  }
}
