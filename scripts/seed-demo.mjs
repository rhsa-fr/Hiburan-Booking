/**
 * Menanam data demo lokal yang dibutuhkan E2E mobile dan review visual.
 *
 * Ini BUKAN seed produksi: semua akun memakai satu kata sandi yang sama dan
 * hanya untuk mesin pengembang. Aman dijalankan berulang (idempoten) karena
 * setiap baris dicocokkan lewat email, slug, atau kode.
 *
 * Pemakaian:
 *   node scripts/seed-demo.mjs
 *   node scripts/seed-demo.mjs --password "Tarlink#2026!"
 *   node scripts/seed-demo.mjs --force          (wajib bila NODE_ENV=production)
 *
 * Butuh DATABASE_URL (dibaca dari .env).
 *
 * Yang dibuat:
 *   - pelanggan : rina.ayu@tarlink.id, qa.b2.520274@tarlink.id
 *   - vendor    : vendor@tarlink.id (owner)
 *   - 6 vendor approved+active + satu paket full-day + kalender 60 hari
 *   - foto panggung asli (Wikimedia Commons/Unsplash) yang disajikan lewat /v1/media
 *   - booking BK-261021-34E0 dan BK-261028-33D9 (confirmed + DP lunas)
 *   - satu notifikasi in-app belum dibaca untuk rina.ayu
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;
const DEFAULT_PASSWORD = 'Tarlink#2026!';
const CALENDAR_DAYS = 60;

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const CUSTOMERS = [
  { email: 'rina.ayu@tarlink.id', phone: '6281200000001', name: 'Rina Ayu' },
  { email: 'qa.b2.520274@tarlink.id', phone: '6281200000002', name: 'QA B2 520274' }
];

const VENDOR_ACCOUNT = {
  email: 'vendor@tarlink.id',
  phone: '6281200000003',
  name: 'Dedi Kurniawan'
};

const FULL_DAY_PACKAGE = {
  name: 'Paket Full Day 12 Jam',
  duration: 720
};

const UNSPLASH_LICENSE = 'Foto demo: Unsplash, lisensi Unsplash (bebas pakai)';

const VENDORS = [
  {
    slug: 'tarling-sinar-remaja',
    displayName: 'Tarling Sinar Remaja',
    legalName: 'CV Sinar Remaja',
    regionCode: '3212',
    address: 'Jl. Pantura No. 12, Indramayu',
    location: [108.3244, -6.3271],
    description:
      'Grup tarling dangdut untuk hajatan, khitanan, dan acara keluarga. ' +
      'Personel lengkap dengan sound system dan panggung.',
    category: 'tarling',
    extraCategory: 'organ-tunggal',
    packages: [{ ...FULL_DAY_PACKAGE, price: 5_000_000, personnel: 10 }],
    media: {
      banner: {
        source: 'tarling-stage.jpg',
        key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg',
        license: 'CC BY 3.0 - Sakurai Midori, Wikimedia Commons'
      },
      avatar: {
        source: 'tarling-2.jpg',
        key: '22222222-2222-4222-8222-222222222222.jpg',
        license: UNSPLASH_LICENSE
      },
      gallery: [
        {
          source: 'tarling-2.jpg',
          key: '22222222-2222-4222-8222-222222222222.jpg',
          license: UNSPLASH_LICENSE
        }
      ]
    }
  },
  {
    slug: 'putra-dermayu-tarling',
    displayName: 'Putra Dermayu Tarling Group',
    legalName: 'Putra Dermayu',
    regionCode: '3212',
    address: 'Jl. Dermayu No. 5, Indramayu',
    location: [108.33, -6.34],
    description:
      'Grup tarling putra daerah Dermayu untuk hajatan dan acara keluarga.',
    category: 'tarling',
    extraCategory: null,
    packages: [{ ...FULL_DAY_PACKAGE, price: 6_000_000, personnel: 12 }],
    media: {
      banner: {
        source: 'campursari.jpg',
        key: 'ffffffff-ffff-4fff-8fff-ffffffffffff.jpg',
        license: 'CC BY 4.0 - Komengskuy, Wikimedia Commons'
      },
      avatar: {
        source: 'tarling-2.jpg',
        key: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg',
        license: UNSPLASH_LICENSE
      },
      gallery: []
    }
  },
  {
    slug: 'organ-tunggal-barokah',
    displayName: 'Organ Tunggal Barokah',
    legalName: 'Barokah Musik',
    regionCode: '3209',
    address: 'Jl. Raya Cirebon No. 88, Cirebon',
    location: [108.556, -6.7063],
    description:
      'Organ tunggal dengan penyanyi dan MC untuk acara pernikahan dan syukuran.',
    category: 'organ-tunggal',
    extraCategory: null,
    packages: [{ ...FULL_DAY_PACKAGE, price: 5_500_000, personnel: 8 }],
    media: {
      banner: {
        source: 'organ-band.png',
        key: '33333333-3333-4333-8333-333333333333.png',
        license: 'CC0 — Simon Høeg Jensen, Wikimedia Commons'
      },
      avatar: {
        source: 'organ-singer.jpg',
        key: '44444444-4444-4444-8444-444444444444.jpg',
        license: 'CC BY 2.0 — Mahbob Yusof, Wikimedia Commons'
      },
      gallery: [
        {
          source: 'organ-singer.jpg',
          key: '44444444-4444-4444-8444-444444444444.jpg',
          license: 'CC BY 2.0 — Mahbob Yusof, Wikimedia Commons'
        }
      ]
    }
  },
  {
    slug: 'sanggar-seni-sekar-arum',
    displayName: 'Sanggar Seni Sekar Arum',
    legalName: 'Sanggar Sekar Arum',
    regionCode: '3274',
    address: 'Jl. Siliwangi No. 4, Kota Cirebon',
    location: [108.5523, -6.732],
    description:
      'Sanggar seni tradisi: tari jaipong, kuda lumping, dan karawitan.',
    category: 'seni-tradisi',
    extraCategory: 'pendukung-acara',
    packages: [{ ...FULL_DAY_PACKAGE, price: 4_500_000, personnel: 12 }],
    media: {
      banner: {
        source: 'tari-cirebon.jpg',
        key: '12121212-1212-4212-8212-121212121212.jpg',
        license: 'CC BY-SA 4.0 - Rifki AW, Wikimedia Commons'
      },
      avatar: {
        source: 'jaipong.jpg',
        key: '13131313-1313-4313-8313-131313131313.jpg',
        license: 'CC BY-SA 3.0 - Gunawan Kartapranata, Wikimedia Commons'
      },
      gallery: [
        {
          source: 'jaipong.jpg',
          key: '13131313-1313-4313-8313-131313131313.jpg',
          license: 'CC BY-SA 3.0 - Gunawan Kartapranata, Wikimedia Commons'
        }
      ]
    }
  },
  {
    slug: 'wayang-kulit-ki-surya',
    displayName: 'Wayang Kulit Ki Surya',
    legalName: 'Sanggar Dalang Surya',
    regionCode: '3212',
    address: 'Jl. Raya Losarang No. 21, Indramayu',
    location: [108.25, -6.38],
    description:
      'Pagelaran wayang kulit semalam suntuk dengan dalang dan sinden ' +
      'untuk hajatan, syukuran, dan ruwatan.',
    category: 'seni-tradisi',
    extraCategory: null,
    packages: [{ ...FULL_DAY_PACKAGE, price: 4_000_000, personnel: 6 }],
    media: {
      banner: {
        source: 'wayang-1.jpg',
        key: '77777777-7777-4777-8777-777777777777.jpg',
        license: 'CC BY-SA 4.0 — FaizAttariqi, Wikimedia Commons'
      },
      avatar: {
        source: 'wayang-2.jpg',
        key: '88888888-8888-4888-8888-888888888888.jpg',
        license: 'CC BY-SA 4.0 — Candra Firmansyah, Wikimedia Commons'
      },
      gallery: [
        {
          source: 'wayang-2.jpg',
          key: '88888888-8888-4888-8888-888888888888.jpg',
          license: 'CC BY-SA 4.0 — Candra Firmansyah, Wikimedia Commons'
        }
      ]
    }
  },
  {
    slug: 'sandiwara-rakyat-dermayu',
    displayName: 'Sandiwara Rakyat Dermayu',
    legalName: 'Komunitas Sandiwara Dermayu',
    regionCode: '3212',
    address: 'Jl. Cimanuk No. 8, Indramayu',
    location: [108.32, -6.33],
    description:
      'Sandiwara tradisional Indramayu dengan pemain dan gamelan untuk ' +
      'hiburan rakyat, hajatan, dan acara desa.',
    category: 'seni-tradisi',
    extraCategory: null,
    packages: [{ ...FULL_DAY_PACKAGE, price: 3_500_000, personnel: 12 }],
    media: {
      banner: {
        source: 'sandiwara-1.jpg',
        key: '99999999-9999-4999-8999-999999999999.jpg',
        license: 'CC BY-SA 4.0 — Media Indramayu, Wikimedia Commons'
      },
      avatar: {
        source: 'sandiwara-2.jpg',
        key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
        license: 'CC BY-SA 4.0 — Media Indramayu, Wikimedia Commons'
      },
      gallery: [
        {
          source: 'sandiwara-2.jpg',
          key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
          license: 'CC BY-SA 4.0 — Media Indramayu, Wikimedia Commons'
        }
      ]
    }
  },
  {
    slug: 'singa-depok-putra-betawi',
    displayName: 'Singa Depok Putra Betawi',
    legalName: 'Sanggar Singa Depok',
    regionCode: '3276',
    address: 'Jl. Margonda Raya No. 10, Kota Depok',
    location: [106.83, -6.4],
    description:
      'Pertunjukan singa depok dengan pemain, musik, dan kostum untuk ' +
      'pawai, hajatan, dan acara budaya.',
    category: 'seni-tradisi',
    extraCategory: 'pendukung-acara',
    packages: [{ ...FULL_DAY_PACKAGE, price: 3_000_000, personnel: 14 }],
    media: {
      banner: {
        source: 'singa-depok.jpg',
        key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',
        license: 'CC BY-SA 4.0 — Wandy payz, Wikimedia Commons'
      },
      avatar: {
        source: 'singa-depok.jpg',
        key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',
        license: 'CC BY-SA 4.0 — Wandy payz, Wikimedia Commons'
      },
      gallery: [
        {
          source: 'singa-depok.jpg',
          key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',
          license: 'CC BY-SA 4.0 — Wandy payz, Wikimedia Commons'
        }
      ]
    }
  }
];

const BOOKINGS = [
  {
    code: 'BK-261021-34E0',
    eventCode: 'EV-DEMO-34E0',
    customerEmail: 'rina.ayu@tarlink.id',
    vendorSlug: 'organ-tunggal-barokah',
    packageName: 'Paket Full Day 12 Jam',
    title: 'Hajatan Pernikahan Rina & Bayu',
    venueName: 'Kediaman Keluarga Ayu',
    venueAddress: 'Jl. Raya Indramayu No. 12, rumah pagar hijau',
    guestEstimate: 150,
    notes: 'Tamu diharapkan hadir pukul 19.00.',
    daysFromNow: 10
  },
  {
    code: 'BK-261028-33D9',
    eventCode: 'EV-DEMO-33D9',
    customerEmail: 'rina.ayu@tarlink.id',
    vendorSlug: 'tarling-sinar-remaja',
    packageName: 'Paket Full Day 12 Jam',
    title: 'Syukuran Khitanan Adik Rina',
    venueName: 'Rumah Keluarga Ayu',
    venueAddress: 'Jl. Pantura No. 45, Indramayu',
    guestEstimate: 80,
    notes: 'Mohon konfirmasi sound system tambahan.',
    daysFromNow: 17
  }
];

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
  const out = { password: '', force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--password') out.password = argv[++i] ?? '';
    else if (arg === '--force') out.force = true;
  }
  return out;
}

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function isoDateFromNow(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function upsertUser(client, { email, phone, name }, passwordHash) {
  const existing = await client.query(
    `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email]
  );

  if (existing.rows[0]) {
    const id = existing.rows[0].id;
    await client.query(
      `UPDATE users
          SET name = $2,
              status = 'active',
              password_hash = $3,
              password_updated_at = now(),
              phone_verified_at = COALESCE(phone_verified_at, now())
        WHERE id = $1`,
      [id, name, passwordHash]
    );
    return { id, created: false };
  }

  const inserted = await client.query(
    `INSERT INTO users
       (phone, email, password_hash, password_updated_at, name, phone_verified_at, status)
     VALUES ($1, $2, $3, now(), $4, now(), 'active')
     RETURNING id`,
    [phone, email, passwordHash, name]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function grantCustomer(client, userId) {
  await client.query(
    `INSERT INTO user_roles (user_id, role, vendor_id, vendor_scope)
     VALUES ($1, 'customer'::user_role, NULL, $2::uuid)
     ON CONFLICT (user_id, role, vendor_scope) DO UPDATE SET revoked_at = NULL`,
    [userId, ZERO_UUID]
  );
}

async function upsertVendor(client, ownerId, vendor) {
  const existing = await client.query(`SELECT id FROM vendors WHERE slug = $1`, [vendor.slug]);
  const [lng, lat] = vendor.location;

  if (existing.rows[0]) {
    const id = existing.rows[0].id;
    await client.query(
      `UPDATE vendors
          SET owner_user_id = $2,
              region_code = $3,
              display_name = $4,
              legal_name = $5,
              description = $6,
              base_address = $7,
              base_location = ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
              service_radius_km = 25,
              free_radius_km = 5,
              transport_fee_per_km_idr = 5000,
              min_dp_bp = 3000,
              verification_status = 'approved',
              verified_at = COALESCE(verified_at, now()),
              verified_by = COALESCE(verified_by, $2),
              verification_note = NULL,
              is_active = true
        WHERE id = $1`,
      [
        id,
        ownerId,
        vendor.regionCode,
        vendor.displayName,
        vendor.legalName,
        vendor.description,
        vendor.address,
        lng,
        lat
      ]
    );
    return { id, created: false };
  }

  const inserted = await client.query(
    `INSERT INTO vendors
       (owner_user_id, region_code, slug, display_name, legal_name, description,
        base_address, base_location, service_radius_km, free_radius_km,
        transport_fee_per_km_idr, min_dp_bp, verification_status, verified_at, verified_by, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
             25, 5, 5000, 3000, 'approved', now(), $1, true)
     RETURNING id`,
    [
      ownerId,
      vendor.regionCode,
      vendor.slug,
      vendor.displayName,
      vendor.legalName,
      vendor.description,
      vendor.address,
      lng,
      lat
    ]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function replaceVendorCategories(client, vendorId, slugs) {
  const found = await client.query(
    `SELECT id, slug FROM categories WHERE slug = ANY($1::text[])`,
    [slugs]
  );
  const bySlug = new Map(found.rows.map((row) => [row.slug, row.id]));

  await client.query(`UPDATE vendor_categories SET is_primary = false WHERE vendor_id = $1`, [
    vendorId
  ]);
  await client.query(`DELETE FROM vendor_categories WHERE vendor_id = $1`, [vendorId]);

  for (const [index, slug] of slugs.entries()) {
    const categoryId = bySlug.get(slug);
    if (!categoryId) {
      throw new Error(`kategori tidak ditemukan: ${slug} (jalankan npm run migrate)`);
    }
    await client.query(
      `INSERT INTO vendor_categories (vendor_id, category_id, is_primary)
       VALUES ($1, $2, $3)
       ON CONFLICT (vendor_id, category_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`,
      [vendorId, categoryId, index === 0]
    );
  }
}

const SEED_MEDIA_DIR = path.resolve(process.cwd(), 'scripts/seed-media');

function uploadDir() {
  return path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'storage/uploads');
}

function mediaBaseUrl() {
  return (process.env.SEED_MEDIA_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
}

function publicMediaUrl(key) {
  return `${mediaBaseUrl()}/v1/media/${key}`;
}

async function ensureSeedRegions(client) {
  await client.query(
    `INSERT INTO regions (code, name, level, parent_code, is_active)
     VALUES ('3276', 'Kota Depok', 'city', '32', true)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true`
  );
}

/**
 * Foto demo asli (Wikimedia Commons/Unsplash) disalin ke UPLOAD_DIR dengan nama
 * UUID agar bisa disajikan `GET /v1/media/:filename`. Baris `vendor_media`
 * ditandai approved supaya konsisten dengan moderasi media, lalu kolom publik
 * vendor diisi dari URL yang sama.
 */
async function seedVendorMedia(client, vendorId, ownerId, media) {
  if (!media?.banner || !media?.avatar) return;
  const root = uploadDir();
  await mkdir(root, { recursive: true });

  const entries = [
    { ...media.banner, kind: 'banner' },
    { ...media.avatar, kind: 'avatar' },
    ...(media.gallery ?? []).map((item) => ({ ...item, kind: 'gallery' }))
  ];
  for (const entry of entries) {
    await copyFile(path.join(SEED_MEDIA_DIR, entry.source), path.join(root, entry.key));
  }

  await client.query(
    `UPDATE vendors
        SET avatar_url = $2,
            banner_url = $3,
            photo_urls = $4::text[],
            video_url = NULL
      WHERE id = $1`,
    [
      vendorId,
      publicMediaUrl(media.avatar.key),
      publicMediaUrl(media.banner.key),
      (media.gallery ?? []).map((item) => publicMediaUrl(item.key))
    ]
  );

  await client.query(
    `DELETE FROM vendor_media WHERE vendor_id = $1 AND review_note = 'seed-demo'`,
    [vendorId]
  );
  for (const entry of entries) {
    await client.query(
      `INSERT INTO vendor_media
         (vendor_id, kind, url, storage_key, license_statement, status,
          submitted_by, reviewed_by, reviewed_at, review_note)
       VALUES ($1, $2::media_kind, $3, $4, $5, 'approved', $6, $6, now(), 'seed-demo')`,
      [vendorId, entry.kind, publicMediaUrl(entry.key), entry.key, entry.license, ownerId]
    );
  }
}

async function upsertPackage(client, vendorId, pkg, createdAt) {
  const existing = await client.query(
    `SELECT id FROM packages WHERE vendor_id = $1 AND name = $2`,
    [vendorId, pkg.name]
  );
  const inclusions = JSON.stringify([
    'Sound system',
    'Panggung dan tata lampu',
    'Personel lengkap'
  ]);

  if (existing.rows[0]) {
    await client.query(
      `UPDATE packages
          SET duration_minutes = $3,
              personnel_count = $4,
              inclusions = $5::jsonb,
              base_price_idr = $6,
              is_active = true,
              created_at = $7
        WHERE id = $1 AND vendor_id = $2`,
      [existing.rows[0].id, vendorId, pkg.duration, pkg.personnel, inclusions, pkg.price, createdAt]
    );
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO packages
       (vendor_id, name, duration_minutes, personnel_count, inclusions, base_price_idr, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, true, $7)
     RETURNING id`,
    [vendorId, pkg.name, pkg.duration, pkg.personnel, inclusions, pkg.price, createdAt]
  );
  return inserted.rows[0].id;
}

/** day/night tersedia untuk CALENDAR_DAYS hari ke depan; slot yang sudah dibooking tidak disentuh. */
async function fillCalendar(client, vendorId, actorId) {
  await client.query(
    `INSERT INTO calendar_slots (vendor_id, date, session, status, source, updated_by)
     SELECT $1::uuid, d::date, s.session, 'available', 'vendor', $2::uuid
       FROM generate_series(CURRENT_DATE, CURRENT_DATE + $3::int, interval '1 day') AS d
       CROSS JOIN (VALUES ('day'), ('night')) AS s(session)
     ON CONFLICT (vendor_id, date, session) DO NOTHING`,
    [vendorId, actorId, CALENDAR_DAYS]
  );
  await client.query(`UPDATE vendors SET calendar_updated_at = now() WHERE id = $1`, [vendorId]);
}

async function currentPolicyId(client) {
  const result = await client.query(
    `SELECT id
       FROM policy_versions
      WHERE code = 'cancellation'
        AND is_active
        AND (effective_to IS NULL OR effective_to > now())
      ORDER BY effective_from DESC, created_at DESC
      LIMIT 1`
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error('policy_versions "cancellation" tidak ada — jalankan npm run migrate');
  }
  return id;
}

async function upsertBooking(client, spec, ctx) {
  const { customerId, policyId } = ctx;
  const vendor = ctx.vendors.get(spec.vendorSlug);
  if (!vendor) throw new Error(`vendor demo tidak ditemukan: ${spec.vendorSlug}`);

  const pkg = vendor.packages.find((item) => item.name === spec.packageName);
  if (!pkg) throw new Error(`paket ${spec.packageName} tidak ada di ${spec.vendorSlug}`);

  const slotDate = isoDateFromNow(spec.daysFromNow);
  const serviceFee = Number((BigInt(pkg.price) * 100n) / 10_000n);
  const total = pkg.price + serviceFee;
  const dp = Number((BigInt(pkg.price) * 30n) / 100n);

  const event = await client.query(
    `INSERT INTO events
       (code, customer_id, title, event_type, region_code, venue_name, venue_address,
        guest_estimate, notes, status, start_date, end_date)
     VALUES ($1, $2, $3, 'hajatan', $4, $5, $6, $7, $8, 'open', $9::date, $9::date)
     ON CONFLICT (code) DO UPDATE
        SET customer_id = EXCLUDED.customer_id,
            title = EXCLUDED.title,
            region_code = EXCLUDED.region_code,
            venue_name = EXCLUDED.venue_name,
            venue_address = EXCLUDED.venue_address,
            guest_estimate = EXCLUDED.guest_estimate,
            notes = EXCLUDED.notes
     RETURNING id`,
    [
      spec.eventCode,
      customerId,
      spec.title,
      vendor.regionCode,
      spec.venueName,
      spec.venueAddress,
      spec.guestEstimate,
      spec.notes,
      slotDate
    ]
  );
  const eventId = event.rows[0].id;

  const booking = await client.query(
    `INSERT INTO bookings
       (code, customer_id, vendor_id, event_id, package_id, policy_version_id,
        lifecycle_status, payment_status, settlement_status,
        price_package_idr, price_addons_idr, price_transport_idr, service_fee_idr, discount_idr,
        total_customer_idr, dp_amount_idr,
        respond_deadline, payment_deadline,
        scheduled_start_at, scheduled_end_at,
        confirmed_at, row_version)
     VALUES ($1, $2, $3, $4, $5, $6,
             'confirmed', 'dp_paid', 'held',
             $7, 0, 0, $8, 0,
             $9, $10,
             now() - interval '2 days', now() + interval '1 day',
             ($11::date + time '19:00') AT TIME ZONE 'Asia/Jakarta',
             ($11::date + time '19:00' + interval '6 hours') AT TIME ZONE 'Asia/Jakarta',
             now() - interval '2 days', 2)
     ON CONFLICT (code) DO UPDATE
        SET customer_id = EXCLUDED.customer_id,
            vendor_id = EXCLUDED.vendor_id,
            event_id = EXCLUDED.event_id,
            package_id = EXCLUDED.package_id,
            policy_version_id = EXCLUDED.policy_version_id,
            lifecycle_status = EXCLUDED.lifecycle_status,
            payment_status = EXCLUDED.payment_status,
            settlement_status = EXCLUDED.settlement_status,
            price_package_idr = EXCLUDED.price_package_idr,
            service_fee_idr = EXCLUDED.service_fee_idr,
            total_customer_idr = EXCLUDED.total_customer_idr,
            dp_amount_idr = EXCLUDED.dp_amount_idr,
            payment_deadline = EXCLUDED.payment_deadline,
            confirmed_at = COALESCE(bookings.confirmed_at, EXCLUDED.confirmed_at)
     RETURNING id`,
    [
      spec.code,
      customerId,
      vendor.id,
      eventId,
      pkg.id,
      policyId,
      pkg.price,
      serviceFee,
      total,
      dp,
      slotDate
    ]
  );
  const bookingId = booking.rows[0].id;

  // Tanggal slot yang sudah ada dipertahankan agar seed ulang tidak memindahkan
  // kalender yang mungkin sudah dipakai tes lain.
  const existingSlot = await client.query(
    `SELECT date::text AS date FROM booking_slots WHERE booking_id = $1 ORDER BY date ASC LIMIT 1`,
    [bookingId]
  );
  const bookedDate = existingSlot.rows[0]?.date ?? slotDate;

  await client.query(
    `INSERT INTO booking_slots
       (booking_id, vendor_id, date, session, session_span, start_time, end_time, is_blocking)
     VALUES ($1, $2, $3::date, 'day', int4range(1, 2), '09:00', '15:00', true)
     ON CONFLICT (booking_id, date, session) DO NOTHING`,
    [bookingId, vendor.id, bookedDate]
  );

  await client.query(
    `INSERT INTO calendar_slots (vendor_id, date, session, status, source, booking_id, updated_by)
     VALUES ($1, $2::date, 'day', 'booked', 'vendor', $3, $4)
     ON CONFLICT (vendor_id, date, session) DO UPDATE
        SET status = 'booked',
            booking_id = EXCLUDED.booking_id
      WHERE calendar_slots.status IN ('available', 'blocked')
         OR calendar_slots.booking_id = EXCLUDED.booking_id`,
    [vendor.id, bookedDate, bookingId, customerId]
  );

  const providerRef = `DEMO-DP-${spec.code}`;
  await client.query(
    `INSERT INTO payments
       (booking_id, kind, method, amount_idr, status, provider, provider_ref,
        fee_idr, expires_at, paid_at)
     VALUES ($1, 'dp', 'va_bca', $2, 'paid', 'midtrans', $3, 0,
             now() - interval '2 days', now() - interval '2 days')
     ON CONFLICT (provider, provider_ref) DO UPDATE
        SET booking_id = EXCLUDED.booking_id,
            amount_idr = EXCLUDED.amount_idr,
            status = 'paid',
            paid_at = EXCLUDED.paid_at`,
    [bookingId, dp, providerRef]
  );

  const history = [
    ['requested', 'accepted', 'vendor_accepted'],
    ['accepted', 'confirmed', 'dp_paid']
  ];
  for (const [from, to, event] of history) {
    await client.query(
      `INSERT INTO booking_status_history
         (booking_id, axis, from_state, to_state, event, actor_id, actor_role)
       SELECT $1::uuid, 'lifecycle'::status_axis, $2::varchar(30), $3::varchar(30),
              $4::varchar(50), $5::uuid, 'customer'::user_role
        WHERE NOT EXISTS (
          SELECT 1 FROM booking_status_history
           WHERE booking_id = $1::uuid
             AND axis = 'lifecycle'::status_axis
             AND to_state = $3::varchar(30)
        )`,
      [bookingId, from, to, event, customerId]
    );
  }

  return { id: bookingId, code: spec.code, date: bookedDate, total, dp };
}

async function seedNotification(client, userId, bookingCode, title, body) {
  await client.query(
    `INSERT INTO notifications (user_id, type, title, body, payload, dedupe_key)
     VALUES ($1::uuid, 'booking_confirmed', $2::text, $3::text,
             jsonb_build_object('booking_code', $4::text), $5::text)
     ON CONFLICT (dedupe_key) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            payload = EXCLUDED.payload,
            read_at = NULL,
            created_at = now()`,
    [userId, title, body, bookingCode, `seed-demo:${bookingCode}`]
  );
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  if (process.env.NODE_ENV === 'production' && !args.force) {
    throw new Error('NODE_ENV=production: tambahkan --force bila benar-benar disengaja');
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL tidak ditemukan (buat .env)');

  const password = args.password || DEFAULT_PASSWORD;
  if (password.length < 8) throw new Error('--password minimal 8 karakter');
  const passwordHash = hashPassword(password);

  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureSeedRegions(client);

    const customers = new Map();
    for (const customer of CUSTOMERS) {
      const { id } = await upsertUser(client, customer, passwordHash);
      await grantCustomer(client, id);
      customers.set(customer.email, id);
    }

    const { id: ownerId } = await upsertUser(client, VENDOR_ACCOUNT, passwordHash);

    const vendors = new Map();
    for (const [index, vendorSpec] of VENDORS.entries()) {
      const { id: vendorId, created } = await upsertVendor(client, ownerId, vendorSpec);

      await client.query(
        `INSERT INTO user_roles (user_id, role, vendor_id, vendor_scope)
         VALUES ($1, 'vendor_owner'::user_role, $2, $2)
         ON CONFLICT (user_id, role, vendor_scope) DO UPDATE SET revoked_at = NULL`,
        [ownerId, vendorId]
      );

      const categories = [vendorSpec.category, vendorSpec.extraCategory].filter(Boolean);
      await replaceVendorCategories(client, vendorId, categories);
      await seedVendorMedia(client, vendorId, ownerId, vendorSpec.media);

      const packages = [];
      for (const [pkgIndex, pkg] of vendorSpec.packages.entries()) {
        // created_at eksplisit dan unik: urutan paket menjadi deterministik
        // (paket pertama = "Paket Lengkap 6 Jam" senilai Rp5.000.000).
        const createdAt = new Date(Date.now() - (VENDORS.length - index) * 60_000 + pkgIndex * 1_000);
        const id = await upsertPackage(client, vendorId, pkg, createdAt);
        packages.push({ ...pkg, id });
      }

      // Satu vendor = satu grup dengan satu paket full-day. Paket lama dari
      // seed versi sebelumnya dinonaktifkan, bukan dihapus (ada FK booking).
      if (vendorSpec.packages[0]) {
        await client.query(
          `UPDATE packages SET is_active = false
            WHERE vendor_id = $1 AND name <> $2`,
          [vendorId, vendorSpec.packages[0].name]
        );
      }

      await fillCalendar(client, vendorId, ownerId);
      vendors.set(vendorSpec.slug, {
        id: vendorId,
        regionCode: vendorSpec.regionCode,
        packages,
        created
      });
    }

    const policyId = await currentPolicyId(client);
    const seededBookings = [];
    for (const spec of BOOKINGS) {
      const customerId = customers.get(spec.customerEmail);
      if (!customerId) throw new Error(`pelanggan demo tidak ditemukan: ${spec.customerEmail}`);
      const result = await upsertBooking(client, spec, { customerId, policyId, vendors });
      seededBookings.push(result);
    }

    const rinaId = customers.get('rina.ayu@tarlink.id');
    const newest = seededBookings[seededBookings.length - 1];
    await seedNotification(
      client,
      rinaId,
      newest.code,
      'DP diterima, jadwal dikunci',
      `Pembayaran DP booking ${newest.code} sudah masuk. Jadwal vendor terkunci.`
    );

    await client.query('COMMIT');

    console.log('seed demo selesai.');
    console.log(`pelanggan : ${CUSTOMERS.map((item) => item.email).join(', ')}`);
    console.log(`vendor    : ${VENDOR_ACCOUNT.email}`);
    console.log(`kata sandi: ${password}`);
    console.log(`booking   : ${seededBookings.map((item) => item.code).join(', ')}`);
    console.log(`kalender  : ${CALENDAR_DAYS} hari ke depan untuk ${VENDORS.length} vendor`);
    console.log('notifikasi: 1 belum dibaca untuk rina.ayu@tarlink.id');
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
