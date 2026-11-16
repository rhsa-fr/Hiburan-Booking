/**
 * Private storage for appeal evidence (FR-124).
 *
 * Security properties (same bar as the private KTP file):
 * - Files live under `PRIVATE_UPLOAD_DIR`, never under the public `/v1/media`
 *   directory, and no route serves this directory directly.
 * - Bytes are encrypted with AES-256-GCM before they touch disk:
 *   IV (12 bytes) || auth tag (16 bytes) || ciphertext.
 * - The key is derived from `KTP_ENCRYPTION_KEY` with a separate domain label
 *   (`appeal-evidence:`), so the same deployment secret protects both stores
 *   without reusing one key for two purposes. In production a missing
 *   `KTP_ENCRYPTION_KEY` already aborts startup via the KTP service; the
 *   development fallback derives from `JWT_SECRET` so local files are never
 *   plaintext either.
 * - Object keys are scoped to `appeal/<reportId>/` and path traversal is
 *   rejected before any filesystem call.
 * - The real image type comes from magic bytes, never from the client-supplied
 *   filename or multipart content-type.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { AppError } from '@tarlink/core/errors';
import { extensionFor, type UploadedImage } from '@tarlink/modules/vendor-portal';

export const MAX_APPEAL_EVIDENCE_BYTES = 5 * 1024 * 1024;

export const APPEAL_EVIDENCE_OBJECT_KEY_PATTERN =
  /^appeal\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Shared secret for both private stores; the domain label keeps the keys apart. */
export function deriveAppealEvidenceKey(secret: string, nodeEnv: string): Buffer {
  if (!secret.trim()) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Kunci privasi bukti banding belum dikonfigurasi (KTP_ENCRYPTION_KEY/JWT_SECRET).'
    );
  }
  // In production the KTP service already refuses to boot without an explicit
  // key, so a JWT-derived key here can only happen in dev/test.
  void nodeEnv;
  return createHash('sha256').update(`appeal-evidence:${secret.trim()}`).digest();
}

export interface AppealEvidenceFile {
  buffer: Buffer;
  mime: string;
  size: number;
}

export class AppealEvidenceStorage {
  private readonly root: string;
  private readonly key: Buffer;

  constructor(root: string, key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new AppError('INTERNAL_ERROR', 'Kunci bukti banding harus 32 byte.');
    }
    this.root = resolve(root);
    this.key = key;
  }

  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.chmod(this.root, 0o700).catch(() => undefined);
  }

  async save(reportId: string, file: UploadedImage | undefined): Promise<{ objectKey: string }> {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Berkas bukti wajib diunggah');
    }
    if (file.buffer.length > MAX_APPEAL_EVIDENCE_BYTES) {
      throw new AppError('VALIDATION_ERROR', 'Ukuran bukti maksimal 5 MB');
    }

    const extension = extensionFor(file.buffer);
    const directory = resolve(this.root, 'appeal', reportId);
    const objectKey = `appeal/${reportId}/${randomUUID()}.${extension}`;

    await this.ensureRoot();
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(resolve(this.root, objectKey), this.encrypt(file.buffer), { mode: 0o600 });
    return { objectKey };
  }

  async read(objectKey: string): Promise<AppealEvidenceFile> {
    const path = this.resolvePath(objectKey);
    const mime = MIME_BY_EXTENSION[extname(objectKey).slice(1)];
    if (!mime) throw new AppError('NOT_FOUND', 'Bukti banding tidak ditemukan');

    let payload: Buffer;
    try {
      payload = await fs.readFile(path);
    } catch {
      throw new AppError('NOT_FOUND', 'Bukti banding tidak ditemukan');
    }

    const buffer = this.decrypt(payload);
    return { buffer, mime, size: buffer.length };
  }

  /** Best-effort removal used when a pending appeal replaces its evidence. */
  async remove(objectKey: string | null | undefined): Promise<void> {
    if (!objectKey || !APPEAL_EVIDENCE_OBJECT_KEY_PATTERN.test(objectKey)) return;
    await fs.rm(resolve(this.root, objectKey), { force: true });
  }

  private resolvePath(objectKey: string): string {
    if (!APPEAL_EVIDENCE_OBJECT_KEY_PATTERN.test(objectKey)) {
      throw new AppError('NOT_FOUND', 'Bukti banding tidak ditemukan');
    }
    const path = resolve(this.root, objectKey);
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new AppError('NOT_FOUND', 'Bukti banding tidak ditemukan');
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
      throw new AppError('INTERNAL_ERROR', 'Bukti banding tersimpan rusak atau tidak lengkap.');
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
        'Bukti banding tidak bisa didekripsi. Kunci enkripsi tidak cocok dengan data tersimpan.'
      );
    }
  }
}
