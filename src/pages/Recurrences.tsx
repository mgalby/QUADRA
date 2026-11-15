import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BottomBar } from '../components/BottomBar';
import { SyncPill } from '../components/SyncPill';
import type { QuadraDB } from '../lib/db';
import { shortDate, todayISO } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { useI18n, type MsgKey } from '../lib/i18n';
import { formatMoney, toCents } from '../lib/money';
import type { Nav } from '../lib/nav';
import { nextOccurrence, scheduleOf } from '../lib/recurrence';
import type { Recurrence } from '../lib/types';

/** Testo della frequenza: "Ogni mese, il 5", "Ogni 2 settimane"… */
export function describeFrequency(r: Recurrence, t: (k: MsgKey, p?: Record<string, string | number>) => string): string {
  const n = r.interval_n ?? 1;
  const unit = r.interval_unit ?? 'month';
  const base = n === 1 ? t(`rec.every.${unit}` as MsgKey) : t(`rec.everyN.${unit}` as MsgKey, { n });
  if (unit !== 'month' && unit !== 'year') return base;
  if (r.anchor === 'end_of_month') return base + t('rec.onLast');
  if (r.anchor_day) return base + t('rec.onDay', { day: r.anchor_day });
  return base;
}

/** Ricorrenze, piani rate e scadenze in attesa di conferma. */
export function Recurrences({ db, master, nav, currency, pending }: {
  db: QuadraDB;
  master: MasterData;
  nav: Nav;
  currency: string;
  pending: number;
}) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const recs = useLiveQuery(() => db.recurrences.toArray(), [db]);
  const insts = useLiveQuery(() => db.installments.toArray(), [db]);
  const toConfirm = useLiveQuery(
    () => db.transactions.filter((x) => !!x.recurrence_id && !x.deleted_at && x.status === 'scheduled' && x.tx_date <= today).toArray(),
    [db, today],
  );
  const merchants = useLiveQuery(() => db.merchants.toArray(), [db]);
  const merchantName = useMemo(() => new Map((merchants ?? []).map((m) => [m.id, m.name])), [merchants]);
  const recName = useMemo(() => new Map((recs ?? []).map((r) => [r.id, r.name])), [recs]);

  const live = (recs ?? []).filter((r) => !r.deleted_at);
  const active = live.filter((r) => r.active).sort((a, b) => a.name.localeCompare(b.name));
  const ended = live.filter((r) => !r.active).sort((a, b) => a.name.localeCompare(b.name));
  const waiting = [...(toConfirm ?? [])].sort((a, b) => a.tx_date.localeCompare(b.tx_date));

  const chip = (r: Recurrence) => {
    const cat = master.categoryById.get(r.category_id);
    const m = cat ? master.macroById.get(cat.macro_id) : undefined;
    const color = cat?.shade ?? m?.color ?? '#8B93A0';
    return (
      <span className="chip" style={{ background: `${color}2E`, color }}>
        <i className={`ph-duotone ph-${cat?.icon ?? 'question'}`} aria-hidden="true" />
      </span>
    );
  };

  const detail = (r: Recurrence): string => {
    if (r.kind === 'plan') {
      const mine = (insts ?? []).filter((i) => i.recurrence_id === r.id && !i.deleted_at);
      const done = mine.filter((i) => i.due_date <= today).length;
      const next = mine.filter((i) => i.due_date >= today).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
      return [t('rec.progress', { done, total: mine.length }), next ? t('rec.next', { date: shortDate(next.due_date, locale) }) : null].filter(Boolean).join(' · ');
    }
    const s = scheduleOf(r);
    const next = r.active && s ? nextOccurrence(s, today) : null;
    return [describeFrequency(r, t), r.active ? (next ? t('rec.next', { date: shortDate(next, locale) }) : t('rec.noNext')) : null].filter(Boolean).join(' · ');
  };

  const row = (r: Recurrence) => {
    const cents = toCents(r.kind === 'plan' && r.max_occurrences ? (r.reference_amount ?? 0) / r.max_occurrences : (r.reference_amount ?? 0));
    return (
      <button key={r.id} type="button" className="tx-row" onClick={() => nav.go({ name: 'recurrence', id: r.id })}>
        {chip(r)}
        <span className="tx-main">
          <span className="tx-title">{r.name}</span>
          <span className="muted tiny tx-sub">{detail(r)}</span>
        </span>
        <span className={`num strong ${r.tx_kind === 'income' ? 'pos' : ''}`}>
          {r.kind === 'variable' ? '≈ ' : ''}
          {formatMoney(r.tx_kind === 'income' ? cents : -cents, currency, locale, { sign: true })}
        </span>
      </button>
    );
  };

  return (
    <main className="page with-bar">
      <header className="topbar">
        <h1 className="grow-title">{t('rec.title')}</h1>
        <button type="button" className="icon-btn" aria-label={t('rec.new')} onClick={() => nav.go({ name: 'recurrence' })}>
          <i className="ph ph-plus" aria-hidden="true" />
        </button>
      </header>

      <SyncPill pending={pending} onClick={() => nav.go({ name: 'settings' })} />

      {waiting.length > 0 && (
        <section className="card day">
          <h2>{t('rec.toConfirm')}</h2>
          {waiting.map((tx) => {
            const cat = master.categoryById.get(tx.lines[0]?.category_id);
            const m = cat ? master.macroById.get(cat.macro_id) : undefined;
            const color = cat?.shade ?? m?.color ?? '#8B93A0';
            const cents = toCents(tx.total);
            return (
              <button key={tx.id} type="button" className="tx-row" onClick={() => nav.go({ name: 'entry', kind: tx.tx_kind, txId: tx.id })}>
                <span className="chip" style={{ background: `${color}2E`, color }}>
                  <i className={`ph-duotone ph-${cat?.icon ?? 'question'}`} aria-hidden="true" />
                </span>
                <span className="tx-main">
                  <span className="tx-title">{(tx.recurrence_id && recName.get(tx.recurrence_id)) || (tx.merchant_id && merchantName.get(tx.merchant_id)) || cat?.name || '—'}</span>
                  <span className="muted tiny tx-sub">{shortDate(tx.tx_date, locale)}</span>
                </span>
                <span className={`num strong ${tx.tx_kind === 'income' ? 'pos' : ''}`}>
                  ≈ {formatMoney(tx.tx_kind === 'income' ? cents : -cents, currency, locale, { sign: true })}
                </span>
              </button>
            );
          })}
        </section>
      )}

      {live.length === 0 && <p className="muted small empty">{t('rec.empty')}</p>}

      {active.length > 0 && (
        <section className="card day">
          <h2>{t('rec.active')}</h2>
          {active.map(row)}
        </section>
      )}
      {ended.length > 0 && (
        <section className="card day ended">
          <h2>{t('rec.ended')}</h2>
          {ended.map(row)}
        </section>
      )}

      <BottomBar nav={nav} />
    </main>
  );
}
