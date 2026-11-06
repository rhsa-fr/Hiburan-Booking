import { relativeFrom as formatRelativeFrom } from './format';

export function nowIso(): string {
  return new Date().toISOString();
}

export function relativeFrom(nowIso: string, iso: string): string {
  return formatRelativeFrom(nowIso, iso);
}
