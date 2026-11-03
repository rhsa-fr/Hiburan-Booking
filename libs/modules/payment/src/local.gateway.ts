/**
 * Deterministic gateway for local development and unit tests.
 *
 * It never touches the network. The instruction payload matches the previous
 * in-service builder so existing widget/unit expectations stay valid.
 */
import { createHash } from 'node:crypto';
import { AppError } from '@tarlink/core/errors';
import type {
  GatewayChargeInput,
  GatewayChargeResult,
  GatewayRefundInput,
  GatewayRefundResult,
  PaymentGateway
} from './payment.gateway';

export class LocalPaymentGateway implements PaymentGateway {
  readonly name = 'local';

  async createCharge(input: GatewayChargeInput): Promise<GatewayChargeResult> {
    const expiresAt = input.expiresAt.toISOString();
    if (input.method === 'qris') {
      const payload = input.orderId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      return {
        providerTxnId: null,
        expiresAt: input.expiresAt,
        instruction: {
          type: 'qris',
          qr_string: `00020101021226${payload}`,
          expires_at: expiresAt
        },
        rawPayload: { local: true }
      };
    }
    if (input.method.startsWith('va_')) {
      const bank = input.method.slice(3).toUpperCase();
      const digest = createHash('sha256').update(input.paymentId).digest('hex');
      const vaNumber = (BigInt(`0x${digest}`) % 1_000_000_000_000n)
        .toString()
        .padStart(12, '0');
      return {
        providerTxnId: null,
        expiresAt: input.expiresAt,
        instruction: { type: 'va', va_number: vaNumber, bank, expires_at: expiresAt },
        rawPayload: { local: true }
      };
    }
    throw new AppError(
      'VALIDATION_ERROR',
      'Metode e-wallet belum tersedia. Gunakan QRIS atau virtual account.'
    );
  }

  async refund(input: GatewayRefundInput): Promise<GatewayRefundResult> {
    return {
      providerRefundId: `LOCAL-REFUND-${input.refundKey}`,
      status: 'refund',
      rawPayload: { local: true, refund_key: input.refundKey }
    };
  }
}
