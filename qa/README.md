# Collaudo nel browser

`v080.mjs` prova Statistiche ed esportazione CSV su un Supabase simulato dalle rotte del
browser (nessun server da avviare), con la data ferma al 16 novembre 2026 e una schermata
da iPhone (390×763). Serve Playwright con Chrome.

```
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_KEY=test npx vite build
npx vite preview --port 4173 &      # nello stesso comando del test
node qa/v080.mjs [cartella-schermate]
node qa/v090.mjs [cartella-schermate]
node qa/v091.mjs [cartella-schermate]
node qa/v110.mjs [cartella-schermate]
```

`v090.mjs` prova le anagrafiche (categorie, macro, esercizi, "Crea" dall'importazione): il
server simulato ha memoria, quindi ciò che l'app invia torna negli scarichi successivi, e può
rifiutare le scritture per provare la coda di invio. 60 controlli.

`v091.mjs` prova il backup (scarico del file, rifiuto di file estranei o di un altro utente,
anteprima, ripristino a due tocchi con invio al server). 16 controlli. Il server finto ignora
il cursore degli scarichi incrementali: per questo il test non ricarica la pagina tra il
danno e il ripristino.

`v110.mjs` prova il Budget: storico di riferimento (saldi, doppioni, totale di controllo,
straordinaria), costruzione del 2027 con le proposte, importo noto, tetto dedicato e bozza viva,
profilo mensile, approvazione e riapertura a due tocchi, lettura, dettaglio della macro, backup
con le tabelle del budget. 31 controlli.

Nota: in `v080.mjs` il controllo "Coop compare solo per la quota Tech" fallisce dalla v0.8.1,
perché le liste delle Statistiche seguono il mese in evidenza (agosto, in quel punto del test).

Attenzione: la build di prova punta al server finto. Non va pubblicata: Cloudflare
ricostruisce da sé con le variabili vere.
