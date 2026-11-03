import { AppError } from '@tarlink/core/errors';
import type { PayoutGateway, PayoutCreateInput, PayoutCreateResult, PayoutStatusResult } from './payout.gateway';

export interface IrisGatewayConfig {
  readonly apiKey: string;
  readonly isProduction?: boolean;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

interface IrisPayoutRow {
  reference_no?: string;
  reference_no_alt?: string;
  id?: string | number;
  status?: string;
  amount?: string | number;
  error_code?: string | null;
  error_message?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
}

const SANDBOX_BASE_URL = 'https://app.sandbox.midtrans.com/iris/api/v1';
const PRODUCTION_BASE_URL = 'https://app.midtrans.com/iris/api/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

function normalizeStatus(value: string | undefined): PayoutStatusResult['status'] {
  switch ((value ?? '').toLowerCase()) {
    case 'completed':
    case 'success':
    case 'succeeded':
      return 'completed';
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return 'failed';
    case 'queued':
      return 'queued';
    default:
      return 'processing';
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    for (const key of ['error_message', 'message', 'status_message']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    const errors = record.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      if (typeof first === 'string') return first;
      if (typeof first === 'object' && first !== null) {
        const message = (first as Record<string, unknown>).message;
        if (typeof message === 'string' && message.trim()) return message.trim();
      }
    }
  }
  return fallback;
}

function isDuplicateReference(message: string): boolean {
  return /reference[_\s-]?no|duplicate|already\s+(?:exist|used)/i.test(message);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Midtrans Iris disbursement adapter (plain `fetch`, no SDK dependency).
 *
 * Iris authenticates with `Authorization: Basic base64(apiKey + ':')` and uses
 * a separate API key from the Core API (`MIDTRANS_SERVER_KEY`).
 */
export class IrisGateway implements PayoutGateway {
  readonly name = 'iris';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(config: IrisGatewayConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new AppError(
        'INTERNAL_ERROR',
        'IRIS_API_KEY belum diisi. Pilih PAYOUT_PROVIDER=local untuk pengembangan tanpa kredensial.'
      );
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl?.trim() ||
      (config.isProduction ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL)).replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? (() => new Date());
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async createPayout(input: PayoutCreateInput): Promise<PayoutCreateResult> {
    const body = {
      payouts: [
        {
          beneficiary_name: input.beneficiary.accountHolderName,
          beneficiary_account: input.beneficiary.accountNumber,
          beneficiary_bank: input.beneficiary.bankCode,
          amount: input.amountIdr.toString(),
          notes: input.notes.slice(0, 200),
          reference_no: input.referenceNo
        }
      ]
    };

    const response = await this.request('/payouts', { method: 'POST', body });
    const payload = await this.readJson(response);

    if (!response.ok) {
      const message = errorMessage(payload, `Iris menolak payout (${response.status})`);
      // A lost response after a successful create is recoverable: the
      // reference_no is ours, so reading the payout answers the question.
      if (isDuplicateReference(message)) {
        const existing = await this.getPayout(input.referenceNo);
        return {
          providerRef: input.referenceNo,
          providerPayoutId: null,
          status: existing.status,
          paidAt: existing.paidAt,
          raw: existing.raw
        };
      }
      throw new AppError('UPSTREAM_ERROR', message);
    }

    const row = pickRow(payload, input.referenceNo);
    const status = normalizeStatus(row?.status);
    return {
      providerRef: row?.reference_no ?? input.referenceNo,
      providerPayoutId: row?.id === undefined || row.id === null ? null : String(row.id),
      status,
      paidAt:
        status === 'completed' ? (parseDate(row?.completed_at) ?? this.now()) : null,
      raw: payload
    };
  }

  async getPayout(referenceNo: string): Promise<PayoutStatusResult> {
    const response = await this.request(`/payouts/${encodeURIComponent(referenceNo)}`, {
      method: 'GET'
    });
    const payload = await this.readJson(response);
    if (!response.ok) {
      throw new AppError(
        'UPSTREAM_ERROR',
        errorMessage(payload, `Iris tidak bisa dibaca (${response.status})`)
      );
    }

    const row = pickRow(payload, referenceNo);
    const status = normalizeStatus(row?.status);
    return {
      status,
      failureCode: status === 'failed' ? (row?.error_code ?? 'IRIS_PAYOUT_FAILED') : null,
      failureReason: status === 'failed' ? (row?.error_message ?? 'Payout ditolak Iris') : null,
      paidAt: status === 'completed' ? (parseDate(row?.completed_at) ?? this.now()) : null,
      raw: payload
    };
  }

  private async request(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown }
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal
      });
    } catch (err) {
      throw new AppError(
        'UPSTREAM_ERROR',
        `Tidak bisa menghubungi Iris: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
}

function pickRow(payload: unknown, referenceNo: string): IrisPayoutRow | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const single = record.payout;
  if (typeof single === 'object' && single !== null) return single as IrisPayoutRow;

  const list = record.payouts;
  if (Array.isArray(list)) {
    const rows = list.filter(
      (item): item is IrisPayoutRow => typeof item === 'object' && item !== null
    );
    return rows.find((row) => row.reference_no === referenceNo) ?? rows[0] ?? null;
  }

  return record as IrisPayoutRow;
}
