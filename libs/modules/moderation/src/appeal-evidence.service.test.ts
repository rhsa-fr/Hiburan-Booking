import { describe, expect, it, vi } from 'vitest';
import type { ContentReportAppealRow, ModerationRepository } from './moderation.repository';
import type { AppealEvidenceStorage } from './appeal-evidence.storage';
import { AppealEvidenceService } from './appeal-evidence.service';

const REPORT_ID = '3f2b1c44-9d6e-4a1f-8f7c-1a2b3c4d5e6f';
const APPEAL_ID = '8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const OWNER = { id: '11111111-1111-1111-1111-111111111111', role: null, requestId: 'req-1' };
const STRANGER = { id: '99999999-9999-9999-9999-999999999999', role: null, requestId: null };
const ADMIN = { id: '22222222-2222-2222-2222-222222222222', role: 'admin_support', requestId: 'req-2' };

const PNG = {
  originalname: 'bukti.png',
  mimetype: 'image/png',
  size: 12,
  buffer: Buffer.alloc(12, 1)
};

function appealRow(overrides: Partial<ContentReportAppealRow> = {}): ContentReportAppealRow {
  return {
    id: APPEAL_ID,
    report_id: REPORT_ID,
    appellant_id: OWNER.id,
    reason: 'Konten ini milik saya sendiri dan tidak melanggar hak cipta.',
    evidence_url: null,
    evidence_file_path: null,
    status: 'pending',
    decision_note: null,
    decided_by: null,
    decided_at: null,
    created_at: new Date('2026-11-08T03:00:00.000Z'),
    updated_at: new Date('2026-11-08T03:00:00.000Z'),
    target_type: 'review',
    target_id: '02111620-b1b4-4af5-b06b-77067c93e606',
    report_resolution: 'content_removed',
    report_resolved_at: new Date('2026-11-07T03:00:00.000Z'),
    ...overrides
  };
}

function setup(options: {
  appeal?: ContentReportAppealRow | null;
  attachError?: Error;
} = {}): {
  service: AppealEvidenceService;
  repository: ModerationRepository;
  storage: AppealEvidenceStorage;
  save: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  attach: ReturnType<typeof vi.fn>;
  audited: ReturnType<typeof vi.fn>;
} {
  const savedKey = `appeal/${REPORT_ID}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`;
  const save = vi.fn(async () => ({ objectKey: savedKey }));
  const remove = vi.fn(async () => undefined);
  const read = vi.fn(async () => ({ buffer: PNG.buffer, mime: 'image/png', size: 12 }));
  const attach = vi.fn(async () => {
    if (options.attachError) throw options.attachError;
    return appealRow({ evidence_file_path: savedKey });
  });
  const audited = vi.fn(async () => undefined);

  const repository = {
    findAppealByReport: vi.fn(async () => (options.appeal === null ? null : (options.appeal ?? appealRow()))),
    findAppealById: vi.fn(async () => (options.appeal === null ? null : (options.appeal ?? appealRow()))),
    attachAppealEvidenceFile: attach,
    auditAppealEvidenceViewed: audited
  } as unknown as ModerationRepository;

  const storage = { save, remove, read } as unknown as AppealEvidenceStorage;
  const service = new AppealEvidenceService(repository, storage);
  return { service, repository, storage, save, remove, attach, audited };
}

describe('AppealEvidenceService.attach', () => {
  it('stores the file, records the audit and returns the updated appeal', async () => {
    const { service, attach, save } = setup();

    const view = await service.attach(REPORT_ID, OWNER, PNG);

    expect(save).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith(
      expect.objectContaining({
        appealId: APPEAL_ID,
        actorId: OWNER.id,
        previousObjectKey: null
      })
    );
    expect(view.has_evidence_file).toBe(true);
    expect(view.evidence_url).toBeNull();
  });

  it('removes the previous file after a successful replacement', async () => {
    const { service, remove } = setup({
      appeal: appealRow({ evidence_file_path: 'appeal/x/old.png' })
    });

    await service.attach(REPORT_ID, OWNER, PNG);

    expect(remove).toHaveBeenCalledWith('appeal/x/old.png');
  });

  it('hides the appeal from a stranger instead of leaking it', async () => {
    const { service, save } = setup();

    await expect(service.attach(REPORT_ID, STRANGER, PNG)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND when no appeal exists for the report', async () => {
    const { service } = setup({ appeal: null });

    await expect(service.attach(REPORT_ID, OWNER, PNG)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });

  it('refuses to change a decided appeal', async () => {
    const { service, save, remove } = setup({ appeal: appealRow({ status: 'accepted' }) });

    await expect(service.attach(REPORT_ID, OWNER, PNG)).rejects.toMatchObject({
      code: 'CONFLICT'
    });
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes the freshly written file when the row update fails', async () => {
    const { service, remove, save } = setup({
      attachError: Object.assign(new Error('conflict'), { code: 'CONFLICT' })
    });

    await expect(service.attach(REPORT_ID, OWNER, PNG)).rejects.toMatchObject({
      code: 'CONFLICT'
    });
    expect(save).toHaveBeenCalledTimes(1);
    // The just-saved key is cleaned up; it is not the previous key.
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0]).toMatch(/^appeal\//);
  });
});

describe('AppealEvidenceService.readOwn', () => {
  it('returns the decrypted bytes for the owner', async () => {
    const { service } = setup({
      appeal: appealRow({ evidence_file_path: 'appeal/x/file.png' })
    });

    const file = await service.readOwn(REPORT_ID, OWNER);
    expect(file.mime).toBe('image/png');
    expect(file.size).toBe(12);
  });

  it('answers NOT_FOUND when the owner never attached a file', async () => {
    const { service } = setup();

    await expect(service.readOwn(REPORT_ID, OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers NOT_FOUND for someone who does not own the appeal', async () => {
    const { service } = setup({
      appeal: appealRow({ evidence_file_path: 'appeal/x/file.png' })
    });

    await expect(service.readOwn(REPORT_ID, STRANGER)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('AppealEvidenceService.readAsAdmin', () => {
  it('audits the read before returning the bytes', async () => {
    const { service, audited } = setup({
      appeal: appealRow({ evidence_file_path: 'appeal/x/file.png' })
    });

    const file = await service.readAsAdmin(APPEAL_ID, ADMIN);

    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({ appealId: APPEAL_ID, actorId: ADMIN.id, actorRole: 'admin_support' })
    );
    expect(file.size).toBe(12);
  });

  it('refuses an appeal without a file and does not audit a read that never happens', async () => {
    const { service, audited } = setup();

    await expect(service.readAsAdmin(APPEAL_ID, ADMIN)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    expect(audited).not.toHaveBeenCalled();
  });
});
