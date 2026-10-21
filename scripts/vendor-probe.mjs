/**
 * Probe UI onboarding vendor lewat browser sungguhan (CDP):
 * login -> /vendors -> modal Tambah vendor (termasuk validasi kosong) ->
 * detail vendor (verifikasi, paket, kalender).
 *
 * Opsional `--create`: benar-benar membuat vendor lewat UI, menyetujuinya,
 * menambah + menonaktifkan paket, dan mengubah 1 hari kalender pada vendor uji
 * itu. Tanpa flag, probe hanya membaca dan mengambil tangkapan layar.
 *
 * Jalankan: node scripts/vendor-probe.mjs [--create]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EMAIL = 'admin@tarlink.id';
const PASSWORD = 'Tarlink#2026';
const CREATE = process.argv.includes('--create');
const OWNER =
  process.argv.find((arg) => arg.startsWith('--owner='))?.slice('--owner='.length) ?? EMAIL;
const SHOT_VENDOR =
  process.argv.find((arg) => arg.startsWith('--shots='))?.slice('--shots='.length) ?? null;
const PORT = 9227;
const BASE = 'http://localhost:3002';
const SHOTS = path.join(tmpdir(), 'opencode', 'shots');

const profile = mkdtempSync(path.join(tmpdir(), 'tarlink-vendor-'));
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
        httpLog.push(`${r.method} ${r.url.replace('http://localhost:3001', '').slice(0, 110)}`);
      }
    }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.url.includes('/v1/') && r.status >= 400) {
        httpLog.push(`  -> ${r.status} ${r.url.replace('http://localhost:3001', '').slice(0, 110)}`);
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

  /* --- Mode cek validasi catatan penolakan -------------------------------- */
  const REJECT_CHECK = process.argv
    .find((arg) => arg.startsWith('--reject-check='))
    ?.slice('--reject-check='.length);
  if (REJECT_CHECK) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false
    });
    await go(`${BASE}/vendors/${REJECT_CHECK}`, 9000);
    await clickText(/^Tolak$/i);
    await sleep(700);
    await setField('#vendor-reject-note', 'kurang');
    await evaluate(`document.querySelector('#vendor-reject-note')?.blur()`);
    await sleep(400);
    const readReject = () =>
      evaluate(`(() => {
        const panel = document.querySelector('[role=dialog]');
        const btn = [...(panel?.querySelectorAll('button') ?? [])].find(b => /tolak vendor/i.test(b.textContent || ''));
        return {
          error: (panel?.querySelector('p.text-danger')?.textContent || '').trim(),
          submitDisabled: btn ? btn.disabled : null
        };
      })()`);
    console.log('REJECT_SHORT', JSON.stringify(await readReject()));
    await shot('vendor-reject-short-note');

    await setField('#vendor-reject-note', 'Foto KTP buram dan rekening tidak cocok.');
    await sleep(500);
    console.log('REJECT_LONG', JSON.stringify(await readReject()));
    await shot('vendor-reject-valid-note');

    ws.close();
    edge.kill();
    return;
  }

  /* --- Mode uji aktif/nonaktif paket -------------------------------------- */
  const PACKAGE_TOGGLE = process.argv
    .find((arg) => arg.startsWith('--package-toggle='))
    ?.slice('--package-toggle='.length);
  if (PACKAGE_TOGGLE) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1400,
      deviceScaleFactor: 1,
      mobile: false
    });
    await go(`${BASE}/vendors/${PACKAGE_TOGGLE}`, 9000);
    await evaluate(`(() => {
      const h = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === 'Paket');
      h?.closest('section')?.scrollIntoView({ block: 'start' });
      return true;
    })()`);
    await sleep(600);
    const readPackage = () =>
      evaluate(`(() => {
        const table = [...document.querySelectorAll('table')].find(t => (t.caption?.textContent||'').includes('paket'));
        const row = table?.querySelector('tbody tr');
        const statuses = [...document.querySelectorAll('[role=status]')].map(n => n.textContent.replace(/\\s+/g, ' ').trim());
        return {
          row: (row?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
          toast: statuses.find(text => /Paket (di|non)/i.test(text)) ?? null,
          dialogOpen: !!document.querySelector('[role=dialog]')
        };
      })()`);

    await clickText(/^Nonaktifkan$/i);
    await sleep(700);
    await clickText(/ya, nonaktifkan/i);
    await sleep(3000);
    console.log('PACKAGE_DEACTIVATE', JSON.stringify(await readPackage()));
    await shot('package-deactivated');

    await clickText(/^Aktifkan$/i);
    await sleep(3000);
    console.log('PACKAGE_REACTIVATE', JSON.stringify(await readPackage()));
    await shot('package-reactivated');

    ws.close();
    edge.kill();
    return;
  }

  /* --- Mode satu tangkapan layar bagian atas ----------------------------- */
  const TOP_VENDOR = process.argv.find((arg) => arg.startsWith('--top='))?.slice('--top='.length);
  if (TOP_VENDOR) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1400,
      deviceScaleFactor: 1,
      mobile: false
    });
    await go(`${BASE}/vendors/${TOP_VENDOR}`, 10000);
    console.log(
      'TOP_PAGE',
      JSON.stringify(
        await evaluate(`({
          title: (document.querySelectorAll('h1')[1]?.textContent || '').trim(),
          font: getComputedStyle(document.body).fontFamily,
          body: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 600)
        })`)
      )
    );
    await shot('detail-top');
    ws.close();
    edge.kill();
    return;
  }

  /* --- Mode toast kalender (menulis 1 hari pada vendor uji) --------------- */
  const CALENDAR_TOAST = process.argv
    .find((arg) => arg.startsWith('--calendar-toast='))
    ?.slice('--calendar-toast='.length);
  if (CALENDAR_TOAST) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false
    });
    await go(`${BASE}/vendors/${CALENDAR_TOAST}`, 8000);
    const picked = await evaluate(`(() => {
      const from = document.querySelector('#calendar-from');
      const to = document.querySelector('#calendar-to');
      if (!from || !to) return null;
      const set = (el, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const start = new Date(from.min + 'T00:00:00Z');
      start.setUTCDate(start.getUTCDate() + 1);
      const day = start.toISOString().slice(0, 10);
      set(from, day);
      set(to, day);
      return day;
    })()`);
    await sleep(800);
    console.log('CALENDAR_PICK', picked);
    await clickText(/^Terapkan ke/i);
    await sleep(700);
    await clickText(/ya, terapkan/i);
    await sleep(3000);
    console.log(
      'CALENDAR_TOAST_RESULT',
      JSON.stringify(
        await evaluate(`(() => ({
          statuses: [...document.querySelectorAll('[role=status]')].map(n => n.textContent.replace(/\\s+/g, ' ').trim()).slice(0, 4),
          alerts: [...document.querySelectorAll('[role=alert]')].map(n => n.textContent.replace(/\\s+/g, ' ').trim()).slice(0, 3),
          dialogOpen: !!document.querySelector('[role=dialog]')
        }))()`)
      )
    );
    await shot('vendor-calendar-toast');

    ws.close();
    edge.kill();
    return;
  }

  /* --- Mode uji konflik 409 (owner sudah punya vendor) -------------------- */
  if (process.argv.includes('--conflict')) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false
    });
    await go(`${BASE}/vendors`, 5000);
    await clickText(/tambah vendor/i);
    await sleep(700);
    await setField('#vendor-owner-contact', EMAIL);
    await setField('#vendor-region-code', '3212');
    await setField('#vendor-display-name', 'Vendor Konflik Uji');
    await clickText(/simpan vendor/i);
    await sleep(3000);
    console.log(
      'CONFLICT',
      JSON.stringify(
        await evaluate(`(() => {
          const panel = document.querySelector('[role=dialog]');
          return {
            title: (panel?.querySelector('h2')?.textContent || '').trim(),
            message: (panel?.querySelector('[role=alert]')?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 220),
            stillOpen: !!panel,
            submitDisabled: (() => {
              const btn = [...(panel?.querySelectorAll('button') ?? [])].find(b => /simpan vendor/i.test(b.textContent || ''));
              return btn ? btn.disabled : null;
            })()
          };
        })()`)
      )
    );
    await shot('vendor-add-conflict');

    ws.close();
    edge.kill();
    return;
  }

  /* --- Mode tangkapan layar detail tertentu ------------------------------ */
  if (SHOT_VENDOR) {
    const scrollToHeading = (heading) =>
      evaluate(`(() => {
        const h = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === ${JSON.stringify(heading)});
        const card = h?.closest('section');
        card?.scrollIntoView({ block: 'start' });
        return card ? Math.round(card.getBoundingClientRect().top) : null;
      })()`);

    await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(500);
    await go(`${BASE}/vendors/${SHOT_VENDOR}`, 8000);
    if (process.argv.includes('--next-month')) {
      await evaluate(`document.querySelector('[aria-label="Bulan berikutnya"]')?.click()`);
      await sleep(2500);
    }
    console.log(
      'SHOT_PAGE',
      JSON.stringify(
        await evaluate(`({
          title: (document.querySelectorAll('h1')[1]?.textContent || '').trim(),
          verification: [...document.querySelectorAll('section span')].map(n => n.textContent.trim()).find(t => /Terverifikasi|Menunggu verifikasi|Ditolak/.test(t)) ?? null,
          alerts: [...document.querySelectorAll('[role=alert]')].map(a => a.textContent.trim().slice(0, 120)).slice(0, 3)
        })`)
      )
    );
    await shot('detail-top');

    await scrollToHeading('Paket');
    await sleep(600);
    await shot('detail-packages');

    await scrollToHeading('Kalender');
    await sleep(600);
    await shot('detail-calendar');

    await evaluate(`document.querySelector('#vendor-calendar-editor')?.scrollIntoView({ block: 'center' })`);
    await sleep(600);
    await shot('detail-calendar-editor');

    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(300);
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844
    });
    await sleep(600);
    await go(`${BASE}/vendors`, 5000);
    await shot('vendor-list-mobile');
    await clickText(/tambah vendor/i);
    await sleep(800);
    console.log(
      'MOBILE_MODAL',
      JSON.stringify(
        await evaluate(`(() => {
          const panel = document.querySelector('[role=dialog]');
          if (!panel) return null;
          const rect = panel.getBoundingClientRect();
          const scroller = panel.querySelector('.overflow-y-auto');
          return {
            viewport: [window.innerWidth, window.innerHeight],
            fits: rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight,
            rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
            scrollable: scroller ? scroller.scrollHeight > scroller.clientHeight : null
          };
        })()`)
      )
    );
    await shot('vendor-add-modal-mobile');

    ws.close();
    edge.kill();
    return;
  }

  /* --- Daftar vendor ------------------------------------------------------ */
  await go(`${BASE}/vendors`);
  console.log(
    'LIST',
    JSON.stringify(
      await evaluate(`({
        path: location.pathname,
        h1: (document.querySelectorAll('h1')[1]?.textContent || '').trim(),
        rows: document.querySelectorAll('tbody tr').length,
        total: (document.body.innerText.match(/(\\d+) vendor cocok/) || [])[1] || null,
        tambah: [...document.querySelectorAll('button')].some(b => /tambah vendor/i.test(b.textContent || '')),
        hasAddForm: !!document.querySelector('#add-vendor-title')
      })`)
    )
  );
  await shot('vendor-list');

  await clickText(/tambah vendor/i);
  await sleep(800);
  console.log(
    'MODAL',
    JSON.stringify(
      await evaluate(`(() => {
        const panel = document.querySelector('[role=dialog]');
        if (!panel) return null;
        const rect = panel.getBoundingClientRect();
        return {
          title: (panel.querySelector('h2')?.textContent || '').trim(),
          fields: [...panel.querySelectorAll('input, textarea, select')].map(el => el.id),
          fitsViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
          height: Math.round(rect.height),
          viewport: window.innerHeight
        };
      })()`)
    )
  );
  await shot('vendor-add-modal');

  await clickText(/simpan vendor/i);
  await sleep(700);
  console.log(
    'MODAL_VALIDATION',
    JSON.stringify(
      await evaluate(`(() => {
        const panel = document.querySelector('[role=dialog]');
        return {
          errors: [...(panel?.querySelectorAll('[role=alert], p.text-danger') ?? [])].map(n => n.textContent.trim()),
          stillOpen: !!panel
        };
      })()`)
    )
  );
  await shot('vendor-add-modal-validation');
  await evaluate(`document.querySelector('[aria-label="Tutup dialog"]')?.click()`);
  await sleep(500);

  /* --- Detail vendor berisi data ----------------------------------------- */
  const seededHref = await evaluate(`(() => {
    const link = document.querySelector('a[href^="/vendors/"]');
    return link ? link.getAttribute('href') : null;
  })()`);
  console.log('SEEDED_HREF', seededHref);

  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 2400,
    deviceScaleFactor: 1,
    mobile: false
  });
  if (seededHref) {
    await go(`${BASE}${seededHref}`, 9000);
    console.log(
      'DETAIL_SEEDED',
      JSON.stringify(
        await evaluate(`({
          path: location.pathname,
          title: (document.querySelectorAll('h1')[1]?.textContent || '').trim(),
          headings: [...document.querySelectorAll('h2, h3')].map(h => h.textContent.trim()).slice(0, 10),
          alerts: [...document.querySelectorAll('[role=alert]')].map(a => a.textContent.trim().slice(0, 140)).slice(0, 4),
          packageRows: [...document.querySelectorAll('table')].filter(t => (t.caption?.textContent||'').includes('paket')).map(t => t.querySelectorAll('tbody tr').length),
          calendarCells: [...document.querySelectorAll('table')].filter(t => (t.caption?.textContent||'').startsWith('Kalender vendor')).map(t => t.querySelectorAll('tbody td').length),
          statusBadges: [...document.querySelectorAll('table')].filter(t => (t.caption?.textContent||'').startsWith('Kalender vendor')).flatMap(t => [...t.querySelectorAll('tbody td')].slice(0, 3).map(td => td.innerText.replace(/\s+/g, ' ').trim()))
        })`)
      )
    );
    await shot('vendor-detail-seeded');

    // Buka editor kalender dan pilih rentang 3 hari lewat klik.
    await evaluate(`(() => {
      const cellButtons = [...document.querySelectorAll('table')]
        .filter(t => (t.caption?.textContent||'').startsWith('Kalender vendor'))
        .flatMap(t => [...t.querySelectorAll('tbody button')]);
      cellButtons[10]?.click();
      return cellButtons.length;
    })()`);
    await sleep(600);
    await evaluate(`(() => {
      const cellButtons = [...document.querySelectorAll('table')]
        .filter(t => (t.caption?.textContent||'').startsWith('Kalender vendor'))
        .flatMap(t => [...t.querySelectorAll('tbody button')]);
      cellButtons[12]?.click();
      return cellButtons.length;
    })()`);
    await sleep(600);
    console.log(
      'CALENDAR_RANGE',
      JSON.stringify(
        await evaluate(`(() => {
          const editor = document.querySelector('#vendor-calendar-editor');
          return {
            from: document.querySelector('#calendar-from')?.value ?? null,
            to: document.querySelector('#calendar-to')?.value ?? null,
            summary: (editor?.innerText || '').replace(/\\s+/g, ' ').slice(0, 240)
          };
        })()`)
      )
    );
    await shot('vendor-detail-calendar-range');
  }

  /* --- Alur tulis nyata (opsional) --------------------------------------- */
  if (CREATE) {
    const newName = `Vendor Uji Panel ${Date.now().toString().slice(-5)}`;
    await go(`${BASE}/vendors`);
    await clickText(/tambah vendor/i);
    await sleep(700);
    await setField('#vendor-owner-contact', OWNER);
    await setField('#vendor-region-code', '3212');
    await setField('#vendor-display-name', newName);
    await setField('#vendor-description', 'Vendor uji untuk memverifikasi alur onboarding panel.');
    await setField('#vendor-base-address', 'Indramayu');
    await sleep(300);
    await clickText(/simpan vendor/i);
    await sleep(3500);
    console.log(
      'CREATE_RESULT',
      JSON.stringify(
        await evaluate(`(() => {
          const dialog = document.querySelector('[role=dialog]');
          const toast = document.querySelector('[role=status]');
          return {
            dialogOpen: !!dialog,
            dialogError: (dialog?.querySelector('[role=alert]')?.textContent || '').trim().slice(0, 160),
            toast: (toast?.textContent || '').trim().slice(0, 160),
            listTotal: (document.body.innerText.match(/(\\d+) vendor cocok/) || [])[1] || null
          };
        })()`)
      )
    );
    await shot('vendor-create-result');

    const newHref = await evaluate(`(() => {
      const row = [...document.querySelectorAll('tbody tr')].find(tr => tr.innerText.includes(${JSON.stringify(newName)}));
      const link = row?.querySelector('a[href^="/vendors/"]');
      return link ? link.getAttribute('href') : null;
    })()`);
    console.log('NEW_HREF', newHref, newName);

    if (newHref) {
      await go(`${BASE}${newHref}`, 8000);
      console.log(
        'DETAIL_NEW',
        JSON.stringify(
          await evaluate(`(() => ({
            title: (document.querySelectorAll('h1')[1]?.textContent || '').trim(),
            badge: (document.querySelector('main [class*="rounded-full"]')?.textContent || '').trim(),
            packageState: [...document.querySelectorAll('[role=status], [role=alert]')].map(n => n.textContent.trim().slice(0, 120)).slice(0, 4),
            hasSetujui: [...document.querySelectorAll('button')].some(b => /setujui/i.test(b.textContent || ''))
          }))()`)
        )
      );
      await shot('vendor-detail-new');

      // Setujui vendor uji.
      await clickText(/^Setujui$/i);
      await sleep(700);
      await shot('vendor-verify-confirm');
      await clickText(/ya, setujui/i);
      await sleep(3000);
      console.log(
        'VERIFY_RESULT',
        JSON.stringify(
          await evaluate(`(() => ({
            badge: [...document.querySelectorAll('main span')].map(n => n.textContent.trim()).find(t => /Terverifikasi|Menunggu verifikasi|Ditolak/.test(t)) ?? null,
            toast: (document.querySelector('[role=status]')?.textContent || '').trim().slice(0, 160),
            hasSetujui: [...document.querySelectorAll('button')].some(b => /setujui/i.test(b.textContent || ''))
          }))()`)
        )
      );
      await shot('vendor-verify-result');

      // Tambah paket lewat modal.
      await clickText(/tambah paket/i);
      await sleep(700);
      await setField('#new-package-name', 'Paket Uji 2 jam');
      await setField('#new-package-duration', '120');
      await setField('#new-package-price', '2500000');
      await clickText(/simpan paket/i);
      await sleep(3000);
      console.log(
        'PACKAGE_CREATE',
        JSON.stringify(
          await evaluate(`(() => ({
            rows: [...document.querySelectorAll('table')].filter(t => (t.caption?.textContent||'').includes('paket')).map(t => t.querySelectorAll('tbody tr').length),
            toast: (document.querySelector('[role=status]')?.textContent || '').trim().slice(0, 160),
            body: (document.body.innerText.match(/Paket Uji 2 jam/) || [])[0] || null
          }))()`)
        )
      );
      await shot('vendor-package-created');

      // Kalender: ubah 1 hari.
      await evaluate(`(() => {
        const from = document.querySelector('#calendar-from');
        const to = document.querySelector('#calendar-to');
        const set = (el, value) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        if (from && to) { set(from, from.min); set(to, from.min); }
        return from && to ? { from: from.min, to: from.min } : null;
      })()`);
      await sleep(600);
      console.log(
        'CALENDAR_FORM',
        JSON.stringify(
          await evaluate(`({
            summary: (document.querySelector('#vendor-calendar-editor')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 260),
            apply: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).find(t => /^Terapkan ke/.test(t)) ?? null
          })`)
        )
      );
      await clickText(/^Terapkan ke/i);
      await sleep(700);
      await clickText(/ya, terapkan/i);
      await sleep(3000);
      console.log(
        'CALENDAR_RESULT',
        JSON.stringify(
          await evaluate(`(() => ({
            toast: (document.querySelector('[role=status]')?.textContent || '').trim().slice(0, 160),
            alerts: [...document.querySelectorAll('[role=alert]')].map(a => a.textContent.trim().slice(0, 140)).slice(0, 3)
          }))()`)
        )
      );
      await shot('vendor-calendar-updated');
    }
  }

  /* --- Mobile ------------------------------------------------------------ */
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844
  });
  await sleep(800);
  await go(`${BASE}/vendors`, 5000);
  console.log(
    'MOBILE_VIEWPORT',
    JSON.stringify(await evaluate(`({ width: window.innerWidth, height: window.innerHeight })`))
  );
  await shot('vendor-list-mobile');
  await clickText(/tambah vendor/i);
  await sleep(800);
  console.log(
    'MODAL_MOBILE',
    JSON.stringify(
      await evaluate(`(() => {
        const panel = document.querySelector('[role=dialog]');
        if (!panel) return null;
        const rect = panel.getBoundingClientRect();
        return {
          fitsWidth: rect.left >= 0 && rect.right <= window.innerWidth,
          width: Math.round(rect.width),
          viewportWidth: window.innerWidth,
          height: Math.round(rect.height),
          viewportHeight: window.innerHeight
        };
      })()`)
    )
  );
  await shot('vendor-add-modal-mobile');

  console.log('HTTP_LOG');
  for (const line of httpLog) console.log(' ', line);
  console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors.slice(0, 8)));

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
