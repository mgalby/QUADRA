import { describe, expect, it } from 'vitest';
import { shades } from './colors';

describe('shades', () => {
  it('una sola categoria: colore della macro invariato', () => {
    expect(shades('#3987e5', 1)).toEqual(['#3987e5']);
  });
  it('più categorie: tonalità tutte diverse e valide', () => {
    const s = shades('#9085e9', 4);
    expect(new Set(s).size).toBe(4);
    for (const c of s) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});
