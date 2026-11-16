# Collaudo nel browser

`v080.mjs` prova Statistiche ed esportazione CSV su un Supabase simulato dalle rotte del
browser (nessun server da avviare), con la data ferma al 16 novembre 2026 e una schermata
da iPhone (390×763). Serve Playwright con Chrome.

```
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_KEY=test npx vite build
npx vite preview --port 4173 &      # nello stesso comando del test
node qa/v080.mjs [cartella-schermate]
```

Attenzione: la build di prova punta al server finto. Non va pubblicata: Cloudflare
ricostruisce da sé con le variabili vere.
