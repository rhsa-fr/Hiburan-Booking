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
    private readonly media: MediaService
  ) {}

  @Post('media')
  @Roles('vendor_owner')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
  )
  async upload(@UploadedFile() file: UploadedImage | undefined, @Req() request: Request) {
    return { data: await this.media.save(file, request) };
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
