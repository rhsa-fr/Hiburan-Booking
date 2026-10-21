/**
 * Bukti browser: login admin -> /audit -> tabel "Tindakan operator".
 * Melaporkan isi baris, overflow tabel, dan screenshot.
 *
 * Jalankan: node scripts/audit-probe.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EMAIL = 'admin@tarlink.id';
const PASSWORD = 'Tarlink#2026';
const PORT = 9229;
const BASE = 'http://localhost:3002';
const SHOTS = path.join(tmpdir(), 'opencode', 'shots');

const profile = mkdtempSync(path.join(tmpdir(), 'tarlink-audit-'));
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1400',
    `${BASE}/login`
  ],
  { stdio: 'ignore' }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });

async function target() {
  for (let i = 0; i < 80; i += 1) {
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
  const pending = new Map();
  const consoleErrors = [];

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve } = pending.get(m.id);
      pending.delete(m.id);
      resolve(m.result ?? m.error);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (text) consoleErrors.push(String(text).slice(0, 240));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(
        `EXCEPTION ${m.params.exceptionDetails?.exception?.description ?? 'unknown'}`.slice(0, 240)
      );
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1;
      const callId = id;
      pending.set(callId, { resolve });
      ws.send(JSON.stringify({ id: callId, method, params }));
      setTimeout(() => {
        if (pending.has(callId)) {
          pending.delete(callId);
          resolve({ __timeout: method });
        }
      }, 15000);
    });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (r?.exceptionDetails) {
      console.log('EVAL_ERROR', JSON.stringify(r.exceptionDetails).slice(0, 400));
    }
    return r?.result?.value;
  };

  const shot = async (name) => {
    let result = await send('Page.captureScreenshot', { format: 'png' });
    if (!result?.data) {
      await sleep(1200);
      result = await send('Page.captureScreenshot', { format: 'png' });
    }
    if (!result?.data) {
      console.log('SCREENSHOT_TIMEOUT', name);
      return null;
    }
    const file = path.join(SHOTS, `${name}-${Date.now()}.png`);
    writeFileSync(file, Buffer.from(result.data, 'base64'));
    console.log('SCREENSHOT', file);
    return file;
  };

  const setField = (selector, value) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);

  const clickText = (pattern) =>
    evaluate(`(() => {
      const btn = [...document.querySelectorAll('button, a')].find(b => ${pattern}.test((b.textContent || '').trim()));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500);

  await setField('#login-email', EMAIL);
  await setField('#login-password', PASSWORD);
  await sleep(300);
  await clickText(/masuk/i);
  await sleep(4500);
  console.log(
    'AFTER_LOGIN',
    JSON.stringify(
      await evaluate(`({
        path: location.pathname,
        token: !!sessionStorage.getItem('tarlink.admin.token')
      })`)
    )
  );

  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1400,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send('Page.navigate', { url: `${BASE}/audit` });
  await sleep(9000);

  console.log(
    'PAGE',
    JSON.stringify(
      await evaluate(`(() => {
        const rows = [...document.querySelectorAll('table')]
          .find(t => (t.querySelector('caption')?.textContent || '').trim() === 'Tindakan operator')
          ?.querySelectorAll('tbody tr') ?? [];
        const cells = [...rows].slice(0, 4).map(r => [...r.cells].map(c => (c.innerText || '').replace(/\\s+/g, ' ').trim()));
        const scroller = [...document.querySelectorAll('table')]
          .find(t => (t.querySelector('caption')?.textContent || '').trim() === 'Tindakan operator')
          ?.parentElement;
        return {
          title: (document.querySelector('h1')?.textContent || '').trim(),
          heading: [...document.querySelectorAll('h2, h3')].map(n => (n.textContent || '').trim()).filter(Boolean).slice(0, 6),
          rowCount: rows.length,
          firstRows: cells,
          tableOverflow: scroller ? { clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth } : null,
          pageOverflow: {
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth
          },
          bodySnippet: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 900)
        };
      })()`)
    )
  );
  await shot('audit-actions');

  if (consoleErrors.length > 0) {
    console.log('CONSOLE_ERRORS');
    for (const line of consoleErrors) console.log(line);
  }

  ws.close();
  edge.kill();
}

void main().catch((error) => {
  console.error('GAGAL:', error.message);
  edge.kill();
  process.exit(1);
});
