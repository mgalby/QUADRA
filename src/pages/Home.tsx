import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BottomBar } from '../components/BottomBar';
import { BasisToggle } from '../components/BasisToggle';
import { Donut, type DonutSlice } from '../components/Donut';
import { SyncPill } from '../components/SyncPill';
import type { QuadraDB } from '../lib/db';
import { slicesInMonth, type Basis } from '../lib/basis';
import { addMonths, monthLabel, todayISO } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { activeTripId, currentTrip, loadTrips } from '../lib/trips';
import { useI18n } from '../lib/i18n';
import { formatMoney } from '../lib/money';
import type { Nav } from '../lib/nav';
import { shades } from '../lib/colors';
import { donutSlices, donutSlicesByCategory, summarizeSlices } from '../lib/stats';

const OTHER_COLOR = '#8B93A0';

export function Home({ db, master, nav, month, setMonth, onlyDisc, setOnlyDisc, view, setView, basis, setBasis, currency, pending }: {
  db: QuadraDB;
  master: MasterData;
  nav: Nav;
  month: string;
  setMonth: (m: string) => void;
  onlyDisc: boolean;
  setOnlyDisc: (v: boolean) => void;
  view: 'macro' | 'category';
  setView: (v: 'macro' | 'category') => void;
  basis: Basis;
  setBasis: (b: Basis) => void;
  currency: string;
  pending: number;
}) {
  const { t, locale } = useI18n();
  const toConfirm = useLiveQuery(
    () => db.transactions.filter((x) => !!x.recurrence_id && !x.deleted_at && x.status === 'scheduled' && x.tx_date <= todayISO()).count(),
    [db],
  ) ?? 0;
  const toAdjust = useLiveQuery(() => db.transactions.filter((x) => !x.deleted_at && x.fx_status === 'estimated').count(), [db]) ?? 0;
  const trips = useLiveQuery(() => loadTrips(db), [db]);
  const tripOn = useLiveQuery(() => activeTripId(db), [db]);
  const trip = currentTrip(trips ?? [], tripOn ?? null);
  // tutti i movimenti: con quote e pagamenti su mesi diversi, un movimento può cadere in un mese lontano dalla sua data
  const txs = useLiveQuery(() => db.transactions.toArray(), [db]);
  const money = (cents: number, sign = false) => formatMoney(cents, currency, locale, { sign });

  const summary = useMemo(
    () => summarizeSlices(slicesInMonth(txs ?? [], basis, month, todayISO()), master.categoryById, onlyDisc),
    [txs, basis, month, master.categoryById, onlyDisc],
  );
  const pct = (cents: number) => (summary.shown > 0 ? Math.round((cents / summary.shown) * 100) : 0);

  // una voce per macro o per categoria, con colore, icona e cosa si apre al tocco
  interface Item { key: string; name: string; icon: string; color: string; cents: number; scheduledCents: number; open: () => void }
  const items: Item[] = useMemo(() => {
    if (view === 'macro') {
      return summary.byMacro.map((m) => {
        const macro = master.macroById.get(m.macroId);
        return {
          key: m.macroId, name: macro?.name ?? t('home.other'), icon: macro?.icon ?? 'dots-three', color: macro?.color ?? OTHER_COLOR,
          cents: m.cents, scheduledCents: m.scheduledCents,
          open: () => nav.tab({ name: 'movements', macroId: master.macroById.has(m.macroId) ? m.macroId : undefined }),
        };
      });
    }
    // per categoria: tonalità diverse del colore della macro, a meno che la categoria ne abbia una sua
    const perMacro = new Map<string, number>();
    for (const c of summary.byCategory) perMacro.set(c.macroId, (perMacro.get(c.macroId) ?? 0) + 1);
    const seen = new Map<string, number>();
    const tones = new Map<string, string[]>();
    return summary.byCategory.map((c) => {
      const cat = master.categoryById.get(c.categoryId);
      const macro = master.macroById.get(c.macroId);
      const base = macro?.color ?? OTHER_COLOR;
      if (!tones.has(c.macroId)) tones.set(c.macroId, shades(base, perMacro.get(c.macroId) ?? 1));
      const i = seen.get(c.macroId) ?? 0;
      seen.set(c.macroId, i + 1);
      return {
        key: c.categoryId, name: cat?.name ?? t('home.other'), icon: cat?.icon ?? 'dots-three', color: cat?.shade ?? tones.get(c.macroId)![i],
        cents: c.cents, scheduledCents: c.scheduledCents,
        open: () => nav.tab({ name: 'movements', categoryId: cat ? c.categoryId : undefined }),
      };
    });
  }, [view, summary, master.macroById, master.categoryById, nav, t]);
  const itemByKey = new Map(items.map((i) => [i.key, i]));

  const rawSlices = view === 'macro' ? donutSlices(summary.byMacro, summary.shown) : donutSlicesByCategory(summary.byCategory, summary.shown);
  const slices: DonutSlice[] = rawSlices.map((sl) => {
    const item = itemByKey.get(sl.key);
    const name = item?.name ?? t('home.other');
    return {
      key: sl.key,
      share: sl.share,
      scheduledShare: sl.scheduledCents / summary.shown,
      color: item?.color ?? OTHER_COLOR,
      icon: item?.icon ?? 'dots-three',
      label: `${name}, ${Math.round(sl.share * 100)}%`,
    };
  });
  const openSlice = (key: string) => itemByKey.get(key)?.open();
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
            className="icon-btn"
            aria-label={t(view === 'macro' ? 'home.viewToCategory' : 'home.viewToMacro')}
            title={t(view === 'macro' ? 'home.viewToCategory' : 'home.viewToMacro')}
            onClick={() => setView(view === 'macro' ? 'category' : 'macro')}
          >
            <i className={view === 'macro' ? 'ph ph-chart-donut' : 'ph-duotone ph-chart-donut'} aria-hidden="true" />
          </button>
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
      <BasisToggle basis={basis} setBasis={setBasis} />
      {trip && (
        <button type="button" className="pill" onClick={() => nav.go({ name: 'settings' })}>
          <i className="ph ph-airplane-tilt" aria-hidden="true" /> {t('trip.on', { name: trip.name, currency: trip.currency })}
        </button>
      )}
      {toAdjust > 0 && (
        <button type="button" className="pill confirm" onClick={() => nav.go({ name: 'fxpending' })}>
          <i className="ph ph-currency-circle-dollar" aria-hidden="true" /> {t('fx.toAdjust', { n: toAdjust })}
        </button>
      )}
      {toConfirm > 0 && (
        <button type="button" className="pill confirm" onClick={() => nav.tab({ name: 'recurrences' })}>
          <i className="ph ph-bell-ringing" aria-hidden="true" /> {t('home.toConfirm', { n: toConfirm })}
        </button>
      )}

      <Donut slices={slices} onSelect={openSlice} label={t(view === 'macro' ? 'home.donut' : 'home.donutCat', { month: title })}>
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
        <h2>{t(view === 'macro' ? 'home.byMacro' : 'home.byCategory')}</h2>
        {items.length === 0 && <p className="muted small empty">{t('home.noTx')}</p>}
        {items.map((m) => (
          <button key={m.key} type="button" className="macro-row" onClick={m.open}>
            <span className="chip" style={{ background: `${m.color}2E`, color: m.color }}>
              <i className={`ph-duotone ph-${m.icon}`} aria-hidden="true" />
            </span>
            <span className="macro-main">
              <span className="macro-line">
                <span>{m.name}</span>
                <span className="num">{money(m.cents)}</span>
              </span>
              <span className="bar"><span style={{ width: `${(m.cents / summary.shown) * 100}%`, background: m.color }} /></span>
            </span>
            <span className="pct num">{pct(m.cents)}%</span>
          </button>
        ))}
      </section>

      <BottomBar nav={nav} />
    </main>
  );
}
