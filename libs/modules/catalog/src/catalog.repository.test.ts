import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { CatalogRepository } from './catalog.repository';

/**
 * `grantVendorOwner` is pure SQL on the caller's `PoolClient`. The fake below
 * mimics the `user_roles` primary key `(user_id, role, vendor_scope)` and the
 * conflict clause used by migration 040:
 *   - a plain insert for an existing key raises 23505,
 *   - an existing active row is left untouched,
 *   - a revoked row is restored, never duplicated.
 */

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_SCOPE = '00000000-0000-0000-0000-000000000000';
const RESTORE_CLAUSE =
  'DO UPDATE SET revoked_at = NULL WHERE user_roles.revoked_at IS NOT NULL';

interface RoleRow {
  user_id: string;
  role: string;
  vendor_scope: string;
  revoked_at: Date | null;
}

function roleKey(userId: string, role: string, scope: string): string {
  return `${userId}:${role}:${scope}`;
}

function fakeRolesClient(seed: RoleRow[] = []) {
  const rows = new Map<string, RoleRow>();
  for (const row of seed) rows.set(roleKey(row.user_id, row.role, row.vendor_scope), { ...row });
  const writes: Array<{ sql: string; params: unknown[] | undefined }> = [];

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    writes.push({ sql, params });
    const userId = String(params?.[0]);
    const role = sql.includes("'customer'") ? 'customer' : 'vendor_owner';
    const scope = role === 'customer' ? CUSTOMER_SCOPE : String(params?.[1]);
    const key = roleKey(userId, role, scope);
    const existing = rows.get(key);

    if (!sql.includes('ON CONFLICT')) {
      if (existing) {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505'
        });
      }
      rows.set(key, { user_id: userId, role, vendor_scope: scope, revoked_at: null });
      return { rows: [], rowCount: 1 };
    }

    if (!existing) {
      rows.set(key, { user_id: userId, role, vendor_scope: scope, revoked_at: null });
      return { rows: [], rowCount: 1 };
    }

    if (existing.revoked_at !== null && sql.includes('DO UPDATE SET revoked_at = NULL')) {
      existing.revoked_at = null;
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  });

  return { client: { query } as unknown as PoolClient, rows, writes };
}

describe('CatalogRepository.grantVendorOwner', () => {
  const repository = new CatalogRepository();

  it('grants vendor_owner and customer for an admin-created vendor', async () => {
    const { client, writes, rows } = fakeRolesClient();

    await repository.grantVendorOwner(client, OWNER_ID, VENDOR_ID);

    expect(writes).toHaveLength(2);
    const [ownerGrant, customerGrant] = writes;

    expect(ownerGrant?.sql).toContain("'vendor_owner'");
    expect(ownerGrant?.params).toEqual([OWNER_ID, VENDOR_ID]);

    // Customer has no vendor: the role check requires vendor_id NULL and the
    // all-zero vendor_scope.
    expect(customerGrant?.sql).toContain("'customer'");
    expect(customerGrant?.sql).toContain(`NULL, '${CUSTOMER_SCOPE}'::uuid`);
    expect(customerGrant?.sql).toContain(RESTORE_CLAUSE);
    expect(customerGrant?.params).toEqual([OWNER_ID]);

    expect(rows.size).toBe(2);
    expect(rows.get(roleKey(OWNER_ID, 'customer', CUSTOMER_SCOPE))?.revoked_at).toBeNull();
  });

  it('restores a revoked customer row instead of inserting a duplicate', async () => {
    const { client, rows } = fakeRolesClient([
      {
        user_id: OWNER_ID,
        role: 'customer',
        vendor_scope: CUSTOMER_SCOPE,
        revoked_at: new Date('2026-09-01T00:00:00.000Z')
      }
    ]);

    await repository.grantVendorOwner(client, OWNER_ID, VENDOR_ID);

    const customerRows = [...rows.values()].filter((row) => row.role === 'customer');
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0]?.revoked_at).toBeNull();
    expect(rows.size).toBe(2); // vendor_owner added, customer restored in place
  });

  it('leaves an existing active customer row alone', async () => {
    const { client, rows } = fakeRolesClient([
      {
        user_id: OWNER_ID,
        role: 'customer',
        vendor_scope: CUSTOMER_SCOPE,
        revoked_at: null
      }
    ]);

    await repository.grantVendorOwner(client, OWNER_ID, VENDOR_ID);

    const customerRows = [...rows.values()].filter((row) => row.role === 'customer');
    expect(customerRows).toHaveLength(1);
    expect(rows.size).toBe(2);
  });
});
