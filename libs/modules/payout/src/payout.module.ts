import { Module } from '@nestjs/common';
import { loadConfig } from '@tarlink/core/config';
import { getPool } from '@tarlink/core/db';
import { AuthGuard, JWT_SECRET, RolesGuard } from '@tarlink/platform/auth';
import { createSecretCipher } from '@tarlink/platform/crypto';
import { PgIdempotencyStore } from '@tarlink/platform/idempotency';
import { AdminPayoutController } from './admin-payout.controller';
import { BankAccountsRepository } from './bank-accounts.repository';
import { BankAccountsService } from './bank-accounts.service';
import { createPayoutGateway } from './gateway.factory';
import { PayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { VendorPayoutController } from './vendor-payout.controller';

/**
 * Payout slice: vendor destination accounts + admin-initiated disbursement.
 *
 * The encryption key is read lazily (`cipherFactory`) so read-only endpoints
 * keep working before `BANK_ACCOUNT_ENCRYPTION_KEY` is configured; writing a
 * bank account fails with a clear message instead of crashing API bootstrap.
 */
@Module({
  controllers: [VendorPayoutController, AdminPayoutController],
  providers: [
    { provide: JWT_SECRET, useValue: loadConfig().JWT_SECRET },
    { provide: AuthGuard, useClass: AuthGuard },
    RolesGuard,
    {
      provide: PayoutRepository,
      useFactory: (): PayoutRepository => new PayoutRepository(getPool())
    },
    {
      provide: BankAccountsRepository,
      useFactory: (): BankAccountsRepository => new BankAccountsRepository(getPool())
    },
    {
      provide: BankAccountsService,
      inject: [BankAccountsRepository],
      useFactory: (repository: BankAccountsRepository): BankAccountsService =>
        new BankAccountsService({
          repository,
          cipherFactory: () => createSecretCipher(process.env)
        })
    },
    {
      provide: PayoutService,
      inject: [PayoutRepository, BankAccountsRepository],
      useFactory: (
        repository: PayoutRepository,
        bankAccounts: BankAccountsRepository
      ): PayoutService =>
        new PayoutService({
          repository,
          bankAccounts,
          gateway: createPayoutGateway(process.env),
          cipherFactory: () => createSecretCipher(process.env),
          idempotencyStore: new PgIdempotencyStore(getPool())
        })
    }
  ],
  exports: [PayoutService, BankAccountsService]
})
export class PayoutModule {}
