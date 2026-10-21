/**
 * Vendor slug generation.
 *
 * Kept pure and database-free so collision suffixing is unit-testable. The
 * caller supplies the slugs already taken; `uniqueSlug` appends `-2`, `-3`, …
 * until it finds a free one, trimming the stem so the 160-char column limit of
 * `vendors.slug` is never exceeded.
 */
import { AppError } from '@tarlink/core/errors';

export const MAX_SLUG_LENGTH = 160;

const MAX_SUFFIX = 9999;

/** Lowercase ASCII, dash-separated. `"Tarling Dangdut Dian"` -> `"tarling-dangdut-dian"`. */
export function slugify(displayName: string): string {
  const ascii = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (ascii.length === 0) return 'vendor';

  const trimmed = ascii.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
  return trimmed.length > 0 ? trimmed : 'vendor';
}

/** Returns `base`, or the first free `base-N` variant. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const stem = base.length > 0 ? base : 'vendor';
  if (!taken.has(stem)) return stem;

  for (let suffix = 2; suffix <= MAX_SUFFIX; suffix += 1) {
    const tail = `-${suffix}`;
    const trimmedStem = stem.slice(0, MAX_SLUG_LENGTH - tail.length).replace(/-+$/g, '');
    const candidate = `${trimmedStem}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }

  throw new AppError('CONFLICT', 'Tidak dapat membuat slug unik untuk vendor ini');
}
