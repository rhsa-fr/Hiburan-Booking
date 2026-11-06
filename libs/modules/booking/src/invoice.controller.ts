import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, Roles, RolesGuard } from '../../../platform/auth/src/index';
import { CurrentUser, type AuthUser } from './current-user.decorator';
import { InvoiceService } from './invoice.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller()
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get('bookings/:id/invoice')
  @Roles('customer', 'vendor_owner', 'vendor_member', 'admin_support', 'admin_finance', 'admin_super')
  async getInvoice(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response
  ) {
    const invoiceData = await this.invoiceService.getInvoiceData(id, user);

    if (format === 'json') {
      return res.json({ data: invoiceData });
    }

    const html = this.invoiceService.renderHtml(invoiceData);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Defense in depth for a self-contained printable document: no scripts, no
    // network requests, no embedding.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(html);
  }
}
