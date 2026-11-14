import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from './types';

// Testi dell'interfaccia. L'italiano fa da riferimento: se in inglese manca
// una chiave, il compilatore lo segnala.
const it = {
  'app.tagline': 'Spese, entrate e budget',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Accedi',
  'login.busy': 'Accesso in corso…',
  'login.invite': 'Accesso solo su invito.',
  'login.error.credentials': 'Email o password non corretti.',
  'login.error.network': 'Nessuna connessione: per il primo accesso serve la rete.',
  'login.error.generic': 'Accesso non riuscito. Riprova tra poco.',
  'config.title': 'Configurazione mancante',
  'config.body': 'Mancano VITE_SUPABASE_URL e VITE_SUPABASE_KEY. Vanno impostate in Cloudflare Pages (o in .env.local sul PC) e poi serve una nuova pubblicazione.',
  'home.logout': 'Esci',
  'home.profile': 'Profilo',
  'home.role.admin': 'Amministratore',
  'home.role.user': 'Utente',
  'home.currency': 'Valuta di conto',
  'home.sync': 'Sincronizzazione',
  'home.sync.syncing': 'Sincronizzazione in corso…',
  'home.sync.ok': 'Aggiornato alle {time}',
  'home.sync.offline': 'Offline: dati salvati sul dispositivo',
  'home.sync.error': 'Errore: {msg}',
  'home.sync.retry': 'Riprova',
  'home.masterdata': 'Anagrafiche',
  'home.counts': '{macros} macro · {categories} categorie',
  'home.empty': 'Nessun dato sul dispositivo: serve una prima sincronizzazione.',
  'home.expense': 'Uscite',
  'home.income': 'Entrate',
  'flag.essential': 'Essenziale',
  'flag.discretionary': 'Discrezionale',
  'home.skeleton': 'Scheletro dell’app: da qui nasceranno Home e inserimento rapido.',
} as const;

export type MsgKey = keyof typeof it;

const en: Record<MsgKey, string> = {
  'app.tagline': 'Expenses, income and budget',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.busy': 'Signing in…',
  'login.invite': 'Access by invitation only.',
  'login.error.credentials': 'Wrong email or password.',
  'login.error.network': 'No connection: the first sign-in needs the network.',
  'login.error.generic': 'Sign-in failed. Try again shortly.',
  'config.title': 'Missing configuration',
  'config.body': 'VITE_SUPABASE_URL and VITE_SUPABASE_KEY are missing. Set them in Cloudflare Pages (or in .env.local on the PC), then deploy again.',
  'home.logout': 'Sign out',
  'home.profile': 'Profile',
  'home.role.admin': 'Administrator',
  'home.role.user': 'User',
  'home.currency': 'Base currency',
  'home.sync': 'Sync',
  'home.sync.syncing': 'Syncing…',
  'home.sync.ok': 'Updated at {time}',
  'home.sync.offline': 'Offline: data saved on this device',
  'home.sync.error': 'Error: {msg}',
  'home.sync.retry': 'Retry',
  'home.masterdata': 'Master data',
  'home.counts': '{macros} macros · {categories} categories',
  'home.empty': 'No data on this device yet: a first sync is needed.',
  'home.expense': 'Expenses',
  'home.income': 'Income',
  'flag.essential': 'Essential',
  'flag.discretionary': 'Discretionary',
  'home.skeleton': 'App skeleton: Home and quick entry will grow from here.',
};

const messages: Record<Locale, Record<MsgKey, string>> = { it, en };
const STORAGE_KEY = 'quadra-locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'it' || saved === 'en') return saved;
  } catch {
    /* archivio non disponibile: si usa la lingua del browser */
  }
  return navigator.language.toLowerCase().startsWith('it') ? 'it' : 'en';
}

type Translate = (key: MsgKey, vars?: Record<string, string | number>) => string;
interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translate;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const value = useMemo<I18n>(() => {
    const t: Translate = (key, vars) =>
      messages[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ''));
    const setLocale = (l: Locale) => {
      setLocaleState(l);
      document.documentElement.lang = l;
      try {
        localStorage.setItem(STORAGE_KEY, l);
      } catch {
        /* pazienza: vale per questa sessione */
      }
    };
    return { locale, setLocale, t };
  }, [locale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n fuori da I18nProvider');
  return ctx;
}
