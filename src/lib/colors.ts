// Tonalità automatiche delle categorie, a partire dal colore della macro.

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * n tonalità dello stesso colore, dalla più chiara alla più scura, tutte leggibili
 * sullo sfondo scuro. Con n = 1 resta il colore della macro.
 */
export function shades(base: string, n: number): string[] {
  if (n <= 1) return [base];
  const [h, s, l] = hexToHsl(base);
  const span = Math.min(0.24, 0.06 * (n - 1)); // ampiezza totale della variazione di luminosità
  // il centro si sposta se il colore di partenza è già molto chiaro o molto scuro, così le tonalità restano tutte diverse
  const center = Math.min(0.72 - span / 2, Math.max(0.3 + span / 2, l));
  return Array.from({ length: n }, (_, i) => hslToHex(h, s, center + span / 2 - (span * i) / (n - 1)));
}
