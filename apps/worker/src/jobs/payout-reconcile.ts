import { BankAccountsRepository } from '../../../../libs/modules/payout/src/bank-accounts.repository';
import { createPayoutGateway } from '../../../../libs/modules/payout/src/gateway.factory';
import { PayoutRepository } from '../../../../libs/modules/payout/src/payout.repository';
import { PayoutService } from '../../../../libs/modules/payout/src/payout.service';
import { createSecretCipher } from '../../../../libs/platform/crypto/src/index';
import { getPool } from '../db';
import { errorMessage, logLine } from '../log';
import type { JobStats } from './runner';

let service: PayoutService | null = null;

function getService(): PayoutService {
  if (service) return service;
  const pool = getPool();
  service = new PayoutService({
    repository: new PayoutRepository(pool),
    bankAccounts: new BankAccountsRepository(pool),
    gateway: createPayoutGateway(process.env),
    cipherFactory: () => createSecretCipher(process.env),
    logger: (line) => logLine(line)
  });
  return service;
}

/**
 * Reconciles payout transfers that are not final yet:
 * - `approved` with no provider answer is retried with the same `reference_no`
 *   (Iris is idempotent on it), which covers a crash between journal post and
 *   the HTTP call;
 * - `processing` is polled; `completed` posts `payout_settled`, `failed`
 *   reverses `payout_requested` and frees the bookings for a new payout.
 *
 * Rows belonging to another provider are skipped by the repository query, so
 * switching PAYOUT_PROVIDER does not reinterpret old rows.
 */
export async function runPayoutReconcile(batch: number): Promise<JobStats> {
  try {
    const stats = await getService().reconcile(batch);
    return {
      processed: stats.processed,
      skipped: stats.skipped,
      failed: stats.failed
    };
  } catch (err) {
    logLine(`job=payout_reconcile failed=1 error=${errorMessage(err)}`);
    return { processed: 0, skipped: 0, failed: 1 };
  }
}
