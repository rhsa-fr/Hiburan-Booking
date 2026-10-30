/**
 * Runner CLI untuk migrasi.
 * `scripts/migrate.ts` memakai guard `require.main === module` yang tidak
 * terpenuhi di bawah vite-node, jadi file ini memanggil `runMigrations` secara
 * eksplisit dan memuat `.env` lebih dulu.
 */
import { loadDotEnv } from '../apps/api/src/core/config';
import { runMigrations } from './migrate';

loadDotEnv();

const dryRun = process.argv.includes('--dry-run');
runMigrations({ dryRun })
  .then((result) => {
    // eslint-disable-next-line no-console
    console.log(`migrasi selesai: applied=${result.applied.length} pending=${result.pending.length}`);
  })
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('migrasi gagal:', (err as Error).message);
    process.exitCode = 1;
  });
