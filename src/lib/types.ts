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

/** Pagamento (cassa): quando esce il denaro. */
export interface Payment {
  pay_date: string; // AAAA-MM-GG
  amount: number;
}

/** Quota di competenza: a quale mese appartiene la spesa. */
export interface Accrual {
  period: string; // primo giorno del mese, AAAA-MM-01
  amount: number;
}

/**
 * Movimento come sta sul dispositivo: testata, righe per categoria, pagamenti e
 * quote di competenza. Pagamenti e quote sommano sempre al totale; se mancano
 * (movimenti nati prima della v0.5.0 o dalle ricorrenze) valgono i default:
 * un pagamento alla data del movimento e una quota nel suo mese.
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
  /** Valuta estera: se manca (o è la valuta di conto) il movimento è in euro. */
  currency?: string;
  amount_original?: number | null; // importo nella valuta estera
  fx_rate?: number | null;         // valuta estera per 1 unità di conto
  fx_status: 'none' | 'estimated' | 'final';
  recurrence_id: string | null;
  occurrence_date: string | null;  // scadenza della ricorrenza da cui nasce
  installment_id: string | null;   // rata del piano da cui nasce
  client_modified_at: string;
  deleted_at: string | null;
  lines: TxLine[];
  payments?: Payment[];
  accruals?: Accrual[];
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

// ----- Budget (v1.1, quadra_schema_v2.sql) ---------------------------------

/** Testata del budget di un anno: stato e riserva per gli imprevisti. */
export interface Budget extends SyncFields {
  year: number;
  status: 'draft' | 'approved';
  approved_at: string | null;
  reserve_original: number;
  reserve_revised: number | null; // dalla 1.2
  reserve_pct: number | null;     // attenuazione usata per proporre la riserva
  note: string | null;
}

export type BudgetSource = 'history' | 'known' | 'manual';
export type Distribution = 'flat' | 'quarterly' | 'manual';

/**
 * Riga di budget: con categoria (previsione se essenziale, tetto dedicato se
 * discrezionale, entrata) oppure con macro (tetto comune). Budget = programmato
 * (fotografia delle ricorrenze) + integrazione (scritta dall'utente).
 */
export interface BudgetLine extends SyncFields {
  budget_id: string;
  category_id: string | null;
  macro_id: string | null;
  source: BudgetSource;
  history_base: number | null;
  adjust_pct: number | null;
  programmed_original: number;
  integration_original: number;
  programmed_revised: number | null;  // dalla 1.2
  integration_revised: number | null; // dalla 1.2
  monthly_profile: number[] | null;   // superato dalla 1.1.1 (patch v2.1): resta vuoto
  /** Curva dell'integrazione sui mesi: flat, 4 % per trimestre, 12 importi in euro (la loro somma è l'integrazione). */
  distribution?: Distribution;        // assente sulle righe scaricate prima della 1.1.1 = flat
  distribution_values?: number[] | null;
  reviewed: boolean;
  note: string | null;
}

/** Saldo di riferimento (storico letto da Monefy). */
export interface ReferenceBalance extends SyncFields {
  year: number;
  month: number | null; // null = tutto l'anno
  category_id: string | null;
  macro_id: string | null;
  amount: number;
  extraordinary: boolean;
  origin: string;
  note: string | null;
}

/** Coda di invio: cosa deve ancora arrivare al server. */
export interface OutboxEntry {
  key: string; // "tx:<id>", "merchant:<id>", "rec:<id>", "macro:<id>", "cat:<id>", "budget:<id>", "bline:<id>" oppure "refbal:<id>"
  kind: 'tx' | 'merchant' | 'rec' | 'macro' | 'cat' | 'budget' | 'bline' | 'refbal';
  id: string;
  error?: string;
}
