import { describe, expect, it } from 'vitest';
import {
  planAppealDecisionNotification,
  planTakedownNotification,
  reportAppealDecisionDedupeKey,
  reportTakedownDedupeKey
} from './templates';

describe('planAppealDecisionNotification (FR-124)', () => {
  it('explains restoration for reviews and chat messages', () => {
    expect(planAppealDecisionNotification('accepted', 'review')).toEqual({
      title: 'Banding diterima',
      body: 'Bandingmu atas ulasan diterima. Konten sudah dipulihkan dan tayang kembali.'
    });
    expect(planAppealDecisionNotification('accepted', 'chat_message').body).toContain(
      'dipulihkan'
    );
  });

  it('explains that media is re-queued instead of published immediately', () => {
    const notice = planAppealDecisionNotification('accepted', 'vendor_media');
    expect(notice.body).toContain('moderasi ulang');
    expect(notice.body).not.toContain('sudah dipulihkan');
  });

  it('keeps the takedown when rejected and never mentions the reporter', () => {
    const notice = planAppealDecisionNotification('rejected', 'review');
    expect(notice.title).toBe('Banding ditolak');
    expect(notice.body).toContain('dipertahankan');
    expect(notice.body).not.toContain('pelapor');
  });

  it('builds one dedupe key per appeal', () => {
    expect(reportAppealDecisionDedupeKey('a-1')).toBe(
      'content_report_appeal:a-1:decided'
    );
  });
});

describe('planTakedownNotification (FR-124)', () => {
  it('tells the owner how to appeal without naming the reporter', () => {
    const notice = planTakedownNotification('review');
    expect(notice.title).toBe('Konten kamu diturunkan');
    expect(notice.body).toContain('30 hari');
    expect(notice.body).toContain('Banding konten');
    expect(notice.body).not.toContain('pelapor');
  });

  it('uses the same dedupe key for retries of one report', () => {
    expect(reportTakedownDedupeKey('r-1')).toBe('content_report:r-1:takedown');
  });
});
