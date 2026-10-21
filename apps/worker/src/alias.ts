/**
 * Runtime resolver for the `@tarlink/*` path aliases used *inside* `libs/**`.
 *
 * The worker runs as a plain `node` process (no `-r` hook, no ts-node), and
 * `tsc` does not rewrite aliases. Worker source therefore uses relative imports
 * only; this module maps the aliases that the ledger module still declares
 * internally onto the worker's own compiled output.
 *
 * Imported for its side effect, first, by `main.ts`.
 */
import Module from 'node:module';
import path from 'node:path';

const ALIAS = /^@tarlink\/(core|platform|modules)\/(.+)$/;
/** dist/worker/apps/worker/src -> dist/worker */
const DIST_ROOT = path.resolve(__dirname, '../../..');

type ModuleResolver = (request: string, ...rest: unknown[]) => string;

const resolverHost = Module as unknown as { _resolveFilename: ModuleResolver };
const originalResolve = resolverHost._resolveFilename;

resolverHost._resolveFilename = function resolveWithWorkerAliases(
  this: unknown,
  request: string,
  ...rest: unknown[]
): string {
  const match = ALIAS.exec(request);
  const kind = match?.[1];
  const name = match?.[2];
  if (kind && name) {
    const target =
      kind === 'core'
        ? path.join(DIST_ROOT, 'apps', 'api', 'src', 'core', name)
        : kind === 'platform'
          ? path.join(DIST_ROOT, 'libs', 'platform', name, 'src', 'index.js')
          : path.join(DIST_ROOT, 'libs', 'modules', name, 'src', 'index.js');
    return originalResolve.call(this, target, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};
