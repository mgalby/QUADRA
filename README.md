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
  lib/sync.ts         coda di invio e scarico (movimenti, ricorrenze, esercizi, macro, categorie)
  lib/master.ts       regole delle anagrafiche (pure, con test); masterWrite.ts le scrive in locale
  lib/icons.ts        ricerca delle icone; iconNames.ts è generato da scripts/make_icon_names.mjs
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

v1.1.0 — Budget, prima tranche (richiede `quadra_schema_v2.sql` sul database). Nuova voce
**Budget** nella barra in basso. Storico di riferimento (saldi letti da Monefy per categoria o
macro, anno o mese, con "straordinaria"); costruzione del budget dell'anno con le proposte: ogni
riga = programmato (ricorrenze e piani rate dell'anno, calcolati) + integrazione (storico
ritoccato meno programmato, importo noto o a mano); previsioni per le essenziali, tetto comune
per la parte discrezionale di una macro, tetti dedicati facoltativi, profilo mensile sui tetti;
bozza viva fino all'approvazione; lettura sempre in competenza con budget, consuntivo,
impegnato, disponibile, Budget YTD, scostamento e "al mese". Logica pura in `src/lib/budget.ts`
(con test), dati in `src/lib/budgetData.ts`, scrittura in `src/lib/budgetWrite.ts`, schermate
`Budget`, `BudgetLineForm`, `BudgetMacro`, `ReferenceBalances`. Dexie versione 4; sincronizzazione
e backup estesi alle tre tabelle. Collaudo nel browser: `qa/v110.mjs`.

v0.9.1 — Backup e ripristino. Impostazioni → Backup e ripristino: «Scarica il backup» produce
`quadra-backup-AAAA-MM-GG.json` con tutte le tabelle dell'utente (anche le righe cancellate
logicamente, con righe, pagamenti e quote dei movimenti) più le preferenze del dispositivo
(`pref:*`: viaggi, vista, periodo; `import:*`); mostra la data dell'ultimo backup e avvisa se
sono passati più di 30 giorni. «Ripristina da file» legge il file, lo controlla (è di Quadra,
non più nuovo dell'app, dello stesso utente, riferimenti completi) e mostra un'anteprima
(nuove e diverse per tabella); dopo due tocchi le righe del file vincono su quelle del
dispositivo (prendono l'ora di adesso e entrano nella coda di invio, quindi vincono anche sul
server), mentre le righe che il file non conosce restano. Funziona anche su un dispositivo
vuoto. Logica in `src/lib/backup.ts` (con test su fake-indexeddb), interfaccia in
`src/components/BackupCard.tsx`. Nessuna modifica al database né a Dexie. Collaudo nel browser:
`qa/v091.mjs`.

v0.9.0 — Anagrafiche. Impostazioni → Categorie e macro: creare, rinominare, cambiare icona
(ricerca in italiano o in inglese) e colore, tipo di spesa, spostare tra macro dello stesso tipo,
riordinare con le frecce, fissare in una casella della griglia, archiviare, ripristinare, eliminare
(solo senza storia). Impostazioni → Esercizi: rinomina, fusione dei doppioni (`merged_into_id`: i
movimenti non si toccano, ovunque compare il nome principale), separazione, eliminazione.
Importazione CSV: "Crea" per i nomi di categoria sconosciuti. Regole: nomi unici tra le attive
dello stesso tipo; il cambio di tipo di spesa o di macro vale anche per il passato (con avviso);
una categoria usata da una ricorrenza attiva non si archivia; archiviare una macro nasconde le
sue categorie senza riscriverle; deve restare una macro attiva per tipo. Sincronizzazione: nuove
voci di coda `macro:` e `cat:` (macro ed esercizi, poi categorie, ricorrenze, movimenti); lo
scarico non sovrascrive le righe in attesa di invio. Nessuna modifica al database né a Dexie.
Collaudo nel browser: `qa/v090.mjs`.

v0.8.1 — Statistiche: categorie ed esercizi seguono il mese toccato nell'istogramma (all'apertura è il mese in corso); toccare di nuovo la colonna o "Tutto il periodo" mostra l'intero periodo; le barrette sotto le categorie restano su tutto il periodo.

v0.8.0 — Statistiche, prima tranche (voce Statistiche nella barra in basso), sempre in euro e
solo su ciò che è già avvenuto (scadenze future e da confermare escluse). Interruttori
Competenza/Cassa, periodo 3/6/12 mesi (ricordato sul dispositivo) e "Solo discrezionali"
(lo stesso della Home). Andamento mensile a barre impilate (discrezionali alla base,
essenziali sopra, entrate come tacca); toccando un mese: discrezionali, quota sulle uscite e
scostamento dalla media dei tre mesi precedenti. Categorie nel tempo (prime 5 + Altre, con
l'andamento mese per mese; il tocco apre i Movimenti filtrati) ed Esercizi principali (primi
10, numero di movimenti e scontrino medio). Il flag vale riga per riga
(`line.flag_override ?? cat.flag`). Logica in `src/lib/trends.ts`.
Esportazione CSV (Impostazioni → Esporta in CSV): intervallo da–a (di default tutto lo
storico), stesso tracciato dell'import; uno scontrino diviso esce con una riga per categoria,
di una spesa spalmata o con più pagamenti resta una riga con il primo mese di competenza
(la schermata avvisa di quanti). Logica in `src/lib/exporter.ts`.

v0.7.0 — Importa da CSV (Impostazioni → Importa): colonne Data, Importo, Segno (U/E),
Categoria, Esercizio, Note, Competenza (AAAA-MM), Valuta, ImportoOriginale; solo Data e
Importo sono obbligatorie. Separatore, codifica (UTF-8/Windows-1252), formati di importo e
data riconosciuti da soli. Anteprima con categorie da assegnare, doppioni (stesso importo e
segno entro 3 giorni, esclusi di default) ed errori; modello scaricabile; importazione
annullabile in blocco da Impostazioni. Tutto in locale. Formato Monefy: da aggiungere.

v0.6.2 — Data su PC: nella schermata di inserimento un clic sulla data apre subito il calendario (prima su desktop non succedeva nulla).

v0.6.1 — Rettifica più visibile: aprendo un movimento in valuta, sotto l'importo
compare "≈ x € · stimato · Rettifica" (o "rettificato"); toccandolo si apre Più opzioni
con il cursore sull'addebito reale. Dall'elenco "da rettificare" il foglio si apre
da solo. Salvando un movimento ancora stimato, l'avviso dice "resta da rettificare".
La rettifica resta implicita: scrivere l'addebito reale in euro.

v0.6.0 — Valuta estera. In "Più opzioni" c'è la scelta della valuta: l'importo
scritto vale in quella valuta e sotto compare "≈ x €". Cambio BCE (Frankfurter) del
giorno del movimento; offline si usa l'ultimo noto per quella valuta; se non ce n'è,
si scrive a mano. Stato stimato finché non si inserisce l'addebito reale in euro
("Addebito reale", in Più opzioni): il movimento diventa rettificato e il cambio si
ricalcola. Home: riquadro "da rettificare" con elenco. Movimenti: importo originale e
tag "stimato". Dividi scontrino: righe nella valuta dello scontrino, ripartite in
proporzione sul totale in euro. Viaggi (Impostazioni): nome, valuta, date; interruttore
a mano; con un viaggio acceso l'inserimento parte nella sua valuta (i viaggi stanno
sul dispositivo). Ricorrenze fisse e variabili in valuta: ogni scadenza nasce stimata
e da confermare. Logica in `src/lib/fx.ts` e `src/lib/trips.ts` (con test). Nessuna
modifica al database.

v0.5.1 — In "Più opzioni" la competenza ha tre scelte: Mese del pagamento (default),
Altro mese (una sola quota in un mese a scelta: anticipo pagato oggi per una cosa di
febbraio) e Spalma. Il pagamento resta alla data del movimento. Dopo il salvataggio
la Home apre il mese in cui il movimento cade nella modalità attiva.

v0.5.0 — Cassa e competenza: interruttore Competenza/Cassa in Home e Movimenti
(preferenza salvata). Ogni movimento si "affetta" in pagamenti (cassa) o quote di
competenza; senza piano è un pagamento alla data e una quota nel mese. "Più opzioni"
(icona regolatori accanto a Dividi) apre il foglio: Spalma (dal mese X per N mesi,
quote uguali, l'ultima assorbe i centesimi, modificabili a mano) e Più pagamenti
(acconto e saldo). Il foglio non si chiude con "Fatto" finché le somme non tornano.
Se il totale cambia dopo aver impostato un piano, quote e pagamenti si ricalcolano
in proporzione con avviso. Movimenti: una riga per fetta ("quota 2 di 12",
"pagamento 2 di 2"); il totale del mese coincide con la Home. Logica in
`src/lib/basis.ts` e `src/lib/plan.ts` (con test). Nessuna modifica al database:
il server già accettava `payments` e `accruals`.

v0.4.0 — Dividi scontrino: nell'inserimento il pulsante "Dividi scontrino" (solo
uscite) apre le righe. La prima prende tutto l'importo; l'importo scritto su una
riga la toglie dalla prima (o dall'ultima se si modifica la prima). Il tastierino
scrive sull'importo attivo: il totale oppure una riga. Salva resta spento finché
il resto non è zero e ogni riga ha categoria e importo maggiore di zero. Logica
pura in `src/lib/split.ts` (con test); `saveTransaction` accetta `split` e rifiuta
righe che non sommano al totale. Le righe di un movimento si ordinano in modo
stabile (la più pesante per prima, `sortLines`) anche al ritorno dal server.
Nei Movimenti: icona "diviso", titolo "Più categorie", categorie elencate; con un
filtro per categoria o macro conta solo la quota. Nessuna modifica al database.

v0.3.1 — Home con vista Macro/Categorie: pulsante nella testata per cambiare al volo,
vista iniziale tra i parametri in Impostazioni (per dispositivo, in `meta` locale
`pref:home_view`); nella vista Categorie le tonalità sono automatiche per macro
(`src/lib/colors.ts`) e il tocco filtra Movimenti per categoria.

v0.3.0 — Ricorrenze e piani rate, oltre a quanto già c'era dalla v0.2.0
(Home con ciambella, inserimento rapido, movimenti, sincronizzazione local-first).

Ricorrenze: fisse (importo noto), variabili (bollette: alla scadenza compaiono in
"Da confermare" con l'ultimo importo) e piani rate (l'ultima rata assorbe i
centesimi). Regole: scadenza il 31 in un mese corto = ultimo giorno del mese; le
scadenze si preparano all'apertura dell'app, anche offline, per gli arretrati e per
i prossimi 30 giorni; una scadenza ha un identificatore calcolato (due dispositivi
ottengono lo stesso), quindi non si duplica; una scadenza cancellata a mano non si
rigenera; una modifica vale solo per le scadenze future; "Termina" lascia la storia.

Non ancora: ricorrenze in valuta estera, competenza "tutta nel mese dell'acquisto"
per le rate (serve una colonna in più sul database), cassa/competenza, valuta
estera, importazione CSV, backup.
