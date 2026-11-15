import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { displayExpr, evaluate, exprFromCents, hasOperator, press, type CalcKey } from '../lib/calc';
import { deleteTransaction, gridCategories, merchantStats, saveTransaction } from '../lib/data';
import type { QuadraDB } from '../lib/db';
import { addDays, shortDate, todayISO } from '../lib/dates';
import { addLine, removeLine, setLineCategory, setLineCents, sortLines, splitStatus, startSplit, type SplitLine } from '../lib/split';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { formatMoney, toCents } from '../lib/money';
import type { Category, Transaction, TxKind } from '../lib/types';

const KEYS: { key: CalcKey; label: string; op?: boolean }[] = [
  { key: '7', label: '7' }, { key: '8', label: '8' }, { key: '9', label: '9' }, { key: '/', label: '÷', op: true },
  { key: '4', label: '4' }, { key: '5', label: '5' }, { key: '6', label: '6' }, { key: '*', label: '×', op: true },
  { key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3' }, { key: '-', label: '−', op: true },
  { key: ',', label: ',' }, { key: '0', label: '0' }, { key: 'back', label: '', op: true }, { key: '+', label: '+', op: true },
];
const KEYBOARD: Record<string, CalcKey> = { '.': ',', Backspace: 'back', x: '*', X: '*' };

/**
 * Inserimento rapido: importo, esercizio, tap sulla categoria che salva.
 * Con txId modifica un movimento esistente (stessa schermata, già compilata).
 */
export function Entry({ db, master, kind: initialKind, txId, currency, onBack, onSaved, onDeleted }: {
  db: QuadraDB;
  master: MasterData;
  kind: TxKind;
  txId?: string;
  currency: string;
  onBack: () => void;
  onSaved: (tx: Transaction, isNew: boolean) => void;
  onDeleted: () => void;
}) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const [kind, setKind] = useState<TxKind>(initialKind);
  const [expr, setExpr] = useState('');
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [original, setOriginal] = useState<Transaction | null>(null);
  const [loaded, setLoaded] = useState(!txId);
  const [showAll, setShowAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grid, setGrid] = useState<Category[]>([]);
  // dividi scontrino: null = movimento normale; altrimenti le righe e quale importo sta scrivendo il tastierino
  const [splitLines, setSplitLines] = useState<SplitLine[] | null>(null);
  const [target, setTarget] = useState<'total' | number>('total');
  const [lineExpr, setLineExpr] = useState('');
  const [pickLine, setPickLine] = useState<number | null>(null);

  // modifica: carica il movimento una volta sola
  useEffect(() => {
    if (!txId) return;
    void (async () => {
      const tx = await db.transactions.get(txId);
      if (tx) {
        const m = tx.merchant_id ? await db.merchants.get(tx.merchant_id) : undefined;
        setOriginal(tx);
        setKind(tx.tx_kind);
        setExpr(exprFromCents(toCents(tx.total)));
        setMerchant(m?.name ?? '');
        setDate(tx.tx_date);
        setNote(tx.note ?? '');
        if (tx.lines.length > 1) {
          setSplitLines(sortLines(tx.lines).map((l) => ({ categoryId: l.category_id, cents: toCents(l.amount) })));
        }
      }
      setLoaded(true);
    })();
  }, [db, txId]);

  const categories = useMemo(() => master.categoriesOf(kind), [master, kind]);
  useEffect(() => {
    let alive = true;
    void gridCategories(db, kind, categories).then((g) => alive && setGrid(g));
    return () => {
      alive = false;
    };
  }, [db, kind, categories]);

  const stats = useLiveQuery(() => merchantStats(db), [db]);
  const typed = merchant.trim().toLowerCase();
  const chips = useMemo(() => {
    const list = stats ?? [];
    return (typed ? list.filter((s) => s.merchant.name.toLowerCase().includes(typed)) : list).slice(0, 4);
  }, [stats, typed]);
  const known = typed ? (stats ?? []).find((s) => s.merchant.name.toLowerCase() === typed) : undefined;

  // categoria in evidenza: quella del movimento in modifica, altrimenti quella abituale dell'esercizio
  const currentId = original?.tx_kind === kind ? original.lines[0]?.category_id : undefined;
  const suggestedId = currentId ?? known?.topCategory[kind] ?? undefined;
  const shown = useMemo(() => {
    const first = suggestedId ? categories.find((c) => c.id === suggestedId) : undefined;
    if (!first) return grid;
    return [first, ...grid.filter((c) => c.id !== first.id)].slice(0, Math.max(grid.length, 1));
  }, [grid, categories, suggestedId]);

  const cents = evaluate(expr);
  const valid = cents !== null && cents > 0;

  // un tasto va all'importo totale oppure, in modalità divisione, alla riga che si sta scrivendo
  function pressKey(key: CalcKey) {
    if (splitLines && target !== 'total') {
      const next = press(lineExpr, key);
      setLineExpr(next);
      setSplitLines(setLineCents(splitLines, target, evaluate(next) ?? 0, cents ?? 0));
    } else {
      setExpr((x) => press(x, key));
    }
  }

  // tastiera fisica, comoda dal PC: cifre e operatori quando non si sta scrivendo in un campo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = KEYBOARD[e.key] ?? e.key;
      if (KEYS.some((k) => k.key === key)) {
        e.preventDefault();
        pressKey(key as CalcKey);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const status = splitLines ? splitStatus(cents ?? 0, splitLines) : null;

  function startDivide() {
    if (!valid || kind !== 'expense') return;
    setSplitLines(startSplit(cents, suggestedId ?? null));
    setTarget(1);
    setLineExpr('');
  }

  function undoSplit() {
    setSplitLines(null);
    setTarget('total');
    setLineExpr('');
  }

  function editLine(i: number) {
    setTarget(i);
    setLineExpr('');
  }

  function dropLine(i: number) {
    if (!splitLines) return;
    const next = removeLine(splitLines, i);
    setTarget('total');
    setLineExpr('');
    setSplitLines(next.length < 2 ? null : next); // con una riga sola torna un movimento normale
  }

  function changeKind(k: TxKind) {
    setKind(k);
    if (k === 'income') undoSplit(); // le entrate non si dividono
  }

  async function saveSplit() {
    if (!splitLines || !status?.ok || busy) return;
    setBusy(true);
    const lines = splitLines.map((l) => ({ categoryId: l.categoryId!, cents: l.cents }));
    const tx = await saveTransaction(db, { id: original?.id, kind, cents: cents!, date, merchantName: merchant, note, categoryId: lines[0].categoryId, split: lines });
    onSaved(tx, !original);
  }

  // un tap su una categoria salva (movimento normale) oppure la assegna alla riga in scelta
  function pickCategory(categoryId: string) {
    if (pickLine !== null && splitLines) {
      setSplitLines(setLineCategory(splitLines, pickLine, categoryId));
      setPickLine(null);
      return;
    }
    void save(categoryId);
  }

  async function save(categoryId: string) {
    if (!valid || busy) return; // busy: un doppio tap salva una volta sola
    setBusy(true);
    const tx = await saveTransaction(db, { id: original?.id, kind, cents, date, merchantName: merchant, note, categoryId });
    onSaved(tx, !original);
  }

  async function remove() {
    if (!original) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    await deleteTransaction(db, original.id);
    onDeleted();
  }

  const dateLabel =
    date === today ? `${t('date.today')}, ${shortDate(date, locale)}`
    : date === addDays(today, -1) ? `${t('date.yesterday')}, ${shortDate(date, locale)}`
    : shortDate(date, locale);
  const hint =
    cents === null ? t('entry.hint.empty')
    : !valid ? t('entry.hint.positive')
    : known && suggestedId && !currentId ? t('entry.suggested', { name: known.merchant.name })
    : '';

  const categoryButton = (c: Category, small = false) => {
    const macro = master.macroById.get(c.macro_id);
    const color = c.shade ?? macro?.color ?? '#8B93A0';
    return (
      <button key={c.id} type="button" className={small ? 'cat-row' : 'cat-btn'} disabled={!valid || busy} onClick={() => pickCategory(c.id)}>
        <span className={c.id === suggestedId ? 'cat-icon ring' : 'cat-icon'} style={{ background: `${color}2E`, color, ['--ring' as string]: color }}>
          <i className={`ph-duotone ph-${c.icon}`} aria-hidden="true" />
        </span>
        <span className="cat-name">{c.name}</span>
      </button>
    );
  };

  if (!loaded) return <main className="entry" aria-busy="true" />;

  return (
    <main className="entry">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.cancel')} onClick={onBack}>
          <i className="ph ph-caret-left" aria-hidden="true" />
        </button>
        <div className="segmented" role="group" aria-label={t('entry.kind')}>
          {(['expense', 'income'] as TxKind[]).map((k) => (
            <button key={k} type="button" className={k} aria-pressed={kind === k} onClick={() => changeKind(k)}>
              {t(`kind.${k}`)}
            </button>
          ))}
        </div>
        {original ? (
          <button type="button" className={confirmDelete ? 'danger' : 'icon-btn'} aria-label={t('entry.delete')} onClick={() => void remove()}>
            {confirmDelete ? t('entry.delete.confirm') : <i className="ph ph-trash" aria-hidden="true" />}
          </button>
        ) : (
          <span className="icon-btn" />
        )}
      </header>

      {splitLines ? (
        <button type="button" className={`amount as-button ${target === 'total' ? 'active' : ''}`} aria-label={t('entry.split.total')} onClick={() => { setTarget('total'); setLineExpr(''); }}>
          <span className="expr num">{hasOperator(expr) ? displayExpr(expr) : ' '}</span>
          <span className={`total num ${cents !== null && !valid ? 'invalid' : ''}`}>{formatMoney(cents ?? 0, currency, locale)}</span>
        </button>
      ) : (
        <div className="amount" aria-live="polite">
          <span className="expr num">{hasOperator(expr) ? displayExpr(expr) : ' '}</span>
          <span className={`total num ${cents !== null && !valid ? 'invalid' : ''}`}>{formatMoney(cents ?? 0, currency, locale)}</span>
        </div>
      )}

      <div className="fields">
        <label className="field">
          <i className="ph ph-storefront" aria-hidden="true" />
          <input
            type="text"
            aria-label={t('entry.merchant')}
            placeholder={t('entry.merchant')}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="done"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        {chips.length > 0 && (
          <div className="chips" aria-label={t('entry.merchant.frequent')}>
            {chips.map((s) => (
              <button
                key={s.merchant.id}
                type="button"
                className={s.merchant.name.toLowerCase() === typed ? 'on' : ''}
                onClick={() => setMerchant(s.merchant.name)}
              >
                {s.merchant.name}
              </button>
            ))}
          </div>
        )}
        <div className="row-fields">
          <label className="pill-field date">
            <i className="ph ph-calendar-blank" aria-hidden="true" />
            <span>{dateLabel}</span>
            <input type="date" aria-label={t('entry.date')} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <label className="pill-field grow">
            <i className="ph ph-note-pencil" aria-hidden="true" />
            <input
              type="text"
              aria-label={t('entry.note')}
              placeholder={t('entry.note')}
              autoComplete="off"
              enterKeyHint="done"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
        </div>
      </div>

      {splitLines && status ? (
        <section className="card split-card">
          <div className="row">
            <h2>{t('entry.split.title')}</h2>
            <button type="button" className="ghost" onClick={undoSplit}>{t('entry.split.undo')}</button>
          </div>
          {splitLines.map((l, i) => {
            const c = l.categoryId ? master.categoryById.get(l.categoryId) : undefined;
            const macro = c ? master.macroById.get(c.macro_id) : undefined;
            const color = c?.shade ?? macro?.color ?? '#8B93A0';
            const active = target === i;
            return (
              <div key={i} className={`split-row ${active ? 'active' : ''}`}>
                <button type="button" className="split-cat" onClick={() => setPickLine(i)}>
                  <span className="cat-icon small" style={{ background: `${color}2E`, color }}>
                    <i className={`ph-duotone ph-${c?.icon ?? 'question'}`} aria-hidden="true" />
                  </span>
                  <span className={c ? 'cat-name' : 'cat-name muted'}>{c?.name ?? t('entry.split.pick')}</span>
                </button>
                <button type="button" className="split-amt num" onClick={() => editLine(i)}>
                  {active && hasOperator(lineExpr) ? displayExpr(lineExpr) : formatMoney(l.cents, currency, locale)}
                </button>
                <button type="button" className="icon-btn" aria-label={t('entry.split.remove')} onClick={() => dropLine(i)}>
                  <i className="ph ph-x" aria-hidden="true" />
                </button>
              </div>
            );
          })}
          <div className="split-foot">
            <button type="button" className="ghost" onClick={() => { setSplitLines(addLine(splitLines)); setTarget(splitLines.length); setLineExpr(''); }}>
              <i className="ph ph-plus" aria-hidden="true" />
              {t('entry.split.add')}
            </button>
            <span className={`split-status ${status.rest === 0 ? 'ok' : 'warn'}`}>
              {status.rest === 0
                ? t('entry.split.done')
                : status.rest > 0
                  ? t('entry.split.rest', { amount: formatMoney(status.rest, currency, locale) })
                  : t('entry.split.over', { amount: formatMoney(-status.rest, currency, locale) })}
            </span>
          </div>
          <button type="button" className="primary split-save" disabled={!status.ok || busy} onClick={() => void saveSplit()}>
            {t('entry.split.save')}
          </button>
        </section>
      ) : (
      <section className="card grid-card">
        <div className="row">
          <h2 className={hint ? 'hinting' : ''}>{hint || t('entry.tap')}</h2>
          {kind === 'expense' && (
            <button type="button" className="ghost split-open" disabled={!valid || busy} onClick={startDivide}>
              <i className="ph ph-arrows-split" aria-hidden="true" />
              {t('entry.split')}
            </button>
          )}
        </div>
        <div className="cat-grid">
          {shown.map((c) => categoryButton(c))}
          {categories.length > shown.length && (
            <button type="button" className="cat-btn" disabled={!valid || busy} onClick={() => setShowAll(true)}>
              <span className="cat-icon" style={{ background: '#9AA3AF2E', color: '#9AA3AF' }}>
                <i className="ph-duotone ph-squares-four" aria-hidden="true" />
              </span>
              <span className="cat-name">{t('entry.all')}</span>
            </button>
          )}
        </div>
      </section>
      )}

      <div className="keypad">
        {KEYS.map((k) => (
          <button
            key={k.key}
            type="button"
            className={k.op ? 'op' : ''}
            aria-label={k.key === 'back' ? t('entry.backspace') : undefined}
            onClick={() => pressKey(k.key)}
          >
            {k.key === 'back' ? <i className="ph ph-backspace" aria-hidden="true" /> : k.label}
          </button>
        ))}
      </div>

      {(showAll || pickLine !== null) && (
        <div className="sheet-backdrop" onClick={() => { setShowAll(false); setPickLine(null); }}>
          <div className="sheet" role="dialog" aria-label={t('entry.all.title')} onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2>{t('entry.all.title')}</h2>
              <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => { setShowAll(false); setPickLine(null); }}>
                <i className="ph ph-x" aria-hidden="true" />
              </button>
            </div>
            {pickLine !== null && <div className="cat-grid sheet-grid">{shown.map((c) => categoryButton(c))}</div>}
            {master.macros.filter((m) => m.tx_kind === kind).map((m) => (
              <div key={m.id}>
                <h3>{m.name}</h3>
                {categories.filter((c) => c.macro_id === m.id).map((c) => categoryButton(c, true))}
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
