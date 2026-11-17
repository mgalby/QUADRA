import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { applyRestore, backupFileName, buildBackup, daysSince, LAST_BACKUP_KEY, parseBackup, planRestore, type BackupFile, type RestorePlan } from '../lib/backup';
import { todayISO } from '../lib/dates';
import type { QuadraDB } from '../lib/db';
import { useI18n } from '../lib/i18n';

/** Impostazioni → Backup e ripristino: file JSON completo, con anteprima prima di ripristinare. */
export function BackupCard({ db, userId, onSync }: { db: QuadraDB; userId: string; onSync: () => void }) {
  const { t, locale } = useI18n();
  const last = useLiveQuery(() => db.meta.get(LAST_BACKUP_KEY), [db]);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<{ file: BackupFile; plan: RestorePlan } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);

  const days = daysSince(last?.value);

  async function download() {
    const file = await buildBackup(db, userId, __APP_VERSION__);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName(todayISO());
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    await db.meta.put({ key: LAST_BACKUP_KEY, value: file.createdAt });
    setDone(file.transactions.filter((x) => !x.deleted_at).length);
  }

  async function pick(f: File | undefined) {
    setError(null);
    setStaged(null);
    setConfirm(false);
    setApplied(null);
    if (!f) return;
    const local = {
      categories: new Set((await db.categories.toArray()).map((c) => c.id)),
      merchants: new Set((await db.merchants.toArray()).map((m) => m.id)),
    };
    const res = parseBackup(await f.text(), userId, local);
    if (!res.ok) return setError(t(`bk.err.${res.reason}`));
    setStaged({ file: res.file, plan: await planRestore(db, res.file) });
  }

  async function apply() {
    if (!staged) return;
    if (!confirm) return setConfirm(true);
    const n = await applyRestore(db, staged.file);
    setStaged(null);
    setConfirm(false);
    setApplied(n);
    onSync();
  }

  const lines = (p: RestorePlan) => [
    ['bk.t.tx', p.transactions],
    ['bk.t.cat', { added: p.categories.added + p.macros.added, changed: p.categories.changed + p.macros.changed, same: 0 }],
    ['bk.t.mer', p.merchants],
    ['bk.t.rec', { added: p.recurrences.added + p.installments.added, changed: p.recurrences.changed + p.installments.changed, same: 0 }],
  ] as const;

  return (
    <section className="card">
      <h2>{t('bk.title')}</h2>
      <p className="muted small">{t('bk.hint')}</p>
      <p className={`small ${last && days !== null && days <= 30 ? 'muted' : 'opt-notice'}`} role="status">
        {last && days !== null
          ? days > 30
            ? t('bk.old', { n: days })
            : t('bk.last', { date: new Date(last.value).toLocaleDateString(locale, { dateStyle: 'medium' }) })
          : t('bk.never')}
      </p>
      <button type="button" className="ghost" onClick={() => void download()}>
        <i className="ph ph-download-simple" aria-hidden="true" /> {t('bk.download')}
      </button>
      {done !== null && <p className="muted small" role="status">{t('bk.done', { n: done })}</p>}

      <p className="muted small">{t('bk.restore.hint')}</p>
      <label className="ghost file-btn bk-file">
        <i className="ph ph-upload-simple" aria-hidden="true" /> {t('bk.restore')}
        <input type="file" accept=".json,application/json" aria-label={t('bk.restore')} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {applied !== null && <p className="muted small" role="status">{t('bk.applied', { n: applied })}</p>}
      {staged && (
        <div className="exp-notes">
          <p className="small strong">{t('bk.plan.title', { date: new Date(staged.file.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
          {staged.plan.toWrite === 0 ? (
            <p className="muted small">{t('bk.plan.none')}</p>
          ) : (
            lines(staged.plan).filter(([, d]) => d.added + d.changed > 0).map(([k, d]) => (
              <p key={k} className="small">{t('bk.plan.line', { label: t(k), added: d.added, changed: d.changed })}</p>
            ))
          )}
          {staged.plan.extra > 0 && <p className="muted small">{t('bk.plan.extra', { n: staged.plan.extra })}</p>}
          <div className="row">
            {staged.plan.toWrite > 0 && (
              <button type="button" className={confirm ? 'primary' : 'ghost'} onClick={() => void apply()}>
                {confirm ? t('bk.apply.confirm') : t('bk.apply')}
              </button>
            )}
            <button type="button" className="ghost" onClick={() => { setStaged(null); setConfirm(false); }}>{t('bk.cancel')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
