import { Module } from '@nestjs/common';
import { CalendarRepository } from './calendar.repository';
import { CalendarService } from './calendar.service';

@Module({
  providers: [CalendarRepository, CalendarService],
  exports: [CalendarRepository, CalendarService]
})
export class CalendarModule {}
