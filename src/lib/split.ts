// Dividi scontrino: logica pura delle righe (nessun accesso a database o schermo).
//
// Un movimento diviso ha un totale e due o più righe, ognuna con la sua categoria.
// Le righe sommano sempre al totale: finché non è così il resto è diverso da zero
// e il salvataggio resta bloccato.

export interface SplitLine {
  categoryId: string | null; // null = categoria ancora da scegliere
  cents: number;
}

export interface SplitStatus {
  assigned: number; // somma delle righe
  rest: number;     // totale meno assegnato: positivo = manca, negativo = eccesso
  ok: boolean;      // si può salvare
}

export const splitStatus = (totalCents: number, lines: SplitLine[]): SplitStatus => {
  const assigned = lines.reduce((sum, l) => sum + l.cents, 0);
  const rest = totalCents - assigned;
  const ok =
    totalCents > 0 &&
    lines.length >= 2 &&
    rest === 0 &&
    lines.every((l) => l.cents > 0 && l.categoryId !== null);
  return { assigned, rest, ok };
};

/** Si parte da una riga che prende tutto e una vuota, in attesa di un importo. */
export const startSplit = (totalCents: number, categoryId: string | null): SplitLine[] => [
  { categoryId, cents: totalCents },
  { categoryId: null, cents: 0 },
];

/**
 * Dopo la modifica dell'importo di una riga, una riga "di bilanciamento" assorbe la
 * differenza, così di solito non resta nulla da assegnare a mano: la prima riga,
 * oppure l'ultima se la riga modificata è proprio la prima. Se la differenza non
 * sarebbe positiva non si tocca nulla: resta l'eccesso, da correggere a mano.
 */
export function setLineCents(lines: SplitLine[], index: number, cents: number, totalCents: number): SplitLine[] {
  const next = lines.map((l, i) => (i === index ? { ...l, cents } : l));
  if (next.length < 2) return next;
  const balancing = index === 0 ? next.length - 1 : 0;
  const others = next.reduce((sum, l, i) => (i === balancing ? sum : sum + l.cents), 0);
  const remainder = totalCents - others;
  if (remainder > 0) next[balancing] = { ...next[balancing], cents: remainder };
  return next;
}

export const setLineCategory = (lines: SplitLine[], index: number, categoryId: string): SplitLine[] =>
  lines.map((l, i) => (i === index ? { ...l, categoryId } : l));

/** Riga nuova, vuota: l'importo lo scrive chi inserisce. */
export const addLine = (lines: SplitLine[]): SplitLine[] => [...lines, { categoryId: null, cents: 0 }];

/** Toglie una riga: il suo importo passa alla prima riga rimasta. */
export function removeLine(lines: SplitLine[], index: number): SplitLine[] {
  const removed = lines[index];
  const rest = lines.filter((_, i) => i !== index);
  if (rest.length === 0) return rest;
  rest[0] = { ...rest[0], cents: rest[0].cents + removed.cents };
  return rest;
}

/** Ordine stabile delle righe, uguale su ogni dispositivo: la più pesante per prima. */
export const sortLines = <T extends { amount: number; category_id: string }>(lines: T[]): T[] =>
  [...lines].sort((a, b) => b.amount - a.amount || a.category_id.localeCompare(b.category_id));
