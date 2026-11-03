import type {
  PayoutGateway,
  PayoutCreateInput,
  PayoutCreateResult,
  PayoutStatusResult
} from './payout.gateway';

interface LocalPayoutRecord {
  status: PayoutStatusResult['status'];
  createdAt: number;
  paidAt: Date | null;
}

export interface LocalPayoutGatewayOptions {
  /** Milliseconds before a created payout reports `completed`. Default 0. */
  readonly delayMs?: number;
  readonly now?: () => Date;
}

/**
 * Deterministic disbursement stub for dev and tests: no network, no balance.
 * The process-local map is enough because nothing in production uses it.
 */
export class LocalPayoutGateway implements PayoutGateway {
  readonly name = 'local';

  private readonly delayMs: number;
  private readonly now: () => Date;
  private readonly records = new Map<string, LocalPayoutRecord>();

  constructor(options: LocalPayoutGatewayOptions = {}) {
    this.delayMs = Math.max(0, options.delayMs ?? 0);
    this.now = options.now ?? (() => new Date());
  }

  async createPayout(input: PayoutCreateInput): Promise<PayoutCreateResult> {
    const existing = this.records.get(input.referenceNo);
    if (existing) {
      return {
        providerRef: input.referenceNo,
        providerPayoutId: `LOCAL-${input.referenceNo}`,
        status: existing.status,
        paidAt: existing.paidAt,
        raw: { reference_no: input.referenceNo, status: existing.status }
      };
    }

    const record: LocalPayoutRecord = {
      status: 'processing',
      createdAt: this.now().getTime(),
      paidAt: null
    };
    this.records.set(input.referenceNo, record);

    return {
      providerRef: input.referenceNo,
      providerPayoutId: `LOCAL-${input.referenceNo}`,
      status: 'processing',
      paidAt: null,
      raw: { reference_no: input.referenceNo, status: 'processing' }
    };
  }

  async getPayout(referenceNo: string): Promise<PayoutStatusResult> {
    const record = this.records.get(referenceNo);
    if (!record) {
      // The worker runs in a different process than the API, so its map is
      // empty for payouts created elsewhere. Treat an unknown reference as
      // settled instead of failing a real transfer during local development.
      return {
        status: 'completed',
        failureCode: null,
        failureReason: null,
        paidAt: this.now(),
        raw: { reference_no: referenceNo, status: 'completed' }
      };
    }

    if (record.status !== 'completed' && this.now().getTime() - record.createdAt >= this.delayMs) {
      record.status = 'completed';
      record.paidAt = this.now();
    }

    return {
      status: record.status,
      failureCode: null,
      failureReason: null,
      paidAt: record.paidAt,
      raw: { reference_no: referenceNo, status: record.status }
    };
  }
}
