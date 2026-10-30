import { Injectable } from '@nestjs/common';
import { AppError } from '@tarlink/core/errors';
import {
  CatalogService,
  idrToPgParam,
  type CreatePackageInput,
  type PackageList,
  type PackageRow,
  type UpdatePackageInput,
  type WriteCalendarInput
} from '@tarlink/modules/catalog';
import type {
  CreatePackageBody,
  UpdatePackageBody,
  VendorSelfUpdateInput,
  WriteCalendarBody
} from './vendor-portal.dto';
import { VendorPortalRepository } from './vendor-portal.repository';

@Injectable()
export class VendorPortalService {
  constructor(
    private readonly repo: VendorPortalRepository,
    private readonly catalog: CatalogService
  ) {}

  private async requireVendor(userId: string) {
    const v = await this.repo.findVendorByOwner(userId);
    if (!v) {
      throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan untuk akun ini.');
    }
    return v;
  }

  async getMe(userId: string) {
    return this.requireVendor(userId);
  }

  async updateMe(userId: string, input: VendorSelfUpdateInput) {
    const vendor = await this.requireVendor(userId);
    const row = await this.repo.updateOwnProfile(vendor.id, {
      ...input,
      transport_fee_per_km_idr:
        input.transport_fee_per_km_idr === undefined
          ? undefined
          : idrToPgParam(input.transport_fee_per_km_idr, 'vendor.transport_fee_per_km_idr')
    });
    if (!row) throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan.');
    return row;
  }

  async listPackages(userId: string): Promise<PackageList> {
    const vendor = await this.requireVendor(userId);
    return this.catalog.listPackages(vendor.id);
  }

  async createPackage(userId: string, input: CreatePackageBody): Promise<PackageRow> {
    const vendor = await this.requireVendor(userId);
    return this.catalog.createPackage(vendor.id, input as CreatePackageInput);
  }

  async updatePackage(
    userId: string,
    packageId: string,
    input: UpdatePackageBody
  ): Promise<PackageRow> {
    const vendor = await this.requireVendor(userId);
    return this.catalog.updatePackage(vendor.id, packageId, input as UpdatePackageInput);
  }

  async deletePackage(userId: string, packageId: string): Promise<void> {
    const vendor = await this.requireVendor(userId);
    await this.catalog.deletePackage(vendor.id, packageId);
  }

  async writeCalendar(userId: string, input: WriteCalendarBody) {
    const vendor = await this.requireVendor(userId);
    return this.catalog.writeCalendar(vendor.id, input as WriteCalendarInput, userId, 'vendor');
  }

  async getDashboard(userId: string) {
    const vendor = await this.requireVendor(userId);
    const summary = await this.repo.getSummary(vendor.id);
    return {
      vendor,
      summary
    };
  }

  async listBookings(userId: string, page: number, pageSize: number, status?: string) {
    const vendor = await this.requireVendor(userId);
    const safePage = Math.max(1, page || 1);
    const safePageSize = Math.min(100, Math.max(1, pageSize || 20));
    const offset = (safePage - 1) * safePageSize;

    const rows = await this.repo.listBookings(
      vendor.id,
      status ?? null,
      safePageSize,
      offset
    );
    const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
    const items = rows.map(({ total_count, ...item }) => item);

    return {
      items,
      total,
      page: safePage,
      page_size: safePageSize
    };
  }

  async getBookingDetail(userId: string, bookingId: string) {
    const vendor = await this.requireVendor(userId);
    const booking = await this.repo.findBookingForVendor(bookingId, vendor.id);
    if (!booking) {
      throw new AppError('NOT_FOUND', 'Booking tidak ditemukan');
    }
    return booking;
  }

  async getEarnings(userId: string, page: number, pageSize: number) {
    const vendor = await this.requireVendor(userId);
    const safePage = Math.max(1, page || 1);
    const safePageSize = Math.min(100, Math.max(1, pageSize || 20));
    const offset = (safePage - 1) * safePageSize;

    const [held_idr, rows] = await Promise.all([
      this.repo.getHeldBalance(vendor.id),
      this.repo.listSettledBookings(vendor.id, safePageSize, offset)
    ]);

    const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
    const items = rows.map(({ total_count, ...item }) => item);

    return {
      held_idr,
      held_balance_idr: held_idr,
      settled: {
        items,
        total,
        page: safePage,
        page_size: safePageSize
      }
    };
  }
}
