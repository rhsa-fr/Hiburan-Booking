/**
 * Probe tipografi: membaca font-family & ukuran yang benar-benar dipakai browser.
 * Jalankan: node scripts/font-probe.mjs [url]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TARGET = process.argv[2] ?? 'http://localhost:3002/';
const PORT = 9224;

const profile = mkdtempSync(path.join(tmpdir(), 'tarlink-font-'));
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1200',
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

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
}

async function main() {
  const t = await target();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const send = cdp(ws);
  await send('Runtime.enable');
  await sleep(4000);

  const out = await send('Runtime.evaluate', {
    expression: `(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { sel, text: (el.textContent||'').trim().slice(0, 42), font: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, line: cs.lineHeight };
      };
      const fontsLoaded = [...document.fonts].map(f => f.family + ':' + f.weight + ':' + f.status).slice(0, 8);
      return {
        rootVar: getComputedStyle(document.documentElement).getPropertyValue('--font-jakarta').trim(),
        html: pick('html'),
        body: pick('body'),
        h1: pick('h1'),
        h2: pick('h2'),
        tableCell: pick('td'),
        kpiValue: pick('[data-kpi-value]') || pick('.tnum'),
        paragraph: pick('p'),
        fontsLoaded
      };
    })()`,
    returnByValue: true
  });
  console.log(JSON.stringify(out.result.value, null, 2));
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
