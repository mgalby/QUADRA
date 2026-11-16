import { useMemo, useState } from 'react';
import type { QuadraDB } from '../lib/db';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { macroFlag, moveRow } from '../lib/master';
import { writeMaster } from '../lib/masterWrite';
import type { Nav } from '../lib/nav';
import type { Category, Flag, Macro, TxKind } from '../lib/types';

// Cosa era aperto quando si è usciti per modificare una voce: al ritorno si ritrova uguale.
let remembered: { kind: TxKind; open: string[]; reorder: boolean } = { kind: 'expense', open: [], reorder: false };

/** Impostazioni → Categorie: macro a fisarmonica con le loro categorie, riordino, archiviate. */
export function Categories({ db, master, nav, onSync }: { db: QuadraDB; master: MasterData; nav: Nav; onSync: () => void }) {
  const { t } = useI18n();
  const [kind, setKindState] = useState<TxKind>(remembered.kind);
  const [open, setOpenState] = useState<Set<string>>(new Set(remembered.open));
  const [reorder, setReorderState] = useState(remembered.reorder);
  const setKind = (k: TxKind) => { remembered = { ...remembered, kind: k }; setKindState(k); };
  const setReorder = (r: boolean) => { remembered = { ...remembered, reorder: r }; setReorderState(r); };
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id); else next.add(id);
    remembered = { ...remembered, open: [...next] };
    setOpenState(next);
  };

  const { macros, catsOf, archivedMacros, archivedCats } = useMemo(() => {
    const allMacros = [...master.macroById.values()].filter((m) => !m.deleted_at && m.tx_kind === kind).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const allCats = [...master.categoryById.values()].filter((c) => !c.deleted_at).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const active = allMacros.filter((m) => !m.archived);
    const activeIds = new Set(active.map((m) => m.id));
    return {
      macros: active,
      catsOf: (macroId: string, archived = false) => allCats.filter((c) => c.macro_id === macroId && c.archived === archived),
      archivedMacros: allMacros.filter((m) => m.archived),
      archivedCats: allCats.filter((c) => c.archived && activeIds.has(c.macro_id)),
      all: allCats,
    };
  }, [master, kind]);

  async function move(rows: (Macro | Category)[], id: string, dir: -1 | 1, what: 'macros' | 'categories') {
    const changed = moveRow(rows, id, dir);
    if (changed.length === 0) return;
    await writeMaster(db, what === 'macros' ? { macros: changed as Macro[] } : { categories: changed as Category[] });
    onSync();
  }

  const flagBadge = (flag: Flag | 'mixed' | null) =>
    flag && kind === 'expense' ? <span className={`md-badge ${flag}`}>{t(`md.flag.${flag}`)}</span> : null;

  const arrows = (rows: (Macro | Category)[], row: Macro | Category, what: 'macros' | 'categories') => {
    const i = rows.findIndex((r) => r.id === row.id);
    return (
      <span className="md-arrows">
        <button type="button" className="icon-btn" disabled={i === 0} aria-label={t('md.up', { name: row.name })} onClick={() => void move(rows, row.id, -1, what)}>
          <i className="ph ph-arrow-up" aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn" disabled={i === rows.length - 1} aria-label={t('md.down', { name: row.name })} onClick={() => void move(rows, row.id, 1, what)}>
          <i className="ph ph-arrow-down" aria-hidden="true" />
        </button>
      </span>
    );
  };

  const chip = (icon: string, color: string, small = false) => (
    <span className={small ? 'chip md-chip-s' : 'chip'} style={{ background: `${color}2E`, color }}>
      <i className={`ph-duotone ph-${icon}`} aria-hidden="true" />
    </span>
  );

  return (
    <main className="page">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={nav.back}>
          <i className="ph ph-caret-left" aria-hidden="true" />
        </button>
        <h1>{t('md.cats.title')}</h1>
        <button type="button" className="icon-btn md-accent" aria-label={t('md.newMacro')} onClick={() => nav.go({ name: 'macro', kind })}>
          <i className="ph ph-plus" aria-hidden="true" />
        </button>
      </header>

      <div className="segmented md-wide" role="group" aria-label={t('md.kind')}>
        {(['expense', 'income'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{t(`md.kind.${k}`)}</button>
        ))}
      </div>
      <div className="row md-head">
        <p className="muted tiny">{t(reorder ? 'md.hint.reorder' : 'md.hint')}</p>
        <button type="button" className={reorder ? 'ghost md-on' : 'ghost'} aria-pressed={reorder} onClick={() => setReorder(!reorder)}>
          <i className="ph ph-arrows-down-up" aria-hidden="true" /> {t(reorder ? 'md.reorder.done' : 'md.reorder')}
        </button>
      </div>

      <section className="card md-list">
        {macros.map((m) => {
          const cats = catsOf(m.id);
          const isOpen = open.has(m.id);
          return (
            <div key={m.id} className="md-macro">
              <div className="md-row">
                <button type="button" className="md-main" aria-expanded={isOpen} onClick={() => toggle(m.id)}>
                  {chip(m.icon, m.color)}
                  <span className="md-text">
                    <span className="strong">{m.name}</span>
                    <span className="muted tiny">{t(cats.length === 1 ? 'md.count.one' : 'md.count', { n: cats.length })}</span>
                  </span>
                  {!reorder && flagBadge(macroFlag(cats))}
                  {!reorder && <i className={`ph ph-caret-${isOpen ? 'down' : 'right'} muted`} aria-hidden="true" />}
                </button>
                {reorder && arrows(macros, m, 'macros')}
              </div>
              {isOpen && (
                <ul className="md-cats">
                  {cats.map((c) => (
                    <li key={c.id} className="md-row">
                      <button type="button" className="md-main" disabled={reorder} onClick={() => nav.go({ name: 'category', id: c.id })}>
                        {chip(c.icon, c.shade ?? m.color, true)}
                        <span className="md-text"><span>{c.name}</span></span>
                        {!reorder && c.pinned_slot && (
                          <span className="muted tiny md-pin" title={t('md.pinned', { n: c.pinned_slot })}>
                            <i className="ph ph-push-pin" aria-hidden="true" /> {c.pinned_slot}
                          </span>
                        )}
                        {!reorder && flagBadge(c.flag)}
                      </button>
                      {reorder && arrows(cats, c, 'categories')}
                    </li>
                  ))}
                  {!reorder && (
                    <li className="md-links">
                      <button type="button" className="ghost" onClick={() => nav.go({ name: 'category', macroId: m.id })}>
                        <i className="ph ph-plus" aria-hidden="true" /> {t('md.addCategory')}
                      </button>
                      <button type="button" className="ghost" onClick={() => nav.go({ name: 'macro', id: m.id })}>
                        <i className="ph ph-pencil-simple" aria-hidden="true" /> {t('md.editMacro')}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      {!reorder && (archivedMacros.length > 0 || archivedCats.length > 0) && (
        <section className="card md-list md-archived">
          <h2>{t('md.archived')}</h2>
          {archivedMacros.map((m) => (
            <button key={m.id} type="button" className="md-main" onClick={() => nav.go({ name: 'macro', id: m.id })}>
              {chip(m.icon, m.color, true)}
              <span className="md-text">
                <span>{m.name}</span>
                <span className="muted tiny">{t('md.archived.macro', { n: catsOf(m.id).length + catsOf(m.id, true).length })}</span>
              </span>
              <i className="ph ph-caret-right muted" aria-hidden="true" />
            </button>
          ))}
          {archivedCats.map((c) => {
            const m = master.macroById.get(c.macro_id);
            return (
              <button key={c.id} type="button" className="md-main" onClick={() => nav.go({ name: 'category', id: c.id })}>
                {chip(c.icon, c.shade ?? m?.color ?? '#8B93A0', true)}
                <span className="md-text">
                  <span>{c.name}</span>
                  <span className="muted tiny">{t('md.archived.in', { macro: m?.name ?? '' })}</span>
                </span>
                <i className="ph ph-caret-right muted" aria-hidden="true" />
              </button>
            );
          })}
        </section>
      )}
    </main>
  );
}
