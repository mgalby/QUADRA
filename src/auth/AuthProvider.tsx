import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface Auth {
  /** undefined = sto ancora leggendo la sessione salvata; null = non autenticato */
  session: Session | null | undefined;
  signIn: (email: string, password: string) => Promise<'ok' | 'credentials' | 'network' | 'generic'>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // La sessione è salvata sul dispositivo: si riapre l'app già autenticati, anche offline.
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const signIn: Auth['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (!error) return 'ok';
    if (error.code === 'invalid_credentials' || error.status === 400) return 'credentials';
    if (!navigator.onLine || error.name === 'AuthRetryableFetchError') return 'network';
    return 'generic';
  };

  // scope local: esce solo questo dispositivo, e funziona anche senza rete
  const signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
  };

  return <Ctx.Provider value={{ session, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth fuori da AuthProvider');
  return ctx;
}
