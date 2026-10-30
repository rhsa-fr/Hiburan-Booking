import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigForTests } from '@tarlink/core/config';
import { MEDIA_FILENAME_PATTERN, MediaService, extensionFor } from './media.service';

describe('media validation', () => {
  it('detects jpeg, png and webp from magic bytes', () => {
    expect(extensionFor(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(
      extensionFor(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ).toBe('png');
    expect(extensionFor(Buffer.from('RIFF0000WEBP', 'ascii'))).toBe('webp');
  });

  it('rejects non-image bytes', () => {
    expect(() => extensionFor(Buffer.from('not an image', 'utf8'))).toThrowError(
      /JPG, PNG, atau WebP/
    );
  });

  it('only accepts generated filenames (no path traversal)', () => {
    expect(MEDIA_FILENAME_PATTERN.test('123e4567-e89b-42d3-a456-426614174000.jpg')).toBe(true);
    expect(MEDIA_FILENAME_PATTERN.test('../evil.jpg')).toBe(false);
    expect(MEDIA_FILENAME_PATTERN.test('photo.jpg')).toBe(false);
    expect(MEDIA_FILENAME_PATTERN.test('123e4567-e89b-42d3-a456-426614174000.svg')).toBe(false);
  });
});

describe('MediaService', () => {
  let dir: string;
  let previousUploadDir: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tarlink-media-'));
    previousUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = dir;
    process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/test';
    process.env.JWT_SECRET ??= '0123456789abcdef';
    resetConfigForTests();
  });

  afterEach(async () => {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;
    resetConfigForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a detected image and serves it back with the right MIME type', async () => {
    const service = new MediaService();
    await service.onModuleInit();
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00
    ]);

    const saved = await service.save(
      { originalname: 'x.png', mimetype: 'image/png', size: png.length, buffer: png },
      { protocol: 'http', get: () => 'localhost:3001' }
    );

    expect(saved.filename).toMatch(MEDIA_FILENAME_PATTERN);
    expect(saved.url).toBe(`http://localhost:3001/v1/media/${saved.filename}`);

    const resolved = await service.resolve(saved.filename);
    expect(resolved.mime).toBe('image/png');
    expect(await readFile(resolved.path)).toEqual(png);

    await expect(service.resolve('../evil.jpg')).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });
});
