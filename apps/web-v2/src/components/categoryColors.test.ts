import { describe, expect, it } from 'vitest';
import { CATEGORY_PALETTE, DARK_TEXT, LIGHT_TEXT, textOn } from './categoryColors';

describe('textOn', () => {
  it('puts dark slate on light colors', () => {
    for (const light of ['#ffffff', '#ffeeaa', '#a3e635', '#F0F0F0']) {
      expect(textOn(light), light).toBe(DARK_TEXT);
    }
  });

  it('puts white on dark colors', () => {
    for (const dark of ['#000000', '#1e293b', '#3b5b8c', '#8b3a3a']) {
      expect(textOn(dark), dark).toBe(LIGHT_TEXT);
    }
  });

  it('falls back to white for anything that is not #rrggbb', () => {
    expect(textOn('red')).toBe(LIGHT_TEXT);
    expect(textOn('#fff')).toBe(LIGHT_TEXT);
  });

  it('offers palette colors that are all distinct #rrggbb values', () => {
    expect(new Set(CATEGORY_PALETTE).size).toBe(CATEGORY_PALETTE.length);
    for (const color of CATEGORY_PALETTE) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
