import { useEffect, useMemo, useState } from 'react';
import { evaluate, exprFromCents } from '../lib/calc';
import { merchantDisplayName } from '../lib/data';
import type { QuadraDB } from '../lib/db';
import { todayISO } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { FX_COMMON, FX_CURRENCIES } from '../lib/fx';
import { useI18n } from '../lib/i18n';
import { formatMoney, toCents } from '../lib/money';
import { endRecurrence, savePlan, saveRecurrence } from '../lib/recurring';
import { splitInstallments } from '../lib/recurrence';
import type { IntervalUnit, Recurrence, TxKind } from '../lib/types';

type FormKind = 'fixed' | 'variable' | 'plan';

/**
 * Nuova ricorrenza (fissa, variabile) o piano rate; in modifica per fisse e
 * variabili. Un piano esistente si può solo terminare.
 */
export function RecurrenceForm({ db, master, id, currency, onBack, onDone }: {
  db: QuadraDB;
  master: MasterData;
  id?: string;
  currency: string;
  onBack: () => void;
  onDone: (msg: 'saved' | 'ended') => void;
}) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const [existing, setExisting] = useState<Recurrence | null>(null);
  const [loaded, setLoaded] = useState(!id);

  const [kind, setKind] = useState<FormKind>('fixed');
  const [txKind, setTxKind] = useState<TxKind>('expense');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [cur, setCur] = useState(currency); // valuta della ricorrenza: si sceglie alla creazione
  const [categoryId, setCategoryId] = useState('');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [every, setEvery] = useState('1');
  const [unit, setUnit] = useState<IntervalUnit>('month');
  const [day, setDay] = useState<string>(String(Number(today.slice(8, 10))));
  const [start, setStart] = useState(today);
  const [until, setUntil] = useState('');
  const [count, setCount] = useState('12');
  const [mode, setMode] = useState<'auto' | 'confirm'>('auto');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const r = await db.recurrences.get(id);
      if (r) {
        setExisting(r);
        setKind(r.kind);
        setTxKind(r.tx_kind);
        setName(r.name);
        setAmount(exprFromCents(toCents(r.reference_amount ?? 0)));
        setCur(r.currency);
        setCategoryId(r.category_id);
        setNote(r.note ?? '');
        setEvery(String(r.interval_n ?? 1));
        setUnit(r.interval_unit ?? 'month');
        setDay(r.anchor === 'end_of_month' ? 'last' : String(r.anchor_day ?? Number((r.start_date ?? today).slice(8, 10))));
        setStart(r.start_date ?? today);
        setUntil(r.end_date ?? '');
        setCount(String(r.max_occurrences ?? 12));
        setMerchant(await merchantDisplayName(db, r.merchant_id));
        const first = await db.installments.where('recurrence_id').equals(r.id).first();
        if (first) setMode(first.mode);
      }
      setLoaded(true);
    })();
  }, [db, id, today]);

  const isPlan = kind === 'plan';
  const readOnly = existing?.kind === 'plan';
  const cents = evaluate(amount);
  const n = Math.max(1, Math.min(120, Math.floor(Number(count)) || 0));
  const categories = useMemo(() => master.categoriesOf(isPlan ? 'expense' : txKind), [master, txKind, isPlan]);
  const groups = useMemo(
    () => master.macros.filter((m) => m.tx_kind === (isPlan ? 'expense' : txKind)).map((m) => ({ macro: m, cats: categories.filter((c) => c.macro_id === m.id) })).filter((g) => g.cats.length),
    [master.macros, categories, txKind, isPlan],
  );
  useEffect(() => {
    // cambiando Uscita/Entrata la categoria scelta può non valere più
    if (categoryId && !categories.some((c) => c.id === categoryId)) setCategoryId('');
  }, [categories, categoryId]);

  const intervalN = Math.max(1, Math.floor(Number(every)) || 1);
  const valid =
    name.trim() !== '' && cents !== null && cents > 0 && categoryId !== '' && /^\d{4}-\d{2}-\d{2}$/.test(start) &&
    (!isPlan || (n >= 2 && n <= 120)) && (until === '' || until >= start);
  const preview = isPlan && cents && n >= 2 ? splitInstallments(cents, n) : null;

  async function save() {
    setTried(true);
    if (!valid || busy || cents === null) return;
    setBusy(true);
    if (isPlan) {
      await savePlan(db, { name, txKind: 'expense', totalCents: cents, count: n, firstDue: start, categoryId, merchantName: merchant, note, mode });
    } else {
      const monthly = unit === 'month' || unit === 'year';
      await saveRecurrence(
        db,
        {
          id: existing?.id,
          kind: kind as 'fixed' | 'variable',
          txKind,
          name,
          cents,
          currency: cur,
          categoryId,
          merchantName: merchant,
          note,
          schedule: {
            interval_n: intervalN,
            interval_unit: unit,
            anchor: monthly ? (day === 'last' ? 'end_of_month' : 'day_of_month') : null,
            anchor_day: monthly && day !== 'last' ? Number(day) : null,
            start_date: start,
            end_date: until || null,
            max_occurrences: null,
          },
        },
        today,
      );
    }
    onDone('saved');
  }

  async function end() {
    if (!existing) return;
    if (!confirmEnd) {
      setConfirmEnd(true);
      setTimeout(() => setConfirmEnd(false), 4000);
      return;
    }
    await endRecurrence(db, existing.id, today);
    onDone('ended');
  }

  if (!loaded) return <main className="page" aria-busy="true" />;

  const monthly = unit === 'month' || unit === 'year';
  return (
    <main className="page recform">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={onBack}>
          <i className="ph ph-caret-left" aria-hidden="true" />
        </button>
        <h1 className="grow-title">{t(existing ? 'rec.f.title.edit' : 'rec.f.title.new')}</h1>
      </header>

      <div className="segmented">
        {(['fixed', 'variable', 'plan'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} disabled={existing?.kind === 'plan' ? kind !== k : !!existing && k === 'plan'} onClick={() => setKind(k)}>
            {t(`rec.kind.${k}`)}
          </button>
        ))}
      </div>

      {!isPlan && (
        <div className="segmented">
          <button type="button" className="expense" aria-pressed={txKind === 'expense'} disabled={readOnly} onClick={() => setTxKind('expense')}>{t('kind.expense')}</button>
          <button type="button" className="income" aria-pressed={txKind === 'income'} disabled={readOnly} onClick={() => setTxKind('income')}>{t('kind.income')}</button>
        </div>
      )}

      <fieldset className="card form" disabled={readOnly}>
        <label>
          {t('rec.f.name')}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </label>
        <label>
          {t(isPlan ? 'rec.f.total' : 'rec.f.amount')} ({isPlan ? currency : cur})
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace('.', ','))} autoComplete="off" />
        </label>
        {!isPlan && !existing && (
          <label>
            {t('opt.cur.title')}
            <select value={cur} onChange={(e) => setCur(e.target.value)}>
              <option value={currency}>{t('opt.cur.eur')} ({currency})</option>
              {[...FX_COMMON, ...FX_CURRENCIES.filter((c) => !FX_COMMON.includes(c)).sort()].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        {!isPlan && cur !== currency && <p className="muted small">{t('rec.f.hint.foreign')}</p>}
        <label>
          {t('rec.f.category')}
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('rec.f.pickCategory')}</option>
            {groups.map((g) => (
              <optgroup key={g.macro.id} label={g.macro.name}>
                {g.cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          {t('rec.f.merchant')}
          <input type="text" value={merchant} onChange={(e) => setMerchant(e.target.value)} autoComplete="off" />
        </label>

        {isPlan ? (
          <>
            <div className="row-fields">
              <label className="grow">
                {t('rec.f.count')}
                <input type="text" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label className="grow">
                {t('rec.f.firstDue')}
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
            </div>
            <label>
              {t('rec.f.mode')}
              <select value={mode} onChange={(e) => setMode(e.target.value as 'auto' | 'confirm')}>
                <option value="auto">{t('rec.mode.auto')}</option>
                <option value="confirm">{t('rec.mode.confirm')}</option>
              </select>
            </label>
            {preview && (
              <p className="muted small">
                {t('rec.f.preview', { n, amount: formatMoney(preview[0], currency, locale), last: formatMoney(preview[preview.length - 1], currency, locale) })}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="row-fields">
              <label className="grow">
                {t('rec.f.every')}
                <input type="text" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label className="grow">
                &nbsp;
                <select value={unit} onChange={(e) => setUnit(e.target.value as IntervalUnit)}>
                  {(['day', 'week', 'month', 'year'] as const).map((u) => <option key={u} value={u}>{t(`rec.unit.${u}`)}</option>)}
                </select>
              </label>
            </div>
            {monthly && (
              <label>
                {t('rec.f.day')}
                <select value={day} onChange={(e) => setDay(e.target.value)}>
                  {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
                  <option value="last">{t('rec.f.lastDay')}</option>
                </select>
              </label>
            )}
            <div className="row-fields">
              <label className="grow">
                {t('rec.f.start')}
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="grow">
                {t('rec.f.until')}
                <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
              </label>
            </div>
          </>
        )}
        <label>
          {t('rec.f.note')}
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        </label>
      </fieldset>

      {kind === 'variable' && <p className="muted small">{t('rec.f.hint.variable')}</p>}
      {existing && !readOnly && <p className="muted small">{t('rec.f.hint.edit')}</p>}
      {readOnly && <p className="muted small">{t('rec.f.hint.plan')}</p>}
      {tried && !valid && <p className="error">{t('rec.f.invalid')}</p>}

      {!readOnly && (
        <button type="button" className="primary" onClick={() => void save()} disabled={busy}>{t('rec.f.save')}</button>
      )}
      {existing && existing.active && (
        <button type="button" className={confirmEnd ? 'danger' : 'secondary'} onClick={() => void end()}>
          {confirmEnd ? t('rec.f.endConfirm') : t('rec.f.end')}
        </button>
      )}
    </main>
  );
}
