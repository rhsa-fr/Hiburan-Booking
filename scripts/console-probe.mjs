/**
 * Tangkap console + exception + request yang gagal dari satu halaman.
 * Jalankan: node scripts/console-probe.mjs [url]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TARGET = process.argv[2] ?? 'http://localhost:3002/bookings';
const PORT = 9225;

const profile = mkdtempSync(path.join(tmpdir(), 'tarlink-console-'));
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1000',
    TARGET
  ],
  { stdio: 'ignore' }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* belum siap */
    }
  }
  throw new Error('target tidak ditemukan');
}

async function main() {
  const t = await target();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let id = 0;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1;
      ws.send(JSON.stringify({ id, method, params }));
      const handler = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === id) {
          ws.removeEventListener('message', handler);
          resolve(m.result ?? m.error);
        }
      };
      ws.addEventListener('message', handler);
    });

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      const args = (m.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      console.log('CONSOLE', m.params.type, args.slice(0, 300));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      console.log('EXCEPTION', (d.exception?.description ?? d.text ?? '').slice(0, 400));
    }
    if (m.method === 'Log.entryAdded') {
      const l = m.params.entry;
      console.log('LOG', l.level, String(l.text).slice(0, 300));
    }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.status >= 400) console.log('HTTP', r.status, r.url.slice(0, 160));
    }
    if (m.method === 'Network.loadingFailed') {
      console.log('FAILED', m.params.errorText, m.params.requestId);
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(8000);

  const state = await send('Runtime.evaluate', {
    expression: `(() => {
      const status = document.querySelector('[role=status]');
      return {
        url: location.href,
        skeletons: document.querySelectorAll('[class*=animate-pulse]').length,
        statusText: status ? status.textContent.trim().slice(0, 80) : null,
        hasRows: document.querySelectorAll('tbody tr').length,
        bodyHasError: /gagal|kesalahan|error/i.test(document.body.innerText.slice(0, 4000)),
        mockFlag: String(window.__NEXT_DATA__ ? 'next-data' : 'no-next-data')
      };
    })()`,
    returnByValue: true
  });
  console.log('STATE', JSON.stringify(state.result?.value));

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (shot?.data) {
    const out = path.join(tmpdir(), 'opencode', 'shots', `probe-${Date.now()}.png`);
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('SCREENSHOT', out);
  }

  ws.close();
  edge.kill();
}

main()
  .catch((e) => {
    console.error('PROBE GAGAL:', e.message);
    edge.kill();
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 300));
