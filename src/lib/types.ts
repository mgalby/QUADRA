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
  occurrence_date: string | null;  // scadenza della ricorrenza da cui nasce
  installment_id: string | null;   // rata del piano da cui nasce
  client_modified_at: string;
  deleted_at: string | null;
  lines: TxLine[];
}

export type RecKind = 'fixed' | 'variable' | 'plan';
export type IntervalUnit = 'day' | 'week' | 'month' | 'year';
export type Anchor = 'day_of_month' | 'end_of_month' | 'first_business_day';

/** Ricorrenza fissa, variabile (importo da confermare) o piano rate. */
export interface Recurrence {
  id: string;
  name: string;
  kind: RecKind;
  tx_kind: TxKind;
  category_id: string;
  merchant_id: string | null;
  note: string | null;
  reference_amount: number | null;
  currency: string;
  interval_n: number | null;
  interval_unit: IntervalUnit | null;
  anchor: Anchor | null;
  anchor_day: number | null;
  start_date: string | null;
  end_date: string | null;
  max_occurrences: number | null;
  notify_days_before: number;
  active: boolean;
  client_modified_at: string;
  deleted_at: string | null;
}

/** Rata di un piano: data, importo e se va confermata a mano. */
export interface Installment {
  id: string;
  recurrence_id: string;
  seq: number;
  due_date: string;
  amount: number;
  mode: 'auto' | 'confirm';
  client_modified_at: string;
  deleted_at: string | null;
}

/** Coda di invio: cosa deve ancora arrivare al server. */
export interface OutboxEntry {
  key: string; // "tx:<id>", "merchant:<id>" oppure "rec:<id>"
  kind: 'tx' | 'merchant' | 'rec';
  id: string;
  error?: string;
}
