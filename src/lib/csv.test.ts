import { describe, expect, it } from 'vitest';
import { buildPreview, catKey, csvCell, decodeCsv, detectDelimiter, parseAmount, parseCsv, parseDate, parseMonth, parseSign, readTable, type PreviewContext } from './csv';

describe('parseAmount', () => {
  it.each([
    ['12,50', 1250], ['1.234,56', 123456], ['1234.56', 123456], ['1,234.56', 123456], ['-12,5', -1250],
    ['12,50 €', 1250], ['€ 12', 1200], ['1.234', 123400], ['1,234', 123400], ['1.234.567,89', 123456789],
    ['(45,00)', -4500], ['45,00-', -4500], ['−3,2', -320], ['+7', 700], ['0,05', 5], ['.5', 50],
  ])('%s → %d', (raw, cents) => expect(parseAmount(raw)).toBe(cents));
  it.each(['', 'abc', '1,2,3x', '12,345,67', '€'])('rifiuta "%s"', (raw) => expect(parseAmount(raw)).toBeNull());
});

describe('parseDate / parseMonth / parseSign', () => {
  it('formati di data', () => {
    expect(parseDate('16/11/2026')).toBe('2026-11-16');
    expect(parseDate('6-1-2026')).toBe('2026-01-06');
    expect(parseDate('16.11.26')).toBe('2026-11-16');
    expect(parseDate('2026-11-16')).toBe('2026-11-16');
    expect(parseDate('2026-11-16 08:30:00')).toBe('2026-11-16');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('boh')).toBeNull();
  });
  it('mesi', () => {
    expect(parseMonth('2026-03')).toBe('2026-03');
    expect(parseMonth('03/2026')).toBe('2026-03');
    expect(parseMonth('marzo 2026')).toBe('2026-03');
    expect(parseMonth('Nov 2026')).toBe('2026-11');
    expect(parseMonth('15/03/2026')).toBe('2026-03');
    expect(parseMonth('2026-13')).toBeNull();
  });
  it('segno', () => {
    expect(parseSign('U')).toBe('expense');
    expect(parseSign('Uscita')).toBe('expense');
    expect(parseSign('−')).toBe('expense');
    expect(parseSign('Entrata')).toBe('income');
    expect(parseSign('+')).toBe('income');
    expect(parseSign('x')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('separatore, virgolette e a capo nelle celle', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('"a;b",c,d')).toBe(',');
    expect(parseCsv('a;b\r\n"x;1";"he said ""hi"""\r\n\r\n"due\nrighe";z\r\n')).toEqual([['a', 'b'], ['x;1', 'he said "hi"'], ['due\nrighe', 'z']]);
  });
  it('decodifica UTF-8 con BOM e Windows-1252', () => {
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, 0x63, 0x61, 0x66, 0xc3, 0xa8]).buffer)).toBe('cafè');
    expect(decodeCsv(new Uint8Array([0x63, 0x61, 0x66, 0xe8]).buffer)).toBe('cafè');
  });
  it('csvCell protegge dalle formule', () => {
    expect(csvCell('=SOMMA(A1)')).toBe("'=SOMMA(A1)");
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell(-12.5)).toBe('-12.5');
  });
});

const cats = [
  { id: 'spesa', name: 'Spesa alimentare', kind: 'expense' as const },
  { id: 'benz', name: 'Benzina', kind: 'expense' as const },
  { id: 'stip', name: 'Stipendio', kind: 'income' as const },
];
const ctx = (over: Partial<PreviewContext> = {}): PreviewContext => ({
  categories: cats, merchantTop: new Map(), existing: [], catMap: {}, positiveIs: 'expense', ...over,
});

describe('readTable + buildPreview', () => {
  const file = [
    'Data;Importo;Segno;Categoria;Esercizio;Note',
    '16/11/2026;45,20;U;Spesa Alimentare;Coop;',
    '15/11/2026;1.500,00;E;Stipendio;;novembre',
    '14/11/2026;30,00;U;Categoria nuova;Eni;',
    '13/11/2026;12,00;U;;Eni;',
    '32/11/2026;5;U;Benzina;;',
    '12/11/2026;abc;U;Benzina;;',
    '11/11/2026;9;Q;Benzina;;',
  ].join('\n');

  it('legge colonne, errori e segno', () => {
    const t = readTable(parseCsv(file));
    expect(t.problem).toBeNull();
    expect(t.hasSign).toBe(true);
    expect(t.rows.map((r) => r.error)).toEqual([null, null, null, null, 'date', 'amount', 'sign']);
    expect(t.rows[0].signed).toBe(4520);
  });

  it('categoria dal file (maiuscole e accenti ignorati), poi dall\'esercizio, poi da assegnare', () => {
    const t = readTable(parseCsv(file));
    const top = new Map([['eni', { expense: 'benz' }]]);
    const items = buildPreview(t, ctx({ merchantTop: top }));
    expect(items.map((i) => [i.status, i.categoryId, i.from])).toEqual([
      ['ok', 'spesa', 'file'], ['ok', 'stip', 'file'], ['ok', 'benz', 'merchant'], ['ok', 'benz', 'merchant'],
      ['error', null, null], ['error', null, null], ['error', null, null],
    ]);
    const none = buildPreview(t, ctx());
    expect(none[2].status).toBe('nocat');
    expect(none[3].status).toBe('nocat');
    const mapped = buildPreview(t, ctx({ catMap: { [catKey('Categoria nuova', 'expense')]: 'spesa', [catKey('', 'expense')]: 'benz' } }));
    expect(mapped[2]).toMatchObject({ status: 'ok', categoryId: 'spesa', from: 'manual' });
    expect(mapped[3]).toMatchObject({ status: 'ok', categoryId: 'benz', from: 'manual' });
  });

  it('doppioni: stesso importo e segno entro 3 giorni', () => {
    const t = readTable(parseCsv(file));
    const items = buildPreview(t, ctx({ existing: [
      { date: '2026-11-19', kind: 'expense', cents: 4520 },   // 3 giorni: doppione
      { date: '2026-11-20', kind: 'income', cents: 150000 },  // 5 giorni: no
    ] }));
    expect(items[0].status).toBe('dup');
    expect(items[1].status).toBe('ok');
  });

  it('senza colonna Segno: il segno meno decide; tutto positivo segue l\'impostazione', () => {
    const bank = readTable(parseCsv('Data;Importo\n01/11/2026;-10,00\n02/11/2026;20,00'));
    expect(buildPreview(bank, ctx()).map((i) => i.kind)).toEqual(['expense', 'income']);
    const pos = readTable(parseCsv('Data;Importo\n01/11/2026;10,00\n02/11/2026;20,00'));
    expect(buildPreview(pos, ctx()).map((i) => i.kind)).toEqual(['expense', 'expense']);
    expect(buildPreview(pos, ctx({ positiveIs: 'income' })).map((i) => i.kind)).toEqual(['income', 'income']);
  });

  it('colonne mancanti o file vuoto', () => {
    expect(readTable(parseCsv('Foo;Bar\n1;2')).problem).toBe('columns');
    expect(readTable(parseCsv('Data;Importo')).problem).toBe('empty');
  });

  it('competenza e valuta estera', () => {
    const t = readTable(parseCsv('Data;Importo;Segno;Categoria;Competenza;Valuta;ImportoOriginale\n05/11/2026;80,00;U;Benzina;2027-02;USD;92,00'));
    expect(t.rows[0]).toMatchObject({ month: '2027-02', currency: 'USD', original: 9200, error: null });
  });
});
