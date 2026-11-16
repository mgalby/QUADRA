import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { buildPreview, catKey, csvCell, decodeCsv, parseCsv, readTable, type CsvTable } from '../lib/csv';
import type { QuadraDB } from '../lib/db';
import { shortDate } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { categoryInfos, existingTxs, merchantTopMap, runImport, undoImport, type ImportBatch } from '../lib/importer';
import { formatMoney } from '../lib/money';
import type { Nav } from '../lib/nav';
import { categoryNameProblem, cleanName, macroFlag, nextSortOrder } from '../lib/master';
import { blankSync, writeMaster } from '../lib/masterWrite';
import type { Category, Flag, TxKind } from '../lib/types';

/** Importa movimenti da un file CSV: scelta del file, anteprima con le correzioni, conferma. */
export function Import({ db, master, nav, currency, userId, onSync }: { db: QuadraDB; master: MasterData; nav: Nav; currency: string; userId: string; onSync: () => void }) {
  const { t, locale } = useI18n();
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<CsvTable | null>(null);
  const [positiveIs, setPositiveIs] = useState<TxKind>('expense');
  const [catMap, setCatMap] = useState<Record<string, string>>({});
  const [withDup, setWithDup] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<ImportBatch | null>(null);
  const [undone, setUndone] = useState(false);

  // "Crea": una categoria nuova per un nome che il file usa e l'app non conosce
  const [draft, setDraft] = useState<{ key: string; kind: TxKind; name: string; macroId: string; flag: Flag } | null>(null);
  const allCats = useMemo(() => [...master.categoryById.values()], [master]);
  const draftProblem = draft ? categoryNameProblem(draft.name, draft.kind, null, allCats, master.macroById) : null;
  const usualFlag = (macroId: string): Flag =>
    macroFlag(master.categories.filter((c) => c.macro_id === macroId)) === 'discretionary' ? 'discretionary' : 'essential';
  function startDraft(g: { key: string; name: string; kind: TxKind }) {
    const macroId = master.macros.find((m) => m.tx_kind === g.kind)?.id ?? '';
    setDraft({ key: g.key, kind: g.kind, name: g.name, macroId, flag: usualFlag(macroId) });
  }
  async function createCategory() {
    const macro = draft ? master.macroById.get(draft.macroId) : undefined;
    if (!draft || !macro || draftProblem) return;
    const row: Category = {
      ...blankSync(userId), macro_id: macro.id, name: cleanName(draft.name), icon: macro.icon, shade: null,
      flag: draft.kind === 'income' ? 'essential' : draft.flag, pinned_slot: null,
      sort_order: nextSortOrder(allCats.filter((c) => c.macro_id === macro.id && !c.deleted_at)), archived: false,
    };
    await writeMaster(db, { categories: [row] });
    setCatMap((m) => ({ ...m, [draft.key]: row.id }));
    setDraft(null);
    onSync();
  }

  const merchantTop = useLiveQuery(() => merchantTopMap(db), [db]);
  const existing = useLiveQuery(() => existingTxs(db), [db]);
  const cats = useMemo(() => categoryInfos(master.categories, master.macroById), [master]);

  const items = useMemo(
    () => (table && merchantTop && existing ? buildPreview(table, { categories: cats, merchantTop, existing, catMap, positiveIs }) : []),
    [table, merchantTop, existing, cats, catMap, positiveIs],
  );
  const toImport = items.filter((i) => i.status === 'ok' || (i.status === 'dup' && withDup.has(i.row.line)));
  const dups = items.filter((i) => i.status === 'dup');
  const errors = items.filter((i) => i.status === 'error');
  const unassigned = items.filter((i) => i.status === 'nocat');
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; kind: TxKind; n: number }>();
    for (const i of unassigned) {
      const key = catKey(i.row.category, i.kind);
      const g = m.get(key) ?? { key, name: i.row.category.trim(), kind: i.kind, n: 0 };
      g.n++;
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [unassigned]);

  const money = (kind: TxKind, cents: number) => formatMoney(kind === 'expense' ? -cents : cents, currency, locale, { sign: true });

  async function pick(file: File | undefined) {
    if (!file) return;
    setDone(null);
    setUndone(false);
    setCatMap({});
    setWithDup(new Set());
    setFileName(file.name);
    setTable(readTable(parseCsv(decodeCsv(await file.arrayBuffer()))));
  }

  function download() {
    const exp = cats.find((c) => c.kind === 'expense')?.name ?? 'Spesa alimentare';
    const inc = cats.find((c) => c.kind === 'income')?.name ?? 'Stipendio';
    const head = ['Data', 'Importo', 'Segno', 'Categoria', 'Esercizio', 'Note', 'Competenza'];
    const rows = [
      ['16/11/2026', '45,20', 'U', exp, 'Coop', 'Spesa settimanale', ''],
      ['27/11/2026', '1500,00', 'E', inc, '', '', '2026-11'],
    ];
    const text = [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`﻿${text}\r\n`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quadra-modello-import.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function confirm() {
    setBusy(0);
    try {
      const batch = await runImport(db, toImport, fileName, currency, setBusy);
      setDone(batch);
      setTable(null);
      onSync();
    } finally {
      setBusy(null);
    }
  }

  const problem = table?.problem;
  const needsSignChoice = !!table && !table.problem && !table.hasNegative && !table.rows.every((r) => r.sign);

  return (
    <main className="page">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={nav.back}>
          <i className="ph ph-caret-left" aria-hidden="true" />
        </button>
        <h1>{t('imp.title')}</h1>
        <span className="icon-btn" />
      </header>

      {done && (
        <section className="card" role="status">
          <p className="strong">{t('imp.done', { n: done.ids.length })}</p>
          <p className="muted small">{undone ? t('imp.undone') : t('imp.done.hint')}</p>
          <div className="row">
            {!undone && (
              <button type="button" className="ghost" onClick={() => void undoImport(db, done).then(() => { setUndone(true); onSync(); })}>
                <i className="ph ph-arrow-counter-clockwise" aria-hidden="true" /> {t('imp.undo')}
              </button>
            )}
            <button type="button" className="primary" onClick={() => nav.tab({ name: 'movements' })}>{t('imp.see')}</button>
          </div>
        </section>
      )}

      <section className="card">
        <p className="muted small">{t('imp.hint')}</p>
        <div className="row">
          <label className="ghost file-btn">
            <i className="ph ph-file-csv" aria-hidden="true" /> {fileName && table ? fileName : t('imp.choose')}
            <input type="file" accept=".csv,.txt,text/csv,text/plain" aria-label={t('imp.choose')} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <button type="button" className="ghost" onClick={download}>
            <i className="ph ph-download-simple" aria-hidden="true" /> {t('imp.template')}
          </button>
        </div>
      </section>

      {problem && <p className="error" role="alert">{t(problem === 'columns' ? 'imp.problem.columns' : 'imp.problem.empty')}</p>}

      {table && !problem && (
        <>
          <section className="card" aria-label={t('imp.summary')}>
            <p className="strong">{t('imp.rows', { n: table.rows.length })}</p>
            <p className="small">
              {t('imp.sum.ok', { n: toImport.length })}
              {dups.length > 0 && ` · ${t('imp.sum.dup', { n: dups.length })}`}
              {unassigned.length > 0 && ` · ${t('imp.sum.nocat', { n: unassigned.length })}`}
              {errors.length > 0 && ` · ${t('imp.sum.err', { n: errors.length })}`}
            </p>
            {needsSignChoice && (
              <>
                <p className="muted small">{t('imp.positive')}</p>
                <div className="segmented" role="group" aria-label={t('imp.positive')}>
                  {(['expense', 'income'] as const).map((k) => (
                    <button key={k} type="button" className={k} aria-pressed={positiveIs === k} onClick={() => setPositiveIs(k)}>{t(`imp.kind.${k}`)}</button>
                  ))}
                </div>
              </>
            )}
          </section>

          {groups.length > 0 && (
            <section className="card">
              <h2>{t('imp.cats')}</h2>
              <p className="muted small">{t('imp.cats.hint')}</p>
              {groups.map((g) => (
                <label key={g.key} className="imp-group">
                  <span className="grow">
                    <span className="strong">{g.name || t('imp.nocatname')}</span>
                    <span className="muted tiny"> · {t(`imp.kind.${g.kind}`)} · {t('imp.n', { n: g.n })}</span>
                  </span>
                  <select aria-label={g.name || t('imp.nocatname')} value={catMap[g.key] ?? ''} onChange={(e) => setCatMap((m) => ({ ...m, [g.key]: e.target.value }))}>
                    <option value="">{t('imp.unassigned')}</option>
                    {master.macros.filter((m) => m.tx_kind === g.kind).map((m) => (
                      <optgroup key={m.id} label={m.name}>
                        {master.categories.filter((c) => c.macro_id === m.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <button type="button" className="ghost" onClick={(e) => { e.preventDefault(); startDraft(g); }}>
                    <i className="ph ph-plus" aria-hidden="true" /> {t('imp.create')}
                  </button>
                </label>
              ))}
            </section>
          )}

          {dups.length > 0 && (
            <section className="card">
              <h2>{t('imp.dups')}</h2>
              <p className="muted small">{t('imp.dups.hint')}</p>
              {dups.map((i) => (
                <label key={i.row.line} className="imp-row">
                  <input type="checkbox" checked={withDup.has(i.row.line)} onChange={(e) => setWithDup((s) => { const n = new Set(s); if (e.target.checked) n.add(i.row.line); else n.delete(i.row.line); return n; })} />
                  <span className="grow">{shortDate(i.row.date!, locale)} · {i.row.merchant || i.row.category || '—'}</span>
                  <span className="num strong">{money(i.kind, i.cents)}</span>
                </label>
              ))}
            </section>
          )}

          {errors.length > 0 && (
            <section className="card">
              <h2>{t('imp.errors')}</h2>
              {errors.slice(0, 20).map((i) => (
                <p key={i.row.line} className="small error">{t('imp.line', { n: i.row.line })}: {t(`imp.err.${i.row.error}` as 'imp.err.date')}</p>
              ))}
              {errors.length > 20 && <p className="muted small">{t('imp.more', { n: errors.length - 20 })}</p>}
            </section>
          )}

          {toImport.length > 0 && (
            <section className="card">
              <h2>{t('imp.preview')}</h2>
              {toImport.slice(0, 8).map((i) => (
                <div key={i.row.line} className="imp-row">
                  <span className="grow">
                    {shortDate(i.row.date!, locale)} · {i.row.merchant || cats.find((c) => c.id === i.categoryId)?.name}
                    <span className="muted tiny"> · {cats.find((c) => c.id === i.categoryId)?.name}{i.from === 'merchant' ? ` (${t('imp.fromMerchant')})` : ''}</span>
                  </span>
                  <span className="num strong">{money(i.kind, i.cents)}</span>
                </div>
              ))}
              {toImport.length > 8 && <p className="muted small">{t('imp.more', { n: toImport.length - 8 })}</p>}
            </section>
          )}

          <button type="button" className="primary" disabled={toImport.length === 0 || busy !== null} onClick={() => void confirm()}>
            {busy !== null ? t('imp.busy', { done: busy, n: toImport.length }) : t('imp.go', { n: toImport.length })}
          </button>
        </>
      )}

      {draft && (
        <div className="sheet-backdrop" onClick={() => setDraft(null)}>
          <div className="sheet md-sheet" role="dialog" aria-label={t('imp.create.title')} onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2 className="strong">{t('imp.create.title')}</h2>
              <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setDraft(null)}>
                <i className="ph ph-x" aria-hidden="true" />
              </button>
            </div>
            <label>{t('md.name')}
              <input type="text" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            {draftProblem && <p className="error" role="alert">{t(draftProblem === 'duplicate' ? 'md.name.dupCat' : draftProblem === 'long' ? 'md.name.long' : 'md.name.empty')}</p>}
            <label>{t('md.macro')}
              <select value={draft.macroId} onChange={(e) => setDraft({ ...draft, macroId: e.target.value, flag: usualFlag(e.target.value) })}>
                {master.macros.filter((m) => m.tx_kind === draft.kind).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            {draft.kind === 'expense' && (
              <div className="segmented md-wide" role="group" aria-label={t('md.flag')}>
                {(['essential', 'discretionary'] as const).map((f) => (
                  <button key={f} type="button" aria-pressed={draft.flag === f} onClick={() => setDraft({ ...draft, flag: f })}>{t(`md.flag.${f}`)}</button>
                ))}
              </div>
            )}
            <button type="button" className="primary" disabled={!!draftProblem || draft.macroId === ''} onClick={() => void createCategory()}>{t('imp.create.go')}</button>
          </div>
        </div>
      )}
    </main>
  );
}
