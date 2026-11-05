/**
 * Private KTP storage (FR-003).
 *
 * Security properties:
 * - Files live under `PRIVATE_UPLOAD_DIR`, never under the public `/v1/media`
 *   directory and never inside a directory served by the API.
 * - Bytes are encrypted with AES-256-GCM before they touch disk:
 *   IV (12 bytes) || auth tag (16 bytes) || ciphertext.
 * - The key comes from `KTP_ENCRYPTION_KEY` (base64 32 bytes). In production a
 *   missing key aborts startup; in development/test a key is derived from
 *   `JWT_SECRET` so local data is still not plaintext.
 * - File and directory permissions are 0600/0700 on POSIX.
 * - Object keys are scoped to `ktp/<userId>/` and path traversal is rejected.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { AppError } from '@tarlink/core/errors';
import { loadConfig } from '@tarlink/core/config';
import { extensionFor, type UploadedImage } from '@tarlink/modules/vendor-portal';

export const MAX_KTP_BYTES = 5 * 1024 * 1024;

const KTP_KEY_PATTERN = /^ktp\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function ktpKeyPrefix(userId: string): string {
  return `ktp/${userId}/`;
}

function parseExplicitKey(value: string): Buffer {
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new AppError(
      'INTERNAL_ERROR',
      `KTP_ENCRYPTION_KEY harus base64 dari ${KEY_BYTES} byte. Buat dengan: openssl rand -base64 32`
    );
  }
  return key;
}

@Injectable()
export class KtpStorageService implements OnModuleInit {
  private readonly root: string;
  private readonly key: Buffer;

  constructor() {
    const cfg = loadConfig();
    this.root = resolve(process.cwd(), cfg.PRIVATE_UPLOAD_DIR);

    const explicit = process.env.KTP_ENCRYPTION_KEY?.trim();
    if (explicit) {
      this.key = parseExplicitKey(explicit);
    } else if (cfg.NODE_ENV === 'production') {
      throw new AppError(
        'INTERNAL_ERROR',
        'KTP_ENCRYPTION_KEY wajib diisi di production. KTP tidak boleh disimpan tanpa enkripsi.'
      );
    } else {
      // Development/test fallback: never plaintext, but not a production key.
      this.key = createHash('sha256')
        .update(`tarlink-dev-ktp:${cfg.JWT_SECRET}`)
        .digest();
    }
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    // Tighten an existing directory too; chmod is a no-op/throws on Windows.
    await fs.chmod(this.root, 0o700).catch(() => undefined);
  }

  async save(
    userId: string,
    file: UploadedImage | undefined
  ): Promise<{ objectKey: string }> {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Foto KTP wajib diunggah');
    }
    if (file.buffer.length > MAX_KTP_BYTES) {
      throw new AppError('VALIDATION_ERROR', 'Ukuran foto KTP maksimal 5 MB');
    }

    // Validate the real image type before encrypting: the magic bytes are only
    // readable on the plaintext.
    const extension = extensionFor(file.buffer);
    const objectKey = `${ktpKeyPrefix(userId)}${randomUUID()}.${extension}`;
    const path = this.resolvePath(objectKey);

    await fs.mkdir(resolve(this.root, 'ktp', userId), { recursive: true, mode: 0o700 });
    await fs.writeFile(path, this.encrypt(file.buffer), { mode: 0o600 });

    return { objectKey };
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await fs.stat(this.resolvePath(objectKey));
      return true;
    } catch {
      return false;
    }
  }

  /** Decrypts the file in memory (max 5 MB) and returns it for the admin route. */
  async read(objectKey: string): Promise<{ buffer: Buffer; mime: string; size: number }> {
    const path = this.resolvePath(objectKey);
    const mime = MIME_BY_EXTENSION[extname(objectKey).slice(1)];
    if (!mime) throw new AppError('NOT_FOUND', 'Foto KTP tidak ditemukan');

    let payload: Buffer;
    try {
      payload = await fs.readFile(path);
    } catch {
      throw new AppError('NOT_FOUND', 'Foto KTP tidak ditemukan');
    }

    const buffer = this.decrypt(payload);
    return { buffer, mime, size: buffer.length };
  }

  /**
   * NIK uses the same key ring as the KTP file but a separate payload:
   * `nik_ciphertext` is IV || tag || ciphertext, exactly like the file bytes.
   */
  encryptNik(nik: string): { ciphertext: Buffer; keyId: string } {
    return { ciphertext: this.encrypt(Buffer.from(nik, 'utf8')), keyId: 'ktp-v1' };
  }

  decryptNik(payload: Buffer): string {
    return this.decrypt(payload).toString('utf8');
  }

  /** Best-effort removal used when an application is rejected or an account is deleted. */
  async remove(objectKey: string): Promise<void> {
    if (!KTP_KEY_PATTERN.test(objectKey)) return;
    await fs.rm(this.resolvePath(objectKey), { force: true });
  }

  private resolvePath(objectKey: string): string {
    if (!KTP_KEY_PATTERN.test(objectKey)) {
      throw new AppError('NOT_FOUND', 'Foto KTP tidak ditemukan');
    }
    const path = resolve(this.root, objectKey);
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new AppError('NOT_FOUND', 'Foto KTP tidak ditemukan');
    }
    return path;
  }

  private encrypt(plaintext: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  private decrypt(payload: Buffer): Buffer {
    if (payload.length <= IV_BYTES + TAG_BYTES) {
      throw new AppError('INTERNAL_ERROR', 'Foto KTP tersimpan rusak atau tidak lengkap.');
    }
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new AppError(
        'INTERNAL_ERROR',
        'Foto KTP tidak bisa didekripsi. Kunci enkripsi tidak cocok dengan data tersimpan.'
      );
    }
  }
}
