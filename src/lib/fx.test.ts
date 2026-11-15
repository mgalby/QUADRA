import { describe, expect, it } from 'vitest';
import { convertCents, parseManualRate, parseRate, rateFromCharge, rateUrl, roundRate } from './fx';

describe('conversione', () => {
  it('12,00 USD al cambio 1,08 (USD per 1 €) = 11,11 €', () => {
    expect(convertCents(1200, 1.08)).toBe(1111);
  });
  it('arrotonda come il server: mezzo centesimo in su', () => {
    expect(convertCents(1000, 2)).toBe(500);
    expect(convertCents(1, 2)).toBe(1); // 0,5 → 1
  });
  it('il cambio si arrotonda a 6 decimali prima di dividere', () => {
    expect(roundRate(1.08123456789)).toBe(1.081235);
    expect(convertCents(100000, 1.08123456789)).toBe(convertCents(100000, 1.081235));
  });
  it('il cambio da un addebito reale: 12,00 USD addebitati 11,00 € → 1,090909', () => {
    expect(rateFromCharge(1200, 1100)).toBe(1.090909);
  });
});

describe('risposta del servizio', () => {
  it('legge il cambio e la data', () => {
    expect(parseRate({ base: 'EUR', date: '2026-11-13', rates: { USD: 1.0812 } }, 'USD')).toEqual({ rate: 1.0812, date: '2026-11-13' });
  });
  it('risposte strane danno null', () => {
    expect(parseRate({ rates: {} }, 'USD')).toBeNull();
    expect(parseRate({ rates: { USD: 0 } }, 'USD')).toBeNull();
    expect(parseRate(null, 'USD')).toBeNull();
    expect(parseRate({ rates: { USD: '1.1' } }, 'USD')).toBeNull();
  });
  it('indirizzo: data passata o ultimo cambio per date future', () => {
    expect(rateUrl('USD', '2026-11-10', '2026-11-15')).toBe('https://api.frankfurter.dev/v1/2026-11-10?base=EUR&symbols=USD');
    expect(rateUrl('USD', '2026-11-20', '2026-11-15')).toContain('/latest?');
  });
});

describe('cambio scritto a mano', () => {
  it('accetta virgola e punto, rifiuta zero e testo', () => {
    expect(parseManualRate('1,0812')).toBe(1.0812);
    expect(parseManualRate(' 1.5 ')).toBe(1.5);
    expect(parseManualRate('0')).toBeNull();
    expect(parseManualRate('abc')).toBeNull();
  });
});
