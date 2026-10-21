/**
 * Membuat / memperbarui satu akun admin secara eksplisit.
 *
 * Admin memakai email + password. Vendor & pelanggan tetap memakai nomor HP +
 * OTP WhatsApp, jadi tidak ada akun default yang ditanam lewat migrasi.
 *
 * Pemakaian:
 *   node scripts/seed-admin.mjs --email admin@tarlink.id --password "RahasiaKuat123" --role admin_super
 *   node scripts/seed-admin.mjs --email admin@tarlink.id            (password dibuat acak)
 *
 * Butuh DATABASE_URL (dibaca dari .env).
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

function loadEnv() {
  const file = path.resolve(process.cwd(), '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const out = { email: '', password: '', phone: '', role: 'admin_super', force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--email') out.email = argv[++i] ?? '';
    else if (arg === '--password') out.password = argv[++i] ?? '';
    else if (arg === '--phone') out.phone = argv[++i] ?? '';
    else if (arg === '--role') out.role = argv[++i] ?? 'admin_super';
    else if (arg === '--force') out.force = true;
  }
  return out;
}

const ALLOWED_ROLES = new Set(['admin_support', 'admin_finance', 'admin_super']);

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function randomPassword() {
  return randomBytes(12).toString('base64url');
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const email = args.email.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    throw new Error('--email wajib diisi, contoh: --email admin@tarlink.id');
  }
  if (!ALLOWED_ROLES.has(args.role)) {
    throw new Error(`--role harus salah satu: ${[...ALLOWED_ROLES].join(', ')}`);
  }
  if (process.env.NODE_ENV === 'production' && !args.force) {
    throw new Error('NODE_ENV=production: tambahkan --force bila benar-benar disengaja');
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL tidak ditemukan (buat .env)');

  const password = args.password || randomPassword();
  if (password.length < 8) throw new Error('--password minimal 8 karakter');

  // users.phone NOT NULL: admin tetap butuh nilai, dipakai sebagai placeholder
  // yang tidak bisa dihubungi (bukan kanal login admin).
  const phone = args.phone || `62${Date.now().toString().slice(-10)}`;

  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [email]
    );

    let userId = existing.rows[0]?.id;
    if (userId) {
      await client.query(
        `UPDATE users
            SET email = $2, password_hash = $3, password_updated_at = now(), status = 'active'
          WHERE id = $1`,
        [userId, email, hashPassword(password)]
      );
      console.log(`admin diperbarui: ${userId} (${email})`);
    } else {
      const inserted = await client.query(
        `INSERT INTO users (phone, email, password_hash, password_updated_at, status)
         VALUES ($1, $2, $3, now(), 'active')
         RETURNING id`,
        [phone, email, hashPassword(password)]
      );
      userId = inserted.rows[0].id;
      console.log(`admin dibuat: ${userId} (${email})`);
    }

    await client.query(
      `INSERT INTO user_roles (user_id, role, vendor_id, vendor_scope)
       VALUES ($1, $2, NULL, '00000000-0000-0000-0000-000000000000')
       ON CONFLICT (user_id, role, vendor_scope) DO UPDATE SET revoked_at = NULL`,
      [userId, args.role]
    );

    // Password baru = sesi lama tidak boleh tetap hidup.
    await client.query(
      `UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1`,
      [userId]
    );

    await client.query('COMMIT');

    console.log(`peran aktif: ${args.role}`);
    console.log(`email      : ${email}`);
    console.log(`password   : ${password}`);
    console.log('\nLogin di http://localhost:3002/login dengan email + password di atas.');
    if (!args.password) {
      console.log('(password dibuat acak — simpan sekarang, tidak ditampilkan lagi)');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error('GAGAL:', error.message);
  process.exit(1);
});
