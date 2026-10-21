/**
 * Helper fixture untuk pengujian terhadap PostgreSQL nyata.
 * Dipakai oleh `scripts/verify-db.ts` (skema) dan `scripts/smoke-booking.ts` (alur end-to-end).
 */
import type { PoolClient } from 'pg';

export interface FixtureIds {
  regionCode: string;
  customerId: string;
  customerRoleId: string;
  vendorId: string;
  vendorOwnerId: string;
  packageId: string;
  eventId: string;
  policyVersionId: string;
  bookingId: string;
}

/**
 * Membangun INSERT minimal untuk sebuah tabel: hanya kolom NOT NULL tanpa
 * default, diisi otomatis per tipe. Kolom relasi (FK) disuplai lewat overrides.
 */
export async function insertMinimal(
  client: PoolClient,
  table: string,
  overrides: Record<string, string> = {}
): Promise<string> {
  const { rows } = await client.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    is_identity: string;
  }>(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default, is_identity
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );

  const cols: string[] = [];
  const vals: string[] = [];
  for (const c of rows) {
    // Override selalu menang, bahkan untuk kolom nullable atau yang punya
    // default (mis. `user_roles.vendor_scope` yang default-nya UUID nol).
    const override = overrides[c.column_name];
    if (override !== undefined) {
      cols.push(c.column_name);
      vals.push(override);
      continue;
    }
    if (c.is_nullable === 'NO' && c.column_default === null && c.is_identity !== 'YES') {
      switch (c.data_type) {
        case 'uuid':
          cols.push(c.column_name);
          vals.push('gen_random_uuid()');
          break;
        case 'USER-DEFINED': {
          const { rows: labels } = await client.query<{ l: string }>(
            `SELECT enumlabel AS l FROM pg_enum JOIN pg_type t ON t.oid = pg_enum.enumtypid WHERE t.typname = $1 ORDER BY enumsortorder LIMIT 1`,
            [c.udt_name]
          );
          if (labels.length === 0) continue;
          cols.push(c.column_name);
          vals.push(`'${labels[0].l}'::${c.udt_name}`);
          break;
        }
        case 'integer':
        case 'bigint':
        case 'smallint':
          cols.push(c.column_name);
          vals.push('0');
          break;
        case 'numeric':
        case 'double precision':
        case 'real':
          cols.push(c.column_name);
          vals.push('0');
          break;
        case 'boolean':
          cols.push(c.column_name);
          vals.push('false');
          break;
        case 'date':
          cols.push(c.column_name);
          vals.push('CURRENT_DATE');
          break;
        case 'timestamp with time zone':
        case 'timestamp without time zone':
          cols.push(c.column_name);
          vals.push('now()');
          break;
        case 'jsonb':
        case 'json':
          cols.push(c.column_name);
          vals.push("'{}'::jsonb");
          break;
        case 'ARRAY':
          cols.push(c.column_name);
          vals.push("'{}'");
          break;
        case 'geography':
          cols.push(c.column_name);
          vals.push("'SRID=4326;POINT(0 0)'::geography");
          break;
        default:
          cols.push(c.column_name);
          vals.push("'test'");
      }
    }
  }

  if (cols.length === 0) {
    const res = await client.query<Record<string, unknown>>(`INSERT INTO ${table} DEFAULT VALUES RETURNING *`);
    return firstKey(res.rows[0]);
  }

  const res = await client
    .query<Record<string, unknown>>(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`,
      []
    )
    .catch((err: unknown) => {
      throw new Error(
        `insert ${table} gagal: ${(err as Error).message} :: SQL = INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')})`
      );
    });
  return firstKey(res.rows[0]);
}

/**
 * Kunci baris yang dikembalikan INSERT. Tidak semua tabel Tarlink punya kolom
 * `id` (mis. `regions` memakai `code`, `chart_of_accounts` memakai `code`,
 * `user_roles` memakai komposit), jadi jangan hardcode `id`.
 */
export function firstKey(row: Record<string, unknown> | undefined): string {
  if (!row) return '';
  for (const key of ['id', 'code', 'booking_id', 'key', 'name']) {
    const value = row[key];
    if (typeof value === 'string') return value;
  }
  const first = Object.values(row)[0];
  return typeof first === 'string' ? first : String(first ?? '');
}

/**
 * Membuat fixture minimum yang konsisten: wilayah, pelanggan (peran customer),
 * vendor (peran vendor_owner), paket, acara, versi kebijakan, dan satu booking
 * pada status `requested`.
 */
export async function ensureBaseFixtures(client: PoolClient): Promise<FixtureIds> {
  const regionCode = '3212';
  const run = Date.now().toString().slice(-8);

  const customerId = await insertMinimal(client, 'users', { phone: `'0812000${run}1'` });

  const vendorOwnerId = await insertMinimal(client, 'users', { phone: `'0812000${run}2'` });

  const vendorId = await insertMinimal(client, 'vendors', {
    owner_user_id: `'${vendorOwnerId}'`,
    region_code: `'${regionCode}'`,
    slug: `'tarling-dian-${run}'`,
    display_name: "'Tarling Dangdut Dian'",
    // Booking hanya diterima vendor yang sudah diverifikasi dan aktif.
    verification_status: "'approved'",
    verified_at: 'now()',
    is_active: 'true'
  });

  // user_roles punya CHECK ketat: peran customer/admin wajib vendor_id NULL dan
  // vendor_scope = UUID nol; peran vendor wajib vendor_id terisi dan
  // vendor_scope = vendor_id.
  const customerRoleId = await insertMinimal(client, 'user_roles', {
    user_id: `'${customerId}'`,
    role: "'customer'",
    vendor_scope: "'00000000-0000-0000-0000-000000000000'"
  });
  await insertMinimal(client, 'user_roles', {
    user_id: `'${vendorOwnerId}'`,
    role: "'vendor_owner'",
    vendor_id: `'${vendorId}'`,
    vendor_scope: `'${vendorId}'`
  });

  const packageId = await insertMinimal(client, 'packages', {
    vendor_id: `'${vendorId}'`,
    name: "'Paket Lengkap 6 jam'",
    duration_minutes: '360',
    base_price_idr: '5000000',
    is_active: 'true'
  });

  const policyVersionId = await insertMinimal(client, 'policy_versions', {
    code: `'cancellation-${run}'`,
    version: '1',
    body: "'{\"currency\":\"IDR\"}'::jsonb",
    body_hash: `'${'a'.repeat(64)}'`,
    effective_from: 'now()'
  });

  const eventId = await insertMinimal(client, 'events', {
    code: `'EV-SMOKE-${run}'`,
    customer_id: `'${customerId}'`,
    title: "'Hajatan Aqiqah 12'",
    region_code: `'${regionCode}'`,
    venue_address: "'Jl. Pantura No. 12, Cirebon'",
    start_date: 'CURRENT_DATE + 30',
    end_date: 'CURRENT_DATE + 30'
  });

  const bookingId = await insertMinimal(client, 'bookings', {
    code: `'BK-SMOKE-${run}'`,
    customer_id: `'${customerId}'`,
    vendor_id: `'${vendorId}'`,
    package_id: `'${packageId}'`,
    event_id: `'${eventId}'`,
    policy_version_id: `'${policyVersionId}'`,
    lifecycle_status: "'requested'",
    payment_status: "'unpaid'",
    settlement_status: "'not_eligible'",
    price_package_idr: '5000000',
    price_addons_idr: '0',
    price_transport_idr: '0',
    service_fee_idr: '50000',
    discount_idr: '0',
    total_customer_idr: '5050000',
    dp_amount_idr: '1500000',
    respond_deadline: 'now() + interval \'1 day\''
  });

  return { regionCode, customerId, customerRoleId, vendorId, vendorOwnerId, packageId, eventId, policyVersionId, bookingId };
}
