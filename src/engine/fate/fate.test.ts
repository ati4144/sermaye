import { describe, expect, it } from 'vitest';
import { applyAction, replay } from '../actions';
import { createNewGame } from '../create';
import { balance, eventDef, netWorth } from '../index';
import { nextFloat } from '../rng';
import { runMonths } from '../test-utils';
import type { EngineAction, FateBeatState, GameState, PendingEvent } from '../types';
import { ANSWER_BEATS, FATE_CATALOG, FATE_QUESTIONS, fateRevealEventId } from './defs';
import { fateOnInherit, triggerFateBeats } from './tick';

// answers: [q_koken, q_mizac, q_sir, q_para, q_aile]
const GOC = [-1, -1, 1, -1, -1]; // göç hikâyesi → gurbet_kusu hard lock
const BORC = [-1, -1, 0, -1, -1]; // eski borç → aile_borcu hard lock
const NEUTRAL = [-1, -1, -1, -1, -1];

function drainOne(s: GameState, pick = 0): GameState {
  const head = s.pendingEvents[0];
  if (!head) return s;
  return head.hasChoice
    ? applyAction(s, { type: 'RESOLVE_EVENT', uid: head.uid, optionIndex: pick })
    : applyAction(s, { type: 'ACK_EVENT', uid: head.uid });
}

function drainUntil(s: GameState, pred: (e: PendingEvent) => boolean, pick = 0): GameState {
  let guard = 0;
  while (s.pendingEvents.length > 0 && !pred(s.pendingEvents[0]) && guard < 30) {
    guard++;
    s = drainOne(s, pick);
  }
  return s;
}

describe('fate creation', () => {
  it('creation isolation: the main stream is identical across all answer sets', () => {
    const base = createNewGame({ seed: 12345, name: 'A' });
    for (const answers of [GOC, BORC, NEUTRAL, [0, 0, 2, 0, 0], [2, 1, 3, 2, 2]]) {
      const s = createNewGame({ seed: 12345, name: 'A', answers });
      expect(s.rng.s).toBe(base.rng.s); // only the one fixed fate-seed draw
      expect(s.fate).not.toBeNull();
    }
  });

  it('hard gate: the göç answer locks gurbet_kusu 100%', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = createNewGame({ seed, name: 'G', answers: GOC });
      expect(s.fate?.destinyId).toBe('gurbet_kusu');
    }
  });

  it('hard gate: the eski borç answer locks aile_borcu 100%', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = createNewGame({ seed, name: 'B', answers: BORC });
      expect(s.fate?.destinyId).toBe('aile_borcu');
    }
  });

  it('huzur blocks the veiled curse (requireNone)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createNewGame({ seed, name: 'H', answers: [-1, -1, -1, -1, 2] });
      expect(s.fate?.destinyId).not.toBe('nazarli_servet');
    }
  });

  it('rejects invalid answers with a stable reason code', () => {
    expect(() => createNewGame({ seed: 1, name: 'X', answers: [9, -1, -1, -1, -1] })).toThrow('INVALID_ANSWERS');
    expect(() => createNewGame({ seed: 1, name: 'X', answers: [-1, -1, -1, -1, -1, -1] })).toThrow('INVALID_ANSWERS');
    expect(() => createNewGame({ seed: 1, name: 'X', answers: [-2, -1, -1, -1, -1] })).toThrow('INVALID_ANSWERS');
  });

  it('all-skip answers normalize to RANDOM mode; a real answer is CHOSEN', () => {
    expect(createNewGame({ seed: 1, name: 'X', answers: NEUTRAL }).fate?.mode).toBe('RANDOM');
    expect(createNewGame({ seed: 1, name: 'X' }).fate?.mode).toBe('RANDOM');
    expect(createNewGame({ seed: 1, name: 'X', answers: GOC }).fate?.mode).toBe('CHOSEN');
  });

  it('answer start deltas: yoksul −10k / varlıklı +10k, receipt-grade', () => {
    const yok = createNewGame({ seed: 7, name: 'Y', answers: [0, -1, -1, -1, -1] });
    expect(yok.cash).toBe(90_000);
    expect(yok.netWorthHistory[0]).toBe(90_000);
    const varl = createNewGame({ seed: 7, name: 'V', answers: [2, -1, -1, -1, -1] });
    expect(varl.cash).toBe(110_000);
    expect(varl.peakNetWorth).toBe(110_000);
  });

  it('merged mods are multiplied and clamped per field', () => {
    // varlıklı (estateTax 1.25) × güç (estateTax 1.15) = 1.4375, under the clamp
    const s = createNewGame({ seed: 7, name: 'M', answers: [2, -1, -1, 1, -1] });
    expect(s.fate!.mods.estateTax).toBeCloseTo(1.4375, 4);
    // nazarli (illness 1.4) × cesur (illness 1.1) = 1.54 → clamps to 1.5
    const seeds = [3, 11, 29, 41, 57, 73];
    for (const seed of seeds) {
      const n = createNewGame({ seed, name: 'N', answers: [2, 0, -1, -1, -1] });
      if (n.fate!.destinyId === 'nazarli_servet') {
        expect(n.fate!.mods.illness).toBe(1.5);
        return;
      }
    }
    throw new Error('never rolled nazarli_servet with varlıklı+cesur across 6 seeds');
  });

  it('jittered plannedTicks stay inside their windows', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = createNewGame({ seed, name: 'J' });
      for (const b of s.fate!.beats) {
        expect(b.plannedTick).toBeGreaterThanOrEqual(b.window[0]);
        expect(b.plannedTick).toBeLessThanOrEqual(b.window[1]);
      }
    }
  });

  it('fee mod: the diaspora ağı lowers trading fees', () => {
    const gk = createNewGame({ seed: 5, name: 'G', answers: GOC });
    const plain = createNewGame({ seed: 5, name: 'P' });
    const feeGk = applyAction(gk, { type: 'BUY', countryId: 'us', amount: 10_000 });
    const feePlain = applyAction(plain, { type: 'BUY', countryId: 'us', amount: 10_000 });
    // us is grade A (0.5%); gurbet_kusu fee 0.9 → 0.45%
    expect(feeGk.holdings.us.units).toBeGreaterThan(feePlain.holdings.us.units);
  });
});

describe('fate tick (phase 2.5)', () => {
  it('consumes zero draws from both streams', () => {
    const s = createNewGame({ seed: 42, name: 'Z', answers: GOC });
    // force the fixed month-3 beat to be due right now
    s.tick = 3;
    const mainBefore = s.rng.s;
    const fateBefore = s.fate!.rng.s;
    triggerFateBeats(s);
    expect(s.rng.s).toBe(mainBefore);
    expect(s.fate!.rng.s).toBe(fateBefore);
    expect(s.pendingEvents.some((e) => e.eventId === 'fate_gk_yola_cikis')).toBe(true);
  });

  it('the aile borcu letter fires in month 3 exactly, after the month-2 reveal', () => {
    let s = createNewGame({ seed: 99, name: 'M', answers: BORC });
    expect(s.fate!.revealAtTick).toBe(2); // window [2,2] → fixed
    s = applyAction(s, { type: 'NEXT_MONTH' }); // tick 1
    s = applyAction(s, { type: 'NEXT_MONTH' }); // tick 2 → reveal
    expect(s.fate!.revealedTick).toBe(2);
    expect(s.pendingEvents.some((e) => e.eventId === 'fate_reveal_aile_borcu')).toBe(true);
    while (s.pendingEvents.length > 0) s = drainOne(s);

    s = applyAction(s, { type: 'NEXT_MONTH' }); // tick 3 → letter
    expect(s.fate!.beats.find((b) => b.key === 'ab_mektup')?.status).toBe('FIRED');
    expect(s.pendingEvents.some((e) => e.eventId === 'fate_ab_mektup')).toBe(true);
  });

  it('a false condition defers monthly, then LOST past window + grace', () => {
    const s = createNewGame({ seed: 1, name: 'D' });
    // synthetic: a beat whose condition (flag) is false, window already tight
    const beat = { ...s.fate!.beats[0] };
    beat.key = 'sz_kazanc'; // condition: hasFlag('sz_hirs') — false here
    beat.eventId = 'fate_sz_kazanc';
    beat.window = [1, 1];
    beat.plannedTick = 1;
    beat.status = 'PENDING';
    s.fate!.beats = [beat];
    s.tick = 0;
    const grace = balance.FATE.DEFER_GRACE;
    for (let t = 1; t <= grace; t++) {
      s.tick = t;
      triggerFateBeats(s);
      expect(beat.status).toBe('PENDING');
      expect(beat.plannedTick).toBe(t + 1); // deferred one month each time
    }
    s.tick = 1 + grace; // past window[1] + grace
    triggerFateBeats(s);
    expect(beat.status).toBe('LOST');
  });

  it('max one beat fires per tick; the runner-up defers a month', () => {
    const s = createNewGame({ seed: 1, name: 'T' });
    const mk = (key: string, eventId: string, i: number) => ({
      key, eventId, window: [1, 1] as [number, number], plannedTick: 1,
      requires: [], personal: true, status: 'PENDING' as const,
    });
    s.fate!.beats = [mk('sz_omen', 'fate_sz_omen', 0), mk('sz_firsat', 'fate_sz_firsat', 1)];
    s.tick = 1;
    triggerFateBeats(s);
    expect(s.fate!.beats[0].status).toBe('FIRED');
    expect(s.fate!.beats[1].status).toBe('PENDING');
    expect(s.fate!.beats[1].plannedTick).toBe(2);
    s.pendingEvents = [];
    s.tick = 2;
    triggerFateBeats(s);
    expect(s.fate!.beats[1].status).toBe('FIRED');
  });

  it('a LOST requirement kills the dependent beat', () => {
    const s = createNewGame({ seed: 1, name: 'R' });
    s.fate!.beats = [
      { key: 'a', eventId: 'fate_sz_omen', window: [1, 1], plannedTick: 1, requires: [], personal: true, status: 'LOST' },
      { key: 'b', eventId: 'fate_sz_firsat', window: [1, 1], plannedTick: 1, requires: ['a'], personal: true, status: 'PENDING' },
    ];
    s.tick = 1;
    triggerFateBeats(s);
    expect(s.fate!.beats[1].status).toBe('LOST');
    expect(s.pendingEvents.length).toBe(0);
  });

  it('pre-reveal fired beats count as omens', () => {
    const s = createNewGame({ seed: 1, name: 'O' });
    s.fate!.revealAtTick = 50;
    s.fate!.beats = [
      { key: 'sz_omen', eventId: 'fate_sz_omen', window: [1, 1], plannedTick: 1, requires: [], personal: true, status: 'PENDING' },
    ];
    s.tick = 1;
    triggerFateBeats(s);
    expect(s.fate!.omenCount).toBe(1);
    expect(s.fate!.revealedTick).toBe(-1);
  });

  it('reveal + beat due the same tick: both enqueue (reveal outside the quota)', () => {
    const s = createNewGame({ seed: 1, name: 'Q', answers: GOC });
    s.fate!.revealAtTick = 3;
    s.fate!.beats = [
      { key: 'gk_yola_cikis', eventId: 'fate_gk_yola_cikis', window: [3, 3], plannedTick: 3, requires: [], personal: true, status: 'PENDING' },
      { key: 'gk_dolar_hissi', eventId: 'fate_gk_dolar_hissi', window: [3, 3], plannedTick: 3, requires: [], personal: true, status: 'PENDING' },
    ];
    s.tick = 3;
    triggerFateBeats(s);
    const ids = s.pendingEvents.map((e) => e.eventId);
    // the reveal never eats the one-beat-per-tick quota; the runner-up defers
    expect(ids).toContain('fate_reveal_gurbet_kusu');
    expect(ids.filter((i) => i !== 'fate_reveal_gurbet_kusu').length).toBe(1);
  });

  it('veiled destinies reveal before any beat can fire', () => {
    let checked = 0;
    for (let seed = 1; seed <= 400 && checked < 25; seed++) {
      const s = createNewGame({ seed: seed * 7 + 1, name: 'N', answers: [2, 0, 3, -1, -1] });
      if (s.fate!.destinyId !== 'nazarli_servet') continue;
      checked++;
      expect(s.fate!.revealAtTick).toBeLessThanOrEqual(30);
      expect(Math.min(...s.fate!.beats.map((b) => b.plannedTick))).toBeGreaterThanOrEqual(30);
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('non-choice beats log with a ☾-grade uid and backfilled net worth', () => {
    let s = createNewGame({ seed: 1, name: 'L' });
    s.fate!.revealAtTick = -1;
    s.fate!.beats = [
      { key: 'sz_omen', eventId: 'fate_sz_omen', window: [1, 1], plannedTick: 1, requires: [], personal: true, status: 'PENDING' },
    ];
    s = applyAction(s, { type: 'NEXT_MONTH' });
    const entry = s.eventLog.find((e) => e.eventId === 'fate_sz_omen');
    expect(entry).toBeDefined();
    expect(entry!.uid).toMatch(/^1:fate_sz_omen:f0$/);
    expect(entry!.netWorth).toBeGreaterThan(0); // backfilled by phase 5
  });
});

describe('fate options (RESOLVE_EVENT seam)', () => {
  it('cashDelta, health, flags and counters all apply on resolve', () => {
    let s = createNewGame({ seed: 1, name: 'F' });
    s.world = null; // fate-isolation: keep the queue free of world-agenda events
    s.fate!.beats = [
      { key: 'ns_parlak_firsat', eventId: 'fate_ns_parlak_firsat', window: [1, 1], plannedTick: 1, requires: [], personal: true, status: 'PENDING' },
    ];
    s.fate!.revealAtTick = -1;
    s = applyAction(s, { type: 'NEXT_MONTH' });
    const uid = s.pendingEvents.find((e) => e.eventId === 'fate_ns_parlak_firsat')!.uid;
    const cashBefore = s.cash;
    s = applyAction(s, { type: 'RESOLVE_EVENT', uid, optionIndex: 1 }); // dağıt: +8k, sadaka +1
    expect(s.cash - cashBefore).toBeCloseTo(8_000, 2);
    expect(s.fate!.counters.sadaka).toBe(1);
  });

  it('modShift clamps at MOD_CLAMP and reveal stamps revealedTick', () => {
    let s = createNewGame({ seed: 1, name: 'S' });
    s.world = null; // fate-isolation: keep the queue free of world-agenda events
    s.fate!.beats = [
      { key: 'ns_agir_hastalik', eventId: 'fate_ns_agir_hastalik', window: [1, 1], plannedTick: 1, requires: [], personal: true, status: 'PENDING' },
    ];
    s.fate!.revealAtTick = -1;
    s.fate!.mods.illness = 1.5; // already at the clamp ceiling
    s = applyAction(s, { type: 'NEXT_MONTH' });
    const uid = s.pendingEvents.find((e) => e.eventId === 'fate_ns_agir_hastalik')!.uid;
    s = applyAction(s, { type: 'RESOLVE_EVENT', uid, optionIndex: 1 }); // katlan: illness +0.1 → clamped 1.5
    expect(s.fate!.mods.illness).toBe(1.5);
    expect(s.fate!.flags.nazar_kirildi).toBeUndefined();
  });
});

describe('fate content wiring (no dead boons)', () => {
  const synth = (key: string, eventId: string, plannedTick = 1): FateBeatState => ({
    key, eventId, window: [plannedTick, 300] as [number, number],
    plannedTick, requires: [], personal: true, status: 'PENDING' as const,
  });

  /** Fire a synthetic beat through a real NEXT_MONTH and resolve one option.
   *  `before` is captured with the fate event at the head of the queue, so
   *  costPctNetWorth assertions see the same net worth the resolve sees. */
  const fireAndResolve = (key: string, eventId: string, option: number, arm?: (s: GameState) => void) => {
    let s = createNewGame({ seed: 2, name: 'W' });
    s.fate!.beats = [synth(key, eventId, 1)];
    s.fate!.revealAtTick = -1;
    arm?.(s); // satisfy the def's condition (flags/counters), if it has one
    s.player.health = 70; // headroom for healthDelta up-gains (clamp at 100)
    s = applyAction(s, { type: 'NEXT_MONTH' });
    s = drainUntil(s, (e) => e.eventId === eventId);
    const ev = s.pendingEvents.find((e) => e.eventId === eventId);
    if (!ev) throw new Error(`${eventId} did not fire (condition false)`);
    const before = {
      cash: s.cash, health: s.player.health, worth: netWorth(s),
      fee: s.fate!.mods.fee, illness: s.fate!.mods.illness,
    };
    s = applyAction(s, { type: 'RESOLVE_EVENT', uid: ev.uid, optionIndex: option });
    return { s, before };
  };

  it('sz_kazanc reads the partnership counter: fires at sz_ortak ≥ 1, defers at 0', () => {
    const bare = createNewGame({ seed: 1, name: 'W' });
    bare.fate!.beats = [synth('sz_kazanc', 'fate_sz_kazanc', 1)];
    bare.fate!.revealAtTick = -1;
    bare.tick = 1;
    triggerFateBeats(bare);
    expect(bare.fate!.beats[0].status).toBe('PENDING'); // no hırs, no ortak → defers

    bare.fate!.counters.sz_ortak = 1;
    bare.tick = 2; // the first attempt deferred plannedTick to 2
    triggerFateBeats(bare);
    expect(bare.fate!.beats[0].status).toBe('FIRED'); // the partner pays off
  });

  it('ky_huzur requires the ongoing partnership (ky_ortak AND ky_devam ≥ 1)', () => {
    const s = createNewGame({ seed: 1, name: 'W' });
    s.fate!.beats = [synth('ky_huzur', 'fate_ky_huzur', 1)];
    s.fate!.revealAtTick = -1;
    s.fate!.flags.ky_ortak = true; // entered the shop…
    s.tick = 1;
    triggerFateBeats(s);
    expect(s.fate!.beats[0].status).toBe('PENDING'); // …but never stayed → defers

    s.fate!.counters.ky_devam = 1;
    s.tick = 2; // the first attempt deferred plannedTick to 2
    triggerFateBeats(s);
    expect(s.fate!.beats[0].status).toBe('FIRED');
  });

  it('ns_parlak_firsat opt0: 5% offering buys a real fee cut', () => {
    const { s, before } = fireAndResolve('ns_parlak_firsat', 'fate_ns_parlak_firsat', 0);
    expect(s.cash - before.cash).toBeCloseTo(-0.05 * before.worth, 1); // costPctNetWorth
    expect(s.fate!.mods.fee).toBeCloseTo(before.fee - 0.05, 6); // the craft stays
  });

  it('ns_parlak_firsat opt1: +8k and the eye softens (illness −0.05)', () => {
    const { s, before } = fireAndResolve('ns_parlak_firsat', 'fate_ns_parlak_firsat', 1);
    expect(s.cash - before.cash).toBeCloseTo(8_000, 2);
    expect(s.fate!.mods.illness).toBeCloseTo(before.illness - 0.05, 6);
    expect(s.fate!.counters.sadaka).toBe(1);
  });

  it('gk_altin_gunu opt1: +5k AND health +8 — a real alternative to the 10k', () => {
    const { s, before } = fireAndResolve('gk_altin_gunu', 'fate_gk_altin_gunu', 1, (g) => {
      g.fate!.counters.gonderi = 1; // sent money home (gk_yola_cikis opt0)
      g.fate!.flags.altin_gunu = true; // heeded the advice (gk_dolar_hissi opt0)
    });
    expect(s.cash - before.cash).toBeCloseTo(5_000, 2);
    expect(s.player.health - before.health).toBeCloseTo(8, 5);
  });
});

describe('fate × inheritance', () => {
  it('fateOnInherit consumes exactly one fate draw', () => {
    const s = createNewGame({ seed: 1, name: 'I' });
    const twin = JSON.parse(JSON.stringify(s)) as GameState;
    const before = s.fate!.rng.s;
    fateOnInherit(s.fate!);
    nextFloat(twin.fate!.rng);
    expect(s.fate!.rng.s).toBe(twin.fate!.rng.s);
    expect(s.fate!.rng.s).not.toBe(before);
  });

  it('personal beats are LOST, dynastic beats roll to the heir, mods reset', () => {
    const s = createNewGame({ seed: 13, name: 'K', answers: GOC });
    s.fate!.mods = { ...s.fate!.mods, fee: 0.9, illness: 1.3 };
    const geri = s.fate!.beats.find((b) => b.key === 'gk_geri_donus')!;
    geri.status = 'PENDING';
    const yola = s.fate!.beats.find((b) => b.key === 'gk_yola_cikis')!;
    yola.status = 'PENDING';
    // a personal beat: the founder's lost love (armed answer beat)
    const kayip: FateBeatState = {
      key: 'ka_kayip_ask', eventId: 'fate_ka_kayip_ask', window: [60, 120],
      plannedTick: 100, requires: [], personal: true, status: 'PENDING',
    };
    s.fate!.beats.push(kayip);
    const revealed = s.fate!.revealedTick;
    fateOnInherit(s.fate!);
    expect(kayip.status).toBe('LOST'); // personal: true — dies with the founder
    expect(geri.status).toBe('PENDING'); // unmarked → dynastic (design §10.2)
    expect(yola.status).toBe('PENDING'); // unmarked → dynastic
    expect(s.fate!.mods).toEqual({
      illness: 1, death: 1, marriage: 1, birth: 1, spouse: 1, child: 1,
      livingCost: 1, estateTax: 1, fee: 1,
    });
    expect(s.fate!.revealedTick).toBe(revealed);
  });

  it('the dynastic default is snapshot-correct: only ka_kayip_ask is personal', () => {
    const kayip = createNewGame({ seed: 5, name: 'P', answers: [-1, -1, 2, -1, -1] });
    const ka = kayip.fate!.beats.find((b) => b.key === 'ka_kayip_ask');
    expect(ka?.personal).toBe(true);
    for (const seed of [1, 7, 42]) {
      const s = createNewGame({ seed, name: 'P', answers: GOC });
      for (const b of s.fate!.beats) expect(b.personal).toBe(false); // surname-bound
    }
  });

  it('heir health bias: curse weighs, upbringing lifts, neutral stays 80', () => {
    const orig = JSON.parse(JSON.stringify(balance)) as typeof balance;
    balance.DEATH.BASE = 1;
    balance.ILLNESS.BASE = 0;
    const kill = (illness: number, upbringing: boolean, seed: number, answers?: number[]) => {
      let s = createNewGame({ seed, name: 'H', answers });
      s.fate!.mods.illness = illness;
      if (upbringing) s.fate!.flags.heir_upbringing = true;
      s.player.children.push({ id: 'heir', birthTick: s.tick - 24, alive: true });
      s = applyAction(s, { type: 'NEXT_MONTH' });
      s = drainUntil(s, (e) => e.eventId === 'death');
      const death = s.pendingEvents.find((e) => e.eventId === 'death')!;
      return applyAction(s, { type: 'ACK_EVENT', uid: death.uid });
    };
    try {
      expect(kill(1, false, 21).player.health).toBe(80);
      expect(kill(1.4, false, 22).player.health).toBe(50); // 80 × 0.6 = 48 → clamped
      expect(kill(0.9, false, 23).player.health).toBeCloseTo(88, 5);
      expect(kill(1, true, 24, [2, -1, 3, -1, -1]).player.health).toBe(85); // varlıklı upbringing
    } finally {
      Object.assign(balance.DEATH, orig.DEATH);
      Object.assign(balance.ILLNESS, orig.ILLNESS);
    }
  });

  it('the founder estate tax honors the fate mod (varlıklı upbringing)', () => {
    const orig = JSON.parse(JSON.stringify(balance)) as typeof balance;
    balance.DEATH.BASE = 1;
    balance.ILLNESS.BASE = 0;
    try {
      let s = createNewGame({ seed: 9, name: 'V', answers: [2, -1, 3, -1, -1] }); // varlıklı + temiz
      s = applyAction(s, { type: 'NEXT_MONTH' });
      s = drainUntil(s, (e) => e.eventId === 'death');
      const death = s.pendingEvents.find((e) => e.eventId === 'death')!;
      const worthAtDeath = s.cash;
      s = applyAction(s, { type: 'ACK_EVENT', uid: death.uid });
      // 15% × 1.25 = 18.75% (plus the unavoidable month of living costs → allow slop)
      const tax = (worthAtDeath - s.cash) / worthAtDeath;
      expect(tax).toBeGreaterThan(0.17);
      expect(tax).toBeLessThan(0.2);
    } finally {
      Object.assign(balance.DEATH, orig.DEATH);
      Object.assign(balance.ILLNESS, orig.ILLNESS);
    }
  });
});

describe('fate migration & replay', () => {
  it('a v1 state migrates losslessly and keeps playing deterministically (fate inert)', () => {
    const initial = createNewGame({ seed: 31337, name: 'V1', answers: GOC });
    // hand-strip to a v1 shape: no fate/assets/properties/world/expenses/home/income fields, schemaVersion 1
    const v1 = JSON.parse(JSON.stringify(initial)) as GameState;
    delete (v1 as Partial<GameState>).fate;
    delete (v1 as Partial<GameState>).assets;
    delete (v1 as Partial<GameState>).properties;
    delete (v1 as Partial<GameState>).world;
    delete (v1 as Partial<GameState>).expenses;
    delete (v1 as Partial<GameState>).home;
    delete (v1 as Partial<GameState>).pendingSales;
    delete (v1 as Partial<GameState>).income;
    delete (v1 as Partial<GameState>).residency;
    (v1 as { schemaVersion: number }).schemaVersion = 1;

    // migration adds inert fields only: version 8, fate null, assets null, properties {}, world null, expenses null, home null, pendingSales [], income null, residency null
    const migrated = replay(v1, []);
    expect(migrated.schemaVersion).toBe(8);
    expect(migrated.fate).toBeNull();
    expect(migrated.assets).toBeNull();
    expect(migrated.properties).toEqual({});
    expect(migrated.world).toBeNull();
    expect(migrated.expenses).toBeNull();
    expect(migrated.home).toBeNull();
    expect(migrated.pendingSales).toEqual([]);
    expect(migrated.income).toBeNull();
    expect(migrated.residency).toBeNull();
    const v1Plus = { ...JSON.parse(JSON.stringify(v1)), schemaVersion: 8, fate: null, assets: null, properties: {}, world: null, expenses: null, pendingSales: [], home: null, income: null, residency: null }; // key order = migrateState's
    expect(JSON.stringify(migrated)).toBe(JSON.stringify(v1Plus));

    // the honest parity contract: a log generated by LIVE play on the raw v1
    // state (pre-migration) must replay bit-for-bit — applyAction normalizes
    // on entry, so step-by-step play and replay() both run fate-null/assets-null
    const { final, actions } = runMonths(v1, 36);
    const replayed = replay(v1, actions);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(final));
    expect(final.schemaVersion).toBe(8); // live play normalized too
    expect(final.fate).toBeNull(); // still inert after 3 years
    expect(final.assets).toBeNull(); // the asset layer never self-activates
    expect(final.world).toBeNull(); // the world layer never self-activates
    expect(final.expenses).toBeNull(); // the expense layer never self-activates
    expect(final.home).toBeNull(); // the Yuva layer never self-activates
    expect(final.income).toBeNull(); // the income layer never self-activates
    expect(final.residency).toBeNull(); // the residency layer never self-activates
  });

  it('CHOSEN runs replay bit-for-bit, fate rng included', () => {
    const initial = createNewGame({ seed: 8080, name: 'R', answers: [0, 0, 2, 0, 0] });
    const { final, actions } = runMonths(initial, 60);
    const replayed = replay(initial, actions);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(final));
  });

  it('multi-generation runs replay bit-for-bit across handovers', () => {
    const orig = JSON.parse(JSON.stringify(balance)) as typeof balance;
    balance.DEATH.BASE = 0.02; // short lives → the heir takes the helm mid-arc
    balance.INHERIT.HEIR_HEALTH = 100;
    try {
      const initial = createNewGame({ seed: 5, name: 'Dyn', answers: GOC });
      // guarantee an heir so the founder's death hands over instead of ending
      // the dynasty (the push precedes every logged action — replay-safe)
      initial.player.children.push({ id: 'heir0', birthTick: initial.tick - 24, alive: true });
      let s = initial;
      const actions: EngineAction[] = [];
      for (let t = 0; t < 400 && s.status === 'PLAYING'; t++) {
        s = applyAction(s, { type: 'NEXT_MONTH' });
        actions.push({ type: 'NEXT_MONTH' });
        let guard = 0;
        while (s.pendingEvents.length > 0 && guard < 50) {
          guard++;
          const head = s.pendingEvents[0];
          const a: EngineAction = head.hasChoice
            ? { type: 'RESOLVE_EVENT', uid: head.uid, optionIndex: 0 }
            : { type: 'ACK_EVENT', uid: head.uid };
          s = applyAction(s, a);
          actions.push(a);
        }
      }
      expect(s.player.generation).toBeGreaterThan(1); // at least one handover
      expect(JSON.stringify(replay(initial, actions))).toBe(JSON.stringify(s));
    } finally {
      Object.assign(balance.DEATH, orig.DEATH);
      Object.assign(balance.INHERIT, orig.INHERIT);
    }
  });
});

describe('fate soak (reduced)', () => {
  it('300 seeds × 240 months: no NaN, beats well-formed, pacing holds', () => {
    const destinySeen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const answers = seed % 3 === 0 ? GOC : seed % 3 === 1 ? NEUTRAL : [0, 0, 2, 1, 0];
      const { final } = runMonths(createNewGame({ seed: seed * 31 + 7, name: 'S', answers }), 240);
      const f = final.fate!;
      expect(f).not.toBeNull();
      destinySeen.add(f.destinyId);
      expect(Number.isFinite(final.cash)).toBe(true);
      for (const b of f.beats) {
        expect(['PENDING', 'FIRED', 'LOST']).toContain(b.status);
        expect(Number.isInteger(b.plannedTick)).toBe(true);
      }
      // uid uniqueness across the whole run
      const uids = new Set(final.eventLog.map((e) => e.uid));
      expect(uids.size).toBe(final.eventLog.length);
    }
    // RANDOM path reaches several destinies
    expect(destinySeen.size).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('the fight path is real: nazarli runs can break the curse', () => {
    // force the destiny by seeding until nazarli_servet comes up on the neutral path
    let broken = 0;
    let nazarRuns = 0;
    for (let seed = 1; seed <= 120 && nazarRuns < 25; seed++) {
      const initial = createNewGame({ seed: seed * 17 + 3, name: 'N', answers: [2, 0, 3, -1, -1] });
      if (initial.fate!.destinyId !== 'nazarli_servet') continue;
      nazarRuns++;
      // opt for treatment (option 0 of ns_agir_hastalik) whenever it appears
      const { final } = runMonths(initial, 220, (eventId) => (eventId === 'fate_ns_agir_hastalik' ? 0 : 0));
      if (final.fate!.flags.nazar_kirildi) broken++;
    }
    expect(nazarRuns).toBeGreaterThanOrEqual(5);
    expect(broken).toBeGreaterThanOrEqual(Math.ceil(nazarRuns * 0.25));
  }, 120_000);
});

describe('fate content lint', () => {
  it('beat keys are globally unique', () => {
    const keys = [...FATE_CATALOG.flatMap((d) => d.beats), ...ANSWER_BEATS].map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every beat eventId and variant resolves to a FATE event def', () => {
    for (const b of [...FATE_CATALOG.flatMap((d) => d.beats), ...ANSWER_BEATS]) {
      const ids = [b.eventId, ...(b.variants ?? [])];
      for (const id of ids) {
        expect(() => eventDef(id)).not.toThrow();
        expect(eventDef(id).trigger).toBe('FATE');
      }
    }
  });

  it('every destiny reveal event resolves', () => {
    for (const d of FATE_CATALOG) {
      expect(() => eventDef(fateRevealEventId(d.id))).not.toThrow();
    }
  });

  it('windows are valid and requires keys exist', () => {
    const allKeys = new Set([...FATE_CATALOG.flatMap((d) => d.beats), ...ANSWER_BEATS].map((b) => b.key));
    for (const b of [...FATE_CATALOG.flatMap((d) => d.beats), ...ANSWER_BEATS]) {
      expect(b.window[0]).toBeGreaterThanOrEqual(0);
      expect(b.window[0]).toBeLessThanOrEqual(b.window[1]);
      for (const r of b.requires ?? []) expect(allKeys.has(r)).toBe(true);
    }
    for (const d of FATE_CATALOG) {
      expect(d.revealWindow[0]).toBeLessThanOrEqual(d.revealWindow[1]);
    }
  });

  it('FATE events are player-scoped only: no world effects, capped cashDelta', () => {
    for (const e of FATE_CATALOG.flatMap((d) => d.beats).map((b) => eventDef(b.eventId))) {
      expect(e.scope).toBe('GLOBAL');
      expect(e.trigger).toBe('FATE');
      expect(e.effects).toEqual([]);
      for (const o of e.options ?? []) {
        expect(o.effects).toEqual([]);
        if (o.cashDelta !== undefined) {
          expect(Math.abs(o.cashDelta)).toBeLessThanOrEqual(balance.FATE.CASH_DELTA_CAP);
        }
      }
    }
  });

  it('answerWeights keys are real answer keys or flags', () => {
    const tokens = new Set<string>();
    for (const q of FATE_QUESTIONS) {
      expect(q.options.length).toBeGreaterThanOrEqual(3);
      expect(q.options.length).toBeLessThanOrEqual(4);
      for (const o of q.options) {
        tokens.add(o.key);
        for (const f of o.flags ?? []) tokens.add(f);
      }
    }
    for (const d of FATE_CATALOG) {
      for (const k of Object.keys(d.answerWeights ?? {})) {
        expect(tokens.has(k)).toBe(true);
      }
    }
  });

  it('armBeats reference existing answer beats', () => {
    const answerKeys = new Set(ANSWER_BEATS.map((b) => b.key));
    for (const q of FATE_QUESTIONS) {
      for (const o of q.options) {
        for (const k of o.armBeats ?? []) expect(answerKeys.has(k)).toBe(true);
      }
    }
  });

  it('≥3 destinies are reachable from the neutral path', () => {
    // neutral = no answer flags: requireAll is trivially unsatisfied for
    // gated destinies, requireNone never blocks
    const reachable = FATE_CATALOG.filter((d) => (d.requireAll ?? []).length === 0);
    expect(reachable.length).toBeGreaterThanOrEqual(3);
  });

  it('v6 asset-hooked beats stay invisible to RANDOM runs — creation draws stay neutral', () => {
    // The rule that keeps the legacy goldens immovable: asset-hooked kader
    // content may only ride requireAll-locked destinies. RANDOM creations
    // carry none of the answer flags, so those destinies are never eligible —
    // their beat jitters can never shift the fate stream and '1b9d3a91' stays
    // put without conscious bumps. Hooking an UNLOCKED destiny breaks this.
    const ASSET_HOOKED = new Set(['fate_gk_memleket_evi', 'fate_ab_tarla_rehni']);
    for (const d of FATE_CATALOG) {
      if (d.beats.some((b) => ASSET_HOOKED.has(b.eventId))) {
        expect((d.requireAll ?? []).length, d.id).toBeGreaterThan(0);
      }
    }
    for (let seed = 1; seed <= 100; seed++) {
      const s = createNewGame({ seed, name: 'N' });
      expect(s.fate!.destinyId).not.toBe('gurbet_kusu');
      expect(s.fate!.destinyId).not.toBe('aile_borcu');
    }
  });
});

describe('fate × v6 asset hooks (M3 Yuva content)', () => {
  const synth = (key: string, eventId: string, plannedTick = 1): FateBeatState => ({
    key, eventId, window: [plannedTick, 300] as [number, number],
    plannedTick, requires: [], personal: true, status: 'PENDING' as const,
  });
  const withFarm = (s: GameState): void => {
    s.properties.farm = { classId: 'farm', units: 1, avgCost: 100_000, firstBuyTick: 0, rentCollected: 0 };
  };

  /** Fire a synthetic beat through a real NEXT_MONTH and resolve one option
   *  (the content-wiring pattern above, with the livingCost mod tracked). */
  const fireAndResolve = (key: string, eventId: string, option: number, arm?: (s: GameState) => void) => {
    let s = createNewGame({ seed: 2, name: 'M3' });
    s.fate!.beats = [synth(key, eventId, 1)];
    s.fate!.revealAtTick = -1;
    arm?.(s);
    s.player.health = 70;
    s = applyAction(s, { type: 'NEXT_MONTH' });
    s = drainUntil(s, (e) => e.eventId === eventId);
    const ev = s.pendingEvents.find((e) => e.eventId === eventId);
    if (!ev) throw new Error(`${eventId} did not fire (condition false)`);
    const before = {
      cash: s.cash, health: s.player.health, worth: netWorth(s),
      livingCost: s.fate!.mods.livingCost,
    };
    s = applyAction(s, { type: 'RESOLVE_EVENT', uid: ev.uid, optionIndex: option });
    return { s, before };
  };

  it('gk_memleket_evi opt0: the deed lands, 4% charged on the pre-grant worth', () => {
    const { s, before } = fireAndResolve('gk_memleket_evi', 'fate_gk_memleket_evi', 0);
    expect(s.cash - before.cash).toBeCloseTo(-0.04 * before.worth, 1); // costPctNetWorth
    expect(s.properties.house?.units ?? 0).toBe(1); // the memleket deed
    expect(s.fate!.flags.memleket_evi).toBe(true);
    expect(s.eventLog.some((e) => e.eventId === 'asset_granted')).toBe(true);
  });

  it('gk_memleket_evi opt1: refusing keeps pockets and deeds untouched', () => {
    const { s, before } = fireAndResolve('gk_memleket_evi', 'fate_gk_memleket_evi', 1);
    expect(s.properties.house).toBeUndefined();
    expect(s.cash).toBe(before.cash);
    expect(s.fate!.flags.memleket_evi).toBeUndefined();
  });

  it('ab_tarla_rehni opt0: the farm is seized, the debt closes, no cash moves', () => {
    const { s, before } = fireAndResolve('ab_tarla_rehni', 'fate_ab_tarla_rehni', 0, withFarm);
    expect(s.properties.farm).toBeUndefined(); // tapu gider
    expect(s.cash).toBe(before.cash); // the land pays, not the wallet
    expect(s.fate!.flags.borc_kapali).toBe(true);
    expect(s.eventLog.some((e) => e.eventId === 'asset_taken')).toBe(true);
  });

  it('ab_tarla_rehni opt1: paying 10% keeps the land and closes the debt', () => {
    const { s, before } = fireAndResolve('ab_tarla_rehni', 'fate_ab_tarla_rehni', 1, withFarm);
    expect(s.cash - before.cash).toBeCloseTo(-0.1 * before.worth, 1);
    expect(s.properties.farm?.units).toBe(1); // the land stays
    expect(s.fate!.flags.borc_kapali).toBe(true);
  });

  it('ab_tarla_rehni opt2: holding out costs health and raises living costs — the debt lives', () => {
    const { s, before } = fireAndResolve('ab_tarla_rehni', 'fate_ab_tarla_rehni', 2, withFarm);
    expect(s.player.health - before.health).toBeCloseTo(-5, 5);
    expect(s.fate!.mods.livingCost).toBeCloseTo(before.livingCost + 0.1, 6);
    expect(s.properties.farm?.units).toBe(1);
    expect(s.fate!.flags.borc_kapali).toBeUndefined(); // miras_agirlığı still looms
  });

  it('ab_tarla_rehni only visits owing landowners: defers deedless, defers once paid', () => {
    const s = createNewGame({ seed: 1, name: 'G' });
    s.fate!.beats = [synth('ab_tarla_rehni', 'fate_ab_tarla_rehni', 1)];
    s.fate!.revealAtTick = -1;
    s.tick = 1;
    triggerFateBeats(s);
    expect(s.fate!.beats[0].status).toBe('PENDING'); // no tarla deed → defers

    withFarm(s);
    s.tick = 2; // the first attempt deferred plannedTick to 2
    triggerFateBeats(s);
    expect(s.fate!.beats[0].status).toBe('FIRED'); // landowner → the rehinci calls

    const closed = createNewGame({ seed: 1, name: 'C' });
    closed.fate!.beats = [synth('ab_tarla_rehni', 'fate_ab_tarla_rehni', 1)];
    closed.fate!.revealAtTick = -1;
    closed.fate!.flags.borc_kapali = true; // settled earlier (mektup/tahsilat)
    withFarm(closed);
    closed.tick = 1;
    triggerFateBeats(closed);
    expect(closed.fate!.beats[0].status).toBe('PENDING'); // debt closed → never comes
  });

  it('CHOSEN snapshots carry the new beats as dynastic threads inside their windows', () => {
    const gk = createNewGame({ seed: 7, name: 'G', answers: GOC });
    const evi = gk.fate!.beats.find((b) => b.key === 'gk_memleket_evi')!;
    expect(evi.window).toEqual([36, 96]);
    expect(evi.personal).toBe(false); // the memleket house rolls to the heir

    const ab = createNewGame({ seed: 7, name: 'B', answers: BORC });
    const reh = ab.fate!.beats.find((b) => b.key === 'ab_tarla_rehni')!;
    expect(reh.window).toEqual([48, 96]);
    expect(reh.personal).toBe(false);
  });
});
