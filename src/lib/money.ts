// Gli importi si sommano sempre in centesimi interi: niente errori di virgola mobile.
export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (cents: number): number => cents / 100;

export function formatMoney(cents: number, currency: string, locale: string, opts: { sign?: boolean } = {}): string {
  const text = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    useGrouping: 'always', // in italiano senza questo 1842,40 resta senza punto delle migliaia
  }).format(Math.abs(cents) / 100);
  if (cents < 0) return `−${text}`;
  return opts.sign && cents > 0 ? `+${text}` : text;
}
