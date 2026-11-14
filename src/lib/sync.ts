import type { QuadraDB } from './db';
import { supabase } from './supabase';
import type { Category, Macro, Profile } from './types';

/**
 * Scarica dal server profilo e anagrafiche e li salva in locale.
 * Scheletro: scarico completo (sono poche decine di righe). Con i movimenti
 * diventerà incrementale su updated_at, più l'invio delle modifiche locali.
 */
export async function pullMasterData(db: QuadraDB, userId: string): Promise<void> {
  const [profile, macros, categories] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('macros').select('*'),
    supabase.from('categories').select('*'),
  ]);
  const error = profile.error ?? macros.error ?? categories.error;
  if (error) throw new Error(error.message);

  await db.transaction('rw', [db.profile, db.macros, db.categories, db.meta], async () => {
    await db.profile.put(profile.data as Profile);
    await db.macros.clear();
    await db.macros.bulkPut(macros.data as Macro[]);
    await db.categories.clear();
    await db.categories.bulkPut(categories.data as Category[]);
    await db.meta.put({ key: 'last_pull', value: new Date().toISOString() });
  });
}
