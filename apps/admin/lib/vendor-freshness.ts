import { daysBetween } from './format';

export interface CalendarFreshness {
  days: number;
  label: string;
  tone: 'ok' | 'soft' | 'danger';
}

/** D-10 freshness bands used by search ranking and the admin list. */
export function calendarFreshness(calendarUpdatedAt: string, nowIso: string): CalendarFreshness {
  const days = Math.max(0, daysBetween(calendarUpdatedAt, nowIso));
  if (days <= 7) return { days, label: 'Segar', tone: 'ok' };
  if (days <= 14) return { days, label: 'Perlu diingat', tone: 'soft' };
  return { days, label: 'Basi', tone: 'danger' };
}
