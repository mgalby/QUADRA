import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconPicker } from '../components/IconPicker';
import type { QuadraDB } from '../lib/db';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import {
  GRID_SLOTS, canArchiveCategory, canDeleteCategory, categoryNameProblem, categoryUsage, cleanName, macroActive, macroFlag,
  nextSortOrder, shadeChoices, slotOwner,
} from '../lib/master';
import { blankSync, writeMaster } from '../lib/masterWrite';
import type { Category, Flag } from '../lib/types';

/** Nuova categoria o modifica: nome, macro, tipo di spesa, icona, colore, casella della griglia, archivio. */
export function CategoryForm({ db, master, userId, id, macroId, onBack, onDone }: {
  db: QuadraDB;
  master: MasterData;
  userId: string;
  id?: string;
  macroId?: string; // per una categoria nuova: la macro da cui si è partiti
  onBack: () => void;
  onDone: (text: string) => void;
}) {
  const { t } = useI18n();
  const existing = id ? master.categoryById.get(id) : undefined;
  const allCats = useMemo(() => [...master.categoryById.values()], [master]);
  const firstMacro = master.macroById.get(existing?.macro_id ?? macroId ?? '');
  const siblingsOf = (mid: string) => allCats.filter((c) => c.macro_id === mid && !c.deleted_at);

  const [name, setName] = useState(existing?.name ?? '');
  const [mId, setMId] = useState(firstMacro?.id ?? '');
  const [flag, setFlag] = useState<Flag>(() => {
    if (existing) return existing.flag;
    const usual = macroFlag(siblingsOf(firstMacro?.id ?? '').filter((c) => !c.archived));
    return usual === 'discretionary' ? 'discretionary' : 'essential';
  });
  const [icon, setIcon] = useState(existing?.icon ?? firstMacro?.icon ?? 'tag');
  const [shade, setShade] = useState<string | null>(existing?.shade ?? null);
  const [slot, setSlot] = useState<number | null>(existing?.pinned_slot ?? null);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  const txs = useLiveQuery(() => db.transactions.toArray(), [db]);
  const recs = useLiveQuery(() => db.recurrences.toArray(), [db]);
  const usage = useMemo(() => (existing && txs && recs ? categoryUsage(existing.id, txs, recs) : null), [existing, txs, recs]);

  const macro = master.macroById.get(mId);
  if (!macro || (id && !existing)) return <main className="page" aria-busy="true" />;
  const kind = macro.tx_kind;
  const color = shade ?? macro.color;
  const archived = !!existing?.archived;
  const macroArchived = !macroActive(macro);
  // si sposta solo tra macro dello stesso tipo: una categoria di uscita non diventa di entrata
  const macroChoices = [...master.macros.filter((m) => m.tx_kind === kind), ...(macroArchived ? [macro] : [])];

  const problem = categoryNameProblem(name, kind, existing?.id ?? null, allCats, master.macroById);
  const owner = slot ? slotOwner(slot, kind, existing?.id ?? null, allCats, master.macroById) : undefined;
  const flagChanged = !!existing && kind === 'expense' && flag !== existing.flag;
  const moved = !!existing && mId !== existing.macro_id;

  function changeMacro(next: string) {
    setMId(next);
    setShade(null); // le sfumature sono quelle della macro: cambiandola si riparte dall'automatica
  }

  async function write(row: Category, others: Category[], toast: 'saved' | 'archived' | 'restored' | 'deleted') {
    setBusy(true);
    await writeMaster(db, { categories: [row, ...others] });
    onDone(t(`md.toast.${toast}`, { name: row.name }));
  }

  function save() {
    if (problem || busy) return;
    const base: Category = existing ?? {
      ...blankSync(userId), macro_id: mId, name: '', icon, shade, flag, pinned_slot: null, sort_order: 0, archived: false,
    };
    const row: Category = {
      ...base,
      macro_id: mId,
      name: cleanName(name),
      icon,
      shade,
      flag: kind === 'income' ? base.flag : flag,
      pinned_slot: archived ? null : slot,
      // in una macro nuova (o appena creata) va in fondo
      sort_order: !existing || moved ? nextSortOrder(siblingsOf(mId)) : base.sort_order,
    };
    void write(row, owner && !archived ? [{ ...owner, pinned_slot: null }] : [], 'saved');
  }

  function step(what: 'archive' | 'delete', run: () => void) {
    if (confirm !== what) { setConfirm(what); return; }
    run();
  }

  return (
    <main className="page md-form">
      <header className="topbar">
        <button type="button" className="ghost" onClick={onBack}>{t('common.cancel')}</button>
        <h1>{t(existing ? 'md.cat.edit' : 'md.cat.new')}</h1>
        <button type="button" className="ghost strong" disabled={!!problem || busy} onClick={save}>{t('common.save')}</button>
      </header>

      <div className="md-preview">
        <span className="md-big" style={{ background: `${color}2E`, color }}><i className={`ph-duotone ph-${icon}`} aria-hidden="true" /></span>
        <span className="muted small">{macro.name} › {cleanName(name) || t('md.cat.new')}</span>
      </div>

      {archived && <p className="opt-notice">{t(macroArchived ? 'md.macro.inArchived' : 'md.isArchived', { macro: macro.name })}</p>}

      <section className="card">
        <label>{t('md.name')}
          <input type="text" value={name} maxLength={60} autoFocus={!existing} enterKeyHint="done" onChange={(e) => setName(e.target.value)} />
        </label>
        {problem && (name !== '' || existing) && <p className="error" role="alert">{t(problem === 'duplicate' ? 'md.name.dupCat' : problem === 'long' ? 'md.name.long' : 'md.name.empty')}</p>}
        <label>{t('md.macro')}
          <select value={mId} onChange={(e) => changeMacro(e.target.value)}>
            {macroChoices.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        {moved && usage && usage.movements > 0 && <p className="opt-notice">{t(usage.movements === 1 ? 'md.move.notice.one' : 'md.move.notice', { n: usage.movements })}</p>}
        {kind === 'expense' && (
          <>
            <span className="muted small">{t('md.flag')}</span>
            <div className="segmented md-wide" role="group" aria-label={t('md.flag')}>
              {(['essential', 'discretionary'] as const).map((f) => (
                <button key={f} type="button" aria-pressed={flag === f} onClick={() => setFlag(f)}>{t(`md.flag.${f}`)}</button>
              ))}
            </div>
            {flagChanged && usage && usage.followFlag > 0 && (
              <p className="opt-notice" role="status">{t(usage.followFlag === 1 ? 'md.flag.notice.one' : 'md.flag.notice', { n: usage.followFlag })}</p>
            )}
          </>
        )}
      </section>

      <IconPicker value={icon} color={color} onChange={setIcon} />

      <section className="card">
        <h2>{t('md.color.shades', { macro: macro.name })}</h2>
        <div className="md-colors">
          <button type="button" className={shade === null ? 'md-auto on' : 'md-auto'} aria-pressed={shade === null} onClick={() => setShade(null)}>{t('md.color.auto')}</button>
          {shadeChoices(macro.color).map((c, i) => (
            <button key={c} type="button" className={shade?.toLowerCase() === c ? 'md-color on' : 'md-color'} aria-pressed={shade?.toLowerCase() === c}
              aria-label={t('md.color.n', { n: i + 1 })} style={{ background: c }} onClick={() => setShade(c)} />
          ))}
        </div>
      </section>

      {!archived && (
        <section className="card">
          <h2>{t('md.grid')}</h2>
          <div className="md-slots" role="group" aria-label={t('md.grid')}>
            <button type="button" className="md-slot none" aria-pressed={slot === null} onClick={() => setSlot(null)}>{t('md.grid.none')}</button>
            {GRID_SLOTS.map((n) => (
              <button key={n} type="button" className="md-slot" aria-pressed={slot === n} aria-label={t('md.grid.slot', { n })} onClick={() => setSlot(n)}>{n}</button>
            ))}
          </div>
          {owner
            ? <p className="opt-notice" role="status">{t('md.grid.taken', { n: slot!, name: owner.name })}</p>
            : <p className="muted tiny">{t('md.grid.hint')}</p>}
        </section>
      )}

      {existing && usage && (
        <section className="card">
          <p className="small">{usage.movements === 0 ? t('md.usage.none') : t(usage.movements === 1 ? 'md.usage.one' : 'md.usage', { n: usage.movements })}</p>
          {archived ? (
            !macroArchived && (
              <button type="button" className="secondary" disabled={busy || !!problem} onClick={() => void write({ ...existing, archived: false }, [], 'restored')}>
                <i className="ph ph-arrow-counter-clockwise" aria-hidden="true" /> {t('md.restore')}
              </button>
            )
          ) : canArchiveCategory(usage) ? (
            <>
              <p className="muted tiny">{t('md.archive.hint')}</p>
              <button type="button" className="secondary" disabled={busy} onClick={() => step('archive', () => void write({ ...existing, archived: true, pinned_slot: null }, [], 'archived'))}>
                <i className="ph ph-archive" aria-hidden="true" /> {t(confirm === 'archive' ? 'md.archive.confirm' : 'md.archive')}
              </button>
            </>
          ) : (
            <p className="opt-notice">{t('md.archive.blocked', { names: usage.activeRecurrences.join(', ') })}</p>
          )}
          {canDeleteCategory(usage) ? (
            <button type="button" className="danger" disabled={busy} onClick={() => step('delete', () => void write({ ...existing, deleted_at: new Date().toISOString(), pinned_slot: null }, [], 'deleted'))}>
              {t(confirm === 'delete' ? 'md.delete.confirm' : 'md.delete')}
            </button>
          ) : (
            <p className="muted tiny">{t('md.delete.blockedCat')}</p>
          )}
        </section>
      )}
    </main>
  );
}
