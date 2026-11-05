import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { AppError } from '@tarlink/core/errors';
import { AuthGuard, Roles, RolesGuard, type AuthenticatedRequest } from '@tarlink/platform/auth';
import type { UploadedImage } from '@tarlink/modules/vendor-portal';
import {
  LIST_VENDOR_APPLICATIONS_QUERY,
  REVIEW_VENDOR_APPLICATION_BODY,
  SUBMIT_VENDOR_APPLICATION_BODY,
  type VendorApplicationList,
  type VendorApplicationView
} from './vendor-onboarding.contracts';
import { MAX_KTP_BYTES } from './ktp-storage.service';
import { VendorOnboardingService, type ReviewActor } from './vendor-onboarding.service';

const UUID = z.string().uuid();

function requireUser(request: AuthenticatedRequest): { id: string; roles: string[] } {
  if (!request.user) throw new AppError('UNAUTHENTICATED', 'Authentication is required');
  return { id: request.user.id, roles: request.user.roles };
}

function adminActor(request: AuthenticatedRequest): ReviewActor {
  const user = requireUser(request);
  const role = user.roles.find((candidate) => candidate.startsWith('admin_'));
  if (!role) throw new AppError('FORBIDDEN', 'Butuh peran admin.');
  return { id: user.id, role };
}

/** Public reference data for the onboarding form. */
@Controller('regions')
export class RegionsController {
  constructor(private readonly onboarding: VendorOnboardingService) {}

  @Get()
  async list(): Promise<{ items: Array<{ code: string; name: string; level: string }> }> {
    return { items: await this.onboarding.regions() };
  }
}

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class VendorOnboardingController {
  constructor(private readonly onboarding: VendorOnboardingService) {}

  /** Private KTP upload; the file is never served from `/v1/media`. */
  @Post('vendor-applications/ktp')
  @HttpCode(201)
  @Roles('customer')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_KTP_BYTES, files: 1 } }))
  async uploadKtp(
    @UploadedFile() file: UploadedImage | undefined,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: { ktp_object_key: string } }> {
    const user = requireUser(request);
    return { data: await this.onboarding.uploadKtp(user.id, file) };
  }

  @Post('vendor-applications')
  @HttpCode(201)
  @Roles('customer')
  async submit(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: VendorApplicationView }> {
    const user = requireUser(request);
    const parsed = SUBMIT_VENDOR_APPLICATION_BODY.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Pengajuan vendor tidak valid', parsed.error.issues);
    }
    return { data: await this.onboarding.submit(user.id, parsed.data) };
  }

  @Get('vendor-applications/me')
  @Roles('customer')
  async mine(
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: VendorApplicationView | null }> {
    const user = requireUser(request);
    return { data: await this.onboarding.myApplication(user.id) };
  }
}

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class VendorOnboardingAdminController {
  constructor(private readonly onboarding: VendorOnboardingService) {}

  @Get('admin/vendor-applications')
  @Roles('admin_support', 'admin_super')
  async list(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<VendorApplicationList> {
    const parsed = LIST_VENDOR_APPLICATIONS_QUERY.safeParse(query);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Filter pengajuan tidak valid', parsed.error.issues);
    }
    const user = requireUser(request);
    return this.onboarding.list(parsed.data, {
      // Full NIK is only for the role that can also open the private KTP.
      revealNik: user.roles.includes('admin_super')
    });
  }

  /** PII: only admin_super may open the private KTP file. Every access is audited. */
  @Get('admin/vendor-applications/:id/ktp')
  @Roles('admin_super')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async ktp(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest
  ): Promise<StreamableFile> {
    const parsed = UUID.safeParse(id);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'invalid application id');

    const file = await this.onboarding.ktpFile(parsed.data, adminActor(request));
    return new StreamableFile(file.buffer, {
      type: file.mime,
      disposition: 'inline',
      length: file.size
    });
  }

  @Post('admin/vendor-applications/:id/approve')
  @HttpCode(200)
  @Roles('admin_super')
  async approve(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: VendorApplicationView }> {
    return this.decide(id, 'approve', undefined, request);
  }

  @Post('admin/vendor-applications/:id/reject')
  @HttpCode(200)
  @Roles('admin_super')
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ data: VendorApplicationView }> {
    return this.decide(id, 'reject', body, request);
  }

  private async decide(
    id: string,
    decision: 'approve' | 'reject',
    body: unknown,
    request: AuthenticatedRequest
  ): Promise<{ data: VendorApplicationView }> {
    const parsedId = UUID.safeParse(id);
    if (!parsedId.success) throw new AppError('VALIDATION_ERROR', 'invalid application id');

    const payload =
      decision === 'approve'
        ? { decision }
        : { ...(typeof body === 'object' && body !== null ? body : {}), decision };
    const parsed = REVIEW_VENDOR_APPLICATION_BODY.safeParse(payload);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Keputusan tidak valid', parsed.error.issues);
    }
    return {
      data: await this.onboarding.review(parsedId.data, parsed.data, adminActor(request))
    };
  }
}
