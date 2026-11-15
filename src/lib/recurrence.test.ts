import { describe, expect, it } from 'vitest';
import { nextOccurrence, occurrenceDates, splitInstallments, stableId, type Schedule } from './recurrence';

const monthly = (start: string, extra: Partial<Schedule> = {}): Schedule => ({
  interval_n: 1, interval_unit: 'month', anchor: 'day_of_month', anchor_day: null,
  start_date: start, end_date: null, max_occurrences: null, ...extra,
});

describe('occurrenceDates', () => {
  it('il 31 cade nell\'ultimo giorno dei mesi corti', () => {
    expect(occurrenceDates(monthly('2027-01-31'), '2027-05-31')).toEqual([
      '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31',
    ]);
  });
  it('29 febbraio: 28 negli anni non bisestili, 29 nel bisestile', () => {
    const s: Schedule = { ...monthly('2027-02-28'), interval_n: 1, interval_unit: 'year', anchor_day: 29 };
    expect(occurrenceDates(s, '2029-12-31')).toEqual(['2027-02-28', '2028-02-29', '2029-02-28']);
  });
  it('fine mese e primo giorno lavorativo', () => {
    expect(occurrenceDates(monthly('2027-01-15', { anchor: 'end_of_month' }), '2027-03-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    // 1 maggio 2027 è sabato: primo lavorativo lunedì 3
    expect(occurrenceDates(monthly('2027-04-01', { anchor: 'first_business_day' }), '2027-05-31')).toEqual(['2027-04-01', '2027-05-03']);
  });
  it('giorno fisso precedente alla data di inizio: salta il primo mese', () => {
    expect(occurrenceDates(monthly('2027-01-20', { anchor_day: 5 }), '2027-03-31')).toEqual(['2027-02-05', '2027-03-05']);
  });
  it('ogni N settimane e ogni N giorni', () => {
    expect(occurrenceDates({ ...monthly('2027-01-04'), interval_unit: 'week', interval_n: 2 }, '2027-02-15'))
      .toEqual(['2027-01-04', '2027-01-18', '2027-02-01', '2027-02-15']);
    expect(occurrenceDates({ ...monthly('2027-02-27'), interval_unit: 'day', interval_n: 1 }, '2027-03-02'))
      .toEqual(['2027-02-27', '2027-02-28', '2027-03-01', '2027-03-02']);
  });
  it('ogni 3 mesi, rispetta data di fine e numero massimo', () => {
    expect(occurrenceDates(monthly('2027-01-10', { interval_n: 3 }), '2027-12-31')).toEqual(['2027-01-10', '2027-04-10', '2027-07-10', '2027-10-10']);
    expect(occurrenceDates(monthly('2027-01-10', { end_date: '2027-03-09' }), '2027-12-31')).toEqual(['2027-01-10', '2027-02-10']);
    expect(occurrenceDates(monthly('2027-01-10', { max_occurrences: 2 }), '2027-12-31')).toEqual(['2027-01-10', '2027-02-10']);
  });
  it('nextOccurrence', () => {
    expect(nextOccurrence(monthly('2027-01-31'), '2027-02-01')).toBe('2027-02-28');
    expect(nextOccurrence(monthly('2027-01-31', { max_occurrences: 1 }), '2027-02-01')).toBeNull();
  });
});

describe('splitInstallments', () => {
  it('l\'ultima rata assorbe i centesimi', () => {
    expect(splitInstallments(10000, 3)).toEqual([3333, 3333, 3334]);
    expect(splitInstallments(10000, 4)).toEqual([2500, 2500, 2500, 2500]);
    expect(splitInstallments(1, 1)).toEqual([1]);
    expect(splitInstallments(10000, 3).reduce((a, b) => a + b, 0)).toBe(10000);
  });
});

describe('stableId', () => {
  it('è stabile e ha formato UUID', async () => {
    const a = await stableId('rec', '2027-01-31');
    expect(a).toBe(await stableId('rec', '2027-01-31'));
    expect(a).not.toBe(await stableId('rec', '2027-02-28'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
