/**
 * Bukti fan-out chat lintas instance API lewat PostgreSQL LISTEN/NOTIFY.
 *
 * Prasyarat: dua instance API dengan DATABASE_URL yang SAMA, mis.
 *   PORT=3001 npm run start:api
 *   PORT=3003 CORS_ORIGINS=http://localhost:3002,http://localhost:8080 npm run start:api
 * lalu `node scripts/probe-chat-fanout.mjs`.
 *
 * Yang diuji:
 *   1. Socket customer di instance A menerima pesan yang dikirim lewat REST ke A.
 *   2. Socket vendor di instance B menerima pesan yang sama (NOTIFY lintas proses).
 *   3. Balasan vendor lewat B diterima socket customer di A.
 *   4. Riwayat REST di kedua instance memuat pesan yang sama.
 *
 * Ini dev tool, bukan test CI: butuh DB demo (`scripts/seed-demo.mjs`) dan dua
 * proses API yang hidup.
 */
import WebSocket from 'ws';

const INSTANCE_A = process.env.CHAT_INSTANCE_A ?? 'http://localhost:3001';
const INSTANCE_B = process.env.CHAT_INSTANCE_B ?? 'http://localhost:3003';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Tarlink#2026!';
const CUSTOMER_EMAIL = 'rina.ayu@tarlink.id';
const VENDOR_EMAIL = 'vendor@tarlink.id';

async function api(base, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${base}/v1${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

async function login(base, email) {
  const { status, json } = await api(base, '/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD }
  });
  if (status !== 200) throw new Error(`login ${email} -> ${status}`);
  const data = json?.data ?? json;
  if (!data?.access_token) throw new Error(`login ${email}: access_token tidak ada`);
  return data.access_token;
}

function waitForEvent(socket, predicate, label, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`timeout menunggu ${label}`));
    }, timeoutMs);
    function onMessage(raw) {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!predicate(event)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(event);
    }
    socket.on('message', onMessage);
  });
}

function wsUrl(base, token) {
  const url = new URL(base.replace(/^http/, 'ws'));
  url.pathname = '/v1/chat/ws';
  url.searchParams.set('token', token);
  return url.toString();
}

async function openSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function subscribe(socket, bookingId) {
  socket.send(JSON.stringify({ type: 'subscribe', booking_id: bookingId }));
  const event = await waitForEvent(socket, (e) => e.type === 'subscribed', 'subscribed');
  return event.role;
}

async function main() {
  const customerA = await login(INSTANCE_A, CUSTOMER_EMAIL);
  const vendorA = await login(INSTANCE_A, VENDOR_EMAIL);
  const vendorToken = await login(INSTANCE_B, VENDOR_EMAIL);

  const list = await api(INSTANCE_A, '/bookings', { token: customerA });
  const booking = list.json?.items?.[0];
  if (!booking) throw new Error('booking demo tidak ditemukan');
  console.log('booking:', booking.code, booking.id);

  const customerSocket = await openSocket(wsUrl(INSTANCE_A, customerA));
  const vendorSocket = await openSocket(wsUrl(INSTANCE_B, vendorToken));

  const customerRole = await subscribe(customerSocket, booking.id);
  const vendorRole = await subscribe(vendorSocket, booking.id);
  console.log(`subscribed customer=${customerRole} vendor=${vendorRole}`);
  if (customerRole !== 'customer') throw new Error('peran customer salah');
  if (vendorRole !== 'vendor') throw new Error('peran vendor salah');

  const fromCustomer = `Probe customer ${Date.now()}`;
  await Promise.all([
    waitForEvent(
      customerSocket,
      (e) => e.type === 'message' && e.message?.body === fromCustomer,
      'pesan customer di instance A'
    ),
    waitForEvent(
      vendorSocket,
      (e) => e.type === 'message' && e.message?.body === fromCustomer,
      'pesan customer di instance B'
    ),
    api(INSTANCE_A, `/bookings/${booking.id}/chat/messages`, {
      method: 'POST',
      token: customerA,
      body: { body: fromCustomer }
    }).then((result) => {
      if (result.status !== 201) throw new Error(`POST customer -> ${result.status}`);
    })
  ]);
  console.log('fan-out customer -> A & B: OK');

  const fromVendor = `Probe vendor ${Date.now()}`;
  const [customerDelivery] = await Promise.all([
    waitForEvent(
      customerSocket,
      (e) => e.type === 'message' && e.message?.body === fromVendor,
      'pesan vendor di instance A'
    ),
    api(INSTANCE_B, `/bookings/${booking.id}/chat/messages`, {
      method: 'POST',
      token: vendorToken,
      body: { body: fromVendor }
    }).then((result) => {
      if (result.status !== 201) throw new Error(`POST vendor -> ${result.status}`);
    })
  ]);
  console.log('fan-out vendor -> A: OK');

  const historyA = await api(INSTANCE_A, `/bookings/${booking.id}/chat/messages?limit=50`, {
    token: customerA
  });
  const historyB = await api(INSTANCE_B, `/bookings/${booking.id}/chat/messages?limit=50`, {
    token: vendorA
  });
  const idsA = (historyA.json?.data?.items ?? []).map((item) => item.id).sort();
  const idsB = (historyB.json?.data?.items ?? []).map((item) => item.id).sort();
  if (JSON.stringify(idsA) !== JSON.stringify(idsB)) {
    throw new Error('riwayat REST kedua instance berbeda');
  }
  console.log(`riwayat REST sama di A & B (${idsA.length} pesan)`);

  customerSocket.close();
  vendorSocket.close();
  console.log('OK');
}

main().catch((error) => {
  console.error('GAGAL:', error.message);
  process.exit(1);
});
