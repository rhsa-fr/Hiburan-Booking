import { describe, expect, it, vi } from 'vitest';
import {
  slaDueAt,
  type BlockUserInput,
  type CreateReportInput,
  type ReportTargetContext
} from './moderation.contracts';
import type {
  ContentReportAppealRow,
  ContentReportRow,
  ModerationRepository,
  OwnedTakedownRow
} from './moderation.repository';
import { ModerationService, REPORT_RATE_LIMIT_MAX } from './moderation.service';

type FakeRepo = {
  [K in keyof ModerationRepository]: ReturnType<typeof vi.fn>;
};

function fakeRepo(overrides: Partial<FakeRepo> = {}): FakeRepo {
  const base: FakeRepo = {
    createReport: vi.fn(),
    findById: vi.fn(),
    listByReporter: vi.fn(),
    countByReporter: vi.fn(),
    listQueue: vi.fn(),
    countQueue: vi.fn(),
    targetContext: vi.fn(),
    userExists: vi.fn(),
    userDisplayName: vi.fn(),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
    listBlocks: vi.fn(),
    isBlocked: vi.fn(),
    resolveReport: vi.fn(),
    findAppealById: vi.fn(),
    findAppealByReport: vi.fn(),
    createAppeal: vi.fn(),
    listAppeals: vi.fn(),
    countAppeals: vi.fn(),
    resolveAppeal: vi.fn(),
    listOwnedTakedowns: vi.fn(),
    countOwnedTakedowns: vi.fn()
  };
  return { ...base, ...overrides };
}

function repo(fake: FakeRepo): ModerationRepository {
  return fake as unknown as ModerationRepository;
}

const REPORTER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const REPORT_ID = '33333333-3333-4333-8333-333333333333';
const TARGET_ID = '44444444-4444-4444-8444-444444444444';
const ACTOR = { id: REPORTER, roles: ['customer'] as const };

const REPORT_INPUT: CreateReportInput = {
  target_type: 'vendor',
  target_id: TARGET_ID,
  reason: 'fraud',
  detail: 'Vendor meminta transfer langsung setelah DP dibayar.'
};

function target(overrides: Partial<ReportTargetContext> = {}): ReportTargetContext {
  return {
    found: true,
    summary: 'Vendor Panggung Jaya (approved)',
    owner_user_id: OTHER_USER,
    hidden: false,
    can_report: true,
    ...overrides
  };
}

function row(overrides: Partial<ContentReportRow> = {}): ContentReportRow {
  return {
    id: REPORT_ID,
    reporter_id: REPORTER,
    target_type: 'vendor',
    target_id: TARGET_ID,
    booking_id: null,
    reason: 'fraud',
    detail: REPORT_INPUT.detail,
    evidence_url: null,
    status: 'open',
    resolution: null,
    resolution_note: null,
    resolved_by: null,
    resolved_at: null,
    sla_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    escalated_at: null,
    created_at: new Date('2026-11-08T02:00:00.000Z'),
    updated_at: new Date('2026-11-08T02:00:00.000Z'),
    ...overrides
  };
}

const APPEAL_ID = '55555555-5555-4555-8555-555555555555';

function appealRow(overrides: Partial<ContentReportAppealRow> = {}): ContentReportAppealRow {  return {
    id: APPEAL_ID,
    report_id: REPORT_ID,
    appellant_id: OTHER_USER,
    reason: 'Konten ini saya buat sendiri dan tidak melanggar hak cipta siapa pun.',
    evidence_url: null,
    status: 'pending',
    decision_note: null,
    decided_by: null,
    decided_at: null,
    created_at: new Date('2026-11-08T03:00:00.000Z'),
    updated_at: new Date('2026-11-08T03:00:00.000Z'),
    target_type: 'review',
    target_id: TARGET_ID,
    report_resolution: 'content_removed',
    report_resolved_at: new Date('2026-11-07T03:00:00.000Z'),
    ...overrides
  };
}

describe('slaDueAt', () => {
  it('gives ordinary reports 24 hours (FR-123)', () => {
    const now = new Date('2026-11-08T02:00:00.000Z');
    expect(slaDueAt('fraud', now).toISOString()).toBe('2026-11-09T02:00:00.000Z');
  });

  it('gives copyright reports 72 hours (FR-124)', () => {
    const now = new Date('2026-11-08T02:00:00.000Z');
    expect(slaDueAt('copyright', now).toISOString()).toBe('2026-11-11T02:00:00.000Z');
  });
});

describe('ModerationService.createReport', () => {
  it('rejects an unknown target with 404', async () => {
    const fake = fakeRepo({
      targetContext: vi.fn().mockResolvedValue(target({ found: false }))
    });
    const service = new ModerationService(repo(fake));

    await expect(service.createReport(ACTOR, REPORT_INPUT)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
    expect(fake.createReport).not.toHaveBeenCalled();
  });

  it('refuses to report a chat message outside the reporter booking', async () => {
    const fake = fakeRepo({
      targetContext: vi.fn().mockResolvedValue(target({ can_report: false }))
    });
    const service = new ModerationService(repo(fake));

    await expect(
      service.createReport(ACTOR, { ...REPORT_INPUT, target_type: 'chat_message' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses to report your own content', async () => {
    const fake = fakeRepo({
      targetContext: vi.fn().mockResolvedValue(target({ owner_user_id: REPORTER }))
    });
    const service = new ModerationService(repo(fake));

    await expect(service.createReport(ACTOR, REPORT_INPUT)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('rate-limits report creation per user after the hourly budget', async () => {
    const fake = fakeRepo({
      targetContext: vi.fn().mockResolvedValue(target()),
      createReport: vi.fn().mockResolvedValue(row())
    });
    const service = new ModerationService(repo(fake));

    for (let index = 0; index < REPORT_RATE_LIMIT_MAX; index += 1) {
      await service.createReport(ACTOR, REPORT_INPUT);
    }
    await expect(service.createReport(ACTOR, REPORT_INPUT)).rejects.toMatchObject({
      code: 'RATE_LIMITED'
    });
    expect(fake.createReport).toHaveBeenCalledTimes(REPORT_RATE_LIMIT_MAX);
  });

  it('turns a second open report for the same target into 409', async () => {
    const duplicate = Object.assign(new Error('duplicate key'), { code: '23505' });
    const fake = fakeRepo({
      targetContext: vi.fn().mockResolvedValue(target()),
      createReport: vi.fn().mockRejectedValue(duplicate)
    });
    const service = new ModerationService(repo(fake));

    await expect(service.createReport(ACTOR, REPORT_INPUT)).rejects.toMatchObject({
      code: 'CONFLICT'
    });
  });

  it('stores the reporter, the computed SLA, and returns the view', async () => {
    const fake = fakeRepo({
      targetContext: vi.fn().mockResolvedValue(target()),
      createReport: vi.fn().mockResolvedValue(row())
    });
    const service = new ModerationService(repo(fake));

    const view = await service.createReport(ACTOR, { ...REPORT_INPUT, reason: 'copyright' });

    const [reporterId, input, sla] = fake.createReport.mock.calls[0] as [
      string,
      CreateReportInput,
      Date
    ];
    expect(reporterId).toBe(REPORTER);
    expect(input.reason).toBe('copyright');
    const hours = (sla.getTime() - Date.now()) / (60 * 60 * 1000);
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);
    expect(view.id).toBe(REPORT_ID);
    expect(view.status).toBe('open');
  });
});

describe('ModerationService.listOwnReports', () => {
  it('clamps page size and maps rows', async () => {
    const fake = fakeRepo({
      listByReporter: vi.fn().mockResolvedValue([row()]),
      countByReporter: vi.fn().mockResolvedValue(1)
    });
    const service = new ModerationService(repo(fake));

    const page = await service.listOwnReports(ACTOR, 0, 500);

    expect(page.page).toBe(1);
    expect(page.page_size).toBe(100);
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
    // offset = (page - 1) * page_size
    expect(fake.listByReporter).toHaveBeenCalledWith(REPORTER, 100, 0);
  });

  it('marks reports past their SLA as overdue while still open', async () => {
    const fake = fakeRepo({
      listByReporter: vi
        .fn()
        .mockResolvedValue([
          row({ sla_due_at: new Date(Date.now() - 60_000) }),
          row({ id: 'other', sla_due_at: new Date(Date.now() - 60_000), status: 'resolved' })
        ]),
      countByReporter: vi.fn().mockResolvedValue(2)
    });
    const service = new ModerationService(repo(fake));

    const page = await service.listOwnReports(ACTOR);
    expect(page.items[0]?.overdue).toBe(true);
    // A resolved report is never "overdue": the deadline no longer applies.
    expect(page.items[1]?.overdue).toBe(false);
  });
});

describe('ModerationService.getOwnReport', () => {
  it('hides reports belonging to someone else behind 404', async () => {
    const fake = fakeRepo({
      findById: vi.fn().mockResolvedValue(row({ reporter_id: OTHER_USER }))
    });
    const service = new ModerationService(repo(fake));

    await expect(service.getOwnReport(ACTOR, REPORT_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });

  it('returns the report status to its own reporter (FR-123)', async () => {
    const fake = fakeRepo({ findById: vi.fn().mockResolvedValue(row()) });
    const service = new ModerationService(repo(fake));

    const view = await service.getOwnReport(ACTOR, REPORT_ID);
    expect(view.id).toBe(REPORT_ID);
    expect(view.reporter_id).toBe(REPORTER);
  });
});

describe('ModerationService.resolve', () => {
  it('forwards the decision together with the acting admin and request id', async () => {
    const resolved = row({
      status: 'resolved',
      resolution: 'content_removed',
      resolution_note: 'Konten melanggar pedoman komunitas.',
      resolved_by: OTHER_USER,
      resolved_at: new Date('2026-11-08T03:00:00.000Z')
    });
    const fake = fakeRepo({
      resolveReport: vi.fn().mockResolvedValue({
        report: resolved,
        auditBefore: {},
        auditAfter: {},
        removed: 'review_hidden'
      })
    });
    const service = new ModerationService(repo(fake));

    const view = await service.resolve(
      { id: OTHER_USER, roles: ['admin_support'] },
      'admin_support',
      REPORT_ID,
      { action: 'content_removed', note: 'Konten melanggar pedoman komunitas.' },
      'req-1'
    );

    expect(fake.resolveReport).toHaveBeenCalledWith({
      reportId: REPORT_ID,
      action: 'content_removed',
      note: 'Konten melanggar pedoman komunitas.',
      actorId: OTHER_USER,
      actorRole: 'admin_support',
      requestId: 'req-1'
    });
    expect(view.status).toBe('resolved');
    expect(view.resolution).toBe('content_removed');
  });
});

describe('ModerationService.block', () => {
  const input: BlockUserInput = { user_id: OTHER_USER };

  it('refuses to block yourself', async () => {
    const fake = fakeRepo();
    const service = new ModerationService(repo(fake));

    await expect(
      service.block(ACTOR, { user_id: REPORTER })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.blockUser).not.toHaveBeenCalled();
  });

  it('rejects an unknown user', async () => {
    const fake = fakeRepo({ userExists: vi.fn().mockResolvedValue(false) });
    const service = new ModerationService(repo(fake));

    await expect(service.block(ACTOR, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is idempotent and returns the blocked user', async () => {
    const fake = fakeRepo({
      userExists: vi.fn().mockResolvedValue(true),
      blockUser: vi.fn().mockResolvedValue({
        user_id: OTHER_USER,
        name: 'Budi',
        reason: null,
        created_at: new Date('2026-11-08T03:00:00.000Z')
      })
    });
    const service = new ModerationService(repo(fake));

    const view = await service.block(ACTOR, input);
    expect(view.user_id).toBe(OTHER_USER);
    expect(view.created_at).toBe('2026-11-08T03:00:00.000Z');
  });

  it('treats blocking yourself as never blocked', async () => {
    const fake = fakeRepo({ isBlocked: vi.fn() });
    const service = new ModerationService(repo(fake));

    expect(await service.isBlocked(REPORTER, REPORTER)).toBe(false);
    expect(fake.isBlocked).not.toHaveBeenCalled();
  });

  it('delegates the viewer/sender pair to the repository', async () => {
    const fake = fakeRepo({ isBlocked: vi.fn().mockResolvedValue(true) });
    const service = new ModerationService(repo(fake));

    expect(await service.isBlocked(REPORTER, OTHER_USER)).toBe(true);
    expect(fake.isBlocked).toHaveBeenCalledWith(REPORTER, OTHER_USER);
  });
});

describe('ModerationService appeals (FR-124)', () => {
  const OWNER = { id: OTHER_USER, roles: ['customer'] as const };
  const APPEAL_INPUT = {
    reason: 'Konten ini saya buat sendiri dan tidak melanggar hak cipta siapa pun.'
  };

  function removedReport(overrides: Partial<ContentReportRow> = {}): ContentReportRow {
    return row({
      target_type: 'review',
      reporter_id: REPORTER,
      status: 'resolved',
      resolution: 'content_removed',
      resolved_by: '99999999-9999-4999-8999-999999999999',
      resolved_at: new Date(Date.now() - 60 * 60 * 1000),
      ...overrides
    });
  }

  it('rejects an unknown report without touching the repository', async () => {
    const fake = fakeRepo({ findById: vi.fn().mockResolvedValue(null) });
    const service = new ModerationService(repo(fake));

    await expect(
      service.createAppeal(OWNER, REPORT_ID, APPEAL_INPUT)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.createAppeal).not.toHaveBeenCalled();
  });

  it('only accepts appeals for content that was actually removed', async () => {
    const fake = fakeRepo({
      findById: vi.fn().mockResolvedValue(removedReport({ resolution: 'no_action' }))
    });
    const service = new ModerationService(repo(fake));

    await expect(
      service.createAppeal(OWNER, REPORT_ID, APPEAL_INPUT)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.createAppeal).not.toHaveBeenCalled();
  });

  it('rejects vendor targets because takedown uses the suspension path', async () => {
    const fake = fakeRepo({
      findById: vi.fn().mockResolvedValue(removedReport({ target_type: 'vendor' }))
    });
    const service = new ModerationService(repo(fake));

    await expect(
      service.createAppeal(OWNER, REPORT_ID, APPEAL_INPUT)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('hides the report from a stranger with 404', async () => {
    const fake = fakeRepo({
      findById: vi.fn().mockResolvedValue(removedReport()),
      targetContext: vi.fn().mockResolvedValue(target({ owner_user_id: REPORTER }))
    });
    const service = new ModerationService(repo(fake));

    await expect(
      service.createAppeal(OWNER, REPORT_ID, APPEAL_INPUT)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.createAppeal).not.toHaveBeenCalled();
  });

  it('rejects an appeal after the 30-day window', async () => {
    const fake = fakeRepo({
      findById: vi.fn().mockResolvedValue(
        removedReport({ resolved_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      ),
      targetContext: vi.fn().mockResolvedValue(target({ owner_user_id: OTHER_USER }))
    });
    const service = new ModerationService(repo(fake));

    await expect(
      service.createAppeal(OWNER, REPORT_ID, APPEAL_INPUT)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an appeal when the content is already visible again', async () => {
    const fake = fakeRepo({
      findById: vi.fn().mockResolvedValue(removedReport()),
      targetContext: vi.fn().mockResolvedValue(
        target({ owner_user_id: OTHER_USER, hidden: false })
      )
    });
    const service = new ModerationService(repo(fake));

    await expect(
      service.createAppeal(OWNER, REPORT_ID, APPEAL_INPUT)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.createAppeal).not.toHaveBeenCalled();
  });

  it('stores an appeal from the content owner and maps the view', async () => {
    const fake = fakeRepo({
      findById: vi.fn().mockResolvedValue(removedReport()),
      targetContext: vi.fn().mockResolvedValue(
        target({ owner_user_id: OTHER_USER, hidden: true })
      ),
      createAppeal: vi.fn().mockResolvedValue(appealRow())
    });
    const service = new ModerationService(repo(fake));

    const view = await service.createAppeal(OWNER, REPORT_ID, APPEAL_INPUT);

    expect(fake.targetContext).toHaveBeenCalledWith('review', TARGET_ID, OTHER_USER);
    expect(fake.createAppeal).toHaveBeenCalledWith(OTHER_USER, REPORT_ID, APPEAL_INPUT);
    expect(view).toMatchObject({
      id: APPEAL_ID,
      report_id: REPORT_ID,
      status: 'pending',
      target_type: 'review',
      decision_note: null
    });
  });

  it('maps a duplicate appeal to CONFLICT', async () => {
    const fake = fakeRepo({
      findById: vi.fn().mockResolvedValue(removedReport()),
      targetContext: vi.fn().mockResolvedValue(
        target({ owner_user_id: OTHER_USER, hidden: true })
      ),
      createAppeal: vi.fn().mockRejectedValue({ code: '23505' })
    });
    const service = new ModerationService(repo(fake));

    await expect(
      service.createAppeal(OWNER, REPORT_ID, APPEAL_INPUT)
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rate limits the sixth appeal within the window', async () => {
    let counter = 0;
    const fake = fakeRepo({
      findById: vi.fn().mockImplementation(() => {
        counter += 1;
        return Promise.resolve(removedReport());
      }),
      targetContext: vi.fn().mockResolvedValue(
        target({ owner_user_id: OTHER_USER, hidden: true })
      ),
      createAppeal: vi.fn().mockResolvedValue(appealRow())
    });
    const service = new ModerationService(repo(fake));

    for (let index = 0; index < 5; index += 1) {
      await service.createAppeal(OWNER, REPORT_ID, APPEAL_INPUT);
    }
    await expect(
      service.createAppeal(OWNER, REPORT_ID, APPEAL_INPUT)
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(counter).toBe(6);
    expect(fake.createAppeal).toHaveBeenCalledTimes(5);
  });

  it('hides another user\u2019s appeal from GET', async () => {
    const fake = fakeRepo({
      findAppealByReport: vi.fn().mockResolvedValue(appealRow({ appellant_id: REPORTER }))
    });
    const service = new ModerationService(repo(fake));

    await expect(service.getOwnAppeal(OWNER, REPORT_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });

  it('lists and resolves appeals through the repository', async () => {
    const fake = fakeRepo({
      listAppeals: vi.fn().mockResolvedValue([appealRow()]),
      countAppeals: vi.fn().mockResolvedValue(1),
      resolveAppeal: vi.fn().mockResolvedValue(
        appealRow({
          status: 'accepted',
          decided_by: '99999999-9999-4999-8999-999999999999',
          decided_at: new Date('2026-11-08T04:00:00.000Z'),
          decision_note: 'Bukti hak cipta valid, konten dipulihkan.'
        })
      )
    });
    const service = new ModerationService(repo(fake));

    const page = await service.listAppeals({ status: 'pending', page: 1, page_size: 20 });
    expect(page).toMatchObject({ total: 1, page: 1, page_size: 20 });
    expect(page.items[0]?.id).toBe(APPEAL_ID);

    const view = await service.resolveAppeal(
      { id: OWNER.id, roles: ['admin_support'] },
      'admin_support',
      APPEAL_ID,
      { status: 'accepted', note: 'Bukti hak cipta valid, konten dipulihkan.' },
      'req-1'
    );
    expect(fake.resolveAppeal).toHaveBeenCalledWith({
      appealId: APPEAL_ID,
      status: 'accepted',
      note: 'Bukti hak cipta valid, konten dipulihkan.',
      actorId: OWNER.id,
      actorRole: 'admin_support',
      requestId: 'req-1'
    });
    expect(view.status).toBe('accepted');
    expect(view.decision_note).toContain('dipulihkan');
  });
});

describe('ModerationService.listTakedownsAgainstMe', () => {
  function ownedTakedown(
    overrides: Partial<OwnedTakedownRow> = {}
  ): OwnedTakedownRow {
    return {
      report_id: REPORT_ID,
      target_type: 'review',
      target_id: TARGET_ID,
      reason: 'copyright',
      resolved_at: new Date('2026-11-07T03:00:00.000Z'),
      appeal_deadline_at: new Date('2026-12-07T03:00:00.000Z'),
      appeal_id: null,
      appeal_status: null,
      appeal_created_at: null,
      appeal_decided_at: null,
      appeal_decision_note: null,
      ...overrides
    };
  }

  it('maps the owner list without reporter identity or report detail', async () => {
    const fake = fakeRepo({
      listOwnedTakedowns: vi.fn().mockResolvedValue([ownedTakedown()]),
      countOwnedTakedowns: vi.fn().mockResolvedValue(1)
    });
    const service = new ModerationService(repo(fake));

    const page = await service.listTakedownsAgainstMe({ id: OTHER_USER, roles: [] });

    expect(fake.listOwnedTakedowns).toHaveBeenCalledWith(OTHER_USER, 20, 0);
    expect(page.total).toBe(1);
    expect(page.items[0]).toEqual({
      report_id: REPORT_ID,
      target_type: 'review',
      target_id: TARGET_ID,
      reason: 'copyright',
      resolved_at: '2026-11-07T03:00:00.000Z',
      appeal_deadline_at: '2026-12-07T03:00:00.000Z',
      appeal_id: null,
      appeal_status: null,
      appeal_created_at: null,
      appeal_decided_at: null,
      appeal_decision_note: null
    });
    expect(Object.keys(page.items[0] ?? {})).not.toContain('reporter_id');
    expect(Object.keys(page.items[0] ?? {})).not.toContain('detail');
  });

  it('includes the current appeal state and paginates', async () => {
    const fake = fakeRepo({
      listOwnedTakedowns: vi.fn().mockResolvedValue([
        ownedTakedown({
          appeal_id: APPEAL_ID,
          appeal_status: 'rejected',
          appeal_created_at: new Date('2026-11-08T03:00:00.000Z'),
          appeal_decided_at: new Date('2026-11-08T04:00:00.000Z'),
          appeal_decision_note: 'Bukti tidak cukup; takedown dipertahankan.'
        })
      ]),
      countOwnedTakedowns: vi.fn().mockResolvedValue(1)
    });
    const service = new ModerationService(repo(fake));

    const page = await service.listTakedownsAgainstMe(
      { id: OTHER_USER, roles: [] },
      2,
      5
    );

    expect(fake.listOwnedTakedowns).toHaveBeenCalledWith(OTHER_USER, 5, 5);
    expect(page).toMatchObject({ page: 2, page_size: 5, total: 1 });
    expect(page.items[0]).toMatchObject({
      appeal_id: APPEAL_ID,
      appeal_status: 'rejected',
      appeal_decision_note: 'Bukti tidak cukup; takedown dipertahankan.'
    });
  });
});
