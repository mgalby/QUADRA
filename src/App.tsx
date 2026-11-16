import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from './auth/AuthProvider';
import { Toast, type ToastData } from './components/Toast';
import { deleteTransaction } from './lib/data';
import { openDb } from './lib/db';
import { generateDue } from './lib/recurring';
import { slicesOf, type Basis } from './lib/basis';
import { monthOf, todayISO } from './lib/dates';
import { useMasterData } from './lib/hooks';
import { useI18n } from './lib/i18n';
import { formatMoney, toCents } from './lib/money';
import { useNav } from './lib/nav';
import { isConfigured } from './lib/supabase';
import { markOffline, syncNow } from './lib/sync';
import type { Transaction } from './lib/types';
import { Entry } from './pages/Entry';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Movements } from './pages/Movements';
import { RecurrenceForm } from './pages/RecurrenceForm';
import { Recurrences } from './pages/Recurrences';
import { Import } from './pages/Import';
import { FxPending } from './pages/FxPending';
import { Settings } from './pages/Settings';
import { Categories } from './pages/Categories';
import { CategoryForm } from './pages/CategoryForm';
import { MacroForm } from './pages/MacroForm';
import { Merchants } from './pages/Merchants';
import { PERIODS, Stats } from './pages/Stats';
import { activeTripId, currentTrip, loadTrips } from './lib/trips';

export function App() {
  const { session } = useAuth();
  const { t } = useI18n();

  if (!isConfigured) {
    return (
      <main className="login">
        <div className="card">
          <h2>{t('config.title')}</h2>
          <p className="muted">{t('config.body')}</p>
        </div>
      </main>
    );
  }
  if (session === undefined) return <main className="login" aria-busy="true" />;
  if (session === null) return <Login />;
  return <Shell key={session.user.id} userId={session.user.id} email={session.user.email ?? ''} />;
}

/** L'app dopo il login: dati locali, sincronizzazione, schermate. */
function Shell({ userId, email }: { userId: string; email: string }) {
  const { t, locale, setLocale } = useI18n();
  const db = useMemo(() => openDb(userId), [userId]);
  const master = useMasterData(db);
  const nav = useNav();
  const [month, setMonth] = useState(() => monthOf(todayISO()));
  const [onlyDisc, setOnlyDisc] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  // vista della ciambella: la preferenza (per dispositivo) decide l'avvio, il pulsante nella Home la cambia al volo
  const [homeView, setHomeView] = useState<'macro' | 'category' | null>(null);
  const savedView = useLiveQuery(() => db.meta.get('pref:home_view'), [db]);
  const view: 'macro' | 'category' = homeView ?? (savedView?.value === 'category' ? 'category' : 'macro');

  // Competenza o Cassa: l'ultima scelta resta salvata su questo dispositivo
  const [basisState, setBasisState] = useState<Basis | null>(null);
  const savedBasis = useLiveQuery(() => db.meta.get('pref:basis'), [db]);
  const basis: Basis = basisState ?? (savedBasis?.value === 'cash' ? 'cash' : 'accrual');
  const setBasis = useCallback((b: Basis) => {
    setBasisState(b);
    void db.meta.put({ key: 'pref:basis', value: b });
  }, [db]);

  // Statistiche: il periodo (3, 6 o 12 mesi) resta salvato su questo dispositivo
  const [periodState, setPeriodState] = useState<number | null>(null);
  const savedPeriod = useLiveQuery(() => db.meta.get('pref:stats_months'), [db]);
  const statsPeriod = periodState ?? PERIODS.find((p) => String(p) === savedPeriod?.value) ?? 12;
  const setStatsPeriod = useCallback((p: number) => {
    setPeriodState(p);
    void db.meta.put({ key: 'pref:stats_months', value: String(p) });
  }, [db]);

  const profile = useLiveQuery(() => db.profile.get(userId), [db, userId]);
  const trips = useLiveQuery(() => loadTrips(db), [db]);
  const tripOn = useLiveQuery(() => activeTripId(db), [db]);
  const trip = currentTrip(trips ?? [], tripOn ?? null);
  const pending = useLiveQuery(() => db.outbox.filter((o) => o.kind === 'tx').count(), [db]) ?? 0;
  const currency = profile?.base_currency ?? 'EUR';

  // Sincronizza e poi prepara le scadenze delle ricorrenze (anche senza rete: sono calcolate sul dispositivo).
  // Se ne nascono di nuove, parte subito un secondo invio.
  const sync = useCallback(() => {
    void syncNow(db, userId)
      .then(() => generateDue(db, todayISO()))
      .then(async (created) => {
        if ((await db.outbox.count()) > 0) void syncNow(db, userId);
        if (created > 0) setToast({ id: Date.now(), text: t(created === 1 ? 'toast.generated.one' : 'toast.generated.many', { n: created }) });
      })
      .catch((e) => console.error('Ricorrenze:', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, userId]);

  // sincronizza all'avvio, al ritorno della rete e quando si torna sull'app
  useEffect(() => {
    sync();
    const onVisible = () => document.visibilityState === 'visible' && sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', markOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', markOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sync]);

  // la lingua salvata nel profilo vince su quella del browser
  useEffect(() => {
    if (profile && profile.locale !== locale) setLocale(profile.locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.locale]);

  const closeToast = useCallback(() => setToast(null), []);

  function onSaved(tx: Transaction, isNew: boolean) {
    const amount = formatMoney(toCents(tx.total), currency, locale);
    const stillEstimated = tx.fx_status === 'estimated' ? ` · ${t('fx.stillEstimated')}` : '';
    const category = tx.lines.length > 1 ? t('mov.multi') : master.categoryById.get(tx.lines[0].category_id)?.name ?? '';
    // si torna sul mese del movimento nella vista scelta, per vederlo (con quote o pagamenti spostati, il primo)
    setMonth(monthOf(slicesOf(tx, basis, todayISO())[0]?.date ?? tx.tx_date));
    nav.back();
    sync();
    setToast({
      id: Date.now(),
      text: t(isNew ? 'toast.saved' : 'toast.updated', { amount, category }) + stillEstimated,
      // tap sbagliato: cinque secondi per ripensarci
      action: isNew
        ? { label: t('toast.undo'), run: () => void deleteTransaction(db, tx.id).then(sync) }
        : undefined,
    });
  }

  function onDeleted() {
    nav.back();
    sync();
    setToast({ id: Date.now(), text: t('toast.deleted') });
  }

  function onRecDone(msg: 'saved' | 'ended') {
    void generateDue(db, todayISO()).then(() => sync());
    nav.back();
    setToast({ id: Date.now(), text: t(msg === 'saved' ? 'toast.recSaved' : 'toast.recEnded') });
  }

  // anagrafiche: si torna all'elenco, parte l'invio e un avviso conferma
  function onMasterDone(text: string) {
    nav.back();
    sync();
    setToast({ id: Date.now(), text });
  }

  const s = nav.screen;
  return (
    <>
      {s.name === 'home' && (
        <Home db={db} master={master} nav={nav} month={month} setMonth={setMonth} onlyDisc={onlyDisc} setOnlyDisc={setOnlyDisc} view={view} setView={setHomeView} basis={basis} setBasis={setBasis} currency={currency} pending={pending} />
      )}
      {s.name === 'movements' && (
        <Movements db={db} master={master} nav={nav} month={month} setMonth={setMonth} macroId={s.macroId} categoryId={s.categoryId} basis={basis} setBasis={setBasis} currency={currency} pending={pending} />
      )}
      {s.name === 'stats' && (
        <Stats db={db} master={master} nav={nav} setMonth={setMonth} period={statsPeriod} setPeriod={setStatsPeriod} onlyDisc={onlyDisc} setOnlyDisc={setOnlyDisc} basis={basis} setBasis={setBasis} currency={currency} pending={pending} />
      )}
      {s.name === 'entry' && (
        <Entry key={s.txId ?? 'new'} db={db} master={master} kind={s.kind} txId={s.txId} adjust={s.adjust} currency={currency} trip={trip ? { name: trip.name, currency: trip.currency } : null} onBack={nav.back} onSaved={onSaved} onDeleted={onDeleted} />
      )}
      {s.name === 'import' && <Import db={db} master={master} nav={nav} currency={currency} userId={userId} onSync={sync} />}
      {s.name === 'categories' && <Categories db={db} master={master} nav={nav} onSync={sync} />}
      {s.name === 'category' && master.ready && (
        <CategoryForm key={s.id ?? `new:${s.macroId}`} db={db} master={master} userId={userId} id={s.id} macroId={s.macroId} onBack={nav.back} onDone={onMasterDone} />
      )}
      {s.name === 'macro' && master.ready && (
        <MacroForm key={s.id ?? `new:${s.kind}`} db={db} master={master} userId={userId} id={s.id} kind={s.kind} onBack={nav.back} onDone={onMasterDone} />
      )}
      {s.name === 'merchants' && <Merchants db={db} nav={nav} onSync={sync} onToast={setToast} />}
      {s.name === 'fxpending' && <FxPending db={db} master={master} nav={nav} currency={currency} />}
      {s.name === 'recurrences' && <Recurrences db={db} master={master} nav={nav} currency={currency} pending={pending} />}
      {s.name === 'recurrence' && <RecurrenceForm key={s.id ?? 'new'} db={db} master={master} id={s.id} currency={currency} onBack={nav.back} onDone={onRecDone} />}
      {s.name === 'settings' && (
        <Settings db={db} master={master} nav={nav} currency={currency} userId={userId} email={email} pending={pending} onSync={sync} view={savedView?.value === 'category' ? 'category' : 'macro'} onViewPref={(v) => { void db.meta.put({ key: 'pref:home_view', value: v }); setHomeView(v); }} />
      )}
      {toast && <Toast toast={toast} onClose={closeToast} />}
    </>
  );
}
