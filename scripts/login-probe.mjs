/**
 * Uji login panel lewat browser sungguhan (CDP): isi email+password, submit,
 * lalu laporkan halaman tujuan + data yang tampil.
 *
 * Jalankan: node scripts/login-probe.mjs [email] [password]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EMAIL = process.argv[2] ?? 'admin@tarlink.id';
const PASSWORD = process.argv[3] ?? 'Tarlink#2026';
const PORT = 9226;
const BASE = 'http://localhost:3002';

const profile = mkdtempSync(path.join(tmpdir(), 'tarlink-login-'));
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1100',
    `${BASE}/login`
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
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve } = pending.get(m.id);
      pending.delete(m.id);
      resolve(m.result ?? m.error);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, { resolve });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    return r?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500);

  const form = await evaluate(`(() => ({
    hasEmail: !!document.querySelector('#login-email'),
    hasPassword: !!document.querySelector('#login-password'),
    buttons: [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(Boolean)
  }))()`);
  console.log('FORM', JSON.stringify(form));

  const filled = await evaluate(`(() => {
    const setValue = (selector, value) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    return {
      email: setValue('#login-email', ${JSON.stringify(EMAIL)}),
      password: setValue('#login-password', ${JSON.stringify(PASSWORD)})
    };
  })()`);
  console.log('FILLED', JSON.stringify(filled));
  await sleep(300);

  const clicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /masuk/i.test((b.textContent||'').trim()));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  console.log('CLICKED', clicked);
  await sleep(4000);

  const after = await evaluate(`(() => ({
    path: location.pathname,
    h1: (document.querySelector('h1')?.textContent || '').trim(),
    title: document.title,
    alert: (document.querySelector('[role=alert]')?.textContent || '').trim(),
    hasToken: !!sessionStorage.getItem('tarlink.admin.token'),
    bodyStart: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 220)
  }))()`);
  console.log('AFTER', JSON.stringify(after));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot?.data) {
    const dir = path.join(tmpdir(), 'opencode', 'shots');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `login-after-${Date.now()}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('SCREENSHOT', file);
  }

  // Halaman lain: pastikan membaca data server, bukan mock.
  await send('Network.enable');
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.url.includes('/v1/')) {
        console.log('HTTP', r.status, r.url.replace('http://localhost:3001', '').slice(0, 90));
      }
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (text) console.log('CONSOLE_ERROR', String(text).slice(0, 240));
    }
  });

  for (const route of ['/bookings', '/vendors', '/release', '/ledger', '/payments', '/disputes', '/settings', '/audit']) {
    await send('Page.navigate', { url: `${BASE}${route}` });
    await sleep(3500);
    const page = await evaluate(`(() => ({
      path: location.pathname,
      rows: document.querySelectorAll('tbody tr').length,
      skeletons: document.querySelectorAll('[class*=animate-pulse]').length,
      alertText: (document.querySelector('[role=alert]')?.textContent || '').trim().slice(0, 100),
      sample: (document.body.innerText.match(/(BK-[A-Z0-9-]+|Rp [\\d.]+|\\d+ booking cocok)/) || [])[0] || null
    }))()`);
    console.log('PAGE', route, JSON.stringify(page));
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
