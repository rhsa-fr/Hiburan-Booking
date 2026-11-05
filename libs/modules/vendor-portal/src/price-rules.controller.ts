import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards
} from '@nestjs/common';
import { AuthGuard, Roles, RolesGuard } from '@tarlink/platform/auth';
import { CurrentUser, type AuthUser as BookingAuthUser } from '../../booking/src/current-user.decorator';
import { parseCreatePriceRule, parseUpdatePriceRule } from './price-rules.dto';
import { PriceRulesService } from './price-rules.service';

export type AuthUser = BookingAuthUser & { sub?: string };

@UseGuards(AuthGuard, RolesGuard)
@Roles('vendor_owner')
@Controller('vendor/packages/:packageId/price-rules')
export class PriceRulesController {
  constructor(private readonly service: PriceRulesService) {}

  @Get()
  async list(
    @Param('packageId') packageId: string,
    @CurrentUser() user: AuthUser
  ) {
    const rules = await this.service.list(packageId, user.sub ?? user.id);
    return { data: rules };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Param('packageId') packageId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser
  ) {
    const dto = parseCreatePriceRule(body);
    const createdRule = await this.service.create(packageId, dto, user.sub ?? user.id);
    return { data: createdRule };
  }

  @Put(':ruleId')
  async update(
    @Param('packageId') packageId: string,
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser
  ) {
    const dto = parseUpdatePriceRule(body);
    const updatedRule = await this.service.update(packageId, ruleId, dto, user.sub ?? user.id);
    return { data: updatedRule };
  }

  @Delete(':ruleId')
  async delete(
    @Param('packageId') packageId: string,
    @Param('ruleId') ruleId: string,
    @CurrentUser() user: AuthUser
  ) {
    await this.service.delete(packageId, ruleId, user.sub ?? user.id);
    return { data: { deleted: true } };
  }
}
