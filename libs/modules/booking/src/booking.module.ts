import { Module } from '@nestjs/common';
import { loadConfig } from '../../../../apps/api/src/core/config';
import { AuthGuard, JWT_SECRET, RolesGuard } from '../../../platform/auth/src/index';
import { CalendarModule } from '../../calendar/src/index';
import { AvailabilityController } from './availability.controller';
import { BookingController } from './booking.controller';
import { BookingRepository } from './booking.repository';
import { BookingService } from './booking.service';
import { RequestIdInterceptor } from './request-context';

@Module({
  imports: [CalendarModule],
  controllers: [BookingController, AvailabilityController],
  providers: [
    BookingRepository,
    BookingService,
    RequestIdInterceptor,
    // The guards are registered here so they resolve in THIS module's
    // injector: `AuthGuard` needs the JWT secret from configuration, and
    // `RolesGuard` needs the `Reflector` of the framework. The secret is
    // provided as a token, because a primitive constructor parameter cannot be
    // injected by Nest.
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard
  ],
  exports: [BookingRepository, BookingService]
})
export class BookingModule {}
