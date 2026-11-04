import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, Roles, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import type { FavoriteListResult } from './contracts';
import { FavoriteService } from './favorite.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VENDOR_ID_PARAM = z.string().trim().regex(UUID_REGEX, 'ID vendor harus UUID');

const pageNumber = (fallback: number, max?: number): z.ZodType<number> => {
  const base = z.coerce.number().int().min(1);
  const bounded = max === undefined ? base : base.max(max);
  return z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : value),
    bounded.default(fallback)
  ) as z.ZodType<number>;
};

const FAVORITES_LIST_QUERY = z.object({
  page: pageNumber(1),
  page_size: pageNumber(20, 100)
});

function parse<T>(schema: z.ZodType<T>, raw: unknown, message: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', message, parsed.error.issues);
  }
  return parsed.data;
}

function requireUserId(request: AuthenticatedRequest): string {
  const userId = request.user?.id;
  if (!userId) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  }
  return userId;
}

@Controller('favorites')
@UseGuards(AuthGuard, RolesGuard)
@Roles('customer')
export class FavoriteController {
  constructor(private readonly favoriteService: FavoriteService) {}

  @Post(':vendorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async addFavorite(
    @Param('vendorId') vendorId: string,
    @Req() req: AuthenticatedRequest
  ): Promise<void> {
    const validVendorId = parse(VENDOR_ID_PARAM, vendorId, 'ID vendor tidak valid');
    await this.favoriteService.addFavorite(requireUserId(req), validVendorId);
  }

  @Delete(':vendorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFavorite(
    @Param('vendorId') vendorId: string,
    @Req() req: AuthenticatedRequest
  ): Promise<void> {
    const validVendorId = parse(VENDOR_ID_PARAM, vendorId, 'ID vendor tidak valid');
    await this.favoriteService.removeFavorite(requireUserId(req), validVendorId);
  }

  @Get()
  async listFavorites(
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest
  ): Promise<FavoriteListResult> {
    const parsed = parse(FAVORITES_LIST_QUERY, query, 'Parameter daftar favorit tidak valid');
    return this.favoriteService.listFavorites(
      requireUserId(req),
      parsed.page,
      parsed.page_size
    );
  }

  @Get(':vendorId')
  async isFavorite(
    @Param('vendorId') vendorId: string,
    @Req() req: AuthenticatedRequest
  ): Promise<{ data: { is_favorite: boolean } }> {
    const validVendorId = parse(VENDOR_ID_PARAM, vendorId, 'ID vendor tidak valid');
    const isFavorite = await this.favoriteService.isFavorite(requireUserId(req), validVendorId);
    return { data: { is_favorite: isFavorite } };
  }
}
