import { Controller, Get, Param, Query } from '@nestjs/common';
import { CalendarService } from '../../calendar/src/index';
import { availabilityQuerySchema, parseInput } from './dto';

/**
 * The availability projection is a PUBLIC endpoint (TECH-DESIGN §7.2:
 * `GET /vendors/{id}/availability` | publik), so it lives outside the guarded
 * booking controller. The path and the response shape are unchanged.
 */
@Controller()
export class AvailabilityController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('vendors/:vendorId/availability')
  async availability(@Param('vendorId') vendorId: string, @Query() query: unknown) {
    const dto = parseInput(availabilityQuerySchema, query);
    return { data: await this.calendar.listAvailability(vendorId, dto.from, dto.to) };
  }
}
