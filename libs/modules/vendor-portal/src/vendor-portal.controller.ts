import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AuthGuard, Roles, RolesGuard } from '@tarlink/platform/auth';
import { CurrentUser, type AuthUser as BookingAuthUser } from '../../booking/src/current-user.decorator';
import { AppError } from '@tarlink/core/errors';
import {
  VENDOR_MEDIA_LINK_BODY,
  VENDOR_MEDIA_UPLOAD_FIELDS
} from './media.contracts';
import { MediaRepository, isUuid } from './media.repository';
import { MediaService, type UploadedImage } from './media.service';
import {
  CREATE_PACKAGE_BODY,
  UPDATE_PACKAGE_BODY,
  VENDOR_SELF_UPDATE_BODY,
  WRITE_CALENDAR_BODY,
  parseBody
} from './vendor-portal.dto';
import { VendorPortalService } from './vendor-portal.service';

export type AuthUser = BookingAuthUser & { sub?: string };

@UseGuards(AuthGuard, RolesGuard)
@Controller('vendor')
export class VendorPortalController {
  constructor(
    private readonly svc: VendorPortalService,
    private readonly media: MediaService,
    private readonly mediaRepo: MediaRepository
  ) {}

  @Post('media')
  @HttpCode(201)
  @Roles('vendor_owner')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
  )
  async upload(
    @UploadedFile() file: UploadedImage | undefined,
    @Body() body: unknown,
    @Req() request: Request,
    @CurrentUser() user: AuthUser
  ) {
    const rawBody =
      typeof body === 'object' && body !== null
        ? {
            ...body,
            package_id:
              (body as { package_id?: unknown }).package_id === '' ||
              (body as { package_id?: unknown }).package_id === undefined
                ? undefined
                : (body as { package_id?: unknown }).package_id
          }
        : body;
    const fields = parseBody(
      VENDOR_MEDIA_UPLOAD_FIELDS,
      rawBody,
      'Field upload media tidak valid'
    );
    if (fields.kind === 'package_photo' && !fields.package_id) {
      throw new AppError('VALIDATION_ERROR', 'Foto paket harus menyertakan package_id');
    }
    if (fields.kind !== 'package_photo' && fields.package_id) {
      throw new AppError('VALIDATION_ERROR', 'package_id hanya boleh diisi untuk jenis package_photo');
    }
    const vendor = await this.svc.requireVendor(user.sub ?? user.id);
    this.svc.assertVendorCanEditCatalogue(vendor);
    if (fields.kind === 'package_photo' && fields.package_id) {
      const owns = await this.mediaRepo.packageBelongsToVendor(fields.package_id, vendor.id);
      if (!owns) {
        throw new AppError('NOT_FOUND', 'Paket tidak ditemukan untuk vendor ini');
      }
    }
    const saved = await this.media.save(file, request);
    const media = await this.mediaRepo.insertSubmission({
      vendor_id: vendor.id,
      package_id: fields.package_id ?? null,
      kind: fields.kind,
      url: saved.url,
      storage_key: saved.filename,
      license_statement: fields.license_statement,
      status: 'pending',
      submitted_by: user.sub ?? user.id
    });
    return { data: { media } };
  }

  @Post('media/link')
  @HttpCode(201)
  @Roles('vendor_owner')
  async createMediaLink(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser
  ) {
    const rawBody =
      typeof body === 'object' && body !== null
        ? {
            ...body,
            package_id:
              (body as { package_id?: unknown }).package_id === '' ||
              (body as { package_id?: unknown }).package_id === undefined
                ? undefined
                : (body as { package_id?: unknown }).package_id
          }
        : body;
    const input = parseBody(
      VENDOR_MEDIA_LINK_BODY,
      rawBody,
      'Data tautan media tidak valid'
    );
    if (input.kind === 'package_photo' && !input.package_id) {
      throw new AppError('VALIDATION_ERROR', 'Foto paket harus menyertakan package_id');
    }
    if (input.kind !== 'package_photo' && input.package_id) {
      throw new AppError('VALIDATION_ERROR', 'package_id hanya boleh diisi untuk jenis package_photo');
    }
    const vendor = await this.svc.requireVendor(user.sub ?? user.id);
    this.svc.assertVendorCanEditCatalogue(vendor);
    if (input.kind === 'package_photo' && input.package_id) {
      const owns = await this.mediaRepo.packageBelongsToVendor(input.package_id, vendor.id);
      if (!owns) {
        throw new AppError('NOT_FOUND', 'Paket tidak ditemukan untuk vendor ini');
      }
    }
    const media = await this.mediaRepo.insertSubmission({
      vendor_id: vendor.id,
      package_id: input.package_id ?? null,
      kind: input.kind,
      url: input.url,
      storage_key: null,
      license_statement: input.license_statement,
      status: 'pending',
      submitted_by: user.sub ?? user.id
    });
    return { data: { media } };
  }

  @Get('media')
  @Roles('vendor_owner')
  async listMedia(@CurrentUser() user: AuthUser) {
    const vendor = await this.svc.requireVendor(user.sub ?? user.id);
    const items = await this.mediaRepo.listByVendor(vendor.id);
    return { data: { items } };
  }

  @Delete('media/:id')
  @HttpCode(204)
  @Roles('vendor_owner')
  async deleteMedia(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser
  ): Promise<void> {
    if (!isUuid(id)) {
      throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
    }
    const vendor = await this.svc.requireVendor(user.sub ?? user.id);
    const row = await this.mediaRepo.findById(id);
    if (!row || row.vendor_id !== vendor.id) {
      throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
    }
    if (row.status !== 'pending') {
      throw new AppError('CONFLICT', 'Hanya media berstatus pending yang dapat dihapus');
    }
    await this.mediaRepo.deleteById(id);
  }

  @Get('me')
  @Roles('vendor_owner')
  async getMe(@CurrentUser() user: AuthUser) {
    return { data: await this.svc.getMe(user.sub ?? user.id) };
  }

  @Patch('me')
  @Roles('vendor_owner')
  async updateMe(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const input = parseBody(VENDOR_SELF_UPDATE_BODY, body, 'Perubahan profil tidak valid');
    return { data: await this.svc.updateMe(user.sub ?? user.id, input) };
  }

  @Get('packages')
  @Roles('vendor_owner')
  async listPackages(@CurrentUser() user: AuthUser) {
    return this.svc.listPackages(user.sub ?? user.id);
  }

  @Post('packages')
  @Roles('vendor_owner')
  async createPackage(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const input = parseBody(CREATE_PACKAGE_BODY, body, 'Data paket tidak valid');
    return { data: await this.svc.createPackage(user.sub ?? user.id, input) };
  }

  @Patch('packages/:id')
  @Roles('vendor_owner')
  async updatePackage(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser
  ) {
    const input = parseBody(UPDATE_PACKAGE_BODY, body, 'Perubahan paket tidak valid');
    return { data: await this.svc.updatePackage(user.sub ?? user.id, id, input) };
  }

  @Delete('packages/:id')
  @HttpCode(204)
  @Roles('vendor_owner')
  async deletePackage(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.svc.deletePackage(user.sub ?? user.id, id);
  }

  @Put('calendar')
  @Roles('vendor_owner')
  async writeCalendar(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const input = parseBody(WRITE_CALENDAR_BODY, body, 'Perubahan kalender tidak valid');
    return { data: await this.svc.writeCalendar(user.sub ?? user.id, input) };
  }

  @Get('dashboard')
  @Roles('vendor_owner')
  async getDashboard(@CurrentUser() user: AuthUser) {
    return { data: await this.svc.getDashboard(user.sub ?? user.id) };
  }

  @Get('bookings')
  @Roles('vendor_owner')
  async listBookings(@Query() q: unknown, @CurrentUser() user: AuthUser) {
    const query = typeof q === 'object' && q !== null ? (q as Record<string, unknown>) : {};
    const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(query.page_size ?? '20'), 10) || 20));
    const status =
      typeof query.status === 'string' && query.status.trim().length > 0
        ? query.status.trim()
        : undefined;
    return this.svc.listBookings(user.sub ?? user.id, page, pageSize, status);
  }

  @Get('bookings/:id')
  @Roles('vendor_owner')
  async getBooking(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return { data: await this.svc.getBookingDetail(user.sub ?? user.id, id) };
  }

  @Get('earnings')
  @Roles('vendor_owner')
  async getEarnings(@Query() q: unknown, @CurrentUser() user: AuthUser) {
    const query = typeof q === 'object' && q !== null ? (q as Record<string, unknown>) : {};
    const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(query.page_size ?? '20'), 10) || 20));
    return { data: await this.svc.getEarnings(user.sub ?? user.id, page, pageSize) };
  }
}
