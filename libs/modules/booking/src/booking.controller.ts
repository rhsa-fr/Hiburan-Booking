import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { AuthGuard, Roles, RolesGuard } from '../../../platform/auth/src/index';
import { BookingService } from './booking.service';
import { CurrentUser, type AuthUser } from './current-user.decorator';
import {
  acceptBookingSchema,
  cancelBookingSchema,
  createBookingSchema,
  declineBookingSchema,
  parseInput
} from './dto';
import { RequestIdInterceptor } from './request-context';

/**
 * Mounted under the app's global `/v1` prefix (main.ts), so paths here are
 * relative: POST /v1/bookings, GET /v1/bookings/:id, …
 *
 * Identity comes from the verified access token only (`AuthGuard`); the role
 * checks below follow TECH-DESIGN §7.2. Ownership is enforced by the service
 * (a role alone never grants access to a booking).
 */
@UseGuards(AuthGuard, RolesGuard)
@UseInterceptors(RequestIdInterceptor)
@Controller()
export class BookingController {
  constructor(private readonly bookings: BookingService) {}

  @Post('bookings')
  @HttpCode(201)
  @Roles('customer')
  async create(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const dto = parseInput(createBookingSchema, body);
    return { data: await this.bookings.createBooking(dto, user) };
  }

  @Get('bookings/:id')
  @Roles('customer', 'vendor_owner', 'vendor_member', 'admin_support', 'admin_finance', 'admin_super')
  async getById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return { data: await this.bookings.getById(id, user) };
  }

  @Post('bookings/:id/accept')
  @HttpCode(200)
  @Roles('vendor_owner', 'vendor_member')
  async accept(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser
  ) {
    const dto = parseInput(acceptBookingSchema, body);
    return { data: await this.bookings.accept(id, dto, user) };
  }

  @Post('bookings/:id/decline')
  @HttpCode(200)
  @Roles('vendor_owner', 'vendor_member')
  async decline(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser
  ) {
    const dto = parseInput(declineBookingSchema, body);
    return { data: await this.bookings.decline(id, dto, user) };
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @Roles('customer', 'vendor_owner', 'admin_support', 'admin_finance', 'admin_super')
  async cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser
  ) {
    const dto = parseInput(cancelBookingSchema, body);
    return { data: await this.bookings.cancel(id, dto, user) };
  }
}
