// Collaudo v0.9.1: backup e ripristino su un server Supabase simulato dalle rotte del browser.
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

// i POST su movimenti passano da rpc: li registriamo a parte
await page.route('http://localhost:54321/rest/v1/rpc/**', async (route) => {
  const req = route.request();
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers, body: '{}' });
  rpcs.push([new URL(req.url()).pathname.split('/').pop(), JSON.parse(req.postData() ?? 'null')]);
  return route.fulfill({ status: 200, contentType: 'application/json', headers, body: 'null' });
});
const rpcs = [];

await page.goto('http://localhost:4173/');
await page.fill('input[type=email]', 'marco@example.test');
await page.fill('input[type=password]', 'x');
await page.click('button[type=submit]');
await page.waitForSelector('.donut');
await page.waitForFunction(() => document.querySelectorAll('.macro-row').length > 0);
await settle();

await page.click('button[aria-label="Impostazioni"]');
const card = page.locator('.card', { has: page.locator('h2', { hasText: 'Backup e ripristino' }) });
await card.scrollIntoViewIfNeeded();
ok('card Backup presente, con avviso «nessun backup»', /Nessun backup/.test(await card.innerText()));
await page.screenshot({ path: `${out}/b1-card.png`, fullPage: true });

// scarico del backup
const [dl] = await Promise.all([page.waitForEvent('download'), card.locator('button:has-text("Scarica il backup")').click()]);
const file = `${out}/backup.json`;
await dl.saveAs(file);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
ok('nome file quadra-backup-AAAA-MM-GG.json', /^quadra-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
ok('file: tutte le tabelle', data.app === 'quadra' && data.userId === UID && data.macros.length === 6 && data.categories.length === 10 && data.merchants.length === 6 && data.transactions.length === txs.length && data.recurrences.length === 1,
  `m${data.macros.length} c${data.categories.length} e${data.merchants.length} t${data.transactions.length}`);
ok('file: i movimenti hanno le righe', data.transactions.every((x) => x.lines.length === 1));
await settle();
ok('card: ultimo backup di oggi', /Ultimo backup/.test(await card.innerText()) && /Backup scaricato: \d+ movimenti/.test(await card.innerText()));

// ripristino dello stesso file: niente da fare
const picker = card.locator('input[type=file]');
await picker.setInputFiles(file);
await page.waitForSelector('text=niente da ripristinare');
ok('stesso file: «niente da ripristinare» e nessun pulsante Ripristina', (await card.locator('button:has-text("Ripristina")').count()) === 0);
await card.locator('button:has-text("Annulla")').click();

// file sbagliati
fs.writeFileSync(`${out}/no.json`, '{"ciao":1}');
await picker.setInputFiles(`${out}/no.json`);
await page.waitForSelector('text=non è un backup di Quadra');
ok('file estraneo rifiutato', true);
fs.writeFileSync(`${out}/altro.json`, JSON.stringify({ ...data, userId: 'altro' }));
await picker.setInputFiles(`${out}/altro.json`);
await page.waitForSelector('text=appartiene a un altro utente');
ok('file di un altro utente rifiutato', true);

// danni sul dispositivo: elimino un movimento e rinomino una categoria dall'app
await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  const name = dbs.find((d) => d.name?.startsWith('quadra-')).name;
  await new Promise((res, rej) => {
    const open = indexedDB.open(name);
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const t = db.transaction(['transactions', 'categories'], 'readwrite');
      const txs = t.objectStore('transactions');
      txs.getAll().onsuccess = (e) => {
        const first = e.target.result[0];
        txs.put({ ...first, deleted_at: '2026-11-16T12:00:00Z' });
        window.__lostTx = first.id;
      };
      const cats = t.objectStore('categories');
      cats.get('c-cene').onsuccess = (e) => cats.put({ ...e.target.result, name: 'Cenette rovinate' });
      t.oncomplete = () => { db.close(); res(); };
    };
  });
});
// (niente ricarica: il server finto ignora il cursore e riscriverebbe tutto)
await card.scrollIntoViewIfNeeded();
await picker.setInputFiles(file);
await page.waitForSelector('text=Cosa cambierebbe');
await page.screenshot({ path: `${out}/b2-anteprima.png`, fullPage: true });
const prev = await card.innerText();
ok('anteprima: 1 movimento e 1 categoria da riportare', /Movimenti: 0 nuovi, 1 da riportare/.test(prev) && /Categorie e macro: 0 nuovi, 1 da riportare/.test(prev), prev.replace(/\n/g, ' | '));
ok('anteprima: nessuno scorrimento orizzontale', await noOverflow());

// due tocchi per confermare
rpcs.length = 0;
writes.length = 0;
await card.locator('button:has-text("Ripristina")').first().click();
ok('primo tocco: chiede conferma', (await card.locator('button:has-text("Tocca ancora")').count()) === 1 && rpcs.length === 0);
await card.locator('button:has-text("Tocca ancora")').click();
await page.waitForSelector('text=Ripristinate 2 righe');
await settle();
ok('categoria tornata «Cene e pranzi fuori» e inviata al server', lastWrite('categories', 'c-cene')?.name === 'Cene e pranzi fuori', JSON.stringify(lastWrite('categories', 'c-cene')));
const saved = rpcs.filter(([f]) => f === 'save_transaction');
ok('movimento tornato in vita e inviato con le sue righe', saved.length === 1 && saved[0][1].p.id === (await page.evaluate(() => window.__lostTx)) && saved[0][1].p.lines.length === 1, JSON.stringify(saved[0]?.[1]).slice(0, 160));
ok('nessun errore di invio', (await page.locator('.error').count()) === 0);

// di nuovo: ora tutto uguale
await picker.setInputFiles(file);
await page.waitForSelector('text=niente da ripristinare');
ok('dopo il ripristino il file coincide con il dispositivo', true);

ok('nessun errore in console', errors.length === 0, errors.join(' | '));
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} controlli superati`);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(bad ? 1 : 0);
