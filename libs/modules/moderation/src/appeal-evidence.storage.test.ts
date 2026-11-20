import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APPEAL_EVIDENCE_OBJECT_KEY_PATTERN,
  AppealEvidenceStorage,
  deriveAppealEvidenceKey
} from './appeal-evidence.storage';

const REPORT_ID = '3f2b1c44-9d6e-4a1f-8f7c-1a2b3c4d5e6f';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('bukti-kepemilikan', 'utf8')
]);

const roots: string[] = [];

async function makeStorage(): Promise<{ storage: AppealEvidenceStorage; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'tarlink-evidence-'));
  roots.push(root);
  return {
    root,
    storage: new AppealEvidenceStorage(root, deriveAppealEvidenceKey('test-secret', 'test'))
  };
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe('AppealEvidenceStorage', () => {
  it('roundtrips a PNG and reports the real mime type', async () => {
    const { storage } = await makeStorage();
    const saved = await storage.save(REPORT_ID, {
      originalname: 'bukti.png',
      mimetype: 'image/png',
      size: PNG.length,
      buffer: PNG
    });

    expect(saved.objectKey).toMatch(APPEAL_EVIDENCE_OBJECT_KEY_PATTERN);
    const file = await storage.read(saved.objectKey);
    expect(file.mime).toBe('image/png');
    expect(file.buffer.equals(PNG)).toBe(true);
  });

  it('never writes plaintext to disk', async () => {
    const { storage, root } = await makeStorage();
    const saved = await storage.save(REPORT_ID, {
      originalname: 'bukti.png',
      mimetype: 'image/png',
      size: PNG.length,
      buffer: PNG
    });

    const raw = await readFile(join(root, saved.objectKey));
    expect(raw.includes(Buffer.from('bukti-kepemilikan', 'utf8'))).toBe(false);
    expect(raw.subarray(0, 8).equals(PNG.subarray(0, 8))).toBe(false);
  });

  it('rejects a file whose magic bytes are not an image', async () => {
    const { storage } = await makeStorage();
    await expect(
      storage.save(REPORT_ID, {
        originalname: 'evil.png',
        mimetype: 'image/png',
        size: 12,
        buffer: Buffer.from('<?php echo 1', 'utf8')
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an empty upload', async () => {
    const { storage } = await makeStorage();
    await expect(storage.save(REPORT_ID, undefined)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('refuses object keys outside the evidence scope', async () => {
    const { storage } = await makeStorage();
    await expect(storage.read('ktp/00000000-0000-0000-0000-000000000000/x.png')).rejects.toMatchObject(
      { code: 'NOT_FOUND' }
    );
    await expect(storage.read(`appeal/${REPORT_ID}/../escape.png`)).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });

  it('removes a stored file and ignores unknown keys', async () => {
    const { storage } = await makeStorage();
    const saved = await storage.save(REPORT_ID, {
      originalname: 'bukti.png',
      mimetype: 'image/png',
      size: PNG.length,
      buffer: PNG
    });

    await storage.remove(saved.objectKey);
    await expect(storage.read(saved.objectKey)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(storage.remove('random/path.png')).resolves.toBeUndefined();
  });
});

describe('deriveAppealEvidenceKey', () => {
  it('derives a 32 byte key and never returns the raw secret', () => {
    const key = deriveAppealEvidenceKey('super-secret', 'test');
    expect(key.length).toBe(32);
    expect(key.toString('utf8')).not.toContain('super-secret');
  });

  it('is stable for the same secret and different for another', () => {
    const a = deriveAppealEvidenceKey('secret-a', 'test');
    const b = deriveAppealEvidenceKey('secret-a', 'test');
    const c = deriveAppealEvidenceKey('secret-b', 'test');
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('refuses an empty secret', () => {
    expect(() => deriveAppealEvidenceKey('   ', 'test')).toThrowError();
  });
});
