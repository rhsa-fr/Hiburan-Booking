import { Module } from '@nestjs/common';
import { loadConfig } from '@tarlink/core/config';
import { getPool } from '@tarlink/core/db';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard,
    {
      provide: NotificationsRepository,
      useFactory: (): NotificationsRepository => new NotificationsRepository(getPool())
    },
    {
      provide: NotificationsService,
      inject: [NotificationsRepository],
      useFactory: (repository: NotificationsRepository): NotificationsService =>
        new NotificationsService(repository)
    }
  ],
  exports: [NotificationsService]
})
export class NotificationsModule {}
