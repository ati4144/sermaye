import { COUNTRY_IDS } from '../data/countries';
import { netWorth } from '../market';
import type { EventDef, GameState } from '../types';
import type { FateBeatDef, FateDef, FateQuestionDef } from './types';

/**
 * Fate content — all copy lives in locale files (fate.* / events.<id>.*);
 * the engine deals in ids, numbers and pure predicates only.
 *
 * Iron rules (docs/kader-design.md §1):
 *  - fate never moves money without a player decision (cash only via options),
 *  - fate options carry player-scoped effects only (no world/index writes),
 *  - every curse has a fight path.
 */

// ---------- pure condition helpers ----------

const worthAtLeast = (min: number) => (s: GameState) => netWorth(s) >= min;
const anyIndexAbove = (min: number) => (s: GameState) =>
  COUNTRY_IDS.some((id) => s.countries[id].index > min);
const hasFlag = (flag: string) => (s: GameState) => s.fate?.flags[flag] === true;
const noFlag = (flag: string) => (s: GameState) => s.fate?.flags[flag] !== true;
const unmarried = (s: GameState) => !s.player.married;
const counterAtLeast = (counter: string, min: number) => (s: GameState) =>
  (s.fate?.counters[counter] ?? 0) >= min;

// ---------- destinities ----------

export const FATE_CATALOG: FateDef[] = [
  {
    // 1 — Sıfırdan Zirveye: foreshadowed rise, neutral-reachable
    id: 'sifirdan_zirveye',
    weight: 10,
    answerWeights: { yoksul: 6, cesur: 2, varlikli: -6 },
    start: { health: 95 },
    mods: { illness: 0.85 },
    revealWindow: [18, 48],
    beats: [
      {
        key: 'sz_omen',
        eventId: 'fate_sz_omen',
        window: [6, 18],
      },
      {
        key: 'sz_firsat',
        eventId: 'fate_sz_firsat',
        window: [24, 60],
      },
      {
        key: 'sz_zirve',
        eventId: 'fate_sz_zirve',
        window: [96, 144],
        condition: worthAtLeast(400_000),
      },
      {
        key: 'sz_kazanc',
        eventId: 'fate_sz_kazanc',
        window: [120, 180],
        // ambition's yield OR the partnership's: the sz_firsat "ortak ol" boon
        condition: (s) => hasFlag('sz_hirs')(s) || counterAtLeast('sz_ortak', 1)(s),
      },
    ],
  },
  {
    // 2 — Nazırlı Servet: veiled curse with a real fight path
    id: 'nazarli_servet',
    weight: 6,
    veiled: true,
    requireNone: ['huzur'],
    answerWeights: { varlikli: 5, cesur: 2, temiz: -4 },
    mods: { illness: 1.4 },
    revealWindow: [12, 30],
    beats: [
      {
        key: 'ns_parlak_firsat',
        eventId: 'fate_ns_parlak_firsat',
        window: [30, 66],
      },
      {
        key: 'ns_agir_hastalik',
        eventId: 'fate_ns_agir_hastalik',
        window: [84, 144],
      },
      {
        key: 'ns_hesap_gunu',
        eventId: 'fate_ns_hesap_gunu',
        window: [150, 210],
        condition: noFlag('nazar_kirildi'),
      },
    ],
  },
  {
    // 3 — Gurbet Kuşu: hard-locked by the göç answer (requireAll)
    id: 'gurbet_kusu',
    weight: 10,
    requireAll: ['gurbet'],
    mods: { fee: 0.9 }, // diaspora ağı
    revealWindow: [12, 36],
    beats: [
      {
        key: 'gk_yola_cikis',
        eventId: 'fate_gk_yola_cikis',
        window: [3, 3], // fixed month — the call comes early
      },
      {
        // the memleket house — the v6 asset hook: opt0 grants a house deed
        key: 'gk_memleket_evi',
        eventId: 'fate_gk_memleket_evi',
        window: [36, 96],
      },
      {
        key: 'gk_dolar_hissi',
        eventId: 'fate_gk_dolar_hissi',
        window: [48, 96],
        condition: anyIndexAbove(160),
      },
      {
        key: 'gk_altin_gunu',
        eventId: 'fate_gk_altin_gunu',
        window: [96, 156],
        condition: (s) => counterAtLeast('gonderi', 1)(s) && hasFlag('altin_gunu')(s),
      },
      {
        key: 'gk_geri_donus',
        eventId: 'fate_gk_geri_donus',
        window: [180, 240],
        // dynastic by default — the return question rolls to the heir
      },
    ],
  },
  {
    // 4 — Aile Borcu: hard-locked by the eski borç answer; payable off
    id: 'aile_borcu',
    weight: 10,
    requireAll: ['father_debt'],
    mods: { livingCost: 1.15 },
    revealWindow: [2, 2],
    beats: [
      {
        key: 'ab_mektup',
        eventId: 'fate_ab_mektup',
        window: [3, 3], // the letter arrives in month 3, exactly
      },
      {
        key: 'ab_tahsilat',
        eventId: 'fate_ab_tahsilat',
        window: [36, 72],
        condition: noFlag('borc_kapali'),
      },
      {
        // the farm mortgage — the v6 asset hook: only visits landowners who
        // still owe (no farm deed or borc_kapali → defers monthly, then LOST)
        key: 'ab_tarla_rehni',
        eventId: 'fate_ab_tarla_rehni',
        window: [48, 96],
        condition: (s) => noFlag('borc_kapali')(s) && (s.properties.farm?.units ?? 0) > 0,
      },
      {
        key: 'ab_miras_agirligi',
        eventId: 'fate_ab_miras_agirligi',
        window: [96, 144],
        condition: noFlag('borc_kapali'),
      },
    ],
  },
  {
    // 5 — Kısmetli Yol: the boon
    id: 'kismetli_yol',
    weight: 6,
    answerWeights: { temiz: 5, huzur: 4, guvenlik: 2 },
    mods: { illness: 0.9, fee: 0.95 },
    revealWindow: [24, 60],
    beats: [
      {
        key: 'ky_firsat',
        eventId: 'fate_ky_firsat',
        window: [18, 48],
      },
      {
        key: 'ky_karsilik',
        eventId: 'fate_ky_karsilik',
        window: [60, 120],
        condition: hasFlag('ky_ortak'),
      },
      {
        key: 'ky_huzur',
        eventId: 'fate_ky_huzur',
        window: [120, 180],
        // the full table requires the partnership to still be running
        // (ky_karsilik opt1 — "hisseyle devam") — kısmet accumulates for real
        condition: (s) => hasFlag('ky_ortak')(s) && counterAtLeast('ky_devam', 1)(s),
      },
    ],
  },
];

// ---------- answer-armed beats ----------

/** Beats armed by questionnaire answers (keyed by beat key). */
export const ANSWER_BEATS: FateBeatDef[] = [
  {
    key: 'ka_kayip_ask',
    eventId: 'fate_ka_kayip_ask',
    window: [60, 120],
    condition: unmarried,
    personal: true, // the founder's lost love dies with the founder
  },
];

// ---------- questionnaire ----------

export const FATE_QUESTIONS: FateQuestionDef[] = [
  {
    id: 'q_koken',
    options: [
      { key: 'yoksul', cashDelta: -10_000 },
      { key: 'esnaf', mods: { fee: 0.95 } },
      { key: 'varlikli', cashDelta: 10_000, mods: { estateTax: 1.25 }, flags: ['heir_upbringing'] },
    ],
  },
  {
    id: 'q_mizac',
    options: [
      { key: 'cesur', mods: { illness: 1.1, marriage: 1.15 } },
      { key: 'temkinli', mods: { illness: 0.9, marriage: 0.85 } },
      { key: 'kurnaz', mods: { fee: 0.95, birth: 0.9 } },
    ],
  },
  {
    id: 'q_sir', // the lock
    options: [
      { key: 'eski_borc', flags: ['father_debt'] },
      { key: 'goc', flags: ['gurbet'] },
      { key: 'kayip_ask', armBeats: ['ka_kayip_ask'] },
      { key: 'temiz' },
    ],
  },
  {
    id: 'q_para',
    options: [
      { key: 'guvenlik', mods: { livingCost: 0.95 } },
      { key: 'guc', mods: { estateTax: 1.15 } },
      { key: 'ozgurluk', mods: { marriage: 0.9 } },
    ],
  },
  {
    id: 'q_aile',
    options: [
      { key: 'buyuk_aile', mods: { birth: 1.2, marriage: 1.1 } },
      { key: 'kariyer', mods: { birth: 0.85, illness: 1.1 } },
      { key: 'huzur', flags: ['huzur'] },
    ],
  },
];

// ---------- FATE event definitions ----------

const fateEvent = (
  id: string,
  options?: EventDef['options'],
): EventDef => ({ id, scope: 'GLOBAL', trigger: 'FATE', p: 1, cooldown: 0, effects: [], options });

/** All FATE events — appended to EVENT_CATALOG; marketEvents() filters them out. */
export const FATE_EVENT_DEFS: EventDef[] = [
  // destiny reveals (ACK-only)
  fateEvent('fate_reveal_sifirdan_zirveye'),
  fateEvent('fate_reveal_nazarli_servet'),
  fateEvent('fate_reveal_gurbet_kusu'),
  fateEvent('fate_reveal_aile_borcu'),
  fateEvent('fate_reveal_kismetli_yol'),

  // sıfırdan zirveye
  fateEvent('fate_sz_omen'),
  fateEvent('fate_sz_firsat', [
    { effects: [], costPctNetWorth: 0.05, fate: { counters: { sz_ortak: 1 } } },
    { effects: [] },
  ]),
  fateEvent('fate_sz_zirve', [
    { effects: [], costPctNetWorth: 0.15, fate: { setFlag: 'legacy' } },
    { effects: [], fate: { setFlag: 'sz_hirs', modShift: { illness: 0.1 } } },
  ]),
  fateEvent('fate_sz_kazanc', [
    { effects: [], healthDelta: 10 },
    { effects: [], cashDelta: 8_000 },
  ]),

  // nazırlı servet
  fateEvent('fate_ns_parlak_firsat', [
    { effects: [], costPctNetWorth: 0.05, fate: { modShift: { fee: -0.05 } } },
    { effects: [], cashDelta: 8_000, fate: { counters: { sadaka: 1 }, modShift: { illness: -0.05 } } },
  ]),
  fateEvent('fate_ns_agir_hastalik', [
    { effects: [], costPctNetWorth: 0.08, healthDelta: 15, fate: { setFlag: 'nazar_kirildi' } },
    { effects: [], healthDelta: -20, fate: { modShift: { illness: 0.1 } } },
  ]),
  fateEvent('fate_ns_hesap_gunu', [
    { effects: [], costPctNetWorth: 0.15, fate: { setFlag: 'nazar_kirildi' } },
    { effects: [], costPctNetWorth: 0.25 },
  ]),

  // gurbet kuşu
  fateEvent('fate_gk_yola_cikis', [
    { effects: [], costPctNetWorth: 0.03, fate: { counters: { gonderi: 1 } } },
    { effects: [] },
  ]),
  fateEvent('fate_gk_memleket_evi', [
    // the v6 grant hook: cost is charged on net worth BEFORE the deed lands
    // (resolveEvent order: costs → grant), so the house never pays for itself
    { effects: [], costPctNetWorth: 0.04, grantAsset: { assetId: 'house', units: 1 }, fate: { setFlag: 'memleket_evi' } },
    { effects: [] },
  ]),
  fateEvent('fate_gk_dolar_hissi', [
    { effects: [], costPctNetWorth: 0.02, fate: { setFlag: 'altin_gunu' } },
    { effects: [] },
  ]),
  fateEvent('fate_gk_altin_gunu', [
    { effects: [], cashDelta: 10_000 },
    { effects: [], cashDelta: 5_000, healthDelta: 8 },
  ]),
  fateEvent('fate_gk_geri_donus', [
    { effects: [], healthDelta: 5, fate: { setFlag: 'dondu' } },
    { effects: [], cashDelta: 5_000, fate: { setFlag: 'kaldi' } },
  ]),

  // aile borcu
  fateEvent('fate_ab_mektup', [
    { effects: [], costPctNetWorth: 0.05, fate: { setFlag: 'borc_kapali' } },
    { effects: [], fate: { setFlag: 'borc_inkar', modShift: { livingCost: 0.1 } } },
  ]),
  fateEvent('fate_ab_tahsilat', [
    { effects: [], costPctNetWorth: 0.08, fate: { setFlag: 'borc_kapali' } },
    { effects: [], healthDelta: -5, fate: { modShift: { livingCost: 0.1 } } },
  ]),
  fateEvent('fate_ab_tarla_rehni', [
    // the v6 seizure hook: both exits that clear the rehn close the debt —
    // miras_agirligi (noFlag borc_kapali) then never doubles down
    { effects: [], takeAsset: { assetId: 'farm' }, fate: { setFlag: 'borc_kapali' } },
    { effects: [], costPctNetWorth: 0.1, fate: { setFlag: 'borc_kapali' } },
    { effects: [], healthDelta: -5, fate: { modShift: { livingCost: 0.1 } } },
  ]),
  fateEvent('fate_ab_miras_agirligi', [
    { effects: [], costPctNetWorth: 0.1, fate: { setFlag: 'borc_kapali' } },
    { effects: [], cashDelta: -10_000 },
  ]),

  // kısmetli yol
  fateEvent('fate_ky_firsat', [
    { effects: [], costPctNetWorth: 0.02, fate: { setFlag: 'ky_ortak' } },
    { effects: [] },
  ]),
  fateEvent('fate_ky_karsilik', [
    { effects: [], cashDelta: 8_000 },
    { effects: [], fate: { counters: { ky_devam: 1 } } },
  ]),
  fateEvent('fate_ky_huzur', [
    { effects: [], healthDelta: 10 },
    { effects: [], cashDelta: 3_000, healthDelta: -3 },
  ]),

  // kayıp aşk (answer beat)
  fateEvent('fate_ka_kayip_ask', [
    { effects: [], cashCost: 3_000, setMarried: true },
    { effects: [], healthDelta: -8, fate: { setFlag: 'kayip_ask_red' } },
  ]),
];

// ---------- lookups ----------

const fateById = new Map(FATE_CATALOG.map((d) => [d.id, d]));

export function fateDefById(id: string): FateDef {
  const def = fateById.get(id);
  if (!def) throw new Error(`Unknown destiny: ${id}`);
  return def;
}

const beatByKey = new Map<string, FateBeatDef>(
  [...FATE_CATALOG.flatMap((d) => d.beats), ...ANSWER_BEATS].map((b) => [b.key, b]),
);

export function beatDefByKey(key: string): FateBeatDef {
  const def = beatByKey.get(key);
  if (!def) throw new Error(`Unknown beat: ${key}`);
  return def;
}

/** Reveal event id for a destiny — ACK-only, copy at events.<id>.{title,text}. */
export function fateRevealEventId(destinyId: string): string {
  return `fate_reveal_${destinyId}`;
}

/** Whether a destiny hides its omens until the reveal (veiled). */
export function isVeiled(destinyId: string): boolean {
  return destinyId !== 'none' && fateDefById(destinyId).veiled === true;
}
