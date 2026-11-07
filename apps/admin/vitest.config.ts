import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Admin unit tests are pure Node: browser globals are installed per test by
 * `test/browser-env.ts`, so no jsdom/happy-dom is needed and there is no shared
 * setup file that could leak state between suites.
 *
 * `root` is anchored to this directory, so the suite behaves the same from the
 * repo root (`npm run test:admin`) and from the workspace (`npm -w apps/admin
 * test`). `include` is therefore relative to `apps/admin`.
 */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    // `.next` is not in Vitest's default exclude list and lives inside the root.
    exclude: ['.next/**', 'node_modules/**'],
    // Keep the suite deterministic: a developer shell may export mock mode.
    env: { NEXT_PUBLIC_USE_MOCK: 'false' },
    passWithNoTests: false
  }
});
