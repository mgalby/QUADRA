// Calcolatrice dell'inserimento rapido.
// L'espressione è un testo fatto di cifre, virgola e operatori (+ - * /).
// Non c'è il tasto "=": il risultato si ricalcola a ogni tasto.
// Regole: prima × e ÷, poi + e −; l'operatore lasciato in fondo si ignora;
// si arrotonda solo il risultato finale, al centesimo.

export type CalcKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ',' | '+' | '-' | '*' | '/' | 'back';

const OPS = '+-*/';
const MAX_INT_DIGITS = 7;
const isOp = (c: string) => c !== '' && OPS.includes(c);

function lastOperand(expr: string): string {
  let i = expr.length;
  while (i > 0 && !isOp(expr[i - 1])) i--;
  return expr.slice(i);
}

export function press(expr: string, key: CalcKey): string {
  if (key === 'back') return expr.slice(0, -1);
  const operand = lastOperand(expr);

  if (isOp(key)) {
    if (expr === '') return expr;
    if (isOp(expr.slice(-1))) return expr.slice(0, -1) + key; // cambia operatore
    return (expr.endsWith(',') ? expr.slice(0, -1) : expr) + key;
  }
  if (key === ',') {
    if (operand.includes(',')) return expr;
    return expr + (operand === '' ? '0,' : ',');
  }
  // cifra
  const [int, dec] = operand.split(',');
  if (dec !== undefined) return dec.length >= 2 ? expr : expr + key;
  if (int === '0') return expr.slice(0, -1) + key; // niente zeri iniziali
  if (int.length >= MAX_INT_DIGITS) return expr;
  return expr + key;
}

// Frazioni esatte, per non perdere centesimi tra moltiplicazioni e divisioni.
interface Frac {
  n: bigint;
  d: bigint;
}

function parseOperand(text: string): Frac {
  const [int, dec = ''] = text.split(',');
  return { n: BigInt(int + dec.padEnd(2, '0')), d: 100n };
}

function apply(a: Frac, op: string, b: Frac): Frac | null {
  switch (op) {
    case '+': return { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
    case '-': return { n: a.n * b.d - b.n * a.d, d: a.d * b.d };
    case '*': return { n: a.n * b.n, d: a.d * b.d };
    default: return b.n === 0n ? null : { n: a.n * b.d, d: a.d * b.n };
  }
}

/** Risultato in centesimi; null se non c'è nulla da calcolare o c'è una divisione per zero. */
export function evaluate(expr: string): number | null {
  let text = expr;
  while (text !== '' && (isOp(text.slice(-1)) || text.endsWith(','))) text = text.slice(0, -1);
  if (text === '') return null;

  const operands = text.split(/[+\-*/]/).map(parseOperand);
  const ops = text.replace(/[^+\-*/]/g, '').split('');

  // primo giro: × e ÷
  const terms: Frac[] = [operands[0]];
  const sums: string[] = [];
  for (let i = 0; i < ops.length; i++) {
    const next = operands[i + 1];
    if (ops[i] === '*' || ops[i] === '/') {
      const r = apply(terms[terms.length - 1], ops[i], next);
      if (!r) return null;
      terms[terms.length - 1] = r;
    } else {
      sums.push(ops[i]);
      terms.push(next);
    }
  }
  // secondo giro: + e −
  let total = terms[0];
  for (let i = 0; i < sums.length; i++) total = apply(total, sums[i], terms[i + 1])!;

  // centesimi, arrotondati per eccesso sul mezzo centesimo
  const scaled = total.n * 100n;
  const negative = scaled < 0n !== total.d < 0n && scaled !== 0n;
  const absN = scaled < 0n ? -scaled : scaled;
  const absD = total.d < 0n ? -total.d : total.d;
  const cents = (absN * 2n + absD) / (absD * 2n);
  return Number(negative ? -cents : cents);
}

export const hasOperator = (expr: string): boolean => /[+\-*/]/.test(expr);

/** Testo per lo schermo: "18,20 + 6,30". */
export function displayExpr(expr: string): string {
  return expr.replace(/[+\-*/]/g, (op) => ` ${{ '+': '+', '-': '−', '*': '×', '/': '÷' }[op]} `).trim();
}

/** Espressione di partenza quando si modifica un movimento esistente. */
export function exprFromCents(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}
