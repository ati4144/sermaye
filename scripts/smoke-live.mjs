/**
 * Same flow as smoke-flow.mjs, run against the DEPLOYED GitHub Pages bundle
 * (M1 acceptance: the exported artifact + localStorage persistence on the
 * public origin). No Metro needed.
 */
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = 'https://ati4144.github.io/sermaye/';
const NAME = 'Kaya';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}\n${String(e.detail?.stack ?? e.detail ?? '')}`));
vc.on('error', (...a) => errors.push(`console.error: ${a.map(String).join(' ')}`));

const dom = await JSDOM.fromURL(BASE, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.localStorage.clear();
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

await sleep(9000); // initial mount over the network (bundle is 2.4 MB)
console.log('1. menu loaded:', body().slice(0, 160));

await clickByText('Yeni Oyun');
await sleep(800);

const input =
  w.document.querySelector('[data-testid="family-name-input"]') ??
  w.document.querySelector('input, textarea');
if (!input) throw new Error('name input not found');
Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, NAME);
input.dispatchEvent(new w.Event('input', { bubbles: true }));
await sleep(300);

await clickByText('Başla');
await sleep(2500);
if (!body().includes('Dönem Seç')) throw new Error('era screen did not render');

const clickTestId = async (id) => {
  const el = w.document.querySelector(`[data-testid="${id}"]`);
  if (!el) throw new Error(`testid not found: ${id} — page: ${body().slice(0, 200)}`);
  el.click();
  await sleep(700);
};

await clickByText('Bu dönemde başla');
await sleep(1500);
if (!body().includes('Vatanını Seç')) throw new Error('country screen did not render');

await clickByText('Türkiye');
await sleep(400);
if (!body().includes('%40/yıl')) throw new Error('tr inflation chip missing');
await clickTestId('country-continue');
await sleep(1500);
if (!body().includes('Aylık Gelirin')) throw new Error('income screen did not render');
const salaryInput = w.document.querySelector('[data-testid="income-input"]');
if (!(salaryInput.placeholder ?? '').includes('TRY')) throw new Error(`placeholder not TRY: ${salaryInput.placeholder}`);
Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(salaryInput, '2000');
salaryInput.dispatchEvent(new w.Event('input', { bubbles: true }));
await sleep(300);
await clickTestId('income-continue');

await sleep(1500);
if (!body().includes('Kaderini sen mi yazarsın')) throw new Error('fate mode screen did not render');
await clickTestId('fate-mode-chosen');
for (let q = 0; q < 5; q++) await clickTestId('fate-option-0');
await sleep(800);
await clickTestId('fate-sealed-continue');
await sleep(2500);
const page = body();

const ok = page.includes(NAME) && w.location.pathname.startsWith('/sermaye/game');
const tufeOk = page.includes('Türkiye') && page.includes('TÜFE');
console.log(`\ndashboard rendered: ${ok} | tüfe chip: ${tufeOk} | url: ${w.location.pathname}`);

// phase 2: fresh JSDOM at the deep route /game with the same origin storage —
// on the SPA export this serves 404.html which meta-refreshes to the root;
// jsdom does not act on meta refresh, so emulate the browser by loading BASE
// (state is in localStorage and rehydrates the run either way)
const savesBlob = w.localStorage.getItem('sermaye-saves');
const settingsBlob = w.localStorage.getItem('sermaye-settings');
if (!savesBlob) throw new Error('no saves blob persisted to localStorage');
const dom2 = await JSDOM.fromURL(BASE, {
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
await sleep(9000);
// root loads the menu; the real resume path is clicking the slot with the
// saved family name (deep routes 404 on GH Pages outside a real browser)
const slotEls = [...dom2.window.document.querySelectorAll('[role="button"], [data-testid]')];
const slot = slotEls.find((e) => (e.textContent ?? '').includes(NAME));
if (!slot) throw new Error(`save slot with "${NAME}" not found on menu: ${dom2.window.document.body.textContent.replace(/\s+/g, ' ').slice(0, 300)}`);
slot.click();
await sleep(3000);
const resumed = dom2.window.document.body.textContent.replace(/\s+/g, ' ');
const resumedOk = resumed.includes(NAME) && resumed.includes('Net Değer');
console.log(`fresh load: resumed=${resumedOk}`);
console.log(resumedOk && ok && tufeOk && !errors.length ? '\nLIVE FLOW OK — deployed bundle + persistence verified' : '\nLIVE FLOW BROKEN');
if (errors.length) {
  console.log('\n=== ERRORS ===');
  for (const e of errors) console.log(e.slice(0, 2000), '\n---');
}
process.exit(resumedOk && ok && tufeOk && !errors.length ? 0 : 1);
