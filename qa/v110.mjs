// Collaudo v1.1: Budget (storico di riferimento, costruzione, schede, tetto dedicato,
// profilo mensile, approvazione, lettura) su un server Supabase simulato con memoria.
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
  ['c-usato', 'm-ent', 'Vendite usato', 'tag', 'essential'],
].map(([id, macro_id, name, icon, flag], i) => ({ ...base, id, macro_id, name, icon, shade: null, flag, pinned_slot: null, sort_order: i + 1, archived: false }));
const recurrences = [
  { ...base, id: 'r-enel', name: 'Bolletta luce', kind: 'variable', tx_kind: 'expense', category_id: 'c-boll', merchant_id: null, note: null,
    reference_amount: 90, currency: 'EUR', interval_n: 2, interval_unit: 'month', anchor: 'day_of_month', anchor_day: 20, start_date: '2027-01-20',
    end_date: null, max_occurrences: null, notify_days_before: 1, active: true },
  { ...base, id: 'r-netflix', name: 'Netflix', kind: 'fixed', tx_kind: 'expense', category_id: 'c-mus', merchant_id: null, note: null,
    reference_amount: 18, currency: 'EUR', interval_n: 1, interval_unit: 'month', anchor: 'day_of_month', anchor_day: 5, start_date: '2027-01-05',
    end_date: null, max_occurrences: null, notify_days_before: 1, active: true },
];

const session = {
  access_token: 'x.y.z', token_type: 'bearer', expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000, refresh_token: 'r',
  user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'marco@example.test', app_metadata: {}, user_metadata: {}, created_at: ts },
};
const profile = { id: UID, display_name: 'Marco', role: 'admin', locale: 'it', theme: 'dark', base_currency: 'EUR', updated_at: ts };

const out = process.argv[2] ?? '/tmp/quadra-qa';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 763 }, deviceScaleFactor: 2, locale: 'it-IT', timezoneId: 'Europe/Rome', serviceWorkers: 'block', acceptDownloads: true });
const page = await ctx.newPage();
await page.clock.install({ time: new Date('2026-11-16T14:00:00+01:00') });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// server finto con memoria
const tables = { macros, categories, merchants: [], recurrences, budgets: [], budget_lines: [], reference_balances: [] };
const writes = [];
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
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  const name = p.replace('/rest/v1/', '');
  if (req.method() === 'POST' && tables[name]) {
    const body = JSON.parse(req.postData());
    for (const row of Array.isArray(body) ? body : [body]) {
      writes.push([name, row]);
      const list = tables[name];
      const i = list.findIndex((r) => r.id === row.id);
      const merged = { ...(i === -1 ? { user_id: UID } : list[i]), ...row, updated_at: `2026-11-16T13:${String(Math.floor(++stamp / 60) % 60).padStart(2, '0')}:${String(stamp % 60).padStart(2, '0')}Z` };
      if (name === 'budget_lines') merged.amount_original = Number(merged.programmed_original) + Number(merged.integration_original);
      if (i === -1) list.push(merged); else list[i] = merged;
    }
    return json([], 201);
  }
  if (p === '/rest/v1/profiles') return json(profile);
  if (tables[name]) return json(tables[name]);
  return json([]);
});
await page.route('https://api.frankfurter.dev/**', (r) => r.abort());

const results = [];
const ok = (name, cond, detail = '') => { results.push(cond); console.log(cond ? 'OK ' : 'KO ', name, detail); };
const settle = async () => { await page.clock.runFor(800); await page.waitForTimeout(300); };
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const lineOf = (label) => page.locator('.bu-line', { has: page.locator('.bu-line-name', { hasText: label }) });
const serverLine = (pred) => tables.budget_lines.find((l) => !l.deleted_at && pred(l));

await page.goto('http://localhost:4173/');
await page.fill('input[type=email]', 'marco@example.test');
await page.fill('input[type=password]', 'x');
await page.click('button[type=submit]');
await page.waitForSelector('.donut');
await settle();

// ----- tab Budget: nessun budget, anno proposto 2027 ------------------------
await page.click('nav button:has-text("Budget")');
await page.waitForSelector('text=Nessun budget per il 2027');
ok('tab Budget: a novembre propone il 2027, vuoto', true);
ok('passi: 2 ricorrenze con scadenze nel 2027', /2 ricorrenze con scadenze/.test(await page.locator('.bu-steps').innerText()));
await page.screenshot({ path: `${out}/u1-vuoto.png`, fullPage: true });

// ----- storico di riferimento 2026 -------------------------------------------
await page.click('button:has-text("Storico di riferimento 2026")');
await page.waitForSelector('h1:has-text("Storico di riferimento")');
async function addRef(target, amount, { month = '', extra = false, note = '' } = {}) {
  await page.click('button[aria-label="Nuovo saldo"]');
  const f = page.locator('.bu-refform');
  await f.locator('select').first().selectOption(target);
  if (month) await f.locator('select').nth(1).selectOption(month);
  await f.locator('input[inputmode=decimal]').fill(amount);
  if (note) await f.locator('input:not([inputmode]):not([type=checkbox])').fill(note);
  if (extra) await f.locator('input[type=checkbox]').check();
  await f.locator('button:has-text("Salva")').click();
  await settle();
}
await addRef('c:c-boll', '2.300,00', { note: 'Monefy: Bills, Bollette' });
await addRef('c:c-spesa', '4361,53');
await addRef('c:c-benz', '1180,40');
await addRef('c:c-foto', '1105,90');
await addRef('c:c-tech', '300');
await addRef('c:c-bar', '500');
await addRef('c:c-cene', '1200');
await addRef('c:c-cene', '300', { month: '8' });
await addRef('c:c-cond', '2920', { extra: true, note: 'Tribunale' });
// doppione: lo stesso saldo non si può scrivere due volte
await page.click('button[aria-label="Nuovo saldo"]');
await page.locator('.bu-refform select').first().selectOption('c:c-boll');
await page.locator('.bu-refform input[inputmode=decimal]').fill('10');
ok('doppione segnalato e Salva spento', (await page.locator('.bu-refform .error').innerText()).includes('Esiste già') && await page.locator('.bu-refform button:has-text("Salva")').isDisabled());
await page.locator('.bu-refform button:has-text("Annulla")').click();
const tot = await page.locator('.card', { hasText: 'Totale uscite 2026' }).innerText();
ok('totale di controllo uscite 2026 (annuali + straordinaria, il mese di agosto non si somma)', /13\.867,83/.test(tot) && /2\.920,00/.test(tot), tot.replace(/\n/g, ' | '));
ok('saldi arrivati al server (9)', tables.reference_balances.length === 9, String(tables.reference_balances.length));
await page.locator('.segmented button:has-text("Entrate")').click();
await addRef('c:c-stip', '33920');
ok('entrate: stipendio 2026', (await page.locator('.bu-ref').count()) === 1);
await page.screenshot({ path: `${out}/u2-storico.png`, fullPage: true });
ok('storico: nessuno scorrimento orizzontale', await noOverflow());
await page.click('.topbar button:has-text("Indietro")');

// ----- costruzione ------------------------------------------------------------
await page.click('button:has-text("Costruisci budget 2027")');
await page.waitForSelector('.badge:has-text("Bozza")');
await settle();
await page.screenshot({ path: `${out}/u3-costruzione.png`, fullPage: true });
const b = tables.budgets[0];
ok('testata al server: 2027, bozza, riserva 1.460 (50% di 2.920)', b && b.year === 2027 && b.status === 'draft' && Number(b.reserve_original) === 1460, JSON.stringify(b && { y: b.year, s: b.status, r: b.reserve_original }));
const boll = serverLine((l) => l.category_id === 'c-boll');
ok('Bollette: storico 2.300, programmato 540 (6 × 90), integrazione 1.760', boll && Number(boll.history_base) === 2300 && Number(boll.programmed_original) === 540 && Number(boll.integration_original) === 1760,
  JSON.stringify(boll && [boll.history_base, boll.programmed_original, boll.integration_original]));
const cond = serverLine((l) => l.category_id === 'c-cond');
ok('Condominio: la straordinaria non fa storico, fonte a mano', cond && cond.source === 'manual' && cond.history_base === null);
const pass = serverLine((l) => l.macro_id === 'm-pass');
ok('Passioni tetto comune: storico 1.405,90, programmato Netflix 216', pass && Number(pass.history_base) === 1405.9 && Number(pass.programmed_original) === 216 && Number(pass.integration_original) === 1189.9,
  JSON.stringify(pass && [pass.history_base, pass.programmed_original, pass.integration_original]));
ok('entrate: solo Stipendio (Vendite usato senza storico resta fuori)', tables.budget_lines.filter((l) => ['c-stip', 'c-usato'].includes(l.category_id)).map((l) => l.category_id).join() === 'c-stip');
ok('amount_original non viene inviato (lo calcola il database)', writes.filter(([t]) => t === 'budget_lines').every(([, r]) => !('amount_original' in r)));
ok('7 voci da rivedere', /7 voci da rivedere/.test(await page.locator('main').innerText()));
ok('costruzione: nessuno scorrimento orizzontale', await noOverflow());

// ----- Condominio: importo noto -------------------------------------------------
await lineOf('Condominio').click();
await page.waitForSelector('h2:has-text("Programmato")');
await page.click('.segmented button:has-text("Importo noto")');
await page.locator('label:has-text("Importo (da un documento)") input').fill('2400');
await page.locator('label:has-text("Nota") input').fill('Preventivo 2027');
await page.click('.topbar button:has-text("Conferma")');
await page.waitForSelector('.toast');
await settle();
const cond2 = serverLine((l) => l.category_id === 'c-cond');
ok('Condominio confermato: importo noto 2.400, nota, rivista', cond2.source === 'known' && Number(cond2.integration_original) === 2400 && cond2.note === 'Preventivo 2027' && cond2.reviewed === true);

// ----- Passioni: Fotografia diventa tetto dedicato ----------------------------
await lineOf('Tetto comune').nth(1).click();
await page.waitForSelector('h2:has-text("Categorie del tetto")');
await page.screenshot({ path: `${out}/u4-tetto-passioni.png`, fullPage: true });
await page.locator('.row', { hasText: 'Fotografia' }).locator('input[type=checkbox]').click();
await settle();
await page.click('.topbar button:has-text("Indietro")');
await settle();
const foto = serverLine((l) => l.category_id === 'c-foto');
const pass2 = serverLine((l) => l.macro_id === 'm-pass');
ok('Fotografia: riga dedicata creata', !!foto);
ok('tetto comune Passioni ricalcolato senza Fotografia (storico 300)', Number(pass2.history_base) === 300 && Number(pass2.integration_original) === 84,
  JSON.stringify([pass2.history_base, pass2.programmed_original, pass2.integration_original]));
await page.waitForTimeout(300);
const fotoProp = serverLine((l) => l.category_id === 'c-foto');
ok('Fotografia dedicata: proposta dallo storico 1.105,90 (bozza viva)', fotoProp.source === 'history' && Number(fotoProp.integration_original) === 1105.9, JSON.stringify([fotoProp.source, fotoProp.integration_original]));

// ----- Tempo libero: curva trimestrale ------------------------------------
await lineOf('Tetto comune').first().click();
await page.waitForSelector('h2:has-text("Ripartizione sui mesi")');
await page.click('.segmented button:has-text("Trimestrale")');
const qs = page.locator('.bu-quarters input');
for (const [i, v] of ['20', '25', '35', '20'].entries()) await qs.nth(i).fill(v);
await page.locator('label:has-text("Ritocco") input').fill('-5');
const bars = await page.locator('.bu-profile .num').allInnerTexts();
ok('anteprima: 108 al mese in T1 (20% di 1.615 / 3), 188 in T3', bars[0] === '108' && bars[6] === '188', bars.join(' '));
await page.screenshot({ path: `${out}/u5-tetto-trimestrale.png`, fullPage: true });
ok('scheda tetto: nessuno scorrimento orizzontale', await noOverflow());
await page.click('.topbar button:has-text("Conferma")');
await page.waitForSelector('.toast');
await settle();
const svago = serverLine((l) => l.macro_id === 'm-svago');
ok('Tempo libero: trimestrale [20,25,35,20], ritocco −5%, integrazione 1.615', svago.distribution === 'quarterly' && svago.distribution_values.join() === '20,25,35,20' && Number(svago.adjust_pct) === -5 && Number(svago.integration_original) === 1615,
  JSON.stringify([svago.distribution, svago.distribution_values, svago.adjust_pct, svago.integration_original]));

// ----- Fotografia: curva manuale in euro --------------------------------------
await lineOf('Fotografia').click();
await page.waitForSelector('h2:has-text("Ripartizione sui mesi")');
await page.click('.segmented button:has-text("Manuale")');
const ms = page.locator('.bu-manual input');
for (let i = 0; i < 12; i++) await ms.nth(i).fill(i === 2 ? '400' : i === 9 ? '600' : '0');
ok('manuale: l\'integrazione diventa la somma dei mesi (1.000)', /1\.000/.test(await page.locator('.card', { hasText: 'Tetto' }).filter({ hasText: 'integrazione' }).first().innerText()));
await page.screenshot({ path: `${out}/u5b-foto-manuale.png`, fullPage: true });
await page.click('.topbar button:has-text("Conferma")');
await page.waitForSelector('.toast');
await settle();
const foto2 = serverLine((l) => l.category_id === 'c-foto');
ok('Fotografia: manuale, 12 importi, integrazione 1.000, fonte a mano', foto2.distribution === 'manual' && foto2.distribution_values.length === 12 && Number(foto2.distribution_values[2]) === 400 && Number(foto2.integration_original) === 1000 && foto2.source === 'manual',
  JSON.stringify([foto2.distribution, foto2.distribution_values, foto2.integration_original, foto2.source]));

// ----- approvazione ------------------------------------------------------------
await page.click('button:has-text("Approva budget")');
ok('primo tocco: chiede conferma con le voci da rivedere', /voci ancora da rivedere/.test(await page.locator('button.primary').innerText()));
await page.click('button.primary');
await settle();
await page.waitForSelector('text=Approvato il');
ok('testata approvata al server', tables.budgets[0].status === 'approved' && !!tables.budgets[0].approved_at);
await page.screenshot({ path: `${out}/u6-lettura.png`, fullPage: true });
const lettura = await page.locator('main').innerText();
ok('lettura: risultato atteso e a oggi', /Risultato atteso/.test(lettura) && /Risultato a oggi/.test(lettura));
ok('lettura: Passioni con i tetti', /Passioni/.test(lettura) && (await page.locator('.bu-read').count()) >= 4);
ok('lettura: nessuno scorrimento orizzontale', await noOverflow());

await page.locator('.bu-read', { hasText: 'Passioni' }).click();
await page.waitForSelector('h3:has-text("Tetti")');
await page.screenshot({ path: `${out}/u7-dettaglio-passioni.png`, fullPage: true });
const det = await page.locator('main').innerText();
ok('dettaglio Passioni: tetto dedicato Fotografia e tetto comune (YTD nascosto prima dell\'inizio dell\'anno)', /Fotografia/.test(det) && /Tetto comune/.test(det) && !/YTD/.test(det));
ok('dettaglio: striscia dei 12 mesi per ogni tetto', (await page.locator('.bu-strip').count()) === 2 && /Ripartizione manuale/.test(det));
await page.click('.topbar button:has-text("Indietro")');

// vista Mese: tetti del mese, senza riporti
await page.click('.segmented button:has-text("Mese")');
await page.waitForSelector('h1.bu-mlabel');
await page.click('button[aria-label="Mese successivo"]');
await page.click('button[aria-label="Mese successivo"]');
const marzo = await page.locator('main').innerText();
ok('vista Mese: marzo 2027, Fotografia con tetto 400 (curva manuale)', /marzo 2027/i.test(marzo) && /tetto 400\s€/.test(marzo), marzo.slice(0, 200).replace(/\n/g, ' | '));
await page.screenshot({ path: `${out}/u6b-mese.png`, fullPage: true });
ok('vista Mese: nessuno scorrimento orizzontale', await noOverflow());
await page.click('.segmented button:has-text("Anno")');

// riaprire con due tocchi
await page.click('button:has-text("Riapri il budget")');
await page.click('button:has-text("Tocca di nuovo per riaprire")');
await settle();
ok('riaperto: torna in bozza', tables.budgets[0].status === 'draft' && tables.budgets[0].approved_at === null);

// ----- backup con il budget ----------------------------------------------------
await page.click('nav button:has-text("Home")');
await page.click('button[aria-label="Impostazioni"]');
const card = page.locator('.card', { has: page.locator('h2', { hasText: 'Backup e ripristino' }) });
await card.scrollIntoViewIfNeeded();
const [dl] = await Promise.all([page.waitForEvent('download'), card.locator('button:has-text("Scarica il backup")').click()]);
await dl.saveAs(`${out}/backup.json`);
const data = JSON.parse(fs.readFileSync(`${out}/backup.json`, 'utf8'));
ok('backup: budget, righe e storico', data.budgets.length === 1 && data.budgetLines.length >= 8 && data.refBalances.length === 10,
  `${data.budgets.length}/${data.budgetLines.length}/${data.refBalances.length}`);

ok('nessun errore nella console', errors.length === 0, errors.slice(0, 3).join(' | '));
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} controlli superati`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
