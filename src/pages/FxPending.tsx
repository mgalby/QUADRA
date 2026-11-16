import { useLiveQuery } from 'dexie-react-hooks';
import { BottomBar } from '../components/BottomBar';
import { merchantNameMap } from '../lib/master';
import type { QuadraDB } from '../lib/db';
import { shortDate } from '../lib/dates';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { formatMoney, toCents } from '../lib/money';
import type { Nav } from '../lib/nav';

/** Movimenti in valuta estera con cambio ancora stimato: da rettificare con l'addebito reale. */
export function FxPending({ db, master, nav, currency }: { db: QuadraDB; master: MasterData; nav: Nav; currency: string }) {
  const { t, locale } = useI18n();
  const list = useLiveQuery(async () => (await db.transactions.toArray()).filter((x) => !x.deleted_at && x.fx_status === 'estimated').sort((a, b) => b.tx_date.localeCompare(a.tx_date)), [db]);
  const merchants = useLiveQuery(() => db.merchants.toArray(), [db]);
  const merchantName = merchantNameMap(merchants ?? []);
  return (
    <main className="page with-bar">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={nav.back}>
          <i className="ph ph-caret-left" aria-hidden="true" />
        </button>
        <h1>{t('fx.pending.title')}</h1>
        <span className="icon-btn" />
      </header>
      <p className="muted small">{t('fx.pending.hint')}</p>
      {(list ?? []).length === 0 && <p className="muted small empty">{t('fx.pending.empty')}</p>}
      {(list ?? []).length > 0 && (
        <section className="card day">
          {(list ?? []).map((tx) => {
            const cat = master.categoryById.get(tx.lines[0]?.category_id);
            const m = cat ? master.macroById.get(cat.macro_id) : undefined;
            const color = cat?.shade ?? m?.color ?? '#8B93A0';
            return (
              <button key={tx.id} type="button" className="tx-row" onClick={() => nav.go({ name: 'entry', kind: tx.tx_kind, txId: tx.id, adjust: true })}>
                <span className="chip" style={{ background: `${color}2E`, color }}>
                  <i className={`ph-duotone ph-${cat?.icon ?? 'question'}`} aria-hidden="true" />
                </span>
                <span className="tx-main">
                  <span className="tx-title">{(tx.merchant_id && merchantName.get(tx.merchant_id)) || cat?.name || '—'}</span>
                  <span className="muted tiny tx-sub">
                    {shortDate(tx.tx_date, locale)} · {formatMoney(toCents(tx.amount_original ?? 0), tx.currency ?? currency, locale)}
                  </span>
                </span>
                <span className="num strong">≈ {formatMoney(-toCents(tx.total), currency, locale, { sign: true })}</span>
              </button>
            );
          })}
        </section>
      )}
      <BottomBar nav={nav} />
    </main>
  );
}
