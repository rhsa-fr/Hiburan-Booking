/**
 * Preflight konfigurasi produksi.
 *
 *   npm run verify:prod                     # baca .env.prod
 *   npm run verify:prod -- --env-file .env  # file lain
 *   npm run verify:prod -- --db             # + cek migrasi di database
 *
 * Tujuan: kegagalan konfigurasi muncul sebagai daftar yang bisa dibaca
 * sebelum deploy, bukan sebagai 500 pertama di produksi. Nilai rahasia TIDAK
 * pernah dicetak — hanya nama variabel, panjang, dan alasannya.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const errors = [];
const warnings = [];
const passes = [];

function pass(message) {
  passes.push(message);
}
function fail(name, reason) {
  errors.push(`${name}: ${reason}`);
}
function warn(name, reason) {
  warnings.push(`${name}: ${reason}`);
}

/* ------------------------------------------------------------------ args */

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const envFile = argValue('--env-file') ?? '.env.prod';
const checkDb = process.argv.includes('--db');
const allowLocalPayout = process.argv.includes('--allow-local-payout');

/* ----------------------------------------------------------- env loading */

/** Sama seperti `loadDotEnv` di API: process.env menang atas file. */
function loadEnvFile(file) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return 0;
  let loaded = 0;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
      loaded += 1;
    }
  }
  return loaded;
}

const loadedKeys = loadEnvFile(envFile);
const env = process.env;

function value(name) {
  const raw = env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

const truthy = (raw) => ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());

function isUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isBase64Key(raw, bytes = 32) {
  if (!raw) return false;
  const decoded = Buffer.from(raw, 'base64');
  // Buffer.from tidak melempar untuk input sampah; panjangnya yang menentukan.
  return decoded.length === bytes;
}

/* ------------------------------------------------------------------ cek */

if (!loadedKeys && existsSync(resolve(process.cwd(), envFile))) {
  pass(`${envFile} dibaca (variabel sudah ada di environment)`);
} else if (loadedKeys > 0) {
  pass(`${envFile} dibaca (${loadedKeys} variabel baru)`);
} else {
  warn(envFile, 'tidak ditemukan; memakai environment proses apa adanya');
}

// --- runtime
if (value('NODE_ENV') === 'production') {
  pass('NODE_ENV=production');
} else {
  fail('NODE_ENV', `harus "production" (sekarang "${value('NODE_ENV') || 'kosong'}")`);
}

if (Number(value('PORT') || 3001) > 0) pass(`PORT=${value('PORT') || 3001}`);
else fail('PORT', 'harus bilangan positif');

// --- database
const databaseUrl = value('DATABASE_URL');
if (!databaseUrl) {
  fail('DATABASE_URL', 'wajib diisi');
} else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
  fail('DATABASE_URL', 'harus diawali postgres:// atau postgresql://');
} else if (/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  warn(
    'DATABASE_URL',
    'menunjuk localhost — benar bila database ada di host yang sama, salah bila container terpisah'
  );
} else {
  pass('DATABASE_URL menunjuk host non-lokal');
}

// --- rahasia JWT
const jwt = value('JWT_SECRET');
if (!jwt) fail('JWT_SECRET', 'wajib diisi');
else if (jwt.length < 32) fail('JWT_SECRET', `terlalu pendek (${jwt.length} < 32 karakter)`);
else if (['change-me-in-production', 'secret', 'tarlink'].includes(jwt)) {
  fail('JWT_SECRET', 'memakai nilai contoh');
} else pass(`JWT_SECRET panjang ${jwt.length} karakter`);

// --- OTP tidak boleh bocor ke produksi
if (truthy(value('OTP_DEV_MODE'))) {
  fail('OTP_DEV_MODE', 'harus false/kosong di produksi (dev_code akan bocor)');
} else {
  pass('OTP_DEV_MODE nonaktif');
}

// --- email (satu-satunya jalur OTP)
const emailUrl = value('EMAIL_API_URL');
if (!emailUrl) fail('EMAIL_API_URL', 'wajib: tanpa provider email, OTP tidak terkirim');
else if (!isUrl(emailUrl)) fail('EMAIL_API_URL', 'harus URL http(s) valid');
else pass('EMAIL_API_URL diisi');

if (!value('EMAIL_API_KEY')) fail('EMAIL_API_KEY', 'wajib diisi');
else pass('EMAIL_API_KEY diisi');

const emailFrom = value('EMAIL_FROM');
if (!emailFrom) fail('EMAIL_FROM', 'wajib diisi');
else if (!emailFrom.includes('@')) fail('EMAIL_FROM', `bukan alamat email: "${emailFrom}"`);
else pass('EMAIL_FROM berisi @');

// --- kunci enkripsi
for (const [name, why] of [
  ['TOTP_ENCRYPTION_KEY', 'tanpa ini login admin gagal di enrollment 2FA'],
  ['KTP_ENCRYPTION_KEY', 'tanpa ini pengajuan vendor ditolak'],
  ['BANK_ACCOUNT_ENCRYPTION_KEY', 'tanpa ini vendor tidak bisa menyimpan rekening']
]) {
  const raw = value(name);
  if (!raw) fail(name, `wajib di produksi — ${why}`);
  else if (!isBase64Key(raw)) fail(name, 'harus base64 dari 32 byte acak');
  else pass(`${name} base64 32 byte`);
}

if (value('BANK_ACCOUNT_ENCRYPTION_KEY_PREVIOUS') || value('TOTP_ENCRYPTION_KEY_PREVIOUS')) {
  warn('*_PREVIOUS', 'mode rotasi kunci aktif; pastikan rotasi selesai sebelum nilai lama dihapus');
}

// --- CORS & origin publik
const origins = value('CORS_ORIGINS')
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean);
if (origins.length === 0) {
  fail('CORS_ORIGINS', 'wajib diisi (origin panel admin)');
} else {
  const wildcard = origins.includes('*');
  const insecure = origins.filter((origin) => origin.startsWith('http://'));
  const local = origins.filter((origin) => /localhost|127\.0\.0\.1/.test(origin));
  if (wildcard) fail('CORS_ORIGINS', 'wildcard "*" tidak boleh dipakai dengan kredensial');
  else if (insecure.length > 0) fail('CORS_ORIGINS', `harus https: ${insecure.join(', ')}`);
  else if (local.length > 0) warn('CORS_ORIGINS', `masih memuat localhost: ${local.join(', ')}`);
  else pass(`CORS_ORIGINS ${origins.length} origin https`);
}

for (const name of ['MEDIA_PUBLIC_BASE_URL', 'NEXT_PUBLIC_API_BASE_URL']) {
  const raw = value(name);
  if (!raw) fail(name, 'wajib diisi origin publik (di-inline saat build panel)');
  else if (!raw.startsWith('https://')) fail(name, 'harus https://');
  else pass(`${name} https`);
}

// --- reverse proxy
if (truthy(value('TRUST_PROXY'))) pass('TRUST_PROXY aktif (rate limit per IP benar)');
else {
  warn(
    'TRUST_PROXY',
    'false: di belakang nginx/load balancer semua klien tampak satu IP sehingga limiter per-IP memblokir bersama'
  );
}

// --- payment gateway
if (value('PJP_PROVIDER') === 'midtrans') {
  const serverKey = value('MIDTRANS_SERVER_KEY');
  if (!serverKey) fail('MIDTRANS_SERVER_KEY', 'wajib saat PJP_PROVIDER=midtrans');
  else if (!serverKey.includes('-')) {
    warn('MIDTRANS_SERVER_KEY', 'tidak berpola kunci Midtrans (biasanya "SB-Mid-server-…"/"Mid-server-…")');
  } else pass('MIDTRANS_SERVER_KEY diisi');

  if (!truthy(value('MIDTRANS_IS_PRODUCTION'))) {
    fail('MIDTRANS_IS_PRODUCTION', 'false: transaksi akan masuk sandbox walau dibuka ke pengguna nyata');
  } else pass('MIDTRANS_IS_PRODUCTION aktif');
} else {
  fail('PJP_PROVIDER', `"${value('PJP_PROVIDER') || 'kosong'}" — produksi harus memakai gateway nyata (midtrans)`);
}

// --- payout
const payoutProvider = value('PAYOUT_PROVIDER') || 'local';
if (payoutProvider === 'iris') {
  if (!value('IRIS_API_KEY')) fail('IRIS_API_KEY', 'wajib saat PAYOUT_PROVIDER=iris');
  else pass('IRIS_API_KEY diisi');
  if (!truthy(value('IRIS_IS_PRODUCTION'))) {
    fail('IRIS_IS_PRODUCTION', 'false: pencairan akan diuji ke sandbox');
  } else pass('IRIS_IS_PRODUCTION aktif');
} else if (payoutProvider === 'local') {
  if (allowLocalPayout) {
    warn('PAYOUT_PROVIDER', 'local: payout ditandai selesai TANPA transfer nyata (diizinkan eksplisit)');
  } else {
    fail(
      'PAYOUT_PROVIDER',
      'local menandai payout "completed" tanpa memindahkan uang; pakai iris atau jalankan dengan --allow-local-payout bila ini memang uji internal'
    );
  }
} else {
  fail('PAYOUT_PROVIDER', `nilai tidak dikenal: "${payoutProvider}"`);
}

const threshold = value('REFUND_APPROVAL_THRESHOLD_IDR');
if (threshold && !/^\d+$/.test(threshold)) {
  fail('REFUND_APPROVAL_THRESHOLD_IDR', 'harus bilangan bulat rupiah');
} else {
  pass(`REFUND_APPROVAL_THRESHOLD_IDR=${threshold || '1000000 (default)'}`);
}

// --- direktori unggahan
for (const name of ['UPLOAD_DIR', 'PRIVATE_UPLOAD_DIR']) {
  if (!value(name)) fail(name, 'wajib diisi');
  else pass(`${name} diisi`);
}
if (
  value('UPLOAD_DIR') &&
  value('PRIVATE_UPLOAD_DIR') &&
  value('UPLOAD_DIR') === value('PRIVATE_UPLOAD_DIR')
) {
  fail('PRIVATE_UPLOAD_DIR', 'tidak boleh sama dengan UPLOAD_DIR (KTP tidak untuk publik)');
}

// --- compose (opsional, hanya dicek bila memakai docker-compose.prod.yml)
if (existsSync(resolve(process.cwd(), 'docker-compose.prod.yml'))) {
  if (!value('POSTGRES_PASSWORD')) {
    warn('POSTGRES_PASSWORD', 'kosong: docker-compose.prod.yml akan menolak start');
  } else if (value('POSTGRES_PASSWORD').length < 16) {
    warn('POSTGRES_PASSWORD', 'kurang dari 16 karakter');
  } else pass('POSTGRES_PASSWORD diisi');
}

/* --------------------------------------------------------- cek migrasi DB */

const migrationsDir = resolve(process.cwd(), 'db', 'migrations');
const onDisk = existsSync(migrationsDir)
  ? readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.replace(/\.sql$/, ''))
      .sort()
  : [];

if (checkDb) {
  if (!databaseUrl) {
    fail('--db', 'butuh DATABASE_URL yang valid');
  } else {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 8000 });
    try {
      await client.connect();
      const applied = await client.query(
        'SELECT version FROM schema_migrations ORDER BY version'
      );
      const appliedVersions = applied.rows.map((row) => row.version);
      const pending = onDisk.filter((version) => !appliedVersions.includes(version));
      if (pending.length > 0) {
        fail('migrasi', `belum diterapkan: ${pending.join(', ')} — jalankan npm run migrate`);
      } else {
        pass(`migrasi lengkap (${appliedVersions.length}/${onDisk.length})`);
      }
    } catch (error) {
      fail('database', `tidak bisa diperiksa: ${error.message}`);
    } finally {
      await client.end().catch(() => {});
    }
  }
} else if (onDisk.length > 0) {
  warn('migrasi', `tidak diperiksa ke database; jalankan dengan --db (${onDisk.length} file di disk)`);
}

/* ------------------------------------------------------------- laporan */

const line = (tag, message) => `${tag.padEnd(5)} ${message}`;
for (const item of passes) console.log(line('PASS', item));
for (const item of warnings) console.log(line('WARN', item));
for (const item of errors) console.log(line('FAIL', item));

console.log(
  `\nRINGKASAN: ${passes.length} lulus, ${warnings.length} peringatan, ${errors.length} gagal`
);
if (errors.length > 0) {
  console.log('Perbaiki item FAIL di atas sebelum deploy. Lihat docs/DEPLOYMENT.md.');
  process.exitCode = 1;
}
