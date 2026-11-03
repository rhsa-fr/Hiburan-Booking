import { AppError } from '@tarlink/core/errors';
import { IrisGateway } from './iris.gateway';
import { LocalPayoutGateway } from './local-payout.gateway';
import type { PayoutGateway } from './payout.gateway';

function boolFromEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? '').trim());
}

/**
 * Builds the disbursement gateway from raw environment variables.
 *
 * Deliberately does NOT call `loadConfig()`: the worker does not require the
 * API's JWT/UPSTREAM keys, and importing that schema there would make the
 * worker refuse to boot.
 */
export function createPayoutGateway(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): PayoutGateway {
  const provider = (env.PAYOUT_PROVIDER ?? 'local').trim().toLowerCase();

  if (provider === 'iris') {
    return new IrisGateway({
      apiKey: env.IRIS_API_KEY ?? '',
      isProduction: boolFromEnv(env.IRIS_IS_PRODUCTION),
      baseUrl: env.IRIS_BASE_URL?.trim() || undefined
    });
  }

  if (provider === 'local') {
    const delay = Number.parseInt(env.LOCAL_PAYOUT_DELAY_MS ?? '0', 10);
    return new LocalPayoutGateway({ delayMs: Number.isFinite(delay) ? delay : 0 });
  }

  throw new AppError(
    'INTERNAL_ERROR',
    `PAYOUT_PROVIDER tidak dikenal: "${provider}". Nilai yang didukung: local, iris.`
  );
}
