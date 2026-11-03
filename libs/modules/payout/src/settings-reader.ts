import type { Pool, PoolClient } from 'pg';
import { DEFAULT_SETTINGS, SETTING_KEYS } from '../../admin/src/settings';

export type SettingField = keyof typeof SETTING_KEYS;

/**
 * Reads one numeric platform setting with the documented default as fallback.
 *
 * Imports the pure `admin/src/settings` module (no Nest providers) so both the
 * API and the worker can resolve the same key names instead of duplicating
 * string literals.
 */
export async function readSettingInt(
  db: Pool | PoolClient,
  field: SettingField,
  fallback: number = DEFAULT_SETTINGS[field]
): Promise<number> {
  const key = SETTING_KEYS[field];
  const result = await db.query<{ value: unknown }>(
    'SELECT value FROM platform_settings WHERE key = $1',
    [key]
  );
  const raw = result.rows[0]?.value;

  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (typeof raw === 'object' && raw !== null) {
    const candidate = (raw as Record<string, unknown>).value;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return Math.trunc(candidate);
    if (typeof candidate === 'string' && /^\d+$/.test(candidate)) {
      return Number.parseInt(candidate, 10);
    }
  }
  return fallback;
}
