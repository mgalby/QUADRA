import { toISODate } from './dates';
import type { Anchor, IntervalUnit, Recurrence } from './types';

// Calcolo delle scadenze: funzioni pure, senza archivio né rete.
// Regola decisa il 15 nov 2026: se il giorno non esiste nel mese (31 in aprile,
// 29 febbraio in un anno non bisestile) la scadenza cade nell'ultimo giorno del mese.

const pad = (n: number) => String(n).padStart(2, '0');
export const daysInMonth = (year: number, month1: number): number => new Date(year, month1, 0).getDate();

const ymd = (iso: string): [number, number, number] => {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
};

function firstBusinessDay(year: number, month1: number): number {
  for (let d = 1; d <= 3; d++) {
    const dow = new Date(year, month1 - 1, d).getDay();
    if (dow !== 0 && dow !== 6) return d;
  }
  return 1;
}

/** Giorno del mese in cui cade la scadenza, già ricondotto alla lunghezza del mese. */
function dayFor(anchor: Anchor | null, anchorDay: number | null, startDay: number, year: number, month1: number): number {
  const last = daysInMonth(year, month1);
  if (anchor === 'end_of_month') return last;
  if (anchor === 'first_business_day') return firstBusinessDay(year, month1);
  return Math.min(anchorDay ?? startDay, last);
}

export interface Schedule {
  interval_n: number;
  interval_unit: IntervalUnit;
  anchor: Anchor | null;
  anchor_day: number | null;
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
}

const SAFETY = 2000;

/** Date delle scadenze da start_date fino a upTo compreso (e a end_date / max_occurrences). */
export function occurrenceDates(s: Schedule, upTo: string): string[] {
  const out: string[] = [];
  const limit = s.end_date && s.end_date < upTo ? s.end_date : upTo;
  const [sy, sm, sd] = ymd(s.start_date);

  for (let k = 0; k < SAFETY; k++) {
    let date: string;
    if (s.interval_unit === 'day' || s.interval_unit === 'week') {
      const d = new Date(sy, sm - 1, sd + k * s.interval_n * (s.interval_unit === 'week' ? 7 : 1));
      date = toISODate(d);
    } else {
      const months = k * s.interval_n * (s.interval_unit === 'year' ? 12 : 1);
      const total = sy * 12 + (sm - 1) + months;
      const y = Math.floor(total / 12);
      const m = (total % 12) + 1;
      date = `${y}-${pad(m)}-${pad(dayFor(s.anchor, s.anchor_day, sd, y, m))}`;
    }
    if (date > limit) break;
    if (date < s.start_date) continue; // il giorno fisso del primo mese può cadere prima della data di inizio
    out.push(date);
    if (s.max_occurrences && out.length >= s.max_occurrences) break;
  }
  return out;
}

export function scheduleOf(r: Recurrence): Schedule | null {
  if (!r.interval_n || !r.interval_unit || !r.start_date) return null;
  return {
    interval_n: r.interval_n,
    interval_unit: r.interval_unit,
    anchor: r.anchor,
    anchor_day: r.anchor_day,
    start_date: r.start_date,
    end_date: r.end_date,
    max_occurrences: r.max_occurrences,
  };
}

/** Prossima scadenza dalla data indicata in poi (compresa), o null se la ricorrenza è finita. */
export function nextOccurrence(s: Schedule, from: string): string | null {
  // cerca in avanti a finestre sempre più larghe: basta un anno per ogni frequenza
  const [y, m, d] = ymd(from);
  const horizon = toISODate(new Date(y + 2, m - 1, d));
  return occurrenceDates(s, horizon).find((x) => x >= from) ?? null;
}

/**
 * Divide un totale in n rate in centesimi: le prime uguali, l'ultima assorbe
 * la differenza (100 € in 3 rate = 33,33 + 33,33 + 33,34).
 */
export function splitInstallments(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? totalCents - base * (n - 1) : base));
}

/**
 * Identificatore stabile di una scadenza: due dispositivi che la generano
 * insieme ottengono lo stesso id, quindi il server la vede una volta sola.
 */
export async function stableId(...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join('|'));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50; // formato UUID versione 5
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
