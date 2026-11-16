import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ToastData } from '../components/Toast';
import type { QuadraDB } from '../lib/db';
import { useI18n } from '../lib/i18n';
import { canDeleteMerchant, checkMerchantRename, mergeMerchants, merchantRows } from '../lib/master';
import { writeMerchants } from '../lib/masterWrite';
import type { Nav } from '../lib/nav';
import type { Merchant } from '../lib/types';

/** Impostazioni → Esercizi: elenco, rinomina, fusione dei doppioni, separazione, eliminazione. */
export function Merchants({ db, nav, onSync, onToast }: { db: QuadraDB; nav: Nav; onSync: () => void; onToast: (t: ToastData) => void }) {
  const { t } = useI18n();
  const merchants = useLiveQuery(() => db.merchants.toArray(), [db]);
  const txs = useLiveQuery(() => db.transactions.toArray(), [db]);
  const recs = useLiveQuery(() => db.recurrences.toArray(), [db]);
  const rows = useMemo(() => merchantRows(merchants ?? [], txs ?? [], recs ?? []), [merchants, txs, recs]);

  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const q = query.trim().toLowerCase();
  const shown = q === '' ? rows : rows.filter((r) => r.merchant.name.toLowerCase().includes(q) || r.aliases.some((a) => a.name.toLowerCase().includes(q)));
  const row = rows.find((r) => r.merchant.id === openId);
  const check = row ? checkMerchantRename(name, row.merchant, merchants ?? []) : null;

  function open(m: Merchant) {
    setOpenId(m.id);
    setName(m.name);
    setTarget('');
    setConfirmDelete(false);
  }
  async function apply(changed: Merchant[], text: string, close = true) {
    if (changed.length === 0) return;
    await writeMerchants(db, changed);
    onSync();
    onToast({ id: Date.now(), text });
    if (close) setOpenId(null);
  }
  const merge = (into: Merchant) => row && apply(mergeMerchants(row.merchant.id, into.id, merchants ?? []), t('mer.toast.merged', { name: into.name }));

  return (
    <main className="page">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={nav.back}>
          <i className="ph ph-caret-left" aria-hidden="true" />
        </button>
        <h1>{t('mer.title')}</h1>
        <span className="icon-btn" />
      </header>

      <label className="field">
        <i className="ph ph-magnifying-glass" aria-hidden="true" />
        <input type="text" aria-label={t('mer.search')} placeholder={t('mer.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <p className="muted tiny">{t('mer.hint')}</p>

      <section className="card md-list">
        {shown.length === 0 && <p className="muted small empty">{t('mer.empty')}</p>}
        {shown.map((r) => (
          <button key={r.merchant.id} type="button" className="md-main" onClick={() => open(r.merchant)}>
            <span className="md-text">
              <span>{r.merchant.name}</span>
              <span className="muted tiny">
                {t(r.movements === 1 ? 'mer.moves.one' : 'mer.moves', { n: r.movements })}
                {r.aliases.length > 0 && ` · ${t('mer.aliases', { names: r.aliases.map((a) => a.name).join(', ') })}`}
              </span>
            </span>
            <i className="ph ph-caret-right muted" aria-hidden="true" />
          </button>
        ))}
      </section>

      {row && check && (
        <div className="sheet-backdrop" onClick={() => setOpenId(null)}>
          <div className="sheet md-sheet" role="dialog" aria-label={row.merchant.name} onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2 className="strong">{row.merchant.name}</h2>
              <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setOpenId(null)}>
                <i className="ph ph-x" aria-hidden="true" />
              </button>
            </div>

            <label>{t('md.name')}
              <input type="text" value={name} maxLength={80} enterKeyHint="done" onChange={(e) => setName(e.target.value)} />
            </label>
            {!check.ok && check.problem === 'exists' && (
              <>
                <p className="opt-notice" role="status">{t('mer.exists', { name: check.other.name })}</p>
                <button type="button" className="primary" onClick={() => void merge(check.other)}>{t('mer.mergeInto', { name: check.other.name })}</button>
              </>
            )}
            {!check.ok && check.problem === 'alias' && <p className="opt-notice" role="status">{t('mer.alias.taken')}</p>}
            {!check.ok && check.problem === 'empty' && <p className="error" role="alert">{t('md.name.empty')}</p>}
            {(check.ok || check.problem === 'same' || check.problem === 'long') && (
              <button type="button" className="primary" disabled={!check.ok}
                onClick={() => check.ok && void apply([{ ...row.merchant, name: check.name }], t('mer.toast.renamed', { name: check.name }))}>
                {t('mer.rename')}
              </button>
            )}

            {rows.length > 1 && (
              <>
                <h3>{t('mer.merge.title')}</h3>
                <p className="muted tiny">{t('mer.merge.hint', { name: row.merchant.name })}</p>
                <div className="md-merge">
                  <select aria-label={t('mer.merge.pick')} value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">{t('mer.merge.pick')}</option>
                    {rows.filter((r) => r.merchant.id !== row.merchant.id).map((r) => <option key={r.merchant.id} value={r.merchant.id}>{r.merchant.name}</option>)}
                  </select>
                  <button type="button" className="secondary" disabled={target === ''}
                    onClick={() => { const into = rows.find((r) => r.merchant.id === target)?.merchant; if (into) void merge(into); }}>
                    {t('mer.merge.go')}
                  </button>
                </div>
              </>
            )}

            {row.aliases.length > 0 && (
              <>
                <h3>{t('mer.aliases.title')}</h3>
                {row.aliases.map((a) => (
                  <div key={a.id} className="row">
                    <span>{a.name}</span>
                    <button type="button" className="ghost" onClick={() => void apply([{ ...a, merged_into_id: null }], t('mer.toast.split', { name: a.name }), false)}>{t('mer.split')}</button>
                  </div>
                ))}
              </>
            )}

            <div className="md-danger">
              {canDeleteMerchant(row) ? (
                <button type="button" className="danger" onClick={() => {
                  if (!confirmDelete) { setConfirmDelete(true); return; }
                  void apply([{ ...row.merchant, deleted_at: new Date().toISOString() }], t('mer.toast.deleted', { name: row.merchant.name }));
                }}>
                  {t(confirmDelete ? 'md.delete.confirm' : 'md.delete')}
                </button>
              ) : (
                <p className="muted tiny">{t('mer.delete.blocked')}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
