/**
 * Narrow helpers for the PostgreSQL error shapes this slice reacts to.
 * `pg` errors are plain objects; there is no typed error class to `instanceof`.
 */

interface PgErrorLike {
  code: string;
  constraint?: string;
  message?: string;
}

export function asPgError(err: unknown): PgErrorLike | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = err as { code?: unknown; constraint?: unknown; message?: unknown };
  if (typeof candidate.code !== 'string') return null;
  return {
    code: candidate.code,
    constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
    message: typeof candidate.message === 'string' ? candidate.message : undefined
  };
}

/** 23505 unique_violation, optionally narrowed to one constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = asPgError(err);
  if (!pg || pg.code !== '23505') return false;
  return constraint === undefined || pg.constraint === constraint;
}

/** 23514 check_violation / 23503 foreign_key_violation / 22P02 bad input. */
export function isDataViolation(err: unknown): boolean {
  const pg = asPgError(err);
  if (!pg) return false;
  return pg.code === '23514' || pg.code === '23503' || pg.code === '22P02' || pg.code === '22001';
}
