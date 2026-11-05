import { Module } from '@nestjs/common';
import { loadConfig } from '@tarlink/core/config';
import { CatalogModule } from '@tarlink/modules/catalog';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { MediaAdminController } from './media-admin.controller';
import { MediaController } from './media.controller';
import { MediaRepository } from './media.repository';
import { MediaReviewService } from './media-review.service';
import { MediaService } from './media.service';
import { PriceRulesController } from './price-rules.controller';
import { PriceRulesRepository } from './price-rules.repository';
import { PriceRulesService } from './price-rules.service';
import { VendorPortalController } from './vendor-portal.controller';
import { VendorPortalRepository } from './vendor-portal.repository';
import { VendorPortalService } from './vendor-portal.service';

@Module({
  imports: [CatalogModule],
  controllers: [
    VendorPortalController,
    MediaController,
    MediaAdminController,
    PriceRulesController
  ],
  providers: [
    VendorPortalRepository,
    VendorPortalService,
    MediaService,
    MediaRepository,
    MediaReviewService,
    PriceRulesRepository,
    PriceRulesService,
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard
  ],
  exports: [
    VendorPortalService,
    MediaReviewService,
    PriceRulesRepository,
    PriceRulesService
  ]
})
export class VendorPortalModule {}
