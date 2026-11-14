// Specchio delle tabelle di quadra_schema_v1.sql (solo i campi usati dall'app).
export type TxKind = 'expense' | 'income';
export type Flag = 'essential' | 'discretionary';
export type Locale = 'it' | 'en';

export interface Profile {
  id: string;
  display_name: string | null;
  role: 'admin' | 'user';
  locale: Locale;
  theme: 'dark' | 'light';
  base_currency: string;
  updated_at: string;
}

interface SyncFields {
  id: string;
  user_id: string;
  updated_at: string;          // scritto dal server: serve a scaricare le novità
  client_modified_at: string;  // scritto dal dispositivo: vince il più recente
  deleted_at: string | null;   // cancellazione logica
}

export interface Macro extends SyncFields {
  tx_kind: TxKind;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  archived: boolean;
}

export interface Category extends SyncFields {
  macro_id: string;
  name: string;
  icon: string;
  shade: string | null;
  flag: Flag;
  pinned_slot: number | null;
  sort_order: number;
  archived: boolean;
}

/** Esercizio (negozio, benzinaio, bar…). */
export interface Merchant {
  id: string;
  name: string;
  merged_into_id: string | null;
  client_modified_at: string;
  deleted_at: string | null;
}

/** Riga di un movimento: quota del totale su una categoria. */
export interface TxLine {
  category_id: string;
  amount: number;
  flag_override: Flag | null;
}

/**
 * Movimento come sta sul dispositivo: testata più righe.
 * Pagamenti e quote di competenza per ora li crea il server con i valori
 * di default (un pagamento e una quota alla data del movimento).
 */
export interface Transaction {
  id: string;
  tx_kind: TxKind;
  total: number;
  tx_date: string; // AAAA-MM-GG
  merchant_id: string | null;
  note: string | null;
  status: 'confirmed' | 'scheduled';
  accrual_mode: 'same' | 'date' | 'spread' | 'package';
  fx_status: 'none' | 'estimated' | 'final';
  recurrence_id: string | null;
  client_modified_at: string;
  deleted_at: string | null;
  lines: TxLine[];
}

/** Coda di invio: cosa deve ancora arrivare al server. */
export interface OutboxEntry {
  key: string; // "tx:<id>" oppure "merchant:<id>"
  kind: 'tx' | 'merchant';
  id: string;
  error?: string;
}
