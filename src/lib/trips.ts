// Modalità viaggio: i viaggi stanno su questo dispositivo (tabella `trips` del server non usata
// finché non arrivano i Progetti). Un viaggio è "attivo" solo se lo si accende a mano.
import type { QuadraDB } from './db';

export interface Trip {
  id: string;
  name: string;
  currency: string;
  start: string; // AAAA-MM-GG
  end: string;
}

const TRIPS = 'pref:trips';
const ACTIVE = 'pref:trip_on';

export async function loadTrips(db: QuadraDB): Promise<Trip[]> {
  const row = await db.meta.get(TRIPS);
  try {
    return row ? (JSON.parse(row.value) as Trip[]) : [];
  } catch {
    return [];
  }
}

export async function saveTrips(db: QuadraDB, trips: Trip[]): Promise<void> {
  await db.meta.put({ key: TRIPS, value: JSON.stringify(trips) });
}

export const activeTripId = async (db: QuadraDB): Promise<string | null> => (await db.meta.get(ACTIVE))?.value || null;

export async function setActiveTrip(db: QuadraDB, id: string | null): Promise<void> {
  await db.meta.put({ key: ACTIVE, value: id ?? '' });
}

/** Il viaggio acceso, se esiste ancora. */
export function currentTrip(trips: Trip[], activeId: string | null): Trip | null {
  return trips.find((t) => t.id === activeId) ?? null;
}

export function newTrip(name: string, currency: string, start: string, end: string): Trip | null {
  const clean = name.trim();
  if (!clean || !currency || !start || !end || end < start) return null;
  return { id: crypto.randomUUID(), name: clean, currency, start, end };
}
