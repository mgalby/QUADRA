import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

/** false se mancano le variabili d'ambiente (build configurata male). */
export const isConfigured = Boolean(url && key);

// La chiave è quella pubblica: da sola non apre nulla, i dati sono protetti dalla RLS.
// La sessione resta salvata sul dispositivo e si rinnova da sola.
export const supabase: SupabaseClient = createClient(
  url ?? 'https://non-configurato.invalid',
  key ?? 'non-configurato',
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'quadra-auth' } },
);
