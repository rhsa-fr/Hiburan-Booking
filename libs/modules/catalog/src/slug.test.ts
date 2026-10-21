import { describe, expect, it } from 'vitest';
import { MAX_SLUG_LENGTH, slugify, uniqueSlug } from './slug';

describe('slugify', () => {
  it('lowercases and dash-separates a display name', () => {
    expect(slugify('Tarling Dangdut Dian')).toBe('tarling-dangdut-dian');
  });

  it('strips accents and punctuation instead of dropping the word', () => {
    expect(slugify('  Sanggar Seni “Budi” & Rakan  ')).toBe('sanggar-seni-budi-rakan');
    expect(slugify('Café Krèsi')).toBe('cafe-kresi');
  });

  it('falls back to `vendor` when nothing alphanumeric survives', () => {
    expect(slugify('!!!')).toBe('vendor');
    expect(slugify('   ')).toBe('vendor');
  });

  it('never exceeds the 160-char column limit', () => {
    expect(slugify('a'.repeat(400))).toHaveLength(MAX_SLUG_LENGTH);
  });
});

describe('uniqueSlug', () => {
  it('keeps the base when it is free', () => {
    expect(uniqueSlug('tarling-dian', new Set())).toBe('tarling-dian');
  });

  it('appends -2 then -3 on collision', () => {
    expect(uniqueSlug('tarling-dian', new Set(['tarling-dian']))).toBe('tarling-dian-2');
    expect(uniqueSlug('tarling-dian', new Set(['tarling-dian', 'tarling-dian-2']))).toBe(
      'tarling-dian-3'
    );
  });

  it('ignores unrelated slugs that only share a prefix', () => {
    expect(uniqueSlug('tarling', new Set(['tarling-dian']))).toBe('tarling');
  });

  it('trims the stem so the suffix still fits in 160 chars', () => {
    const base = 'a'.repeat(MAX_SLUG_LENGTH);
    const slug = uniqueSlug(base, new Set([base]));
    expect(slug).toHaveLength(MAX_SLUG_LENGTH);
    expect(slug.endsWith('-2')).toBe(true);
  });
});
