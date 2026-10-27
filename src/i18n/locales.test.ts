import { describe, expect, it } from 'vitest';
import { balance } from '../engine/balance';
import { ASSETS_CATALOG } from '../engine/data/assets';
import { LIFESTYLE_TIERS } from '../engine/data/expenses';
import { EVENT_CATALOG } from '../engine/events/catalog';
import { FATE_CATALOG, FATE_QUESTIONS } from '../engine/fate/defs';
import { WORLD_PACK } from '../engine/worldpack';
import en from './locales/en';
import tr from './locales/tr';

type Dict = Record<string, unknown>;

/** Flatten a locale tree to dot-paths of its string leaves. */
function keys(obj: Dict, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v !== null && typeof v === 'object' ? keys(v as Dict, path) : [path];
  });
}

/** All {{placeholders}} used in a locale's string leaves, per path. */
function placeholders(obj: Dict, prefix = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') {
      Object.assign(out, placeholders(v as Dict, path));
    } else if (typeof v === 'string') {
      out[path] = [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    }
  }
  return out;
}

function at(obj: Dict, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Dict)[seg];
  }
  return cur;
}

const LOCALES: [string, Dict][] = [
  ['tr', tr as Dict],
  ['en', en as Dict],
];

describe('locale parity', () => {
  it('tr and en expose the identical key tree', () => {
    expect(new Set(keys(en as Dict))).toEqual(new Set(keys(tr as Dict)));
  });

  it('interpolation placeholders match across locales', () => {
    const enP = placeholders(en as Dict);
    for (const [path, names] of Object.entries(placeholders(tr as Dict))) {
      expect(enP[path] ?? []).toEqual(names);
    }
  });
});

describe('locale × engine content coverage', () => {
  it('every catalog event has title, text and one label per option', () => {
    for (const def of EVENT_CATALOG) {
      for (const [locale, tree] of LOCALES) {
        const base = `events.${def.id}`;
        expect(at(tree, `${base}.title`), `${locale}:${base}.title`).toBeTypeOf('string');
        expect(at(tree, `${base}.text`), `${locale}:${base}.text`).toBeTypeOf('string');
        for (let i = 0; i < (def.options?.length ?? 0); i++) {
          expect(at(tree, `${base}.options.${i}`), `${locale}:${base}.options.${i}`).toBeTypeOf('string');
        }
      }
    }
  });

  it('every destiny has a name and a description', () => {
    for (const d of FATE_CATALOG) {
      for (const [locale, tree] of LOCALES) {
        expect(at(tree, `fate.destinies.${d.id}.name`), `${locale}:${d.id}`).toBeTypeOf('string');
        expect(at(tree, `fate.destinies.${d.id}.desc`), `${locale}:${d.id}`).toBeTypeOf('string');
      }
    }
  });

  it('every fate question has text and one label per option', () => {
    for (const q of FATE_QUESTIONS) {
      for (const [locale, tree] of LOCALES) {
        expect(at(tree, `fate.questions.${q.id}.text`), `${locale}:${q.id}`).toBeTypeOf('string');
        for (let i = 0; i < q.options.length; i++) {
          expect(at(tree, `fate.questions.${q.id}.options.${i}`), `${locale}:${q.id}.${i}`).toBeTypeOf('string');
        }
      }
    }
  });

  it('every WORLD_PACK scenario has name/desc and one headline per scripted beat', () => {
    // the key-parity test above stays green when copy is missing from BOTH
    // locales — scenarios resolve keys dynamically, so coverage is asserted
    // per beat here (a scenario added via build:worldpack without copy fails)
    for (const sc of WORLD_PACK.scenarios) {
      for (const [locale, tree] of LOCALES) {
        expect(at(tree, `scenarios.${sc.id}.name`), `${locale}:${sc.id}.name`).toBeTypeOf('string');
        expect(at(tree, `scenarios.${sc.id}.desc`), `${locale}:${sc.id}.desc`).toBeTypeOf('string');
        for (const beat of sc.beats) {
          if (beat.news !== undefined) {
            expect(at(tree, `scenarios.${sc.id}.news.${beat.news}`), `${locale}:${sc.id}.news.${beat.news}`).toBeTypeOf(
              'string',
            );
          }
        }
      }
    }
  });

  it('every catalog asset has name, desc and unit copy in both locales', () => {
    // asset names/descs/units resolve dynamically (`assets.<id>.*`) — the key
    // tree stays green when copy is missing from BOTH locales, so coverage is
    // asserted against ASSETS_CATALOG here (a catalog row without copy renders
    // the raw id in the UI)
    for (const def of ASSETS_CATALOG) {
      for (const [locale, tree] of LOCALES) {
        expect(at(tree, `assets.${def.id}.name`), `${locale}:assets.${def.id}.name`).toBeTypeOf('string');
        expect(at(tree, `assets.${def.id}.desc`), `${locale}:assets.${def.id}.desc`).toBeTypeOf('string');
        expect(at(tree, `assets.${def.id}.unit`), `${locale}:assets.${def.id}.unit`).toBeTypeOf('string');
        expect(at(tree, `assets.${def.id}.unit_one`), `${locale}:assets.${def.id}.unit_one`).toBeTypeOf('string');
        expect(at(tree, `assets.${def.id}.unit_other`), `${locale}:assets.${def.id}.unit_other`).toBeTypeOf('string');
      }
    }
  });

  it('every lifestyle tier and preset item key resolves in both locales', () => {
    // tiers and item labels resolve dynamically (`expenses.tiers.<tier>`,
    // `expenses.items.<key>`) — a balance.ts preset key without copy renders
    // the raw key in the UI, so coverage is asserted against the catalog here
    const itemKeys = new Set<string>();
    for (const tier of LIFESTYLE_TIERS) {
      for (const row of balance.EXPENSES.PRESETS[tier]) itemKeys.add(row.key);
    }
    for (const [locale, tree] of LOCALES) {
      for (const tier of LIFESTYLE_TIERS) {
        expect(at(tree, `expenses.tiers.${tier}`), `${locale}:tiers.${tier}`).toBeTypeOf('string');
      }
      for (const key of itemKeys) {
        expect(at(tree, `expenses.items.${key}`), `${locale}:items.${key}`).toBeTypeOf('string');
      }
    }
  });

  it('month name/abbrev arrays carry exactly 12 non-empty strings in both locales', () => {
    // formatGameDate indexes month-1 into these arrays dynamically — a missing
    // entry would render the raw month number, and the key-parity test cannot
    // see inside arrays, so scope and length are asserted here
    for (const [locale, tree] of LOCALES) {
      for (const key of ['ui.time.monthNames', 'ui.time.monthAbbrevs']) {
        const arr = at(tree, key);
        expect(Array.isArray(arr), `${locale}:${key} is an array`).toBe(true);
        expect((arr as unknown[]).length, `${locale}:${key} has 12 entries`).toBe(12);
        for (const m of arr as unknown[]) {
          expect(typeof m === 'string' && m.length > 0, `${locale}:${key} entries are non-empty strings`).toBe(true);
        }
      }
    }
  });
});
