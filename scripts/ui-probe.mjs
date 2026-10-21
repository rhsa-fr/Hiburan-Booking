/**
 * Probe UI untuk halaman /release: memeriksa apakah textarea "Alasan pencairan"
 * bisa difokuskan/diisi, atau tertutup elemen lain.
 *
 * Memakai Edge + Chrome DevTools Protocol langsung (tanpa dependency baru).
 * Jalankan: node scripts/ui-probe.mjs [url]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL_TARGET = process.argv[2] ?? 'http://localhost:3002/release';
const PORT = 9223;

const profile = mkdtempSync(path.join(tmpdir(), 'tarlink-probe-'));
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1400',
    URL_TARGET
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPageTarget() {
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // Edge belum siap.
    }
  }
  throw new Error('target halaman tidak ditemukan');
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
}

async function evaluate(send, expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (res.exceptionDetails) {
    return { __error: res.exceptionDetails.text ?? 'exception' };
  }
  return res.result?.value;
}

async function main() {
  const target = await findPageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const send = cdp(ws);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_TARGET });
  await sleep(4000);

  const step0 = await evaluate(send, `(() => ({
    title: document.title,
    checkboxes: document.querySelectorAll('input[type=checkbox]').length,
    buttons: [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(Boolean).slice(0, 12)
  }))()`);
  console.log('STEP0', JSON.stringify(step0));

  // Pilih kandidat pertama lalu lanjut ke langkah 1.
  const moved = await evaluate(send, `(() => {
    const boxes = [...document.querySelectorAll('input[type=checkbox]')];
    if (boxes.length === 0) return { clicked: false, why: 'tidak ada checkbox' };
    boxes[1]?.click();
    boxes[0]?.click();
    const btn = [...document.querySelectorAll('button')].find(b => /lanjut|selanjutnya|preview/i.test((b.textContent || '').trim()));
    if (btn) { btn.click(); return { clicked: true, button: (btn.textContent || '').trim() }; }
    return { clicked: false, why: 'tombol lanjut tidak ada' };
  })()`);
  console.log('MOVE', JSON.stringify(moved));
  await sleep(1500);

  const state = await evaluate(send, `(() => {
    const buttons = [...document.querySelectorAll('button')].map(b => ({
      text: (b.textContent || '').trim().slice(0, 40),
      disabled: b.disabled
    }));
    const checks = [...document.querySelectorAll('input[type=checkbox]')].map(c => ({
      id: c.id, checked: c.checked, disabled: c.disabled
    }));
    const stepText = (document.body.innerText.match(/Langkah[^\\n]*/gi) || []).slice(0, 3);
    return {
      buttons: buttons.filter(b => b.text),
      checks,
      stepText,
      hasReason: !!document.querySelector('#release-reason'),
      textareas: [...document.querySelectorAll('textarea')].map(t => t.id || '(tanpa id)')
    };
  })()`);
  console.log('STATE', JSON.stringify(state));

  const probe = await evaluate(send, `(() => {
    const el = document.querySelector('#release-reason');
    if (!el) {
      return {
        found: false,
        textareas: [...document.querySelectorAll('textarea')].map(t => t.id),
        bodyHint: document.body.innerText.slice(0, 300)
      };
    }
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const cs = getComputedStyle(el);
    const describe = (node) => node ? (node.id ? '#' + node.id : node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).split(' ').slice(0, 3).join('.') : '')) : 'null';
    return {
      found: true,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
      topElementAtCenter: describe(top),
      coveredByOther: !!top && top !== el && !el.contains(top),
      disabled: el.disabled,
      readOnly: el.readOnly,
      pointerEvents: cs.pointerEvents,
      visibility: cs.visibility,
      opacity: cs.opacity,
      value: el.value,
      before: el.value
    };
  })()`);
  console.log('PROBE', JSON.stringify(probe));

  const typed = await evaluate(send, `(() => {
    const el = document.querySelector('#release-reason');
    if (!el) return { ok: false, why: 'textarea tidak ada' };
    el.focus();
    const focused = document.activeElement === el;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, 'Acara selesai tanpa sengketa, jendela klaim sudah lewat.');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, focused, value: el.value };
  })()`);
  console.log('TYPED', JSON.stringify(typed));
  await sleep(800);

  const after = await evaluate(send, `(() => {
    const el = document.querySelector('#release-reason');
    const alert = document.querySelector('[role=alert]');
    const next = [...document.querySelectorAll('button')].find(b => /lanjut|konfirmasi|kirim/i.test((b.textContent || '').trim()));
    return {
      value: el ? el.value : null,
      alert: alert ? alert.textContent.trim() : null,
      nextDisabled: next ? next.disabled : null
    };
  })()`);
  console.log('AFTER', JSON.stringify(after));

  // Uji ketikan PER HURUF lewat Input.dispatchKeyEvent: kalau fokus hilang di
  // tengah jalan, nilai akan berhenti bertambah.
  await evaluate(send, `(() => {
    const el = document.querySelector('#release-reason');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    return document.activeElement === el;
  })()`);
  await sleep(300);

  const phrase = 'Acara selesai tanpa sengketa';
  for (const ch of phrase) {
    await send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch });
    await sleep(40);
  }
  await sleep(600);

  const dump = async (label) => {
    const snap = await evaluate(send, `(() => {
      const el = document.querySelector('#release-reason');
      const stepText = (document.body.innerText.match(/LANGKAH[^\\n]*/gi) || [])[0] || null;
      const headings = [...document.querySelectorAll('h1,h2,h3')].map(h => (h.textContent||'').trim()).slice(0, 5);
      const pulses = document.querySelectorAll('[class*=animate-pulse]').length;
      return {
        hasTextarea: !!el,
        value: el ? el.value : null,
        stepText,
        headings,
        skeletons: pulses,
        bodyStart: document.body.innerText.replace(/\\s+/g,' ').slice(0, 160)
      };
    })()`);
    console.log(label, JSON.stringify(snap));
  };

  await dump('AFTER_PER_KEY');

  const perKey = await evaluate(send, `(() => {
    const el = document.querySelector('#release-reason');
    const active = document.activeElement;
    return {
      value: el ? el.value : null,
      length: el ? el.value.length : -1,
      focusStillOnField: active === el,
      activeElement: active ? (active.id || active.tagName.toLowerCase()) : null
    };
  })()`);
  console.log('PER_KEY', JSON.stringify(perKey));
  console.log('EXPECTED_LENGTH', phrase.length);

  ws.close();
  edge.kill();
}

main()
  .catch((err) => {
    console.error('PROBE GAGAL:', err.message);
    edge.kill();
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 300);
  });
