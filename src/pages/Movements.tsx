import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BottomBar } from '../components/BottomBar';
import { SyncPill } from '../components/SyncPill';
import type { QuadraDB } from '../lib/db';
import { addMonths, longDate, monthLabel, monthRange, todayISO } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { formatMoney, toCents } from '../lib/money';
import type { Nav } from '../lib/nav';
import { isScheduled } from '../lib/stats';
import type { Transaction } from '../lib/types';

export function Movements({ db, master, nav, month, setMonth, macroId, categoryId, currency, pending }: {
  db: QuadraDB;
  master: MasterData;
  nav: Nav;
  month: string;
  setMonth: (m: string) => void;
  macroId?: string;
  categoryId?: string;
  currency: string;
  pending: number;
}) {
  const { t, locale } = useI18n();
  const [from, to] = monthRange(month);
  const txs = useLiveQuery(() => db.transactions.where('tx_date').between(from, to, true, false).toArray(), [db, from, to]);
  const merchants = useLiveQuery(() => db.merchants.toArray(), [db]);
  const waiting = useLiveQuery(() => db.outbox.toArray(), [db]);
  const today = todayISO();

  const merchantName = useMemo(() => new Map((merchants ?? []).map((m) => [m.id, m.name])), [merchants]);
  const waitingIds = useMemo(() => new Set((waiting ?? []).filter((o) => o.kind === 'tx').map((o) => o.id)), [waiting]);
  const macro = macroId ? master.macroById.get(macroId) : undefined;
  const category = categoryId ? master.categoryById.get(categoryId) : undefined;
  const filterMacro = category ? master.macroById.get(category.macro_id) : macro;

  // con un filtro conta solo la quota del movimento che sta in quella categoria (o macro)
  const quotaOf = (tx: Transaction): number => {
    if (!categoryId && !macroId) return toCents(tx.total);
    return tx.lines
      .filter((l) => (categoryId ? l.category_id === categoryId : master.categoryById.get(l.category_id)?.macro_id === macroId))
      .reduce((sum, l) => sum + toCents(l.amount), 0);
  };

  const days = useMemo(() => {
    const visible = (txs ?? []).filter(
      (tx) =>
        !tx.deleted_at &&
        (!categoryId || tx.lines.some((l) => l.category_id === categoryId)) &&
        (!macroId || tx.lines.some((l) => master.categoryById.get(l.category_id)?.macro_id === macroId)),
    );
    visible.sort((a, b) => b.tx_date.localeCompare(a.tx_date) || b.client_modified_at.localeCompare(a.client_modified_at));
    const groups: { date: string; items: Transaction[]; net: number }[] = [];
    for (const tx of visible) {
      let g = groups[groups.length - 1];
      if (!g || g.date !== tx.tx_date) groups.push((g = { date: tx.tx_date, items: [], net: 0 }));
      g.items.push(tx);
      g.net += quotaOf(tx) * (tx.tx_kind === 'income' ? 1 : -1);
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txs, macroId, categoryId, master.categoryById]);

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
          {day.items.map((tx) => {
            const split = tx.lines.length > 1;
            const cat = master.categoryById.get(tx.lines[0]?.category_id);
            const m = cat ? master.macroById.get(cat.macro_id) : undefined;
            const color = split ? '#9AA3AF' : cat?.shade ?? m?.color ?? '#8B93A0';
            const merchant = tx.merchant_id ? merchantName.get(tx.merchant_id) : undefined;
            const cents = quotaOf(tx);
            const catNames = split ? tx.lines.map((l) => master.categoryById.get(l.category_id)?.name).filter(Boolean).join(' + ') : cat?.name;
            return (
              <button key={tx.id} type="button" className="tx-row" onClick={() => nav.go({ name: 'entry', kind: tx.tx_kind, txId: tx.id })}>
                <span className="chip" style={{ background: `${color}2E`, color }}>
                  <i className={`ph-duotone ph-${split ? 'arrows-split' : cat?.icon ?? 'question'}`} aria-hidden="true" />
                </span>
                <span className="tx-main">
                  <span className="tx-title">{merchant ?? (split ? t('mov.multi') : cat?.name) ?? '—'}</span>
                  <span className="muted tiny tx-sub">
                    {[merchant || split ? catNames : null, tx.note].filter(Boolean).join(' · ')}
                    {tx.status === 'scheduled' && tx.tx_date <= today ? <span className="tag wait">{t('mov.toConfirm')}</span> : isScheduled(tx, today) && <span className="tag">{t('mov.scheduled')}</span>}
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
