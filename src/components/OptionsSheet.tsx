import { useState } from 'react';
import { addDays, monthLabel } from '../lib/dates';
import { evaluate, exprFromCents } from '../lib/calc';
import { useI18n } from '../lib/i18n';
import { formatMoney } from '../lib/money';
import { sum, spreadRows, type AccRow, type PayRow, type Plan } from '../lib/plan';
import { setLineCents } from '../lib/split';

/** Ricalcola gli importi dopo la modifica di una riga: un'altra riga assorbe la differenza. */
function edit<T extends { cents: number }>(rows: T[], i: number, cents: number, total: number): T[] {
  const out = setLineCents(rows.map((r) => ({ ...r, categoryId: null })), i, cents, total);
  return rows.map((r, k) => ({ ...r, cents: out[k].cents }));
}

/**
 * "Più opzioni": competenza (a quale mese appartiene la spesa, anche spalmata su più mesi)
 * e pagamenti (acconto e saldo). Lavora su una bozza: il piano passa al movimento solo con "Fatto".
 */
export function OptionsSheet({ totalCents, date, plan, notice, currency, onDone, onClose }: {
  totalCents: number;
  date: string;
  plan: Plan;
  notice: boolean;
  currency: string;
  onDone: (plan: Plan) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [acc, setAcc] = useState<AccRow[] | null>(plan.acc);
  const [pay, setPay] = useState<PayRow[] | null>(plan.pay);
  const [accText, setAccText] = useState<string[]>((plan.acc ?? []).map((r) => exprFromCents(r.cents)));
  const [payText, setPayText] = useState<string[]>((plan.pay ?? []).map((r) => exprFromCents(r.cents)));
  const [start, setStart] = useState(plan.acc?.[0]?.month ?? date.slice(0, 7));
  const [months, setMonths] = useState(plan.acc?.length ?? 12);
  const money = (c: number) => formatMoney(c, currency, locale);

  function setSpread(from: string, n: number) {
    const rows = spreadRows(totalCents, from, n);
    setStart(from);
    setMonths(n);
    setAcc(rows);
    setAccText(rows.map((r) => exprFromCents(r.cents)));
  }
  function typeAcc(i: number, text: string) {
    const texts = accText.map((x, k) => (k === i ? text : x));
    const v = evaluate(text);
    if (acc && v !== null) {
      const rows = edit(acc, i, v, totalCents);
      setAcc(rows);
      setAccText(texts.map((x, k) => (k === i ? x : exprFromCents(rows[k].cents))));
    } else setAccText(texts);
  }
  function startMany() {
    const rows: PayRow[] = [{ date, cents: totalCents }, { date: addDays(date, 30), cents: 0 }];
    setPay(rows);
    setPayText(rows.map((r) => exprFromCents(r.cents)));
  }
  function typePay(i: number, text: string) {
    const texts = payText.map((x, k) => (k === i ? text : x));
    const v = evaluate(text);
    if (pay && v !== null) {
      const rows = edit(pay, i, v, totalCents);
      setPay(rows);
      setPayText(texts.map((x, k) => (k === i ? x : exprFromCents(rows[k].cents))));
    } else setPayText(texts);
  }
  function addPay() {
    if (!pay) return;
    const last = pay[pay.length - 1];
    setPay([...pay, { date: addDays(last.date, 30), cents: 0 }]);
    setPayText([...payText, exprFromCents(0)]);
  }
  function dropPay(i: number) {
    if (!pay) return;
    const rows = pay.filter((_, k) => k !== i);
    rows[0] = { ...rows[0], cents: rows[0].cents + pay[i].cents };
    if (rows.length < 2) {
      setPay(null);
      setPayText([]);
      return;
    }
    setPay(rows);
    setPayText(rows.map((r) => exprFromCents(r.cents)));
  }

  const valid = (rows: { cents: number }[] | null) => rows === null || (sum(rows) === totalCents && rows.every((r) => r.cents > 0));
  const ok = valid(acc) && valid(pay);
  const status = (rows: { cents: number }[]) => {
    const rest = totalCents - sum(rows);
    return rest === 0 ? { cls: 'ok', text: t('opt.ok') } : rest > 0 ? { cls: 'warn', text: t('opt.rest', { amount: money(rest) }) } : { cls: 'warn', text: t('opt.over', { amount: money(-rest) }) };
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet opt-sheet" role="dialog" aria-label={t('opt.title')} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2>{t('opt.title')}</h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <i className="ph ph-x" aria-hidden="true" />
          </button>
        </div>
        {notice && <p className="opt-notice">{t('opt.notice')}</p>}

        <h3>{t('opt.acc.title')}</h3>
        <p className="opt-hint">{t('opt.acc.hint')}</p>
        <div className="segmented" role="group" aria-label={t('opt.acc.title')}>
          <button type="button" aria-pressed={acc === null} onClick={() => { setAcc(null); setAccText([]); }}>{t('opt.acc.same')}</button>
          <button type="button" aria-pressed={acc !== null} onClick={() => acc === null && setSpread(start, months)}>{t('opt.acc.spread')}</button>
        </div>
        {acc && (
          <>
            <div className="row-fields">
              <label className="grow">{t('opt.from')}
                <input type="month" value={start} onChange={(e) => e.target.value && setSpread(e.target.value, months)} />
              </label>
              <label className="grow">{t('opt.months')}
                <input type="number" inputMode="numeric" min={2} max={60} value={months}
                  onChange={(e) => { const n = Math.min(60, Math.max(2, Math.floor(Number(e.target.value)) || 2)); setSpread(start, n); }} />
              </label>
            </div>
            <div className="opt-rows">
              {acc.map((r, i) => (
                <div key={r.month} className="opt-row">
                  <span>{monthLabel(r.month, locale)}</span>
                  <input aria-label={`${t('opt.amount')} ${r.month}`} inputMode="decimal" value={accText[i] ?? ''} onChange={(e) => typeAcc(i, e.target.value)} />
                </div>
              ))}
            </div>
            <p className={`split-status ${status(acc).cls}`}>{status(acc).text}</p>
          </>
        )}

        <h3>{t('opt.pay.title')}</h3>
        <p className="opt-hint">{t('opt.pay.hint')}</p>
        <div className="segmented" role="group" aria-label={t('opt.pay.title')}>
          <button type="button" aria-pressed={pay === null} onClick={() => { setPay(null); setPayText([]); }}>{t('opt.pay.one')}</button>
          <button type="button" aria-pressed={pay !== null} onClick={() => pay === null && startMany()}>{t('opt.pay.many')}</button>
        </div>
        {pay && (
          <>
            <div className="opt-rows">
              {pay.map((r, i) => (
                <div key={i} className="opt-row pay">
                  <input type="date" aria-label={`${t('opt.date')} ${i + 1}`} value={r.date}
                    onChange={(e) => e.target.value && setPay(pay.map((p, k) => (k === i ? { ...p, date: e.target.value } : p)))} />
                  <input aria-label={`${t('opt.amount')} ${i + 1}`} inputMode="decimal" value={payText[i] ?? ''} onChange={(e) => typePay(i, e.target.value)} />
                  <button type="button" className="icon-btn" aria-label={t('opt.remove')} onClick={() => dropPay(i)}>
                    <i className="ph ph-trash" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="ghost" onClick={addPay}>
              <i className="ph ph-plus" aria-hidden="true" /> {t('opt.pay.add')}
            </button>
            <p className={`split-status ${status(pay).cls}`}>{status(pay).text}</p>
          </>
        )}

        <button type="button" className="primary split-save" disabled={!ok} onClick={() => onDone({ acc, pay })}>
          {t('opt.done')}
        </button>
      </div>
    </div>
  );
}
