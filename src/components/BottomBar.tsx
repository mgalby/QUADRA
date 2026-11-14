import { useI18n } from '../lib/i18n';
import type { Nav } from '../lib/nav';

/** Pulsanti Uscita / Entrata e sezioni dell'app, fissi in fondo. */
export function BottomBar({ nav }: { nav: Nav }) {
  const { t } = useI18n();
  const current = nav.screen.name;
  const tabs = [
    { name: 'home', icon: 'house', label: t('nav.home'), onClick: () => nav.tab({ name: 'home' }) },
    { name: 'movements', icon: 'list-bullets', label: t('nav.movements'), onClick: () => nav.tab({ name: 'movements' }) },
    { name: 'stats', icon: 'chart-bar', label: t('nav.stats') },
    { name: 'recurrences', icon: 'arrows-clockwise', label: t('nav.recurrences') },
  ];
  return (
    <div className="bottombar">
      <div className="actions">
        <button type="button" className="add expense" onClick={() => nav.go({ name: 'entry', kind: 'expense' })}>
          <i className="ph ph-minus" aria-hidden="true" /> {t('kind.expense')}
        </button>
        <button type="button" className="add income" onClick={() => nav.go({ name: 'entry', kind: 'income' })}>
          <i className="ph ph-plus" aria-hidden="true" /> {t('kind.income')}
        </button>
      </div>
      <nav aria-label={t('nav.sections')}>
        {tabs.map((tab) => (
          <button
            key={tab.name}
            type="button"
            className={current === tab.name ? 'tab active' : 'tab'}
            aria-current={current === tab.name ? 'page' : undefined}
            disabled={!tab.onClick}
            title={tab.onClick ? undefined : t('nav.soon')}
            onClick={tab.onClick}
          >
            <i className={`${current === tab.name ? 'ph-duotone' : 'ph'} ph-${tab.icon}`} aria-hidden="true" />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
