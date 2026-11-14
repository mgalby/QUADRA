import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../auth/AuthProvider';
import { openDb } from '../lib/db';
import { useI18n } from '../lib/i18n';
import { pullMasterData } from '../lib/sync';
import type { Category, TxKind } from '../lib/types';

type SyncState = { status: 'syncing' } | { status: 'ok' } | { status: 'offline' } | { status: 'error'; msg: string };

export function Home({ userId, email }: { userId: string; email: string }) {
  const { signOut } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const db = useMemo(() => openDb(userId), [userId]);
  const [sync, setSync] = useState<SyncState>({ status: 'syncing' });

  // Si legge sempre dall'archivio locale: la schermata si aggiorna da sola quando cambia.
  const profile = useLiveQuery(() => db.profile.get(userId), [db, userId]);
  const macros = useLiveQuery(() => db.macros.orderBy('sort_order').toArray(), [db]);
  const categories = useLiveQuery(() => db.categories.orderBy('sort_order').toArray(), [db]);
  const lastPull = useLiveQuery(() => db.meta.get('last_pull'), [db]);

  const runSync = useCallback(async () => {
    if (!navigator.onLine) return setSync({ status: 'offline' });
    setSync({ status: 'syncing' });
    try {
      await pullMasterData(db, userId);
      setSync({ status: 'ok' });
    } catch (e) {
      setSync(navigator.onLine ? { status: 'error', msg: e instanceof Error ? e.message : String(e) } : { status: 'offline' });
    }
  }, [db, userId]);

  useEffect(() => {
    void runSync();
    const onOnline = () => void runSync();
    const onOffline = () => setSync({ status: 'offline' });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [runSync]);

  // la lingua salvata nel profilo vince su quella del browser
  useEffect(() => {
    if (profile && profile.locale !== locale) setLocale(profile.locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.locale]);

  const byMacro = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories ?? []) {
      if (c.deleted_at || c.archived) continue;
      map.set(c.macro_id, [...(map.get(c.macro_id) ?? []), c]);
    }
    return map;
  }, [categories]);

  const visibleMacros = (macros ?? []).filter((m) => !m.deleted_at && !m.archived);
  const catCount = [...byMacro.values()].reduce((n, list) => n + list.length, 0);
  const time = lastPull
    ? new Date(lastPull.value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : '';

  const syncText =
    sync.status === 'syncing' ? t('home.sync.syncing')
    : sync.status === 'ok' ? t('home.sync.ok', { time })
    : sync.status === 'offline' ? t('home.sync.offline')
    : t('home.sync.error', { msg: sync.msg });

  return (
    <main className="page">
      <header className="topbar">
        <h1>Quadra</h1>
        <button type="button" className="ghost" onClick={() => void signOut()}>
          <i className="ph ph-sign-out" aria-hidden="true" /> {t('home.logout')}
        </button>
      </header>

      <section className="card">
        <h2>{t('home.profile')}</h2>
        <div className="row">
          <span className="strong">{profile?.display_name ?? email}</span>
          {profile && <span className={`badge ${profile.role}`}>{t(`home.role.${profile.role}`)}</span>}
        </div>
        <div className="row muted small">
          <span>{email}</span>
          {profile && (
            <span>
              {t('home.currency')}: {profile.base_currency}
            </span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>{t('home.sync')}</h2>
        <div className="row">
          <span className={`sync ${sync.status}`} role="status">
            <span className="dot" aria-hidden="true" /> {syncText}
          </span>
          {sync.status !== 'syncing' && (
            <button type="button" className="ghost" onClick={() => void runSync()}>
              <i className="ph ph-arrows-clockwise" aria-hidden="true" /> {t('home.sync.retry')}
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <div className="row">
          <h2>{t('home.masterdata')}</h2>
          <span className="muted small">{t('home.counts', { macros: visibleMacros.length, categories: catCount })}</span>
        </div>
        {visibleMacros.length === 0 && <p className="muted small">{t('home.empty')}</p>}
        {(['expense', 'income'] as TxKind[]).map((kind) => {
          const list = visibleMacros.filter((m) => m.tx_kind === kind);
          if (list.length === 0) return null;
          return (
            <div key={kind}>
              <h3>{t(`home.${kind}`)}</h3>
              <ul className="macros">
                {list.map((m) => (
                  <li key={m.id}>
                    <span className="chip" style={{ background: `${m.color}2E`, color: m.color }}>
                      <i className={`ph-duotone ph-${m.icon}`} aria-hidden="true" />
                    </span>
                    <div className="macro-body">
                      <span className="strong">{m.name}</span>
                      <span className="cats">
                        {(byMacro.get(m.id) ?? []).map((c) => (
                          <span key={c.id} className="cat" title={t(`flag.${c.flag}`)}>
                            <i className={`ph-duotone ph-${c.icon}`} style={{ color: c.shade ?? m.color }} aria-hidden="true" />
                            {c.name}
                            {c.flag === 'discretionary' && <span className="disc" aria-label={t('flag.discretionary')} />}
                          </span>
                        ))}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <p className="muted small center">
        {t('home.skeleton')} · v{__APP_VERSION__}
      </p>
    </main>
  );
}
