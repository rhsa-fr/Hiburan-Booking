import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '@tarlink/core/config';
import { KtpStorageService } from './ktp-storage.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64'
);

describe('KtpStorageService', () => {
  let dir: string;
  let previous: Record<string, string | undefined>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'tarlink-ktp-'));
    previous = {
      PRIVATE_UPLOAD_DIR: process.env.PRIVATE_UPLOAD_DIR,
      KTP_ENCRYPTION_KEY: process.env.KTP_ENCRYPTION_KEY,
      JWT_SECRET: process.env.JWT_SECRET,
      DATABASE_URL: process.env.DATABASE_URL,
      NODE_ENV: process.env.NODE_ENV
    };
    process.env.PRIVATE_UPLOAD_DIR = dir;
    process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-chars';
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';
    process.env.NODE_ENV = 'test';
    delete process.env.KTP_ENCRYPTION_KEY;
    resetConfigForTests();
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfigForTests();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('encrypts bytes at rest and decrypts them on read', async () => {
    const service = new KtpStorageService();
    await service.onModuleInit();

    const saved = await service.save(USER_ID, {
      originalname: 'ktp.png',
      mimetype: 'image/png',
      size: PNG.length,
      buffer: PNG
    });

    const raw = await fs.readFile(join(dir, saved.objectKey));
    expect(raw.subarray(0, 8)).not.toEqual(PNG.subarray(0, 8));
    expect(raw.includes(PNG.subarray(0, 8))).toBe(false);

    const read = await service.read(saved.objectKey);
    expect(read.buffer.equals(PNG)).toBe(true);
    expect(read.mime).toBe('image/png');
    expect(read.size).toBe(PNG.length);
  });

  it('removes the encrypted file and makes it unreadable afterwards', async () => {
    const service = new KtpStorageService();
    await service.onModuleInit();
    const saved = await service.save(USER_ID, {
      originalname: 'ktp.png',
      mimetype: 'image/png',
      size: PNG.length,
      buffer: PNG
    });

    await service.remove(saved.objectKey);

    await expect(service.read(saved.objectKey)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a non-image payload before writing anything', async () => {
    const service = new KtpStorageService();
    await service.onModuleInit();

    await expect(
      service.save(USER_ID, {
        originalname: 'ktp.txt',
        mimetype: 'text/plain',
        size: 5,
        buffer: Buffer.from('hello')
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses to build without a key in production', () => {
    process.env.NODE_ENV = 'production';
    resetConfigForTests();
    expect(() => new KtpStorageService()).toThrow(/KTP_ENCRYPTION_KEY/);
  });
});
