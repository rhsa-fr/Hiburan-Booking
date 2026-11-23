#!/usr/bin/env node
/**
 * Menyusun `latest.json` untuk pembaruan APK di dalam aplikasi (Android).
 *
 * Skrip ini TIDAK mengunggah apa pun dan tidak memegang kredensial. Ia hanya
 * membaca APK yang sudah dibangun, menghitung sha256 + ukuran, lalu menulis
 * manifest yang dibaca aplikasi dari bucket publik.
 *
 * Pemakaian:
 *   node scripts/publish-apk.mjs <dir-apk> --version 1.0.3 --build 4 \
 *     --base-url https://<project>.supabase.co/storage/v1/object/public/app-releases \
 *     [--min-build 0] [--notes "…"] [--out latest.json]
 *
 * Nama berkas harus memuat ABI, mis. `tarlink-1.0.3-arm64-v8a.apk`
 * (workflow android-release sudah memakai pola itu).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64'];

function parseArgs(argv) {
  const args = { minBuild: 0, notes: '', out: 'latest.json' };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`nilai untuk --${key} tidak ada`);
    }
    i += 1;
    switch (key) {
      case 'version':
        args.version = value;
        break;
      case 'build':
        args.build = Number(value);
        break;
      case 'min-build':
        args.minBuild = Number(value);
        break;
      case 'notes':
        args.notes = value;
        break;
      case 'base-url':
        args.baseUrl = value.replace(/\/+$/, '');
        break;
      case 'out':
        args.out = value;
        break;
      default:
        throw new Error(`opsi tidak dikenal: --${key}`);
    }
  }
  args.dir = positional[0];
  if (!args.dir) throw new Error('direktori APK wajib diisi');
  if (!args.version || !/^\d+\.\d+\.\d+$/.test(args.version)) {
    throw new Error('--version harus semver, mis. 1.0.3');
  }
  if (!Number.isInteger(args.build) || args.build <= 0) {
    throw new Error('--build harus bilangan bulat > 0');
  }
  if (!Number.isInteger(args.minBuild) || args.minBuild < 0) {
    throw new Error('--min-build harus bilangan bulat >= 0');
  }
  if (!args.baseUrl || !/^https:\/\//.test(args.baseUrl)) {
    throw new Error('--base-url wajib https://');
  }
  if (args.notes.length > 500) throw new Error('--notes maksimal 500 karakter');
  return args;
}

async function sha256(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

function abiOf(fileName) {
  return ABIS.find((abi) => fileName.includes(`-${abi}.apk`) || fileName === `${abi}.apk`) ?? null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.dir);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.apk'));

  const artifacts = [];
  for (const name of files.sort()) {
    const abi = abiOf(name);
    if (!abi) {
      console.warn(`lewati ${name}: ABI tidak dikenali (harus salah satu dari ${ABIS.join(', ')})`);
      continue;
    }
    const path = resolve(dir, name);
    const size = (await stat(path)).size;
    if (size <= 0) throw new Error(`${name} kosong`);
    artifacts.push({
      abi,
      apk_url: `${args.baseUrl}/${encodeURIComponent(name)}`,
      sha256: await sha256(path),
      size_bytes: size,
    });
  }

  if (artifacts.length === 0) {
    throw new Error(`tidak ada APK ber-ABI dikenali di ${dir}`);
  }

  artifacts.sort((a, b) => ABIS.indexOf(a.abi) - ABIS.indexOf(b.abi));

  const manifest = {
    schema: 1,
    version: args.version,
    build_number: args.build,
    min_supported_build: args.minBuild,
    published_at: new Date().toISOString(),
    notes: args.notes,
    artifacts,
  };

  const out = resolve(args.dir, args.out);
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`manifest: ${out}`);
  for (const artifact of artifacts) {
    console.log(
      `  ${artifact.abi.padEnd(12)} ${String(artifact.size_bytes).padStart(10)} B  ${artifact.sha256}`,
    );
  }
}

main().catch((error) => {
  console.error(`gagal: ${error.message}`);
  process.exit(1);
});
