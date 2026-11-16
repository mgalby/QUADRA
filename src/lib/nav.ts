import { useCallback, useEffect, useState } from 'react';
import type { TxKind } from './types';

export type Screen =
  | { name: 'home' }
  | { name: 'movements'; macroId?: string; categoryId?: string }
  | { name: 'entry'; kind: TxKind; txId?: string; adjust?: boolean } // adjust: apre subito il foglio per la rettifica
  | { name: 'stats' }
  | { name: 'recurrences' }
  | { name: 'fxpending' }
  | { name: 'import' }
  | { name: 'recurrence'; id?: string }
  | { name: 'categories' }
  | { name: 'category'; id?: string; macroId?: string } // senza id: categoria nuova nella macro indicata
  | { name: 'macro'; id?: string; kind?: TxKind }
  | { name: 'merchants' }
  | { name: 'settings' };

export interface Nav {
  screen: Screen;
  /** Apre una schermata sopra quella corrente (il tasto indietro del telefono la chiude). */
  go: (s: Screen) => void;
  back: () => void;
  /** Cambia sezione principale (Home, Movimenti). */
  tab: (s: Screen) => void;
}

// Navigazione minima: una pila di schermate agganciata alla cronologia del browser.
export function useNav(): Nav {
  const [stack, setStack] = useState<Screen[]>([{ name: 'home' }]);

  useEffect(() => {
    const onPop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((s: Screen) => {
    history.pushState({ quadra: true }, '');
    setStack((st) => [...st, s]);
  }, []);
  const back = useCallback(() => {
    if (history.state?.quadra) history.back();
    else setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const tab = useCallback((s: Screen) => setStack([s]), []);

  return { screen: stack[stack.length - 1], go, back, tab };
}
