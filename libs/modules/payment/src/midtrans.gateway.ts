/**
 * Midtrans Core API adapter (sandbox by default).
 *
 * Docs used for this implementation:
 * - Charge: POST https://api.sandbox.midtrans.com/v2/charge
 * - QRIS: payment_type=qris, response `actions[]` contains the QR image URL.
 * - VA: payment_type=bank_transfer, response `va_numbers[]`.
 * - Mandiri Bill: payment_type=echannel, response `bill_key` + `biller_code`.
 * - Refund: POST /v2/{order_id}/refund, refund_key as the idempotency key.
 * - Notification: SHA512(order_id + status_code + gross_amount + ServerKey).
 *
 * Midtrans does not support refunds for bank transfer / echannel. The adapter
 * rejects those rails explicitly instead of pretending the refund happened.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '@tarlink/core/errors';
import type { PaymentMethod } from './payment.repository';
import type {
  GatewayChargeInput,
  GatewayChargeResult,
  GatewayEvent,
  GatewayInstruction,
  GatewayNotification,
  GatewayRefundInput,
  GatewayRefundResult,
  PaymentGateway
} from './payment.gateway';

const SANDBOX_BASE_URL = 'https://api.sandbox.midtrans.com';
const PRODUCTION_BASE_URL = 'https://api.midtrans.com';
const MAX_JSON_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export interface MidtransGatewayConfig {
  readonly serverKey: string;
  readonly isProduction?: boolean;
  /** Override for tests. */
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function integerRupiah(value: bigint): number {
  if (value <= 0n) throw new AppError('VALIDATION_ERROR', 'amount must be a positive integer');
  if (value > MAX_JSON_SAFE) {
    throw new AppError('VALIDATION_ERROR', 'amount exceeds the JSON safe integer range');
  }
  return Number(value);
}

/** Midtrans sends `"1500000.00"`; only a zero fractional part is accepted. */
function rupiahText(value: unknown): string {
  const raw = text(value).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new AppError('UPSTREAM_ERROR', `Midtrans gross_amount is invalid: ${raw}`);
  }
  const [whole = '', fraction = ''] = raw.split('.');
  if (!/^0*$/.test(fraction)) {
    throw new AppError('UPSTREAM_ERROR', `Midtrans gross_amount has a fractional part: ${raw}`);
  }
  return whole;
}

/** WIB has no DST; `custom_expiry.order_time` is documented as GMT+7. */
function wibDateTime(date: Date): string {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return `${wib.toISOString().slice(0, 19).replace('T', ' ')} +0700`;
}

export class MidtransGateway implements PaymentGateway {
  readonly name = 'midtrans';

  private readonly baseUrl: string;
  private readonly serverKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(config: MidtransGatewayConfig) {
    const serverKey = config.serverKey?.trim() ?? '';
    if (!serverKey) {
      throw new AppError(
        'INTERNAL_ERROR',
        'MIDTRANS_SERVER_KEY belum diisi. Set PJP_PROVIDER=midtrans dan MIDTRANS_SERVER_KEY.'
      );
    }
    this.serverKey = serverKey;
    this.baseUrl = (config.baseUrl ?? (config.isProduction ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL)).replace(
      /\/$/,
      ''
    );
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = config.now ?? (() => new Date());
  }

  async createCharge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    const expiresAt = input.expiresAt.toISOString();
    const body: JsonRecord = {
      transaction_details: {
        order_id: input.orderId,
        gross_amount: integerRupiah(input.amountIdr)
      },
      metadata: { tarlink_payment_id: input.paymentId },
      custom_expiry: this.expiryBody(input.expiresAt)
    };

    if (input.customer) {
      const customer = {
        first_name: input.customer.name?.trim() || undefined,
        email: input.customer.email?.trim() || undefined,
        phone: input.customer.phone?.trim() || undefined
      };
      if (customer.first_name || customer.email || customer.phone) {
        body.customer_details = customer;
      }
    }

    if (input.method === 'qris') {
      body.payment_type = 'qris';
      body.qris = { acquirer: 'gopay' };
    } else if (input.method === 'va_mandiri') {
      body.payment_type = 'echannel';
      body.echannel = { bill_info1: 'Pembayaran:', bill_info2: 'DP Tarlink' };
    } else if (input.method.startsWith('va_')) {
      body.payment_type = 'bank_transfer';
      body.bank_transfer = { bank: input.method.slice(3) };
    } else {
      throw new AppError(
        'VALIDATION_ERROR',
        'Metode e-wallet belum tersedia. Gunakan QRIS atau virtual account.'
      );
    }

    const response = await this.request('/v2/charge', body);
    const statusCode = text(response.status_code);
    if (statusCode !== '200' && statusCode !== '201') {
      throw new AppError('UPSTREAM_ERROR', this.errorMessage(response, 'Midtrans charge ditolak'), {
        status_code: statusCode,
        status_message: text(response.status_message)
      });
    }

    return {
      providerTxnId: text(response.transaction_id) || null,
      expiresAt: input.expiresAt,
      instruction: this.instruction(response, input),
      rawPayload: response
    };
  }

  async refund(input: GatewayRefundInput): Promise<GatewayRefundResult> {
    if (input.method === 'va_mandiri' || input.method.startsWith('va_')) {
      throw new AppError(
        'UPSTREAM_ERROR',
        'Midtrans tidak mendukung refund untuk bank transfer. Lakukan transfer manual dan catat bukti.'
      );
    }

    const response = await this.request(`/v2/${encodeURIComponent(input.orderId)}/refund`, {
      refund_key: input.refundKey,
      amount: integerRupiah(input.amountIdr),
      reason: input.reason.trim().slice(0, 255)
    });
    const statusCode = text(response.status_code);
    const transactionStatus = text(response.transaction_status);
    if (statusCode !== '200' || (transactionStatus !== 'refund' && transactionStatus !== 'partial_refund')) {
      throw new AppError('UPSTREAM_ERROR', this.errorMessage(response, 'Midtrans refund ditolak'), {
        status_code: statusCode,
        transaction_status: transactionStatus
      });
    }

    return {
      providerRefundId: text(response.refund_chargeback_id) || text(response.refund_key) || null,
      status: transactionStatus,
      rawPayload: response
    };
  }

  verifyNotification(body: unknown): void {
    const notification = isRecord(body) ? body : {};
    const orderId = text(notification.order_id);
    const statusCode = text(notification.status_code);
    const grossAmount = text(notification.gross_amount);
    const signature = text(notification.signature_key);

    if (!orderId || !statusCode || !grossAmount || !signature) {
      throw new AppError('UNAUTHENTICATED', 'Midtrans notification is missing its signature fields');
    }
    if (!/^[0-9a-fA-F]{128}$/.test(signature)) {
      throw new AppError('UNAUTHENTICATED', 'Midtrans signature_key format is invalid');
    }

    const expected = createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${this.serverKey}`)
      .digest();
    const provided = Buffer.from(signature, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new AppError('UNAUTHENTICATED', 'Midtrans signature_key mismatch');
    }
  }

  classifyNotification(body: unknown): GatewayNotification {
    const notification = isRecord(body) ? body : {};
    const orderId = text(notification.order_id);
    const transactionId = text(notification.transaction_id);
    const status = text(notification.transaction_status);
    const fraudStatus = text(notification.fraud_status).toLowerCase();
    const eventId = `${transactionId || orderId}:${status || 'unknown'}`;

    if (status === 'settlement' || status === 'capture') {
      if (status === 'capture' && fraudStatus && fraudStatus !== 'accept') {
        return {
          kind: 'failed',
          eventId,
          eventType: `payment.${status}`,
          orderId,
          reason: `fraud_status=${fraudStatus}`,
          raw: notification
        };
      }
      return {
        kind: 'paid',
        event: this.paidEvent(notification, eventId)
      };
    }
    if (status === 'expire') {
      return {
        kind: 'expired',
        eventId,
        eventType: 'payment.expired',
        orderId,
        reason: 'Midtrans transaction expired',
        raw: notification
      };
    }
    if (status === 'deny' || status === 'cancel' || status === 'failure') {
      return {
        kind: 'failed',
        eventId,
        eventType: `payment.${status}`,
        orderId,
        reason: text(notification.status_message) || `Midtrans transaction ${status}`,
        raw: notification
      };
    }
    if (status === 'refund' || status === 'partial_refund') {
      return {
        kind: 'refund',
        eventId,
        eventType: `payment.${status}`,
        orderId,
        reason: text(notification.status_message) || `Midtrans transaction ${status}`,
        raw: notification
      };
    }
    return {
      kind: 'pending',
      eventId,
      eventType: 'payment.pending',
      orderId,
      reason: 'Midtrans transaction is pending',
      raw: notification
    };
  }

  /* ---------------------------------------------------------------- helpers */

  private paidEvent(notification: JsonRecord, eventId: string): GatewayEvent {
    return {
      id: eventId,
      type: 'payment.paid',
      timestamp: text(notification.transaction_time) || undefined,
      data: {
        provider_ref: text(notification.order_id),
        provider_txn_id: text(notification.transaction_id) || undefined,
        amount_idr: rupiahText(notification.gross_amount),
        paid_at:
          text(notification.settlement_time) || text(notification.transaction_time) || undefined
      }
    };
  }

  private instruction(response: JsonRecord, input: GatewayChargeInput): GatewayInstruction {
    const expiresAt = input.expiresAt.toISOString();
    if (input.method === 'qris') {
      const actions = Array.isArray(response.actions) ? response.actions : [];
      const preferred = actions.find(
        (action) => isRecord(action) && text(action.name) === 'generate-qr-code-v2'
      );
      const fallback = actions.find(
        (action) => isRecord(action) && text(action.name) === 'generate-qr-code'
      );
      const url = text(isRecord(preferred) ? preferred.url : undefined) ||
        text(isRecord(fallback) ? fallback.url : undefined);
      if (!url) {
        throw new AppError('UPSTREAM_ERROR', 'Midtrans tidak mengembalikan URL kode QR');
      }
      return { type: 'qris', qr_url: url, expires_at: expiresAt };
    }

    if (input.method === 'va_mandiri') {
      const billKey = text(response.bill_key);
      if (!billKey) throw new AppError('UPSTREAM_ERROR', 'Midtrans tidak mengembalikan bill_key');
      return {
        type: 'va',
        va_number: billKey,
        bank: 'MANDIRI',
        biller_code: text(response.biller_code) || undefined,
        expires_at: expiresAt
      };
    }

    const vaNumbers = Array.isArray(response.va_numbers) ? response.va_numbers : [];
    const first = isRecord(vaNumbers[0]) ? vaNumbers[0] : {};
    const vaNumber = text(first.va_number);
    if (!vaNumber) throw new AppError('UPSTREAM_ERROR', 'Midtrans tidak mengembalikan nomor VA');
    return {
      type: 'va',
      va_number: vaNumber,
      bank: (text(first.bank) || input.method.slice(3)).toUpperCase(),
      expires_at: expiresAt
    };
  }

  private expiryBody(expiresAt: Date): JsonRecord | undefined {
    const seconds = Math.floor((expiresAt.getTime() - this.now().getTime()) / 1000);
    if (seconds <= 0) return undefined;
    return {
      order_time: wibDateTime(this.now()),
      expiry_duration: Math.max(1, Math.ceil(seconds / 60)),
      unit: 'minute'
    };
  }

  private async request(path: string, body: JsonRecord): Promise<JsonRecord> {
    const authorization = `Basic ${Buffer.from(`${this.serverKey}:`).toString('base64')}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: authorization
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new AppError('UPSTREAM_ERROR', 'Midtrans tidak dapat dihubungi', {
        cause: error instanceof Error ? error.message : String(error)
      });
    }

    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppError('UPSTREAM_ERROR', 'Respons Midtrans bukan JSON', {
        status: response.status,
        body: raw.slice(0, 500)
      });
    }
    if (!isRecord(parsed)) {
      throw new AppError('UPSTREAM_ERROR', 'Respons Midtrans tidak dikenali', {
        status: response.status
      });
    }
    if (!response.ok) {
      throw new AppError('UPSTREAM_ERROR', this.errorMessage(parsed, 'Midtrans menolak permintaan'), {
        status: response.status,
        status_code: text(parsed.status_code),
        status_message: text(parsed.status_message),
        validation_messages: parsed.validation_messages,
        error_messages: parsed.error_messages
      });
    }
    return parsed;
  }

  private errorMessage(response: JsonRecord, fallback: string): string {
    const direct = text(response.status_message);
    if (direct) return direct;
    const messages = Array.isArray(response.error_messages)
      ? response.error_messages.map((item) => text(item)).filter(Boolean).join(', ')
      : text(response.error_messages);
    return messages || fallback;
  }
}
