import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconPicker } from '../components/IconPicker';
import type { QuadraDB } from '../lib/db';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { MACRO_COLORS, canArchiveMacro, canDeleteMacro, cleanName, macroNameProblem, macroUsage, nextSortOrder } from '../lib/master';
import { blankSync, writeMaster } from '../lib/masterWrite';
import type { Category, Macro, TxKind } from '../lib/types';

/** Nuova macro o modifica: nome, icona, colore, archivio. Il tipo (uscita o entrata) si sceglie alla creazione e non cambia. */
export function MacroForm({ db, master, userId, id, kind: newKind, onBack, onDone }: {
  db: QuadraDB;
  master: MasterData;
  userId: string;
  id?: string;
  kind?: TxKind;
  onBack: () => void;
  onDone: (text: string) => void;
}) {
  const { t } = useI18n();
  const existing = id ? master.macroById.get(id) : undefined;
  const kind: TxKind = existing?.tx_kind ?? newKind ?? 'expense';
  const allMacros = useMemo(() => [...master.macroById.values()], [master]);
  const allCats = useMemo(() => [...master.categoryById.values()], [master]);

  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? (kind === 'income' ? 'wallet' : 'tag'));
  const [color, setColor] = useState(() => {
    if (existing) return existing.color;
    // per una macro nuova, il primo colore non ancora usato
    const used = new Set(allMacros.filter((m) => !m.deleted_at && !m.archived).map((m) => m.color.toLowerCase()));
    return MACRO_COLORS.find((c) => !used.has(c.toLowerCase())) ?? MACRO_COLORS[0];
  });
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  const recs = useLiveQuery(() => db.recurrences.toArray(), [db]);
  const usage = useMemo(() => (existing && recs ? macroUsage(existing, allMacros, allCats, recs) : null), [existing, allMacros, allCats, recs]);

  if (id && !existing) return <main className="page" aria-busy="true" />;
  const problem = macroNameProblem(name, kind, existing?.id ?? null, allMacros);
  const archived = !!existing?.archived;
  // il colore di prima resta tra le scelte anche se non è nella tavolozza
  const palette = existing && !MACRO_COLORS.some((c) => c.toLowerCase() === existing.color.toLowerCase()) ? [existing.color, ...MACRO_COLORS] : [...MACRO_COLORS];

  async function write(row: Macro, cats: Category[], toast: 'saved' | 'archived' | 'restored' | 'deleted') {
    setBusy(true);
    await writeMaster(db, { macros: [row], categories: cats });
    onDone(t(`md.toast.${toast}`, { name: row.name }));
  }

  function save() {
    if (problem || busy) return;
    const base: Macro = existing ?? {
      ...blankSync(userId), tx_kind: kind, name: '', icon, color, sort_order: nextSortOrder(allMacros.filter((m) => !m.deleted_at)), archived: false,
    };
    const row: Macro = { ...base, name: cleanName(name), icon, color };
    // le sfumature scelte a mano erano del colore precedente: tornano automatiche
    const recolor = existing && existing.color.toLowerCase() !== color.toLowerCase()
      ? allCats.filter((c) => c.macro_id === existing.id && !c.deleted_at && c.shade !== null).map((c) => ({ ...c, shade: null }))
      : [];
    void write(row, recolor, 'saved');
  }

  function step(what: 'archive' | 'delete', run: () => void) {
    if (confirm !== what) { setConfirm(what); return; }
    run();
  }

  return (
    <main className="page md-form">
      <header className="topbar">
        <button type="button" className="ghost" onClick={onBack}>{t('common.cancel')}</button>
        <h1>{t(existing ? 'md.macro.edit' : 'md.macro.new')}</h1>
        <button type="button" className="ghost strong" disabled={!!problem || busy} onClick={save}>{t('common.save')}</button>
      </header>

      <div className="md-preview">
        <span className="md-big" style={{ background: `${color}2E`, color }}><i className={`ph-duotone ph-${icon}`} aria-hidden="true" /></span>
        <span className="muted small">{t(`md.kind.${kind}`)} › {cleanName(name) || t('md.macro.new')}</span>
      </div>

      {archived && <p className="opt-notice">{t('md.isArchived')}</p>}

      <section className="card">
        <label>{t('md.name')}
          <input type="text" value={name} maxLength={60} autoFocus={!existing} enterKeyHint="done" onChange={(e) => setName(e.target.value)} />
        </label>
        {problem && (name !== '' || existing) && <p className="error" role="alert">{t(problem === 'duplicate' ? 'md.name.dupMacro' : problem === 'long' ? 'md.name.long' : 'md.name.empty')}</p>}
      </section>

      <IconPicker value={icon} color={color} onChange={setIcon} />

      <section className="card">
        <h2>{t('md.color')}</h2>
        <div className="md-colors wrap">
          {palette.map((c, i) => (
            <button key={c} type="button" className={color.toLowerCase() === c.toLowerCase() ? 'md-color on' : 'md-color'} aria-pressed={color.toLowerCase() === c.toLowerCase()}
              aria-label={t('md.color.pick', { n: i + 1 })} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        {existing && <p className="muted tiny">{t('md.color.macroHint')}</p>}
      </section>

      {existing && usage && (
        <section className="card">
          <p className="small">{t(usage.categories === 1 ? 'md.count.one' : 'md.count', { n: usage.categories })}</p>
          {archived ? (
            <button type="button" className="secondary" disabled={busy || !!problem} onClick={() => void write({ ...existing, archived: false }, [], 'restored')}>
              <i className="ph ph-arrow-counter-clockwise" aria-hidden="true" /> {t('md.restore')}
            </button>
          ) : usage.lastOfKind ? (
            <p className="opt-notice">{t('md.macro.last')}</p>
          ) : canArchiveMacro(usage) ? (
            <>
              <p className="muted tiny">{t('md.macro.archive.hint')}</p>
              <button type="button" className="secondary" disabled={busy} onClick={() => step('archive', () => void write({ ...existing, archived: true }, [], 'archived'))}>
                <i className="ph ph-archive" aria-hidden="true" /> {confirm === 'archive' ? t('md.macro.archive.confirm', { n: usage.activeCategories }) : t('md.archive')}
              </button>
            </>
          ) : (
            <p className="opt-notice">{t('md.archive.blocked', { names: usage.activeRecurrences.join(', ') })}</p>
          )}
          {canDeleteMacro(usage) ? (
            <button type="button" className="danger" disabled={busy} onClick={() => step('delete', () => void write({ ...existing, deleted_at: new Date().toISOString() }, [], 'deleted'))}>
              {t(confirm === 'delete' ? 'md.delete.confirm' : 'md.delete')}
            </button>
          ) : (
            usage.categories > 0 && <p className="muted tiny">{t('md.macro.delete.blocked')}</p>
          )}
        </section>
      )}
    </main>
  );
}
