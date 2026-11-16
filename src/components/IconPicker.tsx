import { useMemo, useState } from 'react';
import { searchIcons } from '../lib/icons';
import { useI18n } from '../lib/i18n';

const FIRST = 19; // quattro righe da cinque, con l'ultima casella per "altre"
const MAX = 120;

/** Scelta dell'icona: ricerca in italiano o in inglese, griglia delle prime trovate. */
export function IconPicker({ value, color, onChange }: { value: string; color: string; onChange: (icon: string) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const found = useMemo(() => {
    const list = searchIcons(query);
    // senza ricerca l'icona scelta sta sempre in testa, così si vede qual è
    return query.trim() === '' ? [value, ...list.filter((n) => n !== value)] : list;
  }, [query, value]);
  const shown = found.slice(0, all ? MAX : FIRST);
  const more = Math.min(found.length, MAX) - shown.length;

  return (
    <section className="card">
      <h2>{t('md.icon')}</h2>
      <label className="field">
        <i className="ph ph-magnifying-glass" aria-hidden="true" />
        <input type="text" aria-label={t('md.icon.search')} placeholder={t('md.icon.search')} value={query} autoCapitalize="none" autoCorrect="off"
          onChange={(e) => { setQuery(e.target.value); setAll(false); }} />
      </label>
      <p className="muted tiny">{t('md.icon.hint')}</p>
      {found.length === 0 && <p className="muted small">{t('md.icon.none')}</p>}
      <div className="md-icons">
        {shown.map((name) => {
          const on = name === value;
          return (
            <button key={name} type="button" className={on ? 'md-icon on' : 'md-icon'} aria-pressed={on} title={name}
              aria-label={on ? t('md.icon.selected', { name }) : name}
              style={on ? { background: `${color}2E`, color, boxShadow: `inset 0 0 0 2px ${color}` } : undefined} onClick={() => onChange(name)}>
              <i className={`ph-duotone ph-${name}`} aria-hidden="true" />
            </button>
          );
        })}
        {more > 0 && (
          <button type="button" className="md-icon more" aria-label={t('md.icon.more', { n: more })} onClick={() => setAll(true)}>+{more}</button>
        )}
      </div>
    </section>
  );
}
