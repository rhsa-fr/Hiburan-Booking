/**
 * Entrypoint image gabungan untuk Railway.
 *
 * Railway memilih Dockerfile, bukan target stage, dan CLI-nya tidak menyetel
 * start command per service. Karena itu satu image menjalankan salah satu dari
 * tiga peran berdasarkan `TARLINK_SERVICE`:
 *
 *   api      -> NestJS /v1 (port 3001)
 *   worker   -> poller PostgreSQL
 *   admin    -> panel Next.js (port 3002)
 *   migrate  -> runner migrasi satu kali
 *
 * Lihat docs/DEPLOY-RAILWAY.md.
 */
import { spawn } from 'node:child_process';

const role = (process.env.TARLINK_SERVICE || 'api').trim();
const port = process.env.PORT || (role === 'admin' ? '3002' : '3001');

const roles = {
  api: {
    cwd: '/app',
    args: ['-r', './scripts/alias-hook.js', 'dist/api/apps/api/src/main.js'],
  },
  worker: {
    cwd: '/app',
    args: ['dist/worker/apps/worker/src/main.js'],
  },
  admin: {
    cwd: '/app/apps/admin',
    args: [
      '/app/node_modules/next/dist/bin/next',
      'start',
      '-p',
      port,
      '-H',
      '0.0.0.0',
    ],
  },
  migrate: {
    cwd: '/app',
    args: ['dist/api/scripts/migrate-cli.js'],
  },
};

const entry = roles[role];
if (!entry) {
  console.error(`TARLINK_SERVICE tidak dikenal: ${role}`);
  process.exit(1);
}

const child = spawn('node', entry.args, {
  cwd: entry.cwd,
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    child.kill(signal);
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

child.on('error', (error) => {
  console.error(`gagal menjalankan ${role}:`, error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(0);
    return;
  }
  process.exit(code ?? 1);
});
