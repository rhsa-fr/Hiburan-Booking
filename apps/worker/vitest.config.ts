import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * The root `vitest.config.ts` only includes `libs/**` and `apps/api/src/**`.
 * That root file is out of this packet's write scope, so the worker carries its
 * own config:
 *
 *   npx vitest run --config apps/worker/vitest.config.ts
 *
 * Worker tests are pure (no DB), so only the alias map the ledger module uses
 * internally is mirrored here.
 */
const root = process.cwd();

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@tarlink\/platform\/(.+)$/, replacement: path.join(root, 'libs/platform/$1/src/index.ts') },
      { find: /^@tarlink\/modules\/(.+)$/, replacement: path.join(root, 'libs/modules/$1/src/index.ts') },
      { find: /^@tarlink\/core\/(.+)$/, replacement: path.join(root, 'apps/api/src/core/$1') }
    ]
  },
  test: {
    environment: 'node',
    include: ['apps/worker/src/**/*.test.ts']
  }
});
