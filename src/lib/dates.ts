// Date come testo AAAA-MM-GG nel fuso del dispositivo; mesi come AAAA-MM.
const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayISO = (): string => toISODate(new Date());
export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

function parse(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d ?? 1);
}

export function addDays(isoDate: string, days: number): string {
  const d = parse(isoDate);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function addMonths(month: string, delta: number): string {
  const d = parse(`${month}-01`);
  d.setMonth(d.getMonth() + delta);
  return toISODate(d).slice(0, 7);
}

/** Primo giorno del mese e primo giorno del mese successivo. */
export function monthRange(month: string): [string, string] {
  return [`${month}-01`, `${addMonths(month, 1)}-01`];
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function monthLabel(month: string, locale: string): string {
  return capitalize(parse(`${month}-01`).toLocaleDateString(locale, { month: 'long', year: 'numeric' }));
}

/** "14 nov" oppure, se l'anno non è quello corrente, "14 nov 2025". */
export function shortDate(isoDate: string, locale: string): string {
  const sameYear = isoDate.slice(0, 4) === todayISO().slice(0, 4);
  return parse(isoDate).toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function longDate(isoDate: string, locale: string): string {
  return capitalize(parse(isoDate).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }));
}
