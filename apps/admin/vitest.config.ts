import { defineConfig } from 'vitest/config';

/**
 * `apps/admin` ships no test runner of its own and the root `vitest.config.ts`
 * only includes `libs/**` and `apps/api/src/**` (lead-owned, do not edit).
 * The admin unit tests therefore carry their own config and are run from the
 * repo root:
 *
 *   npx vitest run --config apps/admin/vitest.config.ts
 *
 * `root` defaults to `process.cwd()`, so `include` is written relative to the
 * repo root. Tests are pure Node: browser globals are installed per test by
 * `apps/admin/test/browser-env.ts`, so no jsdom/happy-dom is needed and there
 * is no shared setup file that could leak state between suites.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/admin/lib/**/*.test.ts'],
    // Keep the suite deterministic: a developer shell may export mock mode.
    env: { NEXT_PUBLIC_USE_MOCK: 'false' },
    passWithNoTests: false
  }
});
