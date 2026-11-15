import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from './auth/AuthProvider';
import { Toast, type ToastData } from './components/Toast';
import { deleteTransaction } from './lib/data';
import { openDb } from './lib/db';
import { generateDue } from './lib/recurring';
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
import { Settings } from './pages/Settings';

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

  const profile = useLiveQuery(() => db.profile.get(userId), [db, userId]);
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
    const category = master.categoryById.get(tx.lines[0].category_id)?.name ?? '';
    setMonth(monthOf(tx.tx_date)); // si torna sul mese del movimento, per vederlo
    nav.back();
    sync();
    setToast({
      id: Date.now(),
      text: t(isNew ? 'toast.saved' : 'toast.updated', { amount, category }),
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

  const s = nav.screen;
  return (
    <>
      {s.name === 'home' && (
        <Home db={db} master={master} nav={nav} month={month} setMonth={setMonth} onlyDisc={onlyDisc} setOnlyDisc={setOnlyDisc} currency={currency} pending={pending} />
      )}
      {s.name === 'movements' && (
        <Movements db={db} master={master} nav={nav} month={month} setMonth={setMonth} macroId={s.macroId} currency={currency} pending={pending} />
      )}
      {s.name === 'entry' && (
        <Entry key={s.txId ?? 'new'} db={db} master={master} kind={s.kind} txId={s.txId} currency={currency} onBack={nav.back} onSaved={onSaved} onDeleted={onDeleted} />
      )}
      {s.name === 'recurrences' && <Recurrences db={db} master={master} nav={nav} currency={currency} pending={pending} />}
      {s.name === 'recurrence' && <RecurrenceForm key={s.id ?? 'new'} db={db} master={master} id={s.id} currency={currency} onBack={nav.back} onDone={onRecDone} />}
      {s.name === 'settings' && (
        <Settings db={db} master={master} nav={nav} userId={userId} email={email} pending={pending} onSync={sync} />
      )}
      {toast && <Toast toast={toast} onClose={closeToast} />}
    </>
  );
}
