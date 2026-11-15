import { describe, expect, it } from 'vitest';
import { addLine, removeLine, setLineCategory, setLineCents, sortLines, splitStatus, startSplit, type SplitLine } from './split';

describe('Dividi scontrino', () => {
  it('parte con una riga che prende tutto e una vuota', () => {
    const lines = startSplit(10000, 'spesa');
    expect(lines).toEqual([{ categoryId: 'spesa', cents: 10000 }, { categoryId: null, cents: 0 }]);
    expect(splitStatus(10000, lines).ok).toBe(false); // la seconda è vuota
  });

  it('la riga modificata toglie dalla prima: 100 € con 20 € su Animali', () => {
    let lines: SplitLine[] = startSplit(10000, 'spesa');
    lines = setLineCategory(lines, 1, 'animali');
    lines = setLineCents(lines, 1, 2000, 10000);
    expect(lines.map((l) => l.cents)).toEqual([8000, 2000]);
    expect(splitStatus(10000, lines)).toEqual({ assigned: 10000, rest: 0, ok: true });
  });

  it('modificando la prima riga è l\'ultima ad assorbire', () => {
    let lines: SplitLine[] = [
      { categoryId: 'a', cents: 5000 },
      { categoryId: 'b', cents: 3000 },
      { categoryId: 'c', cents: 2000 },
    ];
    lines = setLineCents(lines, 0, 6500, 10000);
    expect(lines.map((l) => l.cents)).toEqual([6500, 3000, 500]);
  });

  it('con tre righe la prima assorbe quando se ne modifica un\'altra', () => {
    let lines: SplitLine[] = [
      { categoryId: 'a', cents: 7000 },
      { categoryId: 'b', cents: 3000 },
      { categoryId: 'c', cents: 0 },
    ];
    lines = setLineCents(lines, 2, 1500, 10000);
    expect(lines.map((l) => l.cents)).toEqual([5500, 3000, 1500]);
  });

  it('un importo che non lascia nulla alla prima riga resta un eccesso, da correggere', () => {
    let lines: SplitLine[] = startSplit(10000, 'a');
    lines = setLineCategory(lines, 1, 'b');
    lines = setLineCents(lines, 1, 12000, 10000);
    expect(lines.map((l) => l.cents)).toEqual([10000, 12000]);
    const status = splitStatus(10000, lines);
    expect(status.rest).toBe(-12000);
    expect(status.ok).toBe(false);
  });

  it('se cambia il totale le righe restano e compare il resto', () => {
    const lines = [{ categoryId: 'a', cents: 8000 }, { categoryId: 'b', cents: 2000 }];
    const status = splitStatus(12000, lines);
    expect(status.rest).toBe(2000);
    expect(status.ok).toBe(false);
  });

  it('serve la categoria su ogni riga e un importo maggiore di zero', () => {
    expect(splitStatus(10000, [{ categoryId: 'a', cents: 10000 }, { categoryId: null, cents: 0 }]).ok).toBe(false);
    expect(splitStatus(10000, [{ categoryId: 'a', cents: 10000 }, { categoryId: 'b', cents: 0 }]).ok).toBe(false);
    expect(splitStatus(10000, [{ categoryId: 'a', cents: 6000 }, { categoryId: null, cents: 4000 }]).ok).toBe(false);
    expect(splitStatus(10000, [{ categoryId: 'a', cents: 6000 }, { categoryId: 'b', cents: 4000 }]).ok).toBe(true);
  });

  it('la stessa categoria può stare su più righe', () => {
    expect(splitStatus(10000, [{ categoryId: 'a', cents: 6000 }, { categoryId: 'a', cents: 4000 }]).ok).toBe(true);
  });

  it('una riga sola non è una divisione', () => {
    expect(splitStatus(10000, [{ categoryId: 'a', cents: 10000 }]).ok).toBe(false);
  });

  it('togliere una riga restituisce il suo importo alla prima', () => {
    const lines = [
      { categoryId: 'a', cents: 5000 },
      { categoryId: 'b', cents: 3000 },
      { categoryId: 'c', cents: 2000 },
    ];
    expect(removeLine(lines, 2).map((l) => l.cents)).toEqual([7000, 3000]);
    expect(removeLine(lines, 0).map((l) => l.cents)).toEqual([8000, 2000]);
  });

  it('aggiungere una riga la crea vuota', () => {
    expect(addLine([{ categoryId: 'a', cents: 100 }])).toEqual([{ categoryId: 'a', cents: 100 }, { categoryId: null, cents: 0 }]);
  });

  it('l\'ordine delle righe è lo stesso su ogni dispositivo', () => {
    const lines = [
      { category_id: 'z', amount: 20 },
      { category_id: 'b', amount: 20 },
      { category_id: 'a', amount: 80 },
    ];
    expect(sortLines(lines).map((l) => l.category_id)).toEqual(['a', 'b', 'z']);
    expect(sortLines([...lines].reverse()).map((l) => l.category_id)).toEqual(['a', 'b', 'z']);
  });
});
