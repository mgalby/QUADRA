// Collaudo v0.9.0: anagrafiche (categorie, macro, esercizi) su un server Supabase simulato dalle rotte del browser.
// Il server finto ha memoria: ciò che l'app invia torna negli scarichi successivi.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');

const UID = '00000000-0000-4000-8000-000000000001';
const ts = '2026-11-01T10:00:00Z';
const base = { user_id: UID, updated_at: ts, client_modified_at: ts, deleted_at: null };
const macros = [
  ['m-casa', 'Casa', 'house', '#3987e5'], ['m-cibo', 'Spesa', 'shopping-cart', '#199e70'], ['m-svago', 'Tempo libero', 'martini', '#9085e9'],
  ['m-pass', 'Passioni', 'camera', '#d55181'], ['m-tras', 'Mobilità', 'car', '#d95926'],
].map(([id, name, icon, color], i) => ({ ...base, id, tx_kind: 'expense', name, icon, color, sort_order: i + 1, archived: false }));
macros.push({ ...base, id: 'm-ent', tx_kind: 'income', name: 'Entrate', icon: 'wallet', color: '#199e70', sort_order: 10, archived: false });
const categories = [
  ['c-boll', 'm-casa', 'Bollette', 'lightning', 'essential'], ['c-cond', 'm-casa', 'Condominio', 'buildings', 'essential'],
  ['c-spesa', 'm-cibo', 'Spesa alimentare', 'shopping-cart', 'essential'], ['c-bar', 'm-svago', 'Bar e aperitivi', 'coffee', 'discretionary'],
  ['c-cene', 'm-svago', 'Cene e pranzi fuori', 'fork-knife', 'discretionary'], ['c-foto', 'm-pass', 'Fotografia', 'camera', 'discretionary'],
  ['c-tech', 'm-pass', 'Tech', 'laptop', 'discretionary'], ['c-mus', 'm-pass', 'Musica', 'music-notes', 'discretionary'],
  ['c-benz', 'm-tras', 'Benzina', 'gas-pump', 'essential'], ['c-stip', 'm-ent', 'Stipendio', 'briefcase', 'essential'],
].map(([id, macro_id, name, icon, flag], i) => ({ ...base, id, macro_id, name, icon, shade: null, flag, pinned_slot: null, sort_order: i + 1, archived: false }));
const merchants = [['me-coop', 'Coop'], ['me-coop2', 'COOP Via Roma'], ['me-eni', 'Eni'], ['me-bar', 'Bar Centrale'], ['me-enel', 'Enel'], ['me-vuoto', 'Negozio mai usato']]
  .map(([id, name]) => ({ id, name, merged_into_id: null, updated_at: ts, client_modified_at: ts, deleted_at: null, user_id: UID }));
const recurrences = [{
  ...base, id: 'r-enel', name: 'Bolletta luce', kind: 'variable', tx_kind: 'expense', category_id: 'c-boll', merchant_id: 'me-enel', note: null,
  reference_amount: 90, currency: 'EUR', interval_n: 2, interval_unit: 'month', anchor: 'day_of_month', anchor_day: 20, start_date: '2027-01-20',
  end_date: null, max_occurrences: null, notify_days_before: 1, active: true,
}];

let n = 0;
const txs = [];
const add = (kind, cat, amount, date, merchant, note = null) => txs.push({
  id: `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`, user_id: UID, tx_kind: kind, total: amount, tx_date: date, merchant_id: merchant ?? null,
  note, status: 'confirmed', accrual_mode: 'same', currency: 'EUR', amount_original: null, fx_rate: null, fx_status: 'none', recurrence_id: null,
  occurrence_date: null, installment_id: null, updated_at: ts, client_modified_at: ts, deleted_at: null,
  transaction_lines: [{ category_id: cat, amount, flag_override: null }], payments: [], accruals: [],
});
for (const m of ['2026-09', '2026-10', '2026-11']) {
  add('income', 'c-stip', 2400, `${m}-10`, null);
  add('expense', 'c-spesa', 120, `${m}-04`, 'me-coop');
  add('expense', 'c-spesa', 80, `${m}-12`, 'me-coop2');
  add('expense', 'c-boll', 95, `${m}-08`, 'me-enel');
  add('expense', 'c-benz', 70, `${m}-06`, 'me-eni');
  add('expense', 'c-bar', 40, `${m}-09`, 'me-bar');
  add('expense', 'c-cene', 60, `${m}-14`, null, 'Pizza');
  add('expense', 'c-mus', 10.99, `${m}-02`, null, 'Streaming');
}

const session = {
  access_token: 'x.y.z', token_type: 'bearer', expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000, refresh_token: 'r',
  user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'marco@example.test', app_metadata: {}, user_metadata: {}, created_at: ts },
};
const profile = { id: UID, display_name: 'Marco', role: 'admin', locale: 'it', theme: 'dark', base_currency: 'EUR', updated_at: ts };

const out = process.argv[2] ?? '/tmp/quadra-qa';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 763 }, deviceScaleFactor: 2, locale: 'it-IT', timezoneId: 'Europe/Rome', serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.clock.install({ time: new Date('2026-11-16T14:00:00+01:00') });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/status of 500/.test(m.text())) errors.push(m.text()); });

// server finto con memoria
const tables = { macros, categories, merchants };
const writes = []; // [tabella, riga] nell'ordine di arrivo
let failWrites = false;
let stamp = 0;
await page.route('http://localhost:54321/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/auth/v1/token')) return json(session);
  if (p.startsWith('/auth/v1/user')) return json(session.user);
  const name = p.replace('/rest/v1/', '');
  if (req.method() === 'POST' && tables[name]) {
    if (failWrites) return json({ message: 'server giù', code: 'XX000' }, 500);
    const body = JSON.parse(req.postData());
    for (const row of Array.isArray(body) ? body : [body]) {
      writes.push([name, row]);
      const list = tables[name];
      const i = list.findIndex((r) => r.id === row.id);
      const merged = { ...(i === -1 ? { user_id: UID } : list[i]), ...row, updated_at: `2026-11-16T13:00:${String(++stamp % 60).padStart(2, '0')}Z` };
      if (i === -1) list.push(merged); else list[i] = merged;
    }
    return json([], 201);
  }
  if (p === '/rest/v1/profiles') return json(profile);
  if (tables[name]) return json(tables[name]);
  if (p === '/rest/v1/recurrences') return json(recurrences);
  if (p === '/rest/v1/transactions') return json(txs);
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  return json([]);
});
await page.route('https://api.frankfurter.dev/**', (r) => r.abort());

const results = [];
const ok = (name, cond, detail = '') => { results.push(cond); console.log(cond ? 'OK ' : 'KO ', name, detail); };
const lastWrite = (table, id) => [...writes].reverse().find(([t, r]) => t === table && (!id || r.id === id))?.[1];
const settle = async () => { await page.clock.runFor(800); await page.waitForTimeout(250); };
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const macroRow = (name) => page.locator('.md-macro', { has: page.locator('.md-main .strong', { hasText: new RegExp(`^${name}$`) }) });
const save = async () => { await page.click('.topbar button:has-text("Salva")'); await page.waitForSelector('.toast'); await settle(); };

await page.goto('http://localhost:4173/');
await page.fill('input[type=email]', 'marco@example.test');
await page.fill('input[type=password]', 'x');
await page.click('button[type=submit]');
await page.waitForSelector('.donut');
await page.waitForFunction(() => document.querySelectorAll('.macro-row').length > 0);
await settle();
const discBefore = await page.locator('.tiles .tile').nth(1).locator('.num').first().innerText();

// ----- Impostazioni → Categorie
await page.click('button[aria-label="Impostazioni"]');
await page.click('button:has-text("Categorie e macro")');
await page.waitForSelector('.md-macro');
ok('elenco: 5 macro di uscita', (await page.locator('.md-macro').count()) === 5);
ok('macro con tipo di spesa calcolato', /Discrezionale/.test(await macroRow('Tempo libero').innerText()) && /Essenziale/.test(await macroRow('Casa').innerText()));
await macroRow('Tempo libero').locator('.md-main').first().click();
await page.screenshot({ path: `${out}/1-categorie.png` });
ok('macro aperta: 2 categorie e i due collegamenti', (await macroRow('Tempo libero').locator('.md-cats .md-row').count()) === 2 && (await page.locator('.md-links button').count()) === 2);
ok('elenco: nessuno scorrimento orizzontale', await noOverflow());

// nuova categoria con icona cercata in italiano e casella fissa
await page.click('button:has-text("Aggiungi categoria")');
await page.waitForSelector('.md-form');
ok('nuova categoria: tipo di spesa preso dalla macro', (await page.locator('.segmented button[aria-pressed=true]').innerText()) === 'Discrezionale');
ok('senza nome non si salva', await page.locator('.topbar button:has-text("Salva")').isDisabled());
await page.fill('.md-form .card input[type=text]', 'bar e  aperitivi');
ok('nome doppio bloccato', /Esiste già una categoria/.test(await page.locator('.error').innerText()) && await page.locator('.topbar button:has-text("Salva")').isDisabled());
await page.fill('.md-form .card input[type=text]', 'Gelati');
await page.fill('input[aria-label="Cerca icona"]', 'gelato');
ok('icona: «gelato» trova ice-cream', (await page.locator('.md-icon').first().getAttribute('title')) === 'ice-cream');
await page.locator('.md-icon').first().click();
await page.click('button[aria-label="Sfumatura 1"]');
await page.click('button[aria-label="Casella 1"]');
await page.screenshot({ path: `${out}/2-nuova-categoria.png`, fullPage: true });
ok('scheda: nessuno scorrimento orizzontale', await noOverflow());
await save();
const gelati = lastWrite('categories');
ok('categoria creata e inviata', gelati?.name === 'Gelati' && gelati.macro_id === 'm-svago' && gelati.icon === 'ice-cream' && gelati.flag === 'discretionary' && gelati.pinned_slot === 1 && /^#[0-9a-f]{6}$/.test(gelati.shade) && gelati.sort_order === 6, JSON.stringify(gelati));
ok("ritorno all'elenco con la macro ancora aperta e la casella indicata", /Gelati/.test(await macroRow('Tempo libero').innerText()) && (await page.locator('.md-pin').count()) === 1);

// casella già occupata: sostituzione
await page.locator('.md-cats .md-main', { hasText: 'Cene e pranzi fuori' }).click();
await page.click('button[aria-label="Casella 1"]');
ok('casella occupata: avviso con il nome', /«Gelati»/.test(await page.locator('.md-form [role=status]').innerText()));
await save();
ok('la nuova prende la casella, la vecchia la lascia', lastWrite('categories', 'c-cene')?.pinned_slot === 1 && lastWrite('categories', gelati.id)?.pinned_slot === null);

// griglia dell'inserimento: la categoria fissata è la prima
await page.goBack(); await page.goBack(); await settle();
await page.click('.add.expense');
await page.waitForSelector('.cat-grid .cat-btn');
ok('griglia: la categoria fissata in casella 1 è la prima', (await page.locator('.cat-grid .cat-btn .cat-name').first().innerText()) === 'Cene e pranzi fuori');
await page.screenshot({ path: `${out}/3-griglia.png` });
await page.goBack(); await settle();

// cambio di tipo di spesa e di macro
await page.click('button[aria-label="Impostazioni"]');
await page.click('button:has-text("Categorie e macro")');
await page.locator('.md-cats .md-main', { hasText: 'Bar e aperitivi' }).click();
await page.click('.segmented button:has-text("Essenziale")');
ok('cambio di tipo: avviso con i movimenti coinvolti', /^3 movimenti già registrati cambieranno/.test(await page.locator('.md-form [role=status]').first().innerText()));
await page.selectOption('.md-form select', 'm-casa');
ok('spostamento: avviso che i movimenti seguono', /3 movimenti seguiranno/.test(await page.locator('.md-form .card').first().innerText()));
await page.screenshot({ path: `${out}/4-modifica-categoria.png`, fullPage: true });
await save();
const bar = lastWrite('categories', 'c-bar');
ok('categoria spostata in fondo alla nuova macro', bar.macro_id === 'm-casa' && bar.flag === 'essential' && bar.sort_order === 3, `${bar.macro_id} ${bar.flag} ${bar.sort_order}`);
await page.goBack(); await page.goBack(); await settle();
const discAfter = await page.locator('.tiles .tile').nth(1).locator('.num').first().innerText();
ok('Home: le discrezionali del mese scendono di 40 €', discBefore.startsWith('110,99') && discAfter.startsWith('70,99'), `${discBefore} → ${discAfter}`);

// archiviare: bloccato con ricorrenza attiva, in due passi altrimenti
await page.click('button[aria-label="Impostazioni"]');
await page.click('button:has-text("Categorie e macro")');
await macroRow('Casa').locator('.md-main').first().click();
await page.locator('.md-cats .md-main', { hasText: 'Bollette' }).click();
await page.waitForSelector('.md-form >> text=/Usata da/');
ok('archiviazione bloccata dalla ricorrenza attiva', /Bolletta luce/.test(await page.locator('.md-form').innerText()) && (await page.locator('button:has-text("Archivia")').count()) === 0, (await page.locator('.md-form').innerText()).replace(/\s+/g, ' ').slice(-300));
ok('con movimenti non si elimina', (await page.locator('.md-form button.danger').count()) === 0);
await page.click('.topbar button:has-text("Annulla")'); await settle();
await macroRow('Passioni').locator('.md-main').first().click();
await page.locator('.md-cats .md-main', { hasText: 'Musica' }).click();
await page.click('button:has-text("Archivia")');
ok('archiviazione in due passi', (await page.locator('button:has-text("Conferma: archivia")').count()) === 1 && !writes.some(([, r]) => r.id === 'c-mus'));
await page.click('button:has-text("Conferma: archivia")');
await page.waitForSelector('.toast'); await settle();
ok('categoria archiviata e inviata', lastWrite('categories', 'c-mus')?.archived === true);
ok('compare tra le archiviate, non nella macro', /Musica/.test(await page.locator('.md-archived').innerText()) && !/Musica/.test(await macroRow('Passioni').innerText()));
await page.screenshot({ path: `${out}/5-archiviate.png`, fullPage: true });
// lo storico resta: i movimenti mostrano ancora il nome
await page.goBack(); await page.goBack(); await settle();
await page.click('nav .tab:has-text("Movimenti")');
await page.waitForSelector('.tx-row');
ok('storico coerente: il movimento della categoria archiviata si legge ancora', /Musica/.test(await page.locator('main').innerText()));
await page.click('.add.expense');
await page.waitForSelector('.cat-grid .cat-btn');
ok('la categoria archiviata non è più tra le scelte', !/Musica/.test(await page.locator('.cat-grid').innerText()));
await page.goBack(); await settle();
await page.click('nav .tab:has-text("Home")');

// ripristino
await page.click('button[aria-label="Impostazioni"]');
await page.click('button:has-text("Categorie e macro")');
await page.locator('.md-archived .md-main', { hasText: 'Musica' }).click();
await page.click('button:has-text("Ripristina")');
await page.waitForSelector('.toast'); await settle();
ok('categoria ripristinata', lastWrite('categories', 'c-mus')?.archived === false && (await page.locator('.md-archived').count()) === 0);

// eliminare una categoria senza storia
await page.locator('.md-cats .md-main', { hasText: 'Gelati' }).click();
await page.click('.md-form button.danger');
await page.click('button:has-text("Conferma: elimina")');
await page.waitForSelector('.toast'); await settle();
ok('categoria senza movimenti eliminata', !!lastWrite('categories', gelati.id)?.deleted_at && !/Gelati/.test(await page.locator('main').innerText()));

// riordino con le frecce
await page.click('button:has-text("Riordina")');
await page.click('button[aria-label="Sposta su Tempo libero"]');
await settle();
const order = await page.locator('.md-macro > .md-row .strong').allInnerTexts();
ok('riordino delle macro', order.join(',') === 'Casa,Tempo libero,Spesa,Passioni,Mobilità', order.join(','));
ok('ordine inviato', lastWrite('macros', 'm-svago')?.sort_order === 2 && lastWrite('macros', 'm-cibo')?.sort_order === 3);
ok('prima e ultima freccia disattivate', await page.locator('button[aria-label="Sposta su Casa"]').isDisabled() && await page.locator('button[aria-label="Sposta giù Mobilità"]').isDisabled());
await page.click('button[aria-label="Sposta giù Bollette"]');
await settle();
ok('riordino delle categorie', lastWrite('categories', 'c-boll')?.sort_order === 2 && lastWrite('categories', 'c-cond')?.sort_order === 1);
await page.screenshot({ path: `${out}/6-riordina.png` });
await page.click('button:has-text("Fine")');

// nuova macro, poi archiviazione di una macro con le sue categorie
await page.click('button[aria-label="Nuova macro"]');
await page.fill('.md-form .card input[type=text]', 'Casa');
ok('macro: nome doppio bloccato', /Esiste già una macro/.test(await page.locator('.error').innerText()));
await page.fill('.md-form .card input[type=text]', 'Vacanze');
await page.fill('input[aria-label="Cerca icona"]', 'valigia');
await page.locator('.md-icon').first().click();
ok('macro: 12 colori', (await page.locator('.md-color').count()) === 12);
await page.screenshot({ path: `${out}/7-nuova-macro.png`, fullPage: true });
await save();
const vac = lastWrite('macros');
ok('macro creata: in fondo, di uscita, con un colore libero', vac?.name === 'Vacanze' && vac.tx_kind === 'expense' && vac.sort_order === 11 && vac.icon === 'suitcase' && !macros.slice(0, 6).some((m) => m.color === vac.color), JSON.stringify(vac));
await macroRow('Passioni').locator('.md-main').first().click(); // era aperta: si chiude
await macroRow('Passioni').locator('.md-main').first().click();
await page.click('.md-macro:has-text("Fotografia") button:has-text("Modifica macro")');
await page.click('button:has-text("Archivia")');
ok('macro: conferma con il numero di categorie', (await page.locator('button:has-text("Conferma: archivia con 3 categorie")').count()) === 1);
await page.click('button:has-text("Conferma: archivia")');
await page.waitForSelector('.toast'); await settle();
ok('macro archiviata: le categorie non si riscrivono', lastWrite('macros', 'm-pass')?.archived === true && lastWrite('categories', 'c-foto') === undefined);
ok('macro tra le archiviate con le sue 3 categorie', /Passioni/.test(await page.locator('.md-archived').innerText()) && /3 categorie/.test(await page.locator('.md-archived').innerText()));
await page.locator('.md-archived .md-main', { hasText: 'Passioni' }).click();
await page.click('button:has-text("Ripristina")');
await page.waitForSelector('.toast'); await settle();
ok('macro ripristinata con tutte le categorie', (await macroRow('Passioni').count()) === 1 && /3 categorie/.test(await macroRow('Passioni').innerText()));

// entrate: una sola macro, non archiviabile
await page.click('.segmented button:has-text("Entrate")');
await macroRow('Entrate').locator('.md-main').first().click();
await page.click('button:has-text("Modifica macro")');
await page.waitForSelector('.md-form >> text=/categori[ae]$/');
ok("l'unica macro di entrata non si archivia", /unica macro attiva/.test(await page.locator('.md-form').innerText()) && (await page.locator('button:has-text("Archivia")').count()) === 0, (await page.locator('.md-form').innerText()).replace(/\s+/g, ' ').slice(-300));
await page.click('.topbar button:has-text("Annulla")'); await settle();
await page.click('.segmented button:has-text("Uscite")');

// modifica non inviata: lo scarico non la cancella
failWrites = true;
await macroRow('Casa').locator('.md-main').first().click().catch(() => {});
if ((await macroRow('Casa').locator('.md-cats').count()) === 0) await macroRow('Casa').locator('.md-main').first().click();
await page.locator('.md-cats .md-main', { hasText: 'Condominio' }).click();
await page.fill('.md-form .card input[type=text]', 'Spese condominiali');
await save();
await page.evaluate(() => window.dispatchEvent(new Event('online'))); // un altro giro di sincronizzazione, con il server che rifiuta
await settle(); await settle();
ok('invio fallito: la modifica locale resta dopo lo scarico', /Spese condominiali/.test(await macroRow('Casa').innerText()) && categories.find((c) => c.id === 'c-cond').name === 'Condominio');
failWrites = false;
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await settle(); await settle();
ok('al giro dopo la modifica arriva al server', categories.find((c) => c.id === 'c-cond').name === 'Spese condominiali');

// ----- Esercizi
await page.goBack(); await settle();
ok('Impostazioni: conteggi aggiornati', /7 macro · 10 categorie · 6 esercizi/.test(await page.locator('main').innerText()), (await page.locator('.card', { hasText: 'Anagrafiche' }).innerText()).replace(/\s+/g, ' '));
await page.click('button:has-text("Esercizi")');
await page.waitForSelector('.md-list .md-main');
ok('esercizi: 6 in ordine alfabetico', (await page.locator('.md-list .md-main').count()) === 6 && (await page.locator('.md-list .md-main .md-text > span:first-child').first().innerText()) === 'Bar Centrale');
await page.locator('.md-list .md-main', { hasText: 'COOP Via Roma' }).click();
await page.fill('.md-sheet input[type=text]', 'coop');
ok('rinomina su un nome esistente: proposta di fusione', /Esiste già «Coop»/.test(await page.locator('.md-sheet').innerText()));
await page.screenshot({ path: `${out}/8-esercizio-fusione.png` });
await page.click('button:has-text("Unisci a «Coop»")');
await page.waitForSelector('.toast'); await settle();
ok('fusione inviata: il doppione rimanda al principale', lastWrite('merchants', 'me-coop2')?.merged_into_id === 'me-coop' && lastWrite('merchants', 'me-coop2')?.name === 'COOP Via Roma');
const coopRow = await page.locator('.md-list .md-main', { hasText: 'Coop' }).innerText();
ok('elenco: un solo Coop con 6 movimenti e il doppione', (await page.locator('.md-list .md-main').count()) === 5 && /6 movimenti/.test(coopRow) && /anche: COOP Via Roma/.test(coopRow), coopRow.replace(/\s+/g, ' '));
await page.screenshot({ path: `${out}/9-esercizi.png` });
// ovunque compare il nome principale
await page.goBack(); await page.goBack(); await settle();
await page.click('nav .tab:has-text("Movimenti")');
await page.waitForSelector('.tx-row');
ok('Movimenti: il doppione mostra il nome principale', !/COOP Via Roma/.test(await page.locator('main').innerText()) && (await page.locator('.tx-row', { hasText: 'Coop' }).count()) === 2);
await page.click('nav .tab:has-text("Home")');
await page.click('button[aria-label="Impostazioni"]');
await page.click('button:has-text("Esercizi")');
// rinomina semplice
await page.locator('.md-list .md-main', { hasText: 'Eni' }).click();
await page.fill('.md-sheet input[type=text]', 'Eni Station');
await page.click('.md-sheet button:has-text("Rinomina")');
await page.waitForSelector('.toast'); await settle();
ok('rinomina inviata', lastWrite('merchants', 'me-eni')?.name === 'Eni Station');
// eliminazione di un esercizio mai usato, in due passi
await page.locator('.md-list .md-main', { hasText: 'Negozio mai usato' }).click();
await page.click('.md-sheet button.danger');
await page.click('.md-sheet button:has-text("Conferma: elimina")');
await page.waitForSelector('.toast'); await settle();
ok('esercizio senza movimenti eliminato', !!lastWrite('merchants', 'me-vuoto')?.deleted_at && (await page.locator('.md-list .md-main').count()) === 4);
// un esercizio con movimenti non si elimina; separa annulla la fusione
await page.locator('.md-list .md-main', { hasText: 'Coop' }).click();
ok('con movimenti o doppioni non si elimina', (await page.locator('.md-sheet button.danger').count()) === 0);
await page.click('.md-sheet button:has-text("Separa")');
await page.waitForSelector('.toast'); await settle();
ok('separazione: il doppione torna autonomo', lastWrite('merchants', 'me-coop2')?.merged_into_id === null);
await page.click('.md-sheet button[aria-label="Chiudi"]');
ok('dopo la separazione di nuovo due esercizi', (await page.locator('.md-list .md-main').count()) === 5);

// ----- Importazione: crea categoria
await page.goBack(); await settle();
await page.click('button:has-text("Importa")');
const csv = `${out}/prova.csv`;
fs.writeFileSync(csv, 'Data;Importo;Segno;Categoria;Esercizio;Note\r\n03/11/2026;35,00;U;Giardinaggio;Vivaio Verde;Terriccio\r\n05/11/2026;12,50;U;Giardinaggio;Vivaio Verde;\r\n', 'utf8');
await page.setInputFiles('input[type=file]', csv);
await settle();
ok('import: categoria sconosciuta da assegnare', /2 da assegnare|Categorie da assegnare/.test(await page.locator('main').innerText()));
await page.screenshot({ path: `${out}/10a-import-gruppo.png` });
ok('import: nessuno scorrimento orizzontale', await noOverflow());
await page.click('.imp-group button:has-text("Crea")');
ok('import: nome già compilato', (await page.locator('.md-sheet input[type=text]').inputValue()) === 'Giardinaggio');
await page.selectOption('.md-sheet select', 'm-casa');
await page.screenshot({ path: `${out}/10-import-crea.png` });
await page.click('button:has-text("Crea e assegna")');
await settle();
const giard = lastWrite('categories');
ok('import: categoria creata nella macro scelta', giard?.name === 'Giardinaggio' && giard.macro_id === 'm-casa' && giard.icon === 'house' && giard.flag === 'essential');
const impText = await page.locator('main').innerText();
ok('import: le righe diventano importabili', /Importa 2 movimenti/.test(impText) && !/Categorie da assegnare/.test(impText), impText.replace(/\s+/g, ' ').slice(0, 200));
await page.screenshot({ path: `${out}/11-import-dopo.png`, fullPage: true });

// ordine di invio: una macro nuova con la sua prima categoria, creata senza rete
const before = writes.length;
failWrites = true;
await page.goBack(); await settle();
await page.click('button:has-text("Categorie e macro")');
await page.click('button[aria-label="Nuova macro"]');
await page.fill('.md-form .card input[type=text]', 'Giardino');
await save();
await macroRow('Giardino').locator('.md-main').first().click();
await macroRow('Giardino').locator('button:has-text("Aggiungi categoria")').click();
await page.fill('.md-form .card input[type=text]', 'Piante');
await save();
failWrites = false;
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await settle(); await settle();
const sent = writes.slice(before).map(([t, r]) => `${t}:${r.name}`);
ok('la macro parte prima della sua categoria', sent.indexOf('macros:Giardino') !== -1 && sent.indexOf('macros:Giardino') < sent.indexOf('categories:Piante'), sent.join(' '));
const left = await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  const name = dbs.find((d) => d.name?.startsWith('quadra-'))?.name;
  return new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => { const q = r.result.transaction('outbox').objectStore('outbox').getAll(); q.onsuccess = () => res(q.result); }; });
});
ok('coda di invio vuota alla fine', left.length === 0, JSON.stringify(left));

ok('nessun errore in console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`fine: ${results.filter(Boolean).length}/${results.length}`);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(results.every(Boolean) ? 0 : 1);
