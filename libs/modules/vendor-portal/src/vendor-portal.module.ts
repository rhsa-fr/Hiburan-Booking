import { Module } from '@nestjs/common';
import { loadConfig } from '@tarlink/core/config';
import { CatalogModule } from '@tarlink/modules/catalog';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { VendorPortalController } from './vendor-portal.controller';
import { VendorPortalRepository } from './vendor-portal.repository';
import { VendorPortalService } from './vendor-portal.service';

@Module({
  imports: [CatalogModule],
  controllers: [VendorPortalController, MediaController],
  providers: [
    VendorPortalRepository,
    VendorPortalService,
    MediaService,
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard
  ],
  exports: [VendorPortalService]
})
export class VendorPortalModule {}
