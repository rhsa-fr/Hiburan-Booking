import { describe, expect, it, vi } from 'vitest';
import { CatalogController } from './catalog.controller';
import type { CatalogService } from './catalog.service';

const VENDOR_ID = '22222222-2222-4222-8222-222222222222';

function arrange() {
  const service = {
    listVendorCategories: vi.fn().mockResolvedValue({ vendor_id: VENDOR_ID, items: [] }),
    setVendorCategories: vi.fn().mockResolvedValue({ vendor_id: VENDOR_ID, items: [] })
  };
  return {
    subject: new CatalogController(service as unknown as CatalogService),
    service
  };
}

describe('CatalogController vendor categories', () => {
  it('passes a valid assignment to the service', async () => {
    const { subject, service } = arrange();

    await subject.setVendorCategories(VENDOR_ID, {
      categories: [{ slug: 'tarling' }, { slug: 'organ-tunggal', is_primary: true }]
    });

    expect(service.setVendorCategories).toHaveBeenCalledWith(VENDOR_ID, {
      categories: [{ slug: 'tarling' }, { slug: 'organ-tunggal', is_primary: true }]
    });
  });

  it('rejects duplicate slugs', async () => {
    const { subject, service } = arrange();

    await expect(
      subject.setVendorCategories(VENDOR_ID, {
        categories: [{ slug: 'tarling' }, { slug: 'tarling' }]
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(service.setVendorCategories).not.toHaveBeenCalled();
  });

  it('rejects more than one primary category', async () => {
    const { subject, service } = arrange();

    await expect(
      subject.setVendorCategories(VENDOR_ID, {
        categories: [
          { slug: 'tarling', is_primary: true },
          { slug: 'organ-tunggal', is_primary: true }
        ]
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(service.setVendorCategories).not.toHaveBeenCalled();
  });

  it('rejects a slug that is not lowercase kebab-case', async () => {
    const { subject, service } = arrange();

    await expect(
      subject.setVendorCategories(VENDOR_ID, {
        categories: [{ slug: 'Tarling Dangdut' }]
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(service.setVendorCategories).not.toHaveBeenCalled();
  });

  it('reads the assignment from the service', async () => {
    const { subject, service } = arrange();

    const result = await subject.vendorCategories(VENDOR_ID);

    expect(service.listVendorCategories).toHaveBeenCalledWith(VENDOR_ID);
    expect(result).toEqual({ vendor_id: VENDOR_ID, items: [] });
  });
});
