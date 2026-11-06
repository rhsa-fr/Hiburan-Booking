import type { Pool, PoolClient } from 'pg';
import { AppError } from '@tarlink/core/errors';
import { readSettingInt, type SettingField } from './settings-reader';

export type BankAccountStatus = 'pending' | 'verified' | 'rejected';

export interface VendorRef {
  readonly id: string;
  readonly display_name: string;
  readonly is_active: boolean;
  readonly verification_status: string;
}

export interface BankAccountRow {
  readonly id: string;
  readonly vendor_id: string;
  readonly bank_code: string;
  readonly bank_name: string;
  readonly account_number_masked: string;
  readonly account_holder_name: string;
  readonly status: BankAccountStatus;
  readonly cooling_until: Date;
  readonly verified_at: Date | null;
  readonly verified_by: string | null;
  readonly rejection_reason: string | null;
  readonly created_by: string;
  readonly superseded_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** Row including the encrypted payload; never returned over HTTP. */
export interface BankAccountSecretRow extends BankAccountRow {
  readonly account_number_encrypted: Buffer;
  readonly encryption_key_id: string;
  readonly account_number_hash: string;
}

export interface NewBankAccount {
  readonly id: string;
  readonly vendorId: string;
  readonly bankCode: string;
  readonly bankName: string;
  readonly encryptedNumber: Buffer;
  readonly maskedNumber: string;
  readonly numberHash: string;
  readonly holderName: string;
  readonly keyId: string;
  readonly coolingUntil: Date;
  readonly createdBy: string;
}

export interface AuditInput {
  readonly actorId: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly beforeState?: unknown;
  readonly afterState?: unknown;
  readonly requestId?: string | null;
}

const PUBLIC_COLUMNS = `
  id, vendor_id, bank_code, bank_name, account_number_masked, account_holder_name,
  status, cooling_until, verified_at, verified_by, rejection_reason, created_by,
  superseded_at, created_at, updated_at
`;

const SECRET_COLUMNS = `${PUBLIC_COLUMNS}, account_number_encrypted, encryption_key_id, account_number_hash`;

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const record = err as { code?: unknown; constraint?: unknown };
  if (record.code !== '23505') return false;
  return constraint === undefined || record.constraint === constraint;
}

export class BankAccountsRepository {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async readSetting(field: SettingField): Promise<number> {
    return readSettingInt(this.pool, field);
  }

  async findVendorByOwner(ownerUserId: string): Promise<VendorRef | null> {
    const result = await this.pool.query<VendorRef>(
      `SELECT v.id, v.display_name, v.is_active, v.verification_status::text AS verification_status
         FROM vendors v
        WHERE v.owner_user_id = $1::uuid AND v.is_active = true
        LIMIT 1`,
      [ownerUserId]
    );
    return result.rows[0] ?? null;
  }

  async findVendorById(
    vendorId: string,
    db: Pool | PoolClient = this.pool
  ): Promise<VendorRef | null> {
    const result = await db.query<VendorRef>(
      `SELECT v.id, v.display_name, v.is_active, v.verification_status::text AS verification_status
         FROM vendors v
        WHERE v.id = $1::uuid`,
      [vendorId]
    );
    return result.rows[0] ?? null;
  }

  async listForVendor(
    vendorId: string,
    options: { readonly includeSuperseded?: boolean } = {}
  ): Promise<BankAccountRow[]> {
    const superseded = options.includeSuperseded ? '' : 'AND superseded_at IS NULL';
    const result = await this.pool.query<BankAccountRow>(
      `SELECT ${PUBLIC_COLUMNS}
         FROM vendor_bank_accounts
        WHERE vendor_id = $1::uuid ${superseded}
        ORDER BY created_at DESC, id DESC`,
      [vendorId]
    );
    return result.rows;
  }

  async findSecretById(
    vendorId: string,
    accountId: string,
    db: Pool | PoolClient = this.pool
  ): Promise<BankAccountSecretRow | null> {
    const result = await db.query<BankAccountSecretRow>(
      `SELECT ${SECRET_COLUMNS}
         FROM vendor_bank_accounts
        WHERE id = $1::uuid AND vendor_id = $2::uuid`,
      [accountId, vendorId]
    );
    return result.rows[0] ?? null;
  }

  async findSecretByIdAnyVendor(
    accountId: string,
    db: Pool | PoolClient = this.pool
  ): Promise<BankAccountSecretRow | null> {
    const result = await db.query<BankAccountSecretRow>(
      `SELECT ${SECRET_COLUMNS} FROM vendor_bank_accounts WHERE id = $1::uuid`,
      [accountId]
    );
    return result.rows[0] ?? null;
  }

  async findByHash(
    vendorId: string,
    hash: string,
    db: Pool | PoolClient = this.pool
  ): Promise<BankAccountSecretRow | null> {
    const result = await db.query<BankAccountSecretRow>(
      `SELECT ${SECRET_COLUMNS}
         FROM vendor_bank_accounts
        WHERE vendor_id = $1::uuid AND account_number_hash = $2`,
      [vendorId, hash]
    );
    return result.rows[0] ?? null;
  }

  async findVerifiedForPayout(
    vendorId: string,
    db: Pool | PoolClient = this.pool
  ): Promise<BankAccountSecretRow | null> {
    const result = await db.query<BankAccountSecretRow>(
      `SELECT ${SECRET_COLUMNS}
         FROM vendor_bank_accounts
        WHERE vendor_id = $1::uuid
          AND status = 'verified'
          AND superseded_at IS NULL
        LIMIT 1`,
      [vendorId]
    );
    return result.rows[0] ?? null;
  }

  async insert(client: PoolClient, input: NewBankAccount): Promise<BankAccountRow> {
    try {
      const result = await client.query<BankAccountRow>(
        `INSERT INTO vendor_bank_accounts
           (id, vendor_id, bank_code, bank_name, account_number_encrypted,
            account_number_masked, account_number_hash, account_holder_name,
            encryption_key_id, status, cooling_until, created_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11::uuid)
         RETURNING ${PUBLIC_COLUMNS}`,
        [
          input.id,
          input.vendorId,
          input.bankCode,
          input.bankName,
          input.encryptedNumber,
          input.maskedNumber,
          input.numberHash,
          input.holderName,
          input.keyId,
          input.coolingUntil,
          input.createdBy
        ]
      );
      return result.rows[0]!;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('CONFLICT', 'Rekening dengan nomor ini sudah pernah didaftarkan.');
      }
      throw err;
    }
  }

  /** Reuses a superseded/rejected row so the permanent (vendor, hash) unique holds. */
  async revive(
    client: PoolClient,
    accountId: string,
    input: NewBankAccount
  ): Promise<BankAccountRow> {
    const result = await client.query<BankAccountRow>(
      `UPDATE vendor_bank_accounts
          SET bank_code = $2,
              bank_name = $3,
              account_number_encrypted = $4,
              account_number_masked = $5,
              account_holder_name = $6,
              encryption_key_id = $7,
              status = 'pending',
              cooling_until = $8,
              verified_at = NULL,
              verified_by = NULL,
              rejection_reason = NULL,
              superseded_at = NULL,
              created_by = $9::uuid,
              updated_at = now()
        WHERE id = $1::uuid
        RETURNING ${PUBLIC_COLUMNS}`,
      [
        accountId,
        input.bankCode,
        input.bankName,
        input.encryptedNumber,
        input.maskedNumber,
        input.holderName,
        input.keyId,
        input.coolingUntil,
        input.createdBy
      ]
    );
    return result.rows[0]!;
  }

  async cancel(client: PoolClient, vendorId: string, accountId: string, at: Date): Promise<boolean> {
    const result = await client.query(
      `UPDATE vendor_bank_accounts
          SET superseded_at = $3::timestamptz, updated_at = $3::timestamptz
        WHERE id = $1::uuid AND vendor_id = $2::uuid
          AND status = 'pending' AND superseded_at IS NULL`,
      [accountId, vendorId, at]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async supersedeOtherVerified(
    client: PoolClient,
    vendorId: string,
    keepId: string,
    at: Date
  ): Promise<void> {
    await client.query(
      `UPDATE vendor_bank_accounts
          SET superseded_at = $3::timestamptz, updated_at = $3::timestamptz
        WHERE vendor_id = $1::uuid AND id <> $2::uuid
          AND status = 'verified' AND superseded_at IS NULL`,
      [vendorId, keepId, at]
    );
  }

  async markVerified(
    client: PoolClient,
    vendorId: string,
    accountId: string,
    actorId: string,
    at: Date
  ): Promise<BankAccountRow | null> {
    const result = await client.query<BankAccountRow>(
      `UPDATE vendor_bank_accounts
          SET status = 'verified',
              verified_at = $4::timestamptz,
              verified_by = $3::uuid,
              rejection_reason = NULL,
              updated_at = $4::timestamptz
        WHERE id = $1::uuid AND vendor_id = $2::uuid
          AND superseded_at IS NULL
        RETURNING ${PUBLIC_COLUMNS}`,
      [accountId, vendorId, actorId, at]
    );
    return result.rows[0] ?? null;
  }

  async markRejected(
    client: PoolClient,
    vendorId: string,
    accountId: string,
    reason: string,
    at: Date
  ): Promise<BankAccountRow | null> {
    const result = await client.query<BankAccountRow>(
      `UPDATE vendor_bank_accounts
          SET status = 'rejected',
              rejection_reason = $3,
              verified_at = NULL,
              verified_by = NULL,
              updated_at = $4::timestamptz
        WHERE id = $1::uuid AND vendor_id = $2::uuid
          AND superseded_at IS NULL AND status = 'pending'
        RETURNING ${PUBLIC_COLUMNS}`,
      [accountId, vendorId, reason, at]
    );
    return result.rows[0] ?? null;
  }

  async insertAudit(client: PoolClient, input: AuditInput): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id,
          before_state, after_state, request_id)
       VALUES ($1::uuid, $2::user_role, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        input.actorId,
        input.actorRole,
        input.action,
        input.entityType,
        input.entityId,
        input.beforeState === undefined ? null : JSON.stringify(input.beforeState),
        input.afterState === undefined ? null : JSON.stringify(input.afterState),
        input.requestId ?? null
      ]
    );
  }
}
