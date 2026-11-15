import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../auth/AuthProvider';
import type { QuadraDB } from '../lib/db';
import type { MasterData } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import type { Nav } from '../lib/nav';
import { useSyncState } from '../lib/sync';
import { FX_COMMON, FX_CURRENCIES } from '../lib/fx';
import { todayISO } from '../lib/dates';
import { activeTripId, loadTrips, newTrip, saveTrips, setActiveTrip } from '../lib/trips';

/** Impostazioni, per ora ridotte a profilo, stato della sincronizzazione e uscita. */
export function Settings({ db, master, nav, userId, email, pending, onSync, view, onViewPref }: {
  db: QuadraDB;
  master: MasterData;
  nav: Nav;
  userId: string;
  email: string;
  pending: number;
  onSync: () => void;
  view: 'macro' | 'category';
  onViewPref: (v: 'macro' | 'category') => void;
}) {
  const { signOut } = useAuth();
  const { t, locale } = useI18n();
  const sync = useSyncState();
  const profile = useLiveQuery(() => db.profile.get(userId), [db, userId]);
  const lastSync = useLiveQuery(() => db.meta.get('last_sync'), [db]);
  const errors = useLiveQuery(() => db.outbox.filter((o) => !!o.error).toArray(), [db]);

  const trips = useLiveQuery(() => loadTrips(db), [db]) ?? [];
  const tripOn = useLiveQuery(() => activeTripId(db), [db]) ?? null;
  const [form, setForm] = useState(false);
  const [tName, setTName] = useState('');
  const [tCur, setTCur] = useState('USD');
  const [tStart, setTStart] = useState(todayISO());
  const [tEnd, setTEnd] = useState(todayISO());
  const created = newTrip(tName, tCur, tStart, tEnd);
  async function addTrip() {
    if (!created) return;
    await saveTrips(db, [created, ...trips]);
    await setActiveTrip(db, created.id);
    setForm(false);
    setTName('');
  }
  async function removeTrip(id: string) {
    await saveTrips(db, trips.filter((x) => x.id !== id));
    if (tripOn === id) await setActiveTrip(db, null);
  }

  const time = lastSync ? new Date(lastSync.value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
  const syncText =
    sync.status === 'syncing' || sync.status === 'idle' ? t('sync.syncing')
    : sync.status === 'ok' ? t('sync.ok', { time })
    : sync.status === 'error' ? t('sync.error', { msg: sync.msg })
    : t('sync.offline.long');

  return (
    <main className="page">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={t('common.back')} onClick={nav.back}>
          <i className="ph ph-caret-left" aria-hidden="true" />
        </button>
        <h1>{t('home.settings')}</h1>
        <span className="icon-btn" />
      </header>

      <section className="card">
        <h2>{t('set.profile')}</h2>
        <div className="row">
          <span className="strong">{profile?.display_name ?? email}</span>
          {profile && <span className={`badge ${profile.role}`}>{t(`set.role.${profile.role}`)}</span>}
        </div>
        <div className="row muted small">
          <span>{email}</span>
          {profile && <span>{t('set.currency')}: {profile.base_currency}</span>}
        </div>
      </section>

      <section className="card">
        <h2>{t('set.sync')}</h2>
        <div className="row">
          <span className={`sync ${sync.status}`} role="status">
            <span className="dot" aria-hidden="true" /> {syncText}
          </span>
          <button type="button" className="ghost" onClick={onSync} disabled={sync.status === 'syncing'}>
            <i className="ph ph-arrows-clockwise" aria-hidden="true" /> {t('sync.now')}
          </button>
        </div>
        <p className="muted small">{pending ? t('set.pending', { n: pending }) : t('set.nopending')}</p>
        {(errors ?? []).map((e) => (
          <p key={e.key} className="error">{e.error}</p>
        ))}
      </section>

      <section className="card">
        <h2>{t('set.view')}</h2>
        <div className="segmented" role="group" aria-label={t('set.view')}>
          {(['macro', 'category'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => onViewPref(v)}>{t(`set.view.${v}`)}</button>
          ))}
        </div>
        <p className="muted small">{t('set.view.hint')}</p>
      </section>

      <section className="card">
        <h2>{t('trip.title')}</h2>
        <p className="muted small">{t('trip.hint')}</p>
        {trips.map((x) => (
          <div key={x.id} className="row">
            <button type="button" className={tripOn === x.id ? 'primary' : 'ghost'} aria-pressed={tripOn === x.id} onClick={() => void setActiveTrip(db, tripOn === x.id ? null : x.id)}>
              <i className="ph ph-airplane-tilt" aria-hidden="true" /> {x.name} · {x.currency}
            </button>
            <button type="button" className="icon-btn" aria-label={t('trip.remove')} onClick={() => void removeTrip(x.id)}>
              <i className="ph ph-trash" aria-hidden="true" />
            </button>
          </div>
        ))}
        {!form && <button type="button" className="ghost" onClick={() => setForm(true)}><i className="ph ph-plus" aria-hidden="true" /> {t('trip.new')}</button>}
        {form && (
          <div className="trip-form">
            <label>{t('trip.name')}<input value={tName} onChange={(e) => setTName(e.target.value)} placeholder="Tokyo" /></label>
            <label>{t('opt.cur.title')}
              <select value={tCur} onChange={(e) => setTCur(e.target.value)}>
                {[...FX_COMMON, ...FX_CURRENCIES.filter((c) => !FX_COMMON.includes(c)).sort()].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <div className="row-fields">
              <label className="grow">{t('trip.from')}<input type="date" value={tStart} onChange={(e) => setTStart(e.target.value)} /></label>
              <label className="grow">{t('trip.to')}<input type="date" value={tEnd} onChange={(e) => setTEnd(e.target.value)} /></label>
            </div>
            <button type="button" className="primary" disabled={!created} onClick={() => void addTrip()}>{t('trip.save')}</button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t('set.masterdata')}</h2>
        <p className="small">{t('set.counts', { macros: master.macros.length, categories: master.categories.length })}</p>
      </section>

      <button type="button" className="secondary" onClick={() => void signOut()}>
        <i className="ph ph-sign-out" aria-hidden="true" /> {t('set.logout')}
      </button>
      <p className="muted small center">Quadra v{__APP_VERSION__}</p>
    </main>
  );
}
