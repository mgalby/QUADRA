import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BottomBar } from '../components/BottomBar';
import { BasisToggle } from '../components/BasisToggle';
import { SyncPill } from '../components/SyncPill';
import { lineShares, slicesInMonth, type Basis, type Slice } from '../lib/basis';
import type { QuadraDB } from '../lib/db';
import { addMonths, longDate, monthLabel, todayISO } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { formatMoney } from '../lib/money';
import type { Nav } from '../lib/nav';

export function Movements({ db, master, nav, month, setMonth, macroId, categoryId, basis, setBasis, currency, pending }: {
  db: QuadraDB;
  master: MasterData;
  nav: Nav;
  month: string;
  setMonth: (m: string) => void;
  macroId?: string;
  categoryId?: string;
  basis: Basis;
  setBasis: (b: Basis) => void;
  currency: string;
  pending: number;
}) {
  const { t, locale } = useI18n();
  // tutti i movimenti: pagamenti e quote possono cadere in un mese diverso dalla data del movimento
  const txs = useLiveQuery(() => db.transactions.toArray(), [db]);
  const merchants = useLiveQuery(() => db.merchants.toArray(), [db]);
  const waiting = useLiveQuery(() => db.outbox.toArray(), [db]);
  const today = todayISO();

  const merchantName = useMemo(() => new Map((merchants ?? []).map((m) => [m.id, m.name])), [merchants]);
  const waitingIds = useMemo(() => new Set((waiting ?? []).filter((o) => o.kind === 'tx').map((o) => o.id)), [waiting]);
  const macro = macroId ? master.macroById.get(macroId) : undefined;
  const category = categoryId ? master.categoryById.get(categoryId) : undefined;
  const filterMacro = category ? master.macroById.get(category.macro_id) : macro;

  // con un filtro conta solo la parte della fetta che sta in quella categoria (o macro)
  const matches = (categoryOfLine: string) =>
    categoryId ? categoryOfLine === categoryId : macroId ? master.categoryById.get(categoryOfLine)?.macro_id === macroId : true;
  const quotaOf = (slice: Slice): number =>
    !categoryId && !macroId
      ? slice.cents
      : lineShares(slice.tx, slice.cents).filter((l) => matches(l.line.category_id)).reduce((sum, l) => sum + l.cents, 0);

  const days = useMemo(() => {
    const visible = slicesInMonth(txs ?? [], basis, month, today).filter(
      (sl) => (!categoryId && !macroId) || sl.tx.lines.some((l) => matches(l.category_id)),
    );
    visible.sort((a, b) => b.date.localeCompare(a.date) || b.tx.client_modified_at.localeCompare(a.tx.client_modified_at) || a.seq - b.seq);
    const groups: { date: string; items: Slice[]; net: number }[] = [];
    for (const sl of visible) {
      let g = groups[groups.length - 1];
      if (!g || g.date !== sl.date) groups.push((g = { date: sl.date, items: [], net: 0 }));
      g.items.push(sl);
      g.net += quotaOf(sl) * (sl.tx.tx_kind === 'income' ? 1 : -1);
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txs, basis, month, macroId, categoryId, master.categoryById]);

  return (
    <main className="page with-bar">
      <header className="topbar">
        <div className="month">
          <button type="button" className="icon-btn" aria-label={t('home.prev')} onClick={() => setMonth(addMonths(month, -1))}>
            <i className="ph ph-caret-left" aria-hidden="true" />
          </button>
          <h1>{monthLabel(month, locale)}</h1>
          <button type="button" className="icon-btn" aria-label={t('home.next')} onClick={() => setMonth(addMonths(month, 1))}>
            <i className="ph ph-caret-right" aria-hidden="true" />
          </button>
        </div>
      </header>

      <SyncPill pending={pending} onClick={() => nav.go({ name: 'settings' })} />
      <BasisToggle basis={basis} setBasis={setBasis} />

      {(category ?? macro) && (
        <button type="button" className="filter" onClick={() => nav.tab({ name: 'movements' })} aria-label={t('mov.clearFilter', { name: (category ?? macro)!.name })}>
          <i className={`ph-duotone ph-${(category ?? macro)!.icon}`} style={{ color: category?.shade ?? filterMacro?.color }} aria-hidden="true" />
          {(category ?? macro)!.name}
          <i className="ph ph-x" aria-hidden="true" />
        </button>
      )}

      {days.length === 0 && <p className="muted small empty">{t('home.noTx')}</p>}

      {days.map((day) => (
        <section key={day.date} className="card day">
          <div className="row">
            <h2>{day.date === today ? t('date.today') : longDate(day.date, locale)}</h2>
            <span className="muted tiny num">{formatMoney(day.net, currency, locale, { sign: true })}</span>
          </div>
          {day.items.map((slice) => {
            const tx = slice.tx;
            const split = tx.lines.length > 1;
            const cat = master.categoryById.get(tx.lines[0]?.category_id);
            const m = cat ? master.macroById.get(cat.macro_id) : undefined;
            const color = split ? '#9AA3AF' : cat?.shade ?? m?.color ?? '#8B93A0';
            const merchant = tx.merchant_id ? merchantName.get(tx.merchant_id) : undefined;
            const cents = quotaOf(slice);
            const partLabel = slice.count > 1 ? t(basis === 'cash' ? 'mov.payment' : 'mov.quota', { n: slice.seq, count: slice.count }) : null;
            const catNames = split ? tx.lines.map((l) => master.categoryById.get(l.category_id)?.name).filter(Boolean).join(' + ') : cat?.name;
            return (
              <button key={`${tx.id}:${slice.seq}`} type="button" className="tx-row" onClick={() => nav.go({ name: 'entry', kind: tx.tx_kind, txId: tx.id })}>
                <span className="chip" style={{ background: `${color}2E`, color }}>
                  <i className={`ph-duotone ph-${split ? 'arrows-split' : cat?.icon ?? 'question'}`} aria-hidden="true" />
                </span>
                <span className="tx-main">
                  <span className="tx-title">{merchant ?? (split ? t('mov.multi') : cat?.name) ?? '—'}</span>
                  <span className="muted tiny tx-sub">
                    {[merchant || split ? catNames : null, partLabel, tx.note].filter(Boolean).join(' · ')}
                    {tx.status === 'scheduled' && tx.tx_date <= today ? <span className="tag wait">{t('mov.toConfirm')}</span> : slice.scheduled && <span className="tag">{t('mov.scheduled')}</span>}
                    {waitingIds.has(tx.id) && <span className="tag wait">{t('mov.waiting')}</span>}
                  </span>
                </span>
                <span className={`num strong ${tx.tx_kind === 'income' ? 'pos' : ''}`}>
                  {formatMoney(tx.tx_kind === 'income' ? cents : -cents, currency, locale, { sign: true })}
                </span>
              </button>
            );
          })}
        </section>
      ))}

      <BottomBar nav={nav} />
    </main>
  );
}
