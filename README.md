# Quadra

Web app personale (PWA) per spese, entrate e budget. Local-first: i dati stanno in
IndexedDB sul dispositivo e si sincronizzano con Supabase.

Documenti di riferimento (blueprint, mock-up, schema del database): progetto Claude
"Gestione Spese Domestiche".

## Stack

| Parte | Scelta |
| --- | --- |
| Interfaccia | React 19 + TypeScript, Vite 8 |
| Archivio locale | Dexie (IndexedDB), un database per utente |
| Backend | Supabase (Postgres, Auth, RLS), client `@supabase/supabase-js` |
| Installabile / offline | `vite-plugin-pwa` (service worker con aggiornamento automatico) |
| Icone | Phosphor, font icona regular + duotone (i nomi icona arrivano dal database) |
| Carattere | Inter variabile, servito dall'app (niente Google Fonts: funziona offline) |
| Hosting | Cloudflare Pages, pubblicazione automatica dal ramo `main` |

## Configurazione

Due variabili, pubbliche per natura (i dati sono protetti dalla Row Level Security):

- `VITE_SUPABASE_URL` — Project URL
- `VITE_SUPABASE_KEY` — Publishable key (`sb_publishable_…`)

Su Cloudflare Pages: Settings > Variables and Secrets. Sul PC: copiare `.env.example`
in `.env.local`. La chiave *secret* / `service_role` non va mai usata nell'app.

Cloudflare Pages: build command `npm run build`, output directory `dist`.

## Comandi

```
npm install      # una volta
npm run dev      # sviluppo su http://localhost:5173
npm run build    # controllo dei tipi + build in dist/
npm run preview  # prova della build, service worker compreso
```

## Struttura

```
src/
  main.tsx            avvio, font, icone
  App.tsx             smistamento: configurazione mancante / login / Home
  auth/AuthProvider   sessione Supabase (persistente, rinnovo automatico)
  lib/supabase.ts     client
  lib/db.ts           schema IndexedDB (Dexie) — nuove tabelle = nuova version(n)
  lib/sync.ts         scarico di profilo e anagrafiche
  lib/i18n.tsx        testi italiano / inglese
  lib/types.ts        tipi allineati a quadra_schema_v1.sql
  pages/Login.tsx
  pages/Home.tsx      schermata di verifica dello scheletro
  styles.css          tema scuro (valori dei mock-up)
public/
  _redirects          tutte le rotte servono index.html (Cloudflare Pages)
  icons/              icone provvisorie, rigenerabili con scripts/make_icons.py
```

## Stato

v0.1.0 — scheletro: login, sessione, scarico anagrafiche in locale, funzionamento
offline, installazione sulla schermata Home. Prossimo: Home con ciambella e
inserimento rapido.
