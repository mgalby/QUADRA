import { describe, expect, it } from 'vitest';
import { currentTrip, newTrip } from './trips';

describe('viaggi', () => {
  it('serve nome, valuta e date coerenti', () => {
    expect(newTrip('Tokyo', 'JPY', '2027-04-01', '2027-04-10')).toMatchObject({ name: 'Tokyo', currency: 'JPY' });
    expect(newTrip('  ', 'JPY', '2027-04-01', '2027-04-10')).toBeNull();
    expect(newTrip('Tokyo', 'JPY', '2027-04-10', '2027-04-01')).toBeNull();
    expect(newTrip('Tokyo', '', '2027-04-01', '2027-04-10')).toBeNull();
  });
  it('il viaggio attivo è solo quello acceso e ancora esistente', () => {
    const a = newTrip('A', 'USD', '2027-01-01', '2027-01-05')!;
    expect(currentTrip([a], a.id)).toEqual(a);
    expect(currentTrip([a], null)).toBeNull();
    expect(currentTrip([a], 'altro')).toBeNull();
  });
});
