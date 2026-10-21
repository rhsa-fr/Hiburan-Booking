/**
 * Bukti browser: login admin -> detail booking dp_paid -> modal Catat pelunasan
 * -> konfirmasi -> submit ke API nyata -> status Lunas + toast.
 *
 * Jalankan: node scripts/settle-probe.mjs <booking-id>
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EMAIL = 'admin@tarlink.id';
const PASSWORD = 'Tarlink#2026';
const BOOKING = process.argv[2];
if (!BOOKING) throw new Error('pemakaian: node scripts/settle-probe.mjs <booking-id>');
const PORT = 9228;
const BASE = 'http://localhost:3002';
const SHOTS = path.join(tmpdir(), 'opencode', 'shots');

const profile = mkdtempSync(path.join(tmpdir(), 'tarlink-settle-'));
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1200',
    `${BASE}/login`
  ],
  { stdio: 'ignore' }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });

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
  const pending = new Map();
  const httpLog = [];
  const consoleErrors = [];

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve } = pending.get(m.id);
      pending.delete(m.id);
      resolve(m.result ?? m.error);
    }
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      if (r.url.includes('/v1/')) {
        httpLog.push(`${r.method} ${r.url.replace('http://localhost:3001', '').slice(0, 120)}`);
      }
    }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.url.includes('/v1/') && (r.status >= 400 || r.url.includes('/settle'))) {
        httpLog.push(`  -> ${r.status} ${r.url.replace('http://localhost:3001', '').slice(0, 120)}`);
      }
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

  const clickText = (pattern) =>
    evaluate(`(() => {
      const btn = [...document.querySelectorAll('button, a')].find(b => ${pattern}.test((b.textContent || '').trim()));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);

  const setField = (selector, value) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);

  const go = async (url, wait = 4000) => {
    await send('Page.navigate', { url });
    await sleep(wait);
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await sleep(2500);

  await setField('#login-email', EMAIL);
  await setField('#login-password', PASSWORD);
  await sleep(300);
  await clickText(/masuk/i);
  await sleep(4000);
  console.log(
    'AFTER_LOGIN',
    JSON.stringify(
      await evaluate(`({
        path: location.pathname,
        token: !!sessionStorage.getItem('tarlink.admin.token'),
        role: JSON.parse(sessionStorage.getItem('tarlink.admin.session') || 'null')?.role ?? null
      })`)
    )
  );

  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false
  });
  await go(`${BASE}/bookings/${BOOKING}`, 10000);
  console.log(
    'BEFORE',
    JSON.stringify(
      await evaluate(`(() => ({
        title: (document.querySelector('h1')?.textContent || '').trim(),
        action: [...document.querySelectorAll('button')].some(b => /Catat pelunasan/i.test(b.textContent || '')),
        body: document.body.innerText.replace(/\\s+/g, ' ').match(/Status tiga sumbu.{0,220}/)?.[0] ?? ''
      }))()`)
    )
  );

  const opened = await clickText(/^Catat pelunasan$/i);
  await sleep(1200);
  console.log(
    'MODAL',
    JSON.stringify(
      await evaluate(`({
        opened: !!document.querySelector('#settle-modal-title'),
        amount: document.querySelector('#settle-amount')?.value ?? null,
        amountReadOnly: document.querySelector('#settle-amount')?.readOnly ?? null,
        method: document.querySelector('#settle-method')?.value ?? null
      })`)
    )
  );
  if (!opened) throw new Error('tombol Catat pelunasan tidak ditemukan');

  await setField('#settle-reference', 'BCA 21/10/2026');
  await setField('#settle-note', 'Transfer telat, bukti diterima ops');
  await sleep(400);
  await shot('settle-modal');

  await clickText(/^Lanjutkan$/i);
  await sleep(1000);
  console.log(
    'CONFIRM',
    JSON.stringify(
      await evaluate(`(() => {
        const panel = document.querySelector('[role=dialog]');
        return {
          open: !!document.querySelector('#settle-confirm-title'),
          text: (panel?.innerText || '').replace(/\\s+/g, ' ').slice(0, 320)
        };
      })()`)
    )
  );
  await shot('settle-confirm');

  const confirmed = await clickText(/Ya, catat pelunasan/i);
  if (!confirmed) throw new Error('tombol konfirmasi tidak ditemukan');
  await sleep(5000);

  console.log(
    'AFTER',
    JSON.stringify(
      await evaluate(`(() => {
        const statuses = [...document.querySelectorAll('[role=status]')].map(n => (n.innerText || '').replace(/\\s+/g, ' ').trim());
        const axis = [...document.querySelectorAll('div')].find(n => (n.textContent || '').trim() === 'Status tiga sumbu');
        return {
          title: (document.querySelector('h1')?.textContent || '').trim(),
          dialogOpen: !!document.querySelector('[role=dialog]'),
          toast: statuses.find(text => /Pelunasan tercatat/i.test(text)) ?? null,
          paymentSection: (axis?.parentElement?.innerText || '').replace(/\\s+/g, ' ').slice(0, 240),
          hasLunas: /Lunas/i.test(document.body.innerText)
        };
      })()`)
    )
  );
  await shot('settle-after');

  console.log('HTTP');
  for (const line of httpLog.slice(-40)) console.log(line);
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
