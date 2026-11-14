import { describe, expect, it } from 'vitest';
import { displayExpr, evaluate, exprFromCents, press, type CalcKey } from './calc';

const type = (keys: string): string =>
  keys.split('').reduce((expr, k) => press(expr, (k === '<' ? 'back' : k) as CalcKey), '');

describe('calcolatrice', () => {
  it('somma due scontrini', () => {
    expect(evaluate(type('18,20+6,30'))).toBe(2450);
    expect(displayExpr(type('18,20+6,30'))).toBe('18,20 + 6,30');
  });
  it('prima moltiplica, poi somma', () => {
    expect(evaluate(type('18,20+6,30*2'))).toBe(3080);
    expect(evaluate(type('10-2*3'))).toBe(400);
    expect(evaluate(type('100/4+1'))).toBe(2600);
  });
  it('ignora operatore o virgola lasciati in fondo', () => {
    expect(evaluate(type('18,20+'))).toBe(1820);
    expect(evaluate(type('18,'))).toBe(1800);
    expect(evaluate('')).toBeNull();
  });
  it('arrotonda solo il risultato finale', () => {
    expect(evaluate(type('100/3'))).toBe(3333);
    expect(evaluate(type('100/3*3'))).toBe(10000);
    expect(evaluate(type('2,67*0,5'))).toBe(134); // 1,335 -> 1,34
    expect(evaluate(type('0,1+0,2'))).toBe(30);
  });
  it('divisione per zero e risultati non positivi', () => {
    expect(evaluate(type('5/0'))).toBeNull();
    expect(evaluate(type('10-15'))).toBe(-500);
    expect(evaluate(type('10-10'))).toBe(0);
  });
  it('regole di digitazione', () => {
    expect(type('007')).toBe('7');
    expect(type('1,234')).toBe('1,23');
    expect(type('1,,2')).toBe('1,2');
    expect(type(',5')).toBe('0,5');
    expect(type('+5')).toBe('5');
    expect(type('5+*3')).toBe('5*3');
    expect(type('5,+3')).toBe('5+3');
    expect(type('12<')).toBe('1');
    expect(type('123456789')).toBe('1234567');
  });
  it('riparte da un importo esistente', () => {
    expect(exprFromCents(2450)).toBe('24,50');
    expect(exprFromCents(5)).toBe('0,05');
    expect(evaluate(exprFromCents(123456))).toBe(123456);
  });
});
