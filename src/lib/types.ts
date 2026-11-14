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
