/**
 * Resolver hook untuk menjalankan API hasil build `tsc`.
 *
 * `tsc` tidak menulis ulang import ber-alias (`@tarlink/...`) menjadi path
 * relatif, jadi Node tidak bisa me-resolve-nya saat runtime. Hook ini memetakan
 * alias ke hasil build di `dist/api` tanpa menambah dependency apa pun.
 *
 * Dipakai hanya untuk menjalankan build produksi:
 *   node -r ./scripts/alias-hook.js dist/api/apps/api/src/main.js
 *
 * Test runner (vitest) memakai alias lewat `vitest.config.ts` dan tidak
 * memerlukan hook ini.
 */
const path = require('node:path');
const Module = require('node:module');

const DIST = path.resolve(__dirname, '..', 'dist', 'api');
const originalResolve = Module._resolveFilename;

const ALIAS = /^@tarlink\/(core|platform|modules)\/(.+)$/;

Module._resolveFilename = function resolveWithAlias(request, ...rest) {
  if (typeof request === 'string') {
    const match = ALIAS.exec(request);
    if (match) {
      const [, kind, name] = match;
      let target;
      if (kind === 'core') {
        target = path.join(DIST, 'apps', 'api', 'src', 'core', name);
      } else if (kind === 'platform') {
        target = path.join(DIST, 'libs', 'platform', name, 'src', 'index.js');
      } else {
        target = path.join(DIST, 'libs', 'modules', name, 'src', 'index.js');
      }
      return originalResolve.call(this, target, ...rest);
    }
  }
  return originalResolve.call(this, request, ...rest);
};
