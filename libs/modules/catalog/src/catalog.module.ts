import { Module } from '@nestjs/common';
import { loadConfig } from '@tarlink/core/config';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

/**
 * Catalog module: vendor lifecycle, packages and the vendor calendar
 * (`POST/PATCH /admin/vendors*`).
 *
 * Note for the lead: `AppModule` is lead-owned; import `CatalogModule` there.
 * It needs no extra configuration — the JWT secret is read from `loadConfig()`
 * here and both guards are registered in this injector, same as `AdminModule`.
 */
@Module({
  controllers: [CatalogController],
  providers: [
    CatalogRepository,
    CatalogService,
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard
  ],
  exports: [CatalogService]
})
export class CatalogModule {}
