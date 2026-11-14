import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BottomBar } from '../components/BottomBar';
import { Donut, type DonutSlice } from '../components/Donut';
import { SyncPill } from '../components/SyncPill';
import type { QuadraDB } from '../lib/db';
import { addMonths, monthLabel, monthRange, todayISO } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { formatMoney } from '../lib/money';
import type { Nav } from '../lib/nav';
import { donutSlices, summarize } from '../lib/stats';

const OTHER_COLOR = '#8B93A0';

export function Home({ db, master, nav, month, setMonth, onlyDisc, setOnlyDisc, currency, pending }: {
  db: QuadraDB;
  master: MasterData;
  nav: Nav;
  month: string;
  setMonth: (m: string) => void;
  onlyDisc: boolean;
  setOnlyDisc: (v: boolean) => void;
  currency: string;
  pending: number;
}) {
  const { t, locale } = useI18n();
  const [from, to] = monthRange(month);
  const txs = useLiveQuery(() => db.transactions.where('tx_date').between(from, to, true, false).toArray(), [db, from, to]);
  const money = (cents: number, sign = false) => formatMoney(cents, currency, locale, { sign });

  const summary = useMemo(() => summarize(txs ?? [], master.categoryById, todayISO(), onlyDisc), [txs, master.categoryById, onlyDisc]);
  const pct = (cents: number) => (summary.shown > 0 ? Math.round((cents / summary.shown) * 100) : 0);

  const slices: DonutSlice[] = donutSlices(summary.byMacro, summary.shown).map((s) => {
    const macro = master.macroById.get(s.key);
    const name = macro?.name ?? t('home.other');
    return {
      key: s.key,
      share: s.share,
      scheduledShare: s.scheduledCents / summary.shown,
      color: macro?.color ?? OTHER_COLOR,
      icon: macro?.icon ?? 'dots-three',
      label: `${name}, ${Math.round(s.share * 100)}%`,
    };
  });
  const openMacro = (key: string) => nav.tab({ name: 'movements', macroId: master.macroById.has(key) ? key : undefined });
  const balance = summary.income - summary.expense;
  const title = monthLabel(month, locale);

  return (
    <main className="page with-bar">
      <header className="topbar">
        <div className="month">
          <button type="button" className="icon-btn" aria-label={t('home.prev')} onClick={() => setMonth(addMonths(month, -1))}>
            <i className="ph ph-caret-left" aria-hidden="true" />
          </button>
          <h1>{title}</h1>
          <button type="button" className="icon-btn" aria-label={t('home.next')} onClick={() => setMonth(addMonths(month, 1))}>
            <i className="ph ph-caret-right" aria-hidden="true" />
          </button>
        </div>
        <div className="row-tight">
          <button
            type="button"
            className={onlyDisc ? 'icon-btn on' : 'icon-btn'}
            aria-label={t('home.onlyDisc')}
            aria-pressed={onlyDisc}
            title={t('home.onlyDisc')}
            onClick={() => setOnlyDisc(!onlyDisc)}
          >
            <i className={onlyDisc ? 'ph-duotone ph-funnel' : 'ph ph-funnel'} aria-hidden="true" />
          </button>
          <button type="button" className="icon-btn" aria-label={t('home.settings')} onClick={() => nav.go({ name: 'settings' })}>
            <i className="ph ph-gear" aria-hidden="true" />
          </button>
        </div>
      </header>

      <SyncPill pending={pending} onClick={() => nav.go({ name: 'settings' })} />

      <Donut slices={slices} onSelect={openMacro} label={t('home.donut', { month: title })}>
        <span className="muted tiny">{onlyDisc ? t('home.discretionary') : t('home.expenses')}</span>
        <span className="big num">{money(summary.shown)}</span>
        <span className={`num balance ${balance < 0 ? 'neg' : 'pos'}`}>{t('home.balance', { amount: money(balance, true) })}</span>
        {summary.scheduled > 0 && <span className="muted tiny">{t('home.scheduled', { amount: money(summary.scheduled) })}</span>}
      </Donut>

      <div className="tiles">
        <div className="card tile">
          <span className="muted tiny">{t('home.income')}</span>
          <span className="num strong pos">{money(summary.income)}</span>
        </div>
        <div className="card tile">
          <span className="muted tiny">{t('home.discretionary')}</span>
          <span className="num strong">
            {money(summary.discretionary)}{' '}
            {summary.expense > 0 && <span className="muted tiny">· {Math.round((summary.discretionary / summary.expense) * 100)}%</span>}
          </span>
        </div>
      </div>

      <section className="card">
        <h2>{t('home.byMacro')}</h2>
        {summary.byMacro.length === 0 && <p className="muted small empty">{t('home.noTx')}</p>}
        {summary.byMacro.map((m) => {
          const macro = master.macroById.get(m.macroId);
          const color = macro?.color ?? OTHER_COLOR;
          return (
            <button key={m.macroId} type="button" className="macro-row" onClick={() => openMacro(m.macroId)}>
              <span className="chip" style={{ background: `${color}2E`, color }}>
                <i className={`ph-duotone ph-${macro?.icon ?? 'dots-three'}`} aria-hidden="true" />
              </span>
              <span className="macro-main">
                <span className="macro-line">
                  <span>{macro?.name ?? t('home.other')}</span>
                  <span className="num">{money(m.cents)}</span>
                </span>
                <span className="bar"><span style={{ width: `${(m.cents / summary.shown) * 100}%`, background: color }} /></span>
              </span>
              <span className="pct num">{pct(m.cents)}%</span>
            </button>
          );
        })}
      </section>

      <BottomBar nav={nav} />
    </main>
  );
}
