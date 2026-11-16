// Collaudo v0.8.0: Statistiche ed esportazione CSV su un server Supabase simulato dalle rotte del browser.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');

const UID = '00000000-0000-4000-8000-000000000001';
const ts = '2026-11-01T10:00:00Z';
const base = { user_id: UID, updated_at: ts, client_modified_at: ts, deleted_at: null };
const macros = [
  ['m-casa', 'Casa', 'house', '#5B9BE6'], ['m-cibo', 'Alimentari', 'shopping-cart', '#4CC38A'], ['m-svago', 'Svago', 'martini', '#E6A15B'],
  ['m-pass', 'Passioni', 'camera', '#B58BE6'], ['m-tras', 'Trasporti', 'car', '#E66767'],
].map(([id, name, icon, color], i) => ({ ...base, id, tx_kind: 'expense', name, icon, color, sort_order: i, archived: false }));
macros.push({ ...base, id: 'm-ent', tx_kind: 'income', name: 'Entrate', icon: 'coins', color: '#4CC38A', sort_order: 9, archived: false });
const categories = [
  ['c-boll', 'm-casa', 'Bollette', 'lightning', 'essential'], ['c-ass', 'm-casa', 'Assicurazioni', 'shield-check', 'essential'],
  ['c-spesa', 'm-cibo', 'Spesa alimentare', 'shopping-cart', 'essential'], ['c-bar', 'm-svago', 'Bar e aperitivi', 'martini', 'discretionary'],
  ['c-cene', 'm-svago', 'Cene e pranzi fuori', 'fork-knife', 'discretionary'], ['c-foto', 'm-pass', 'Fotografia', 'camera', 'discretionary'],
  ['c-tech', 'm-pass', 'Tech', 'laptop', 'discretionary'], ['c-mus', 'm-pass', 'Musica', 'music-notes', 'discretionary'],
  ['c-benz', 'm-tras', 'Benzina', 'gas-pump', 'essential'], ['c-stip', 'm-ent', 'Stipendio', 'coins', 'essential'],
].map(([id, macro_id, name, icon, flag], i) => ({ ...base, id, macro_id, name, icon, shade: null, flag, pinned_slot: null, sort_order: i, archived: false }));
const merchants = [['me-coop', 'Coop'], ['me-eni', 'Eni'], ['me-bar', 'Bar Centrale'], ['me-oste', 'Osteria del Ponte'], ['me-foto', 'FotoLab Milano'], ['me-amz', 'Amazon'], ['me-enel', 'Enel'], ['me-anth', 'Anthropic'], ['me-uni', 'Unipol']]
  .map(([id, name]) => ({ id, name, merged_into_id: null, updated_at: ts, client_modified_at: ts, deleted_at: null, user_id: UID }));

let n = 0;
const txs = [];
const add = (kind, cat, amount, date, merchant, extra = {}) => {
  const lines = extra.lines ?? [{ category_id: cat, amount, flag_override: null }];
  txs.push({
    id: `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`, user_id: UID, tx_kind: kind, total: amount, tx_date: date, merchant_id: merchant ?? null,
    note: extra.note ?? null, status: extra.status ?? 'confirmed', accrual_mode: 'same', currency: extra.currency ?? 'EUR', amount_original: extra.amount_original ?? null,
    fx_rate: extra.fx_rate ?? null, fx_status: extra.fx_status ?? 'none', recurrence_id: null, occurrence_date: null, installment_id: null,
    updated_at: ts, client_modified_at: ts, deleted_at: null, transaction_lines: lines, payments: extra.payments ?? [], accruals: extra.accruals ?? [],
  });
};
// dodici mesi di storia, dicembre 2025 – novembre 2026, con numeri deterministici
const months = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
months.forEach((m, i) => {
  const cur = m === '2026-11';
  add('income', 'c-stip', 2400, `${m}-${cur ? '10' : '27'}`, null);
  add('expense', 'c-spesa', 310 + (i % 4) * 22, `${m}-04`, 'me-coop');
  add('expense', 'c-spesa', 180 + (i % 3) * 15, `${m}-12`, 'me-coop');
  add('expense', 'c-boll', 95 + (i % 5) * 12, `${m}-08`, 'me-enel');
  add('expense', 'c-benz', 70 + (i % 2) * 15, `${m}-06`, 'me-eni');
  add('expense', 'c-bar', 38 + ((i * 7) % 30), `${m}-09`, 'me-bar');
  add('expense', 'c-cene', 60 + ((i * 13) % 90), `${m}-14`, 'me-oste');
  if (i % 3 === 0) add('expense', 'c-foto', 120 + i * 9, `${m}-11`, 'me-foto');
  if (i % 4 === 1) add('expense', 'c-tech', 89.9, `${m}-05`, 'me-amz');
  add('expense', 'c-mus', 10.99, `${m}-02`, null, { note: 'Streaming' });
});
// agosto: mese di vacanza, discrezionali alte
add('expense', 'c-cene', 420, '2026-08-15', 'me-oste');
// scontrino diviso: Coop con una parte Tech
add('expense', 'c-spesa', 100, '2026-11-13', 'me-coop', { lines: [{ category_id: 'c-spesa', amount: 70, flag_override: null }, { category_id: 'c-tech', amount: 30, flag_override: null }] });
// assicurazione pagata a ottobre, spalmata su 12 mesi
add('expense', 'c-ass', 600, '2026-10-01', 'me-uni', { accruals: Array.from({ length: 12 }, (_, k) => ({ period: `${k < 3 ? 2026 : 2027}-${String(((9 + k) % 12) + 1).padStart(2, '0')}-01`, amount: 50 })) });
// abbonamento in dollari
add('expense', 'c-tech', 18.71, '2026-11-05', 'me-anth', { currency: 'USD', amount_original: 20, fx_rate: 1.068947, fx_status: 'final' });
// futuro e da confermare: fuori dalle statistiche
add('expense', 'c-foto', 900, '2026-11-28', 'me-foto');
add('expense', 'c-bar', 77, '2026-11-12', 'me-bar', { status: 'scheduled' });

const session = {
  access_token: 'x.y.z', token_type: 'bearer', expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000, refresh_token: 'r',
  user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'marco@example.test', app_metadata: {}, user_metadata: {}, created_at: ts },
};
const profile = { id: UID, display_name: 'Marco', role: 'admin', locale: 'it', theme: 'dark', base_currency: 'EUR', updated_at: ts };

const out = process.argv[2] ?? '/tmp/quadra-qa';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 763 }, deviceScaleFactor: 2, locale: 'it-IT', timezoneId: 'Europe/Rome', acceptDownloads: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
// l'app deve credere che oggi sia il 16 novembre 2026
await page.clock.install({ time: new Date('2026-11-16T14:00:00+01:00') });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.route('http://localhost:54321/**', async (route) => {
  const url = new URL(route.request().url());
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
  if (route.request().method() === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p.startsWith('/auth/v1/token')) return json(session);
  if (p.startsWith('/auth/v1/user')) return json(session.user);
  if (p === '/rest/v1/profiles') return json(profile);
  if (p === '/rest/v1/macros') return json(macros);
  if (p === '/rest/v1/categories') return json(categories);
  if (p === '/rest/v1/merchants') return json(merchants);
  if (p === '/rest/v1/transactions') return json(txs);
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  return json([]);
});
await page.route('https://api.frankfurter.dev/**', (r) => r.abort());

const results = [];
const ok = (name, cond, detail = '') => { results.push([cond ? 'OK ' : 'KO ', name, detail]); console.log(cond ? 'OK ' : 'KO ', name, detail); };
const cents = (s) => Math.round(parseFloat(s.replace(/[^\d,−-]/g, '').replace('−', '-').replace(/\./g, '').replace(',', '.')) * 100);

await page.goto('http://localhost:4173/');
await page.fill('input[type=email]', 'marco@example.test');
await page.fill('input[type=password]', 'x');
await page.click('button[type=submit]');
await page.waitForSelector('.donut');
await page.waitForFunction(() => document.querySelectorAll('.macro-row').length > 0);
await page.clock.runFor(1500);

// Home di novembre: discrezionali, programmati esclusi a mano per il confronto
const homeDisc = cents((await page.locator('.tiles .tile').nth(1).locator('.num').first().innerText()).split('€')[0]);
await page.screenshot({ path: `${out}/0-home.png` });

await page.click('nav .tab:has-text("Statistiche")');
await page.waitForSelector('.st-chart');
await page.screenshot({ path: `${out}/1-stats.png`, fullPage: true });
const cols = await page.locator('.st-col').count();
ok('12 mesi di default', cols === 12, `${cols}`);
const big = cents(await page.locator('.st-big').innerText());
// atteso: bar 38+((11*7)%30)=55, cene 60+((11*13)%90)=113, musica 10,99, tech 30 (scontrino) + 18,71 (USD) → niente foto (i=11), niente tech mensile (11%4=3)
const expected = 5500 + 11300 + 1099 + 3000 + 1871;
ok('discrezionali di novembre', big === expected, `${big} atteso ${expected}`);
// la Home conta anche i programmati (900 foto il 28 + 77 da confermare)
ok('coerente con la Home (Home include i programmati)', homeDisc === expected + 90000 + 7700, `home ${homeDisc}`);
const delta = await page.locator('.st-delta').innerText();
ok('scostamento sulla media di 3 mesi', /3 mesi precedenti/.test(delta), delta.replace(/\s+/g, ' '));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
ok('nessuno scorrimento orizzontale', !overflow);

// tocco su agosto
await page.locator('.st-col').nth(8).click();
await page.screenshot({ path: `${out}/2-stats-agosto.png` });
const head = await page.locator('.card').first().locator('.row .tiny').innerText();
ok('selezione del mese', /Agosto 2026/.test(head), head);

// solo discrezionali
await page.click('.topbar .icon-btn');
await page.waitForSelector('.st-avg');
await page.screenshot({ path: `${out}/3-stats-solo-disc.png`, fullPage: true });
const names = await page.locator('.card').nth(1).locator('.macro-line > span:first-child').allInnerTexts();
ok('solo discrezionali: nessuna categoria essenziale', !names.some((x) => /Spesa|Bollette|Benzina|Assicur/.test(x)), names.join(', '));
const coop = await page.locator('.card').nth(2).locator('.macro-row', { hasText: 'Coop' }).locator('.macro-line .num').innerText().catch(() => '');
ok('Coop compare solo per la quota Tech dello scontrino', cents(coop || '0') === 3000, coop);
await page.click('.topbar .icon-btn');

// periodo 3 mesi e cassa
await page.click('.st-controls button[aria-label="3 mesi"]');
ok('periodo 3 mesi', (await page.locator('.st-col').count()) === 3);
const accr = await page.locator('.card').nth(2).locator('.macro-row', { hasText: 'Unipol' }).locator('.macro-line .num').innerText();
await page.click('.st-controls button:has-text("Cassa")');
const cash = await page.locator('.card').nth(2).locator('.macro-row', { hasText: 'Unipol' }).locator('.macro-line .num').innerText();
ok('assicurazione: competenza 100 (ott+nov), cassa 600', cents(accr) === 10000 && cents(cash) === 60000, `${accr} / ${cash}`);
await page.screenshot({ path: `${out}/4-stats-3mesi-cassa.png`, fullPage: true });
await page.click('.st-controls button:has-text("Competenza")');

// tocco su una categoria: Movimenti filtrati
await page.locator('.card').nth(1).locator('button.macro-row').first().click();
await page.waitForSelector('.filter');
ok('categoria → Movimenti filtrati', (await page.locator('.filter').innerText()).includes('Spesa alimentare'));
await page.screenshot({ path: `${out}/5-movimenti-filtrati.png` });

// la preferenza del periodo resta
await page.click('nav .tab:has-text("Statistiche")');
ok('periodo ricordato', (await page.locator('.st-col').count()) === 3);

// esportazione
await page.click('nav .tab:has-text("Home")');
await page.click('button[aria-label="Impostazioni"]');
const card = page.locator('.card', { hasText: 'Esporta in CSV' });
await card.scrollIntoViewIfNeeded();
const from = await card.locator('input[type=date]').first().inputValue();
const to = await card.locator('input[type=date]').nth(1).inputValue();
ok('intervallo predefinito: tutto lo storico', from === '2025-12-02' && to === '2026-11-16', `${from} → ${to}`);
await page.screenshot({ path: `${out}/6-esporta.png` });
const [dl] = await Promise.all([page.waitForEvent('download'), card.locator('button:has-text("Scarica il file")').click()]);
const file = `${out}/${dl.suggestedFilename()}`;
await dl.saveAs(file);
const text = fs.readFileSync(file, 'utf8');
const rows = text.trim().split('\r\n');
const confirmedToToday = txs.filter((t) => t.status === 'confirmed' && t.tx_date <= '2026-11-16');
const expectedRows = confirmedToToday.reduce((s, t) => s + t.transaction_lines.length, 0);
ok('file: nome, BOM, intestazione', dl.suggestedFilename() === 'quadra-2025-12-02_2026-11-16.csv' && text.charCodeAt(0) === 0xfeff && rows[0].endsWith('Data;Importo;Segno;Categoria;Esercizio;Note;Competenza;Valuta;ImportoOriginale'), dl.suggestedFilename());
ok('file: una riga per categoria', rows.length - 1 === expectedRows, `${rows.length - 1} attese ${expectedRows}`);
ok('file: riga in valuta', rows.includes('05/11/2026;18,71;U;Tech;Anthropic;;;USD;20,00'));
ok('avvisi su divisi e piani', /1 scontrino diviso/.test(await card.innerText()) && /1 movimento spalmato/.test(await card.innerText()));

// intervallo ristretto a novembre
await card.locator('input[type=date]').first().fill('2026-11-01');
const count = await card.locator('[role=status]').first().innerText();
const nov = confirmedToToday.filter((t) => t.tx_date >= '2026-11-01').length;
ok('intervallo da–a', count.startsWith(`${nov} movimenti`), count);

// il file si reimporta: tutti doppioni (stessi movimenti già presenti), nessun errore
await page.goBack();
await page.click('button[aria-label="Impostazioni"]');
await page.click('button:has-text("Importa")');
await page.setInputFiles('input[type=file]', file);
await page.clock.runFor(1000);
await page.waitForTimeout(500);
const impText = await page.locator('main').innerText();
await page.screenshot({ path: `${out}/7-reimport.png`, fullPage: true });
ok('reimport: nessuna riga con errori, nessuna categoria da assegnare', !/errori|da assegnare/i.test(impText) || /0 /.test(impText), impText.replace(/\s+/g, ' ').slice(0, 260));

ok('nessun errore in console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log('fine'); await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(results.some((r) => r[0] === 'KO ') ? 1 : 0);
