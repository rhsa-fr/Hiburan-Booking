/**
 * Verifikasi header keamanan + hidrasi halaman login panel admin lewat Chrome
 * headless (CDP), tanpa dependency tambahan.
 *
 * Panel harus sudah berjalan lebih dulu (`npm -w apps/admin run start`):
 *   node scripts/verify-admin-headers.mjs [--base http://localhost:3002] [--port 9341]
 *
 * Keluar 0 hanya bila CSP/header keamanan ada, form login ter-hidrasi, dan tidak
 * ada pelanggaran CSP maupun exception runtime.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);

function readArg(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

const BASE = readArg('--base', 'http://localhost:3002').replace(/\/$/, '');
const PORT = Number(readArg('--port', '9341'));
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const BROWSER = CANDIDATES.find((candidate) => existsSync(candidate));

if (!BROWSER) {
  console.error('Chrome/Edge tidak ditemukan. Set CHROME_PATH ke executable browser.');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = mkdtempSync(path.join(tmpdir(), 'tarlink-admin-headers-'));
const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1100',
    'about:blank'
  ],
  { stdio: 'ignore' }
);

const failures = [];
const report = { base: BASE, browser: path.basename(BROWSER), headers: {}, ui: {}, cspViolations: [], consoleErrors: [] };

function fail(message) {
  failures.push(message);
}

async function devtoolsTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const version = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
      return version;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('Chrome DevTools tidak siap');
}

async function main() {
  const version = await devtoolsTarget();
  report.chrome = version.Browser;

  const tab = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  let documentHeaders = null;
  const consoleErrors = [];

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Network.responseReceived') {
      const { response, type } = message.params;
      if (type === 'Document' && response.url.startsWith(BASE)) {
        documentHeaders = response.headers ?? {};
      }
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const text = (message.params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? '')
        .join(' ')
        .trim();
      if (text) consoleErrors.push(text.slice(0, 300));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const text =
        message.params.exceptionDetails?.exception?.description ??
        message.params.exceptionDetails?.text ??
        '';
      if (text) consoleErrors.push(String(text).slice(0, 300));
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      nextId += 1;
      pending.set(nextId, { resolve, reject });
      ws.send(JSON.stringify({ id: nextId, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspViolations.push({
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
          sample: String(event.sample || '').slice(0, 120)
        });
      });
    `
  });

  await send('Page.navigate', { url: `${BASE}/login` });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (await evaluate('document.readyState === "complete"')) break;
    } catch {
      // still navigating
    }
    await sleep(250);
  }
  await sleep(1500);

  const headers = {};
  for (const [key, value] of Object.entries(documentHeaders ?? {})) {
    headers[key.toLowerCase()] = value;
  }
  const csp = headers['content-security-policy'] ?? '';
  const directives = {};
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives[name] = values.join(' ');
  }

  report.headers = {
    csp,
    scriptSrc: directives['script-src'] ?? null,
    connectSrc: directives['connect-src'] ?? null,
    imgSrc: directives['img-src'] ?? null,
    frameAncestors: directives['frame-ancestors'] ?? null,
    xFrameOptions: headers['x-frame-options'] ?? null,
    xContentTypeOptions: headers['x-content-type-options'] ?? null,
    referrerPolicy: headers['referrer-policy'] ?? null,
    permissionsPolicy: headers['permissions-policy'] ?? null,
    poweredBy: headers['x-powered-by'] ?? null
  };

  report.ui = await evaluate(`(() => ({
    path: location.pathname,
    title: document.title,
    hasEmail: !!document.querySelector('#login-email'),
    hasPassword: !!document.querySelector('#login-password'),
    secureContext: isSecureContext,
    webLocks: typeof navigator.locks?.request === 'function'
  }))()`);

  report.cspViolations = await evaluate('window.__cspViolations || []');
  report.consoleErrors = consoleErrors;

  if (!csp) fail('CSP tidak ada pada respons dokumen');
  if (csp && !directives['default-src']) fail('CSP tanpa default-src');
  if (directives['script-src']?.includes("'unsafe-eval'")) {
    fail("script-src masih memuat 'unsafe-eval' (build produksi tidak boleh)");
  }
  if ((headers['x-frame-options'] ?? '').toUpperCase() !== 'DENY') {
    fail('X-Frame-Options bukan DENY');
  }
  if ((headers['x-content-type-options'] ?? '').toLowerCase() !== 'nosniff') {
    fail('X-Content-Type-Options bukan nosniff');
  }
  if (headers['x-powered-by']) fail('X-Powered-By masih dikirim');
  if (!report.ui?.hasEmail || !report.ui?.hasPassword) {
    fail('Form login tidak ter-hidrasi (input tidak ditemukan)');
  }
  if (report.cspViolations.length) fail(`${report.cspViolations.length} pelanggaran CSP`);
  if (consoleErrors.length) fail(`${consoleErrors.length} console error/exception`);

  ws.close();
}

main()
  .catch((error) => fail(String(error?.message ?? error)))
  .finally(() => {
    spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
    report.failures = failures;
    report.ok = failures.length === 0;
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  });
