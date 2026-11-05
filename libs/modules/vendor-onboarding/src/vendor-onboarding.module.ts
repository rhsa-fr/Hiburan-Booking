import { Module } from '@nestjs/common';
import { loadConfig } from '@tarlink/core/config';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import {
  RegionsController,
  VendorOnboardingAdminController,
  VendorOnboardingController
} from './vendor-onboarding.controller';
import { VendorOnboardingRepository } from './vendor-onboarding.repository';
import { VendorOnboardingService } from './vendor-onboarding.service';
import { KtpStorageService } from './ktp-storage.service';

@Module({
  controllers: [RegionsController, VendorOnboardingController, VendorOnboardingAdminController],
  providers: [
    VendorOnboardingRepository,
    VendorOnboardingService,
    KtpStorageService,
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard
  ],
  exports: [VendorOnboardingService, VendorOnboardingRepository]
})
export class VendorOnboardingModule {}
