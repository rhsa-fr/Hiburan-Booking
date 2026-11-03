/**
 * Payment gateway port.
 *
 * `PaymentService` never talks to a provider SDK directly. The adapter owns the
 * provider wire format and returns an instruction the client can render.
 *
 * `LocalPaymentGateway` keeps the deterministic dev/test behaviour (no network).
 * `MidtransGateway` targets the Midtrans Core API sandbox.
 */
import type { PaymentMethod } from './payment.repository';

export interface GatewayInstruction {
  readonly type: 'qris' | 'va';
  /** Raw QR payload, when the provider returns one (local stand-in). */
  readonly qr_string?: string;
  /** PNG URL, when the provider only returns a rendered QR (Midtrans). */
  readonly qr_url?: string;
  readonly va_number?: string;
  readonly bank?: string;
  /** Mandiri Bill only. */
  readonly biller_code?: string;
  readonly expires_at: string;
}

export interface GatewayChargeInput {
  readonly paymentId: string;
  /** Provider-side order id; must equal `payments.provider_ref`. */
  readonly orderId: string;
  readonly amountIdr: bigint;
  readonly method: PaymentMethod;
  readonly expiresAt: Date;
  readonly customer?: {
    readonly name?: string | null;
    readonly email?: string | null;
    readonly phone?: string | null;
  };
}

export interface GatewayChargeResult {
  readonly providerTxnId: string | null;
  readonly expiresAt: Date | null;
  readonly instruction: GatewayInstruction;
  readonly rawPayload: unknown;
}

export interface GatewayRefundInput {
  readonly orderId: string;
  readonly method: PaymentMethod;
  readonly amountIdr: bigint;
  readonly reason: string;
  readonly refundKey: string;
}

export interface GatewayRefundResult {
  readonly providerRefundId: string | null;
  readonly status: 'refund' | 'partial_refund';
  readonly rawPayload: unknown;
}

/** Internal paid-event shape, structurally identical to `PjpWebhookEvent`. */
export interface GatewayEvent {
  readonly id: string;
  readonly type: string;
  readonly timestamp?: string | number;
  readonly data?: {
    readonly provider_ref?: string;
    readonly provider_txn_id?: string;
    readonly amount_idr?: string | number;
    readonly paid_at?: string;
  };
}

export type GatewayNotification =
  | { readonly kind: 'paid'; readonly event: GatewayEvent }
  | {
      readonly kind: 'pending' | 'failed' | 'expired' | 'refund';
      readonly eventId: string;
      readonly eventType: string;
      readonly orderId: string;
      readonly reason: string;
      readonly raw: unknown;
    };

export interface PaymentGateway {
  readonly name: string;
  createCharge(input: GatewayChargeInput): Promise<GatewayChargeResult>;
  refund(input: GatewayRefundInput): Promise<GatewayRefundResult>;
  /** Throws when the notification is not authentic. */
  verifyNotification?(body: unknown): void;
  /** Maps the provider body to the internal notification classes. */
  classifyNotification?(body: unknown): GatewayNotification;
}
