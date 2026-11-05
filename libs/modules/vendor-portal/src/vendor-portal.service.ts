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
import { MEDIA_NOT_APPROVED_CODE } from './media.contracts';
import { MediaRepository } from './media.repository';
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
    private readonly catalog: CatalogService,
    private readonly mediaRepo: MediaRepository
  ) {}

  async requireVendor(userId: string) {
    const v = await this.repo.findVendorByOwner(userId);
    if (!v) {
      throw new AppError('NOT_FOUND', 'Vendor tidak ditemukan untuk akun ini.');
    }
    return v;
  }

  /**
   * FR-107: kolom media publik hanya boleh berisi URL yang sudah disetujui.
   * Dipakai `updateMe`, `createPackage`, dan `updatePackage` supaya tidak ada
   * jalur tulis yang melewati moderasi.
   */
  private async assertApprovedMedia(vendorId: string, urls: string[]): Promise<void> {
    const approvedSet = await this.mediaRepo.findApprovedUrls(vendorId, urls);
    for (const url of urls) {
      if (!approvedSet.has(url)) {
        throw new AppError('VALIDATION_ERROR', `Media belum disetujui: ${url}`, {
          reason: MEDIA_NOT_APPROVED_CODE
        });
      }
    }
  }

  async getMe(userId: string) {
    return this.requireVendor(userId);
  }

  async updateMe(userId: string, input: VendorSelfUpdateInput) {
    const vendor = await this.requireVendor(userId);

    const urlsToCheck: string[] = [];
    if (typeof input.avatar_url === 'string' && input.avatar_url.trim().length > 0) {
      urlsToCheck.push(input.avatar_url.trim());
    }
    if (typeof input.banner_url === 'string' && input.banner_url.trim().length > 0) {
      urlsToCheck.push(input.banner_url.trim());
    }
    if (typeof input.video_url === 'string' && input.video_url.trim().length > 0) {
      urlsToCheck.push(input.video_url.trim());
    }
    if (Array.isArray(input.photo_urls)) {
      for (const url of input.photo_urls) {
        if (typeof url === 'string' && url.trim().length > 0) {
          urlsToCheck.push(url.trim());
        }
      }
    }

    if (urlsToCheck.length > 0) {
      await this.assertApprovedMedia(vendor.id, urlsToCheck);
    }

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
    if (input.photo_url) {
      await this.assertApprovedMedia(vendor.id, [input.photo_url]);
    }
    return this.catalog.createPackage(vendor.id, input as CreatePackageInput);
  }

  async updatePackage(
    userId: string,
    packageId: string,
    input: UpdatePackageBody
  ): Promise<PackageRow> {
    const vendor = await this.requireVendor(userId);
    if (input.photo_url) {
      await this.assertApprovedMedia(vendor.id, [input.photo_url]);
    }
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

    const [held_idr, rows, payout] = await Promise.all([
      this.repo.getHeldBalance(vendor.id),
      this.repo.listSettledBookings(vendor.id, safePageSize, offset),
      this.repo.getPayoutSummary(vendor.id)
    ]);

    const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
    const items = rows.map(({ total_count, ...item }) => item);

    return {
      held_idr,
      held_balance_idr: held_idr,
      available_idr: payout.available_idr,
      pending_payout_idr: payout.pending_payout_idr,
      bank_account: payout.bank_code
        ? {
            bank_code: payout.bank_code,
            bank_name: payout.bank_name,
            account_number_masked: payout.account_number_masked,
            account_holder_name: payout.account_holder_name,
            status: payout.bank_status
          }
        : null,
      settled: {
        items,
        total,
        page: safePage,
        page_size: safePageSize
      }
    };
  }
}
