import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import { resolve } from 'node:path';
import { query } from '../db';
import { errorMessage, logLine } from '../log';
import type { JobStats } from './runner';

/** A freshly uploaded file is never deleted before a full day has passed. */
const RETENTION_MS = 24 * 60 * 60 * 1000;
/** Directory scan is expensive; at most once per hour per worker process. */
const MIN_INTERVAL_MS = 60 * 60 * 1000;
const MEDIA_FILE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

let lastRunAt = 0;

/**
 * A file is "used" when any public column or moderation row still points at it.
 * The check is intentionally conservative: a false positive only leaks a file,
 * a false negative would break a live image.
 */
const USED_SQL = `
SELECT EXISTS (
  SELECT 1 FROM vendor_media
   WHERE storage_key = $1
      OR coalesce(url, '') LIKE '%' || $1
  UNION ALL
  SELECT 1 FROM vendors
   WHERE coalesce(avatar_url, '') LIKE '%' || $1
      OR coalesce(banner_url, '') LIKE '%' || $1
      OR coalesce(photo_urls::text, '') LIKE '%' || $1
      OR coalesce(video_url, '') LIKE '%' || $1
  UNION ALL
  SELECT 1 FROM packages WHERE coalesce(photo_url, '') LIKE '%' || $1
) AS used
`;

export async function runCleanupMedia(now: number = Date.now()): Promise<JobStats> {
  const stats: JobStats = { processed: 0, skipped: 0, failed: 0 };
  if (now - lastRunAt < MIN_INTERVAL_MS) {
    stats.skipped = 1;
    return stats;
  }
  lastRunAt = now;

  const root = resolve(process.cwd(), process.env.UPLOAD_DIR?.trim() || 'storage/uploads');
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    // No upload directory yet: nothing to clean.
    stats.skipped = 1;
    return stats;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !MEDIA_FILE.test(entry.name)) {
      stats.skipped += 1;
      continue;
    }
    const path = resolve(root, entry.name);
    try {
      const info = await fs.stat(path);
      if (now - info.mtimeMs < RETENTION_MS) {
        stats.skipped += 1;
        continue;
      }
      const used = await query<{ used: boolean }>(USED_SQL, [entry.name]);
      if (used[0]?.used) {
        stats.skipped += 1;
        continue;
      }
      await fs.unlink(path);
      stats.processed += 1;
      logLine(`job=cleanup_media deleted=${entry.name}`);
    } catch (err) {
      stats.failed += 1;
      logLine(`job=cleanup_media failed=1 file=${entry.name} error=${errorMessage(err)}`);
    }
  }

  return stats;
}
