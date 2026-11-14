import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { QuadraDB } from './db';
import type { Category, Macro, TxKind } from './types';

export interface MasterData {
  macros: Macro[];                       // attive, in ordine
  categories: Category[];                // attive, in ordine
  macroById: Map<string, Macro>;         // tutte, anche archiviate: servono ai movimenti vecchi
  categoryById: Map<string, Category>;
  categoriesOf: (kind: TxKind) => Category[];
  ready: boolean;
}

/** Macro e categorie dall'archivio locale, aggiornate da sole quando cambiano. */
export function useMasterData(db: QuadraDB): MasterData {
  const macros = useLiveQuery(() => db.macros.orderBy('sort_order').toArray(), [db]);
  const categories = useLiveQuery(() => db.categories.orderBy('sort_order').toArray(), [db]);

  return useMemo(() => {
    const allMacros = macros ?? [];
    const allCats = categories ?? [];
    const macroById = new Map(allMacros.map((m) => [m.id, m]));
    const categoryById = new Map(allCats.map((c) => [c.id, c]));
    const activeMacros = allMacros.filter((m) => !m.deleted_at && !m.archived);
    const activeIds = new Set(activeMacros.map((m) => m.id));
    const order = new Map(activeMacros.map((m, i) => [m.id, i]));
    const activeCats = allCats
      .filter((c) => !c.deleted_at && !c.archived && activeIds.has(c.macro_id))
      .sort((a, b) => order.get(a.macro_id)! - order.get(b.macro_id)! || a.sort_order - b.sort_order);
    return {
      macros: activeMacros,
      categories: activeCats,
      macroById,
      categoryById,
      categoriesOf: (kind: TxKind) => activeCats.filter((c) => macroById.get(c.macro_id)?.tx_kind === kind),
      ready: macros !== undefined && categories !== undefined,
    };
  }, [macros, categories]);
}
