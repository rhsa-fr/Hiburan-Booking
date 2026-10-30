import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { Request } from 'express';
import { AppError } from '@tarlink/core/errors';
import { loadConfig } from '@tarlink/core/config';

export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
}

const MAX_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Detect the real image type from magic bytes. Never trust the multipart
 * content-type or the client-supplied extension: both are attacker-controlled.
 */
export function extensionFor(buffer: Buffer): 'jpg' | 'png' | 'webp' {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  throw new AppError('VALIDATION_ERROR', 'File harus berupa gambar JPG, PNG, atau WebP');
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

export const MEDIA_FILENAME_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly root: string;

  constructor() {
    const cfg = loadConfig();
    this.root = resolve(process.cwd(), cfg.UPLOAD_DIR);
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }

  async save(
    file: UploadedImage | undefined,
    request: Pick<Request, 'protocol' | 'get'>
  ): Promise<{ url: string; filename: string }> {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'File gambar wajib diunggah');
    }
    if (file.buffer.length > MAX_BYTES) {
      throw new AppError('VALIDATION_ERROR', 'Ukuran gambar maksimal 5 MB');
    }

    const extension = extensionFor(file.buffer);
    const filename = `${randomUUID()}.${extension}`;
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(resolve(this.root, filename), file.buffer);

    return { url: this.publicUrl(filename, request), filename };
  }

  async resolve(filename: string): Promise<{ path: string; mime: string; size: number }> {
    if (!MEDIA_FILENAME_PATTERN.test(filename)) {
      throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
    }
    const path = resolve(this.root, filename);
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
    }
    let size: number;
    try {
      size = (await fs.stat(path)).size;
    } catch {
      throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
    }
    const mime = MIME_BY_EXTENSION[extname(filename).slice(1)];
    if (!mime) throw new AppError('NOT_FOUND', 'Media tidak ditemukan');
    return { path, mime, size };
  }

  stream(path: string): ReturnType<typeof createReadStream> {
    return createReadStream(path);
  }

  private publicUrl(
    filename: string,
    request: Pick<Request, 'protocol' | 'get'>
  ): string {
    const base = loadConfig().MEDIA_PUBLIC_BASE_URL;
    const origin =
      base?.replace(/\/+$/, '') ?? `${request.protocol}://${request.get('host') ?? 'localhost'}`;
    return `${origin}/v1/media/${filename}`;
  }
}
