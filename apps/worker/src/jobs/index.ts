import { runAutoComplete } from './auto-complete';
import { runAutoRelease } from './auto-release';
import { runCleanupAuth } from './cleanup-auth';
import { runExpireHolds } from './expire-holds';
import { runExpireUnpaid } from './expire-unpaid';
import { runOutbox } from './outbox';
import type { Job } from './runner';

/**
 * Execution order inside one tick. Slots are freed before anything reads them,
 * then time-based lifecycle/settlement jobs run, and the outbox relays last so
 * the events produced by this tick leave in the same pass.
 */
export const JOBS: readonly Job[] = [
  { name: 'expire_unpaid', lockKey: 74_101, run: runExpireUnpaid },
  { name: 'expire_holds', lockKey: 74_102, run: runExpireHolds },
  { name: 'auto_complete', lockKey: 74_103, run: runAutoComplete },
  { name: 'auto_release', lockKey: 74_104, run: runAutoRelease },
  { name: 'outbox', lockKey: 74_105, run: runOutbox },
  { name: 'cleanup_auth', lockKey: 74_106, run: runCleanupAuth }
];
