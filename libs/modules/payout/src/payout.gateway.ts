/**
 * Port for disbursement providers (Midtrans Iris in production).
 *
 * `referenceNo` is OUR payout id and is also sent to the provider as
 * `reference_no`, so retrying a request can never create a second transfer.
 */
export interface PayoutBeneficiary {
  readonly bankCode: string;
  readonly accountNumber: string;
  readonly accountHolderName: string;
}

export interface PayoutCreateInput {
  readonly referenceNo: string;
  readonly amountIdr: bigint;
  readonly beneficiary: PayoutBeneficiary;
  readonly notes: string;
}

export type PayoutProviderStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface PayoutCreateResult {
  readonly providerRef: string;
  readonly providerPayoutId: string | null;
  readonly status: PayoutProviderStatus;
  /** Set when the provider settles synchronously. */
  readonly paidAt: Date | null;
  readonly raw: unknown;
}

export interface PayoutStatusResult {
  readonly status: PayoutProviderStatus;
  readonly failureCode: string | null;
  readonly failureReason: string | null;
  readonly paidAt: Date | null;
  readonly raw: unknown;
}

export interface PayoutGateway {
  readonly name: string;
  createPayout(input: PayoutCreateInput): Promise<PayoutCreateResult>;
  getPayout(referenceNo: string): Promise<PayoutStatusResult>;
}
