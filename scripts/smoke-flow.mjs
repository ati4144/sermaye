/**
 * End-to-end smoke of the reported bug: main menu → new game → type name →
 * Başla → the game dashboard must render (was: "Unmatched Route" crash).
 */
import { JSDOM, VirtualConsole } from 'jsdom';

const NAME = 'Kaya';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}\n${String(e.detail?.stack ?? e.detail ?? '')}`));
vc.on('error', (...a) => errors.push(`console.error: ${a.map(String).join(' ')}`));

const dom = await JSDOM.fromURL('http://localhost:8081/', {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.localStorage.clear(); // start from a clean slate
    window.matchMedia ??= (q) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return false; },
    });
    window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    window.addEventListener('error', (e) => errors.push(`window.onerror: ${e.message}`));
  },
});

const w = dom.window;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const body = () => w.document.body.textContent.replace(/\s+/g, ' ');

const clickByText = async (needle) => {
  const els = [...w.document.querySelectorAll('[role="button"], [data-testid]')];
  const el = els.find((e) => (e.textContent ?? '').includes(needle));
  if (!el) throw new Error(`button not found: "${needle}" — page: ${body().slice(0, 200)}`);
  el.click();
  await sleep(800);
};

await sleep(6000); // initial mount + hydration
console.log('1. menu loaded:', body().slice(0, 160));

await clickByText('Yeni Oyun');
console.log('2. after Yeni Oyun click:', body().slice(0, 160));

const input =
  w.document.querySelector('[data-testid="family-name-input"]') ??
  w.document.querySelector('input, textarea');
if (!input) throw new Error('name input not found');
Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, NAME);
input.dispatchEvent(new w.Event('input', { bubbles: true }));
await sleep(300);
console.log('3. typed name. value =', JSON.stringify(input.value));

await clickByText('Başla');
await sleep(2500); // era (scenario) screen mount
let page = body();
console.log('4. era screen:', page.slice(0, 220));
if (!page.includes('Dönem Seç')) {
  throw new Error(`era screen did not render: ${page.slice(0, 200)}`);
}

const clickTestId = async (id) => {
  const el = w.document.querySelector(`[data-testid="${id}"]`);
  if (!el) throw new Error(`testid not found: ${id} — page: ${body().slice(0, 200)}`);
  el.click();
  await sleep(700);
};

// default selection is Güncel Dönem — start the era to reach the country step
await clickByText('Bu dönemde başla');
await sleep(1500);
page = body();
console.log('4b. country screen:', page.slice(0, 220));
if (!page.includes('Vatanını Seç')) {
  throw new Error(`country screen did not render: ${page.slice(0, 200)}`);
}

// v8: pick Türkiye (high-inflation path — the TÜFE chip must be there), then
// continue; the display currency defaults to TL for the salary step
await clickByText('Türkiye');
await sleep(400);
if (!body().includes('%40/yıl')) {
  throw new Error(`tr inflation chip missing: ${body().slice(0, 200)}`);
}
await clickTestId('country-continue');
await sleep(1500);
page = body();
console.log('5. income screen:', page.slice(0, 220));
if (!page.includes('Aylık Gelirin')) {
  throw new Error(`income screen did not render: ${page.slice(0, 200)}`);
}
// v8: the country pick defaulted the display currency — the placeholder now
// speaks TL, not USD (placeholder text lives on the attribute, not in textContent)
const salaryInput = w.document.querySelector('[data-testid="income-input"]');
if (!salaryInput) throw new Error('salary input not found');
if (!(salaryInput.placeholder ?? '').includes('TRY')) {
  throw new Error(`salary placeholder not in TRY: ${salaryInput.placeholder}`);
}

// v7: type a salary (empty would default to $1,500/mo) — the input speaks
// TRY now, so 2000 reaches the engine as ~55.6 USD/mo
Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(salaryInput, '2000');
salaryInput.dispatchEvent(new w.Event('input', { bubbles: true }));
await sleep(300);
console.log('6. typed salary. value =', JSON.stringify(salaryInput.value));
await clickTestId('income-continue');

await sleep(1500);
page = body();
console.log('7. fate mode screen:', page.slice(0, 220));
if (!page.includes('Kaderini sen mi yazarsın')) {
  throw new Error(`fate mode screen did not render: ${page.slice(0, 200)}`);
}

// 8. write our own fate → questionnaire → answer all five (option 0)
await clickTestId('fate-mode-chosen');
for (let q = 0; q < 5; q++) {
  if (!body().includes(`Soru ${q + 1} / 5`)) throw new Error(`question ${q + 1} not shown: ${body().slice(0, 200)}`);
  await clickTestId('fate-option-0');
}
console.log('5. questionnaire answered (5 × option 0)');

// 6. sealed splash
await sleep(800);
page = body();
console.log('6. sealed:', page.slice(0, 220));
if (!page.includes('Kaderin Mühürlendi')) throw new Error(`sealed splash did not render: ${page.slice(0, 200)}`);
await clickTestId('fate-sealed-continue');
await sleep(2500); // dismissTo + dashboard mount + animations
page = body();
console.log('7. after sealed continue:', page.slice(0, 300));

const ok = page.includes(NAME) && w.location.pathname.startsWith('/game');
// v7: the calendar header reads "Ekim 2026" and the cashflow estimate carries
// the salary row the player just typed ($2,000)
const dateOk = page.includes('Ekim 2026');
const salaryOk = page.includes('Maaş') && page.includes('2.000');
// v8: the header chip reads "Türkiye · TÜFE 100" at month zero
const tufeOk = page.includes('Türkiye') && page.includes('TÜFE');
console.log(`\ndashboard rendered: ${ok} | date: ${dateOk} | salary row: ${salaryOk} | tüfe chip: ${tufeOk} | url: ${w.location.pathname}`);

if (errors.length) {
  console.log('\n=== ERRORS ===');
  for (const e of errors) console.log(e.slice(0, 2000), '\n---');
  process.exit(1);
}
console.log(ok && dateOk && salaryOk && tufeOk ? '\nFLOW OK — no errors' : '\nFLOW BROKEN');

// phase 2: fresh page load at /game with the app's own persisted state —
// the persisted activeSlot must resume the run (jsdom can't location.reload,
// so we seed a new JSDOM with the localStorage the app just wrote)
const savesBlob = w.localStorage.getItem('sermaye-saves');
const settingsBlob = w.localStorage.getItem('sermaye-settings');
const dom2 = await JSDOM.fromURL('http://localhost:8081/game', {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    if (savesBlob) window.localStorage.setItem('sermaye-saves', savesBlob);
    if (settingsBlob) window.localStorage.setItem('sermaye-settings', settingsBlob);
    window.matchMedia ??= (q) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return false; },
    });
    window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    window.addEventListener('error', (e) => errors.push(`window.onerror: ${e.message}`));
  },
});
await sleep(8000);
const resumed = dom2.window.document.body.textContent.replace(/\s+/g, ' ');
const resumedOk =
  resumed.includes(NAME) && resumed.includes('Net Değer') && dom2.window.location.pathname.startsWith('/game');
console.log(`5. fresh load at /game: url=${dom2.window.location.pathname} resumed=${resumedOk}`);
console.log(resumedOk ? 'RESUME OK' : `RESUME BROKEN: ${resumed.slice(0, 200)}`);
if (errors.length) {
  console.log('\n=== ERRORS ===');
  for (const e of errors) console.log(e.slice(0, 2000), '\n---');
}
process.exit(resumedOk && !errors.length ? 0 : 1);
