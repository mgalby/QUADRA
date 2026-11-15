// Valuta estera: conversione e cambi BCE (Frankfurter). Le funzioni pure stanno in cima,
// l'accesso alla rete e alla cache locale in fondo.
import type { QuadraDB } from './db';

/** Valute pubblicate dalla BCE tramite Frankfurter (EUR esclusa). */
export const FX_CURRENCIES = [
  'USD', 'GBP', 'CHF', 'JPY', 'CZK', 'SEK', 'NOK', 'DKK', 'PLN', 'HUF', 'RON', 'TRY',
  'AUD', 'CAD', 'NZD', 'CNY', 'HKD', 'SGD', 'KRW', 'THB', 'MYR', 'IDR', 'PHP', 'INR',
  'ILS', 'MXN', 'BRL', 'ZAR', 'ISK',
] as const;
/** Le più usate, in cima all'elenco. */
export const FX_COMMON = ['USD', 'GBP', 'CHF', 'JPY', 'CZK', 'SEK', 'NOK', 'DKK', 'PLN', 'HUF'];

/** Cambio con 6 decimali, come lo conserva il database: valuta estera per 1 unità di conto. */
export const roundRate = (rate: number): number => Math.round(rate * 1e6) / 1e6;

/** Importo in valuta estera (centesimi) → centesimi di valuta di conto. Uguale a round(originale / cambio, 2) del server. */
export const convertCents = (originalCents: number, rate: number): number => Math.round(originalCents / roundRate(rate));

/** Cambio che risulta da un addebito reale: importo originale / totale addebitato. */
export const rateFromCharge = (originalCents: number, chargeCents: number): number => roundRate(originalCents / chargeCents);

/** Legge la risposta di Frankfurter: {rates: {USD: 1.07}, date}. */
export function parseRate(json: unknown, currency: string): { rate: number; date: string } | null {
  const j = json as { rates?: Record<string, unknown>; date?: unknown } | null;
  const r = j?.rates?.[currency];
  if (typeof r !== 'number' || !(r > 0)) return null;
  return { rate: roundRate(r), date: typeof j?.date === 'string' ? j.date : '' };
}

/** Indirizzo del cambio per una data; le date future usano l'ultimo pubblicato. */
export const rateUrl = (currency: string, date: string, today: string): string =>
  `https://api.frankfurter.dev/v1/${date > today ? 'latest' : date}?base=EUR&symbols=${currency}`;

/** Un cambio scritto a mano ("1,0812" o "1.0812"). */
export function parseManualRate(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? roundRate(v) : null;
}

// ----- rete e cache ---------------------------------------------------------

export type RateSource = 'live' | 'cached';
export interface RateResult { rate: number; source: RateSource }

/**
 * Cambio per una valuta in una data. Prima la rete (con un tempo massimo), poi l'ultimo
 * cambio salvato per quella valuta; se non c'è nulla, null: il cambio va scritto a mano.
 * Ogni cambio scaricato si ricorda, sia per data sia come "ultimo noto".
 */
export async function getRate(db: QuadraDB, currency: string, date: string, today: string, timeoutMs = 4000): Promise<RateResult | null> {
  const dated = await db.meta.get(`fx:${currency}:${date}`);
  if (dated && date <= today) return { rate: Number(dated.value), source: 'cached' };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(rateUrl(currency, date, today), { signal: ctl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const got = parseRate(await res.json(), currency);
      if (got) {
        await db.meta.bulkPut([
          { key: `fx:${currency}:${date}`, value: String(got.rate) },
          { key: `fx:${currency}:last`, value: String(got.rate) },
        ]);
        return { rate: got.rate, source: 'live' };
      }
    }
  } catch {
    // offline o servizio non raggiungibile: si usa l'ultimo cambio noto
  }
  const last = await db.meta.get(`fx:${currency}:last`);
  return last ? { rate: Number(last.value), source: 'cached' } : null;
}
