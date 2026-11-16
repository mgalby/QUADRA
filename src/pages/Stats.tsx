import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BottomBar } from '../components/BottomBar';
import { BasisToggle } from '../components/BasisToggle';
import { SyncPill } from '../components/SyncPill';
import type { Basis } from '../lib/basis';
import type { QuadraDB } from '../lib/db';
import { monthLabel, todayISO } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { formatMoney } from '../lib/money';
import type { Nav } from '../lib/nav';
import { buildStats, closedAverage, discFocus } from '../lib/trends';

export const PERIODS = [3, 6, 12] as const;
const OTHER_COLOR = '#8B93A0';
const PLOT = 132; // altezza dell'area delle barre, in px

/** Fondo scala "tondo": 1, 2, 2,5 o 5 per una potenza di dieci (in centesimi). */
function niceMax(cents: number): number {
  if (cents <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(cents));
  const f = cents / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Statistiche, prima tranche: andamento mensile, categorie nel tempo, esercizi principali. */
export function Stats({ db, master, nav, setMonth, period, setPeriod, onlyDisc, setOnlyDisc, basis, setBasis, currency, pending }: {
  db: QuadraDB;
  master: MasterData;
  nav: Nav;
  setMonth: (m: string) => void;
  period: number;
  setPeriod: (p: number) => void;
  onlyDisc: boolean;
  setOnlyDisc: (v: boolean) => void;
  basis: Basis;
  setBasis: (b: Basis) => void;
  currency: string;
  pending: number;
}) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const txs = useLiveQuery(() => db.transactions.toArray(), [db]);
  const merchants = useLiveQuery(() => db.merchants.toArray(), [db]);

  const merchantName = useMemo(() => new Map((merchants ?? []).map((m) => [m.id, m.name])), [merchants]);
  const mergedInto = useMemo(
    () => new Map((merchants ?? []).flatMap((m) => (m.merged_into_id ? [[m.id, m.merged_into_id] as [string, string]] : []))),
    [merchants],
  );
  const stats = useMemo(
    () => buildStats(txs ?? [], master.categoryById, basis, today, period, onlyDisc, mergedInto),
    [txs, master.categoryById, basis, today, period, onlyDisc, mergedInto],
  );

  // mese in evidenza: quello in corso, finché non se ne tocca un altro
  const current = stats.months[stats.months.length - 1].month;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked && stats.months.some((p) => p.month === picked) ? picked : current;
  const point = stats.months.find((p) => p.month === selected)!;
  const focus = discFocus(stats, selected)!;

  const money = (cents: number) => formatMoney(cents, currency, locale);
  const round = (cents: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0, useGrouping: 'always' }).format(cents / 100);
  const pct = (share: number) => `${Math.round(share * 100)}%`;
  const short = (month: string) => new Date(+month.slice(0, 4), +month.slice(5, 7) - 1, 1).toLocaleDateString(locale, { month: 'short' }).replace('.', '');

  const average = onlyDisc ? closedAverage(stats, (p) => p.discretionary) : null;
  const top = Math.max(...stats.months.map((p) => (onlyDisc ? p.discretionary : Math.max(p.expense, p.income))), average ?? 0);
  const scale = niceMax(top);
  const h = (cents: number) => `${(cents / scale) * 100}%`;

  const delta = focus.delta;
  const flat = delta !== null && Math.abs(delta) < 0.005;
  const versus = focus.basedOn === 1 ? t('stats.vsPrev') : t('stats.vsAvg', { n: focus.basedOn });

  const openCategory = (categoryId: string) => {
    setMonth(selected);
    nav.tab({ name: 'movements', categoryId });
  };
  const topMerchant = stats.merchants[0]?.cents ?? 0;

  return (
    <main className="page with-bar">
      <header className="topbar">
        <h1 className="st-title">{t('nav.stats')}</h1>
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
      </header>

      <SyncPill pending={pending} onClick={() => nav.go({ name: 'settings' })} />
      <div className="st-controls">
        <BasisToggle basis={basis} setBasis={setBasis} />
        <div className="segmented basis" role="group" aria-label={t('stats.period')}>
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={period === p} aria-label={t('stats.months', { n: p })} onClick={() => setPeriod(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
      {onlyDisc && (
        <button type="button" className="filter" onClick={() => setOnlyDisc(false)}>
          <i className="ph-duotone ph-funnel" aria-hidden="true" /> {t('home.onlyDisc')} <i className="ph ph-x" aria-hidden="true" />
        </button>
      )}

      <section className="card">
        <div className="row">
          <h2>{t('stats.trend')}</h2>
          <span className="muted tiny">{monthLabel(selected, locale)}{point.partial ? ` · ${t('stats.partial')}` : ''}</span>
        </div>

        <div className="st-focus">
          <span className="muted tiny">{t('home.discretionary')}</span>
          <span className="st-big num">{money(focus.discretionary)}</span>
          {focus.share !== null && <span className="muted small num">{t('stats.ofExpenses', { pct: Math.round(focus.share * 100) })}</span>}
        </div>
        <p className="st-delta small" role="status">
          {delta === null ? (
            <span className="muted">{focus.basedOn === 0 ? t('stats.noHistory') : ''}</span>
          ) : flat ? (
            <span className="muted"><i className="ph ph-equals" aria-hidden="true" /> {t('stats.inLine')}</span>
          ) : (
            <>
              <i className={`ph ph-trend-${delta > 0 ? 'up' : 'down'} ${delta > 0 ? 'up' : 'down'}`} aria-hidden="true" />
              <span className="strong num">{delta > 0 ? '+' : '−'}{Math.round(Math.abs(delta) * 100)}%</span>{' '}
              <span className="muted">{versus} ({money(focus.average!)})</span>
            </>
          )}
        </p>
        {!onlyDisc && (
          <div className="st-nums">
            <span><span className="muted tiny">{t('home.expenses')}</span><span className="num strong">{money(point.expense)}</span></span>
            <span><span className="muted tiny">{t('stats.essential')}</span><span className="num strong">{money(point.essential)}</span></span>
            <span><span className="muted tiny">{t('home.income')}</span><span className="num strong">{money(point.income)}</span></span>
          </div>
        )}

        <div className="st-chart" style={{ ['--plot' as string]: `${PLOT}px` }}>
          <span className="st-scale muted num">{round(scale)}</span>
          {average !== null && average > 0 && <span className="st-avg" style={{ bottom: `calc(20px + ${(average / scale) * PLOT}px)` }} aria-hidden="true" />}
          {stats.months.map((p) => (
            <button
              key={p.month}
              type="button"
              className={`st-col${p.month === selected ? ' sel' : ''}${p.partial ? ' partial' : ''}`}
              aria-pressed={p.month === selected}
              aria-label={t('stats.monthAria', { month: monthLabel(p.month, locale), expense: money(p.expense), disc: money(p.discretionary), income: money(p.income) })}
              onClick={() => setPicked(p.month)}
            >
              <span className="st-plot">
                {p.discretionary > 0 && <span className={onlyDisc || p.essential === 0 ? 'st-seg st-d top' : 'st-seg st-d'} style={{ height: h(p.discretionary) }} />}
                {!onlyDisc && p.essential > 0 && <span className="st-seg st-e top" style={{ height: h(p.essential) }} />}
                {!onlyDisc && p.income > 0 && <span className="st-inc" style={{ bottom: h(p.income) }} />}
              </span>
              <span className="st-lab">{short(p.month)}</span>
            </button>
          ))}
        </div>
        <div className="st-legend tiny muted">
          <span><i className="st-key st-d" aria-hidden="true" /> {t('home.discretionary')}</span>
          {!onlyDisc && <span><i className="st-key st-e" aria-hidden="true" /> {t('stats.essential')}</span>}
          {!onlyDisc && <span><i className="st-key st-i" aria-hidden="true" /> {t('home.income')}</span>}
          {average !== null && average > 0 && <span><i className="st-key st-a" aria-hidden="true" /> {t('stats.average')} · {money(average)}</span>}
        </div>
      </section>

      <section className="card">
        <div className="row">
          <h2>{t('stats.categories')}</h2>
          <span className="muted tiny num">{t('stats.periodTotal', { amount: money(stats.shown), n: period })}</span>
        </div>
        {stats.categories.length === 0 && <p className="muted small empty">{t('stats.empty')}</p>}
        {stats.categories.map((c) => {
          const cat = master.categoryById.get(c.key);
          const macro = cat ? master.macroById.get(cat.macro_id) : undefined;
          const color = cat?.shade ?? macro?.color ?? OTHER_COLOR;
          const peak = Math.max(...c.byMonth, 1);
          const body = (
            <>
              <span className="chip" style={{ background: `${color}2E`, color }}>
                <i className={`ph-duotone ph-${cat?.icon ?? 'dots-three'}`} aria-hidden="true" />
              </span>
              <span className="macro-main">
                <span className="macro-line">
                  <span>{cat?.name ?? t('stats.others')}</span>
                  <span className="num">{money(c.cents)}</span>
                </span>
                <span className="st-spark" aria-hidden="true">
                  {c.byMonth.map((v, i) => (
                    <span key={i} className={stats.months[i].month === selected ? 'sel' : undefined}>
                      <span style={{ height: v > 0 ? `${Math.max(8, (v / peak) * 100)}%` : '1px', background: v > 0 ? color : 'var(--line)' }} />
                    </span>
                  ))}
                </span>
              </span>
              <span className="pct num">{pct(c.share)}</span>
            </>
          );
          return cat ? (
            <button key={c.key} type="button" className="macro-row" onClick={() => openCategory(c.key)}>{body}</button>
          ) : (
            <div key={c.key} className="macro-row">{body}</div>
          );
        })}
      </section>

      <section className="card">
        <h2>{t('stats.merchants')}</h2>
        {stats.merchants.length === 0 && <p className="muted small empty">{t('stats.empty')}</p>}
        {stats.merchants.map((m) => (
          <div key={m.key || 'none'} className="macro-row">
            <span className="macro-main">
              <span className="macro-line">
                <span className={m.key ? undefined : 'muted'}>{m.key ? merchantName.get(m.key) ?? '—' : t('stats.noMerchant')}</span>
                <span className="num">{money(m.cents)}</span>
              </span>
              <span className="bar"><span style={{ width: `${(m.cents / topMerchant) * 100}%`, background: 'var(--accent)' }} /></span>
              <span className="muted tiny num">
                {m.count === 1 ? t('stats.count.one') : t('stats.count.many', { n: m.count, avg: money(Math.round(m.cents / m.count)) })}
              </span>
            </span>
            <span className="pct num">{pct(m.share)}</span>
          </div>
        ))}
      </section>

      <BottomBar nav={nav} />
    </main>
  );
}
