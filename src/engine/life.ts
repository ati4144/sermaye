import { balance } from './balance';
import { enqueueLifeEvent } from './events/apply';
import { fateHazard, fateOnInherit } from './fate/tick';
import { clamp, liquidateToRaise, netWorth } from './market';
import { nextFloat, weightedIndex } from './rng';
import type { RngState } from './rng';
import type { GameState, Player } from './types';

export function ageYears(s: GameState, p: Player = s.player): number {
  return Math.floor((s.tick - p.birthTick) / 12);
}

/**
 * Phase 3 — the player's life. Draw order is FIXED and unconditional draws
 * come before branching (draw-then-decide): changing family state must never
 * shift the RNG stream for the world.
 *
 *  1. marriage draw (always)
 *  2. birth draw (always)
 *  3. illness draw; if ill → severity draw
 *  4. death draw
 *  5. spouse mortality draw (always; discarded when unmarried)
 *  6. one child-mortality draw per alive child (birth order)
 *
 * Fate multiplies the comparison side only (fateHazard) — the draw slots are
 * untouched, so the stream shape never forks on destiny.
 */
export function liveLife(s: GameState, rng: RngState): void {
  const age = ageYears(s);
  const p = s.player;

  // --- health dynamics ---
  let decay = 0;
  if (age > balance.HEALTH.DECAY_START_AGE) {
    decay = (balance.HEALTH.DECAY_PER_MONTH * (age - balance.HEALTH.DECAY_START_AGE)) / 10;
  }
  p.health = clamp(p.health - decay, 0, 100);

  // --- marriage (informational choice event; state set on RESOLVE) ---
  const marriageDraw = nextFloat(rng);
  if (
    !p.married &&
    age >= balance.FAMILY.MARRIAGE_MIN_AGE &&
    age <= balance.FAMILY.MARRIAGE_MAX_AGE &&
    marriageDraw < fateHazard(s, balance.FAMILY.MARRIAGE_P, 'marriage')
  ) {
    enqueueLifeEvent(s, 'marriage', true);
  }

  // --- eve çıkma (v6) — the 6th month after a wedding asks the couple to
  // move out. Exact-tick `=== 6` fires structurally once (marriedTick re-stamps
  // on a later wedding); the lifeFlag is the belt-and-suspenders dedupe. Home
  // layer null (every legacy run) keeps the exact v5 path — zero draws. ---
  if (
    s.home !== null &&
    p.married &&
    p.marriedTick !== undefined &&
    s.tick - p.marriedTick === 6 &&
    p.lifeFlags?.eve_cikti !== true
  ) {
    p.lifeFlags = { ...p.lifeFlags, eve_cikti: true };
    enqueueLifeEvent(s, 'eve_cikma', true);
  }

  // --- childbirth ---
  const birthDraw = nextFloat(rng);
  if (
    p.married &&
    age <= balance.FAMILY.BIRTH_MAX_AGE &&
    p.children.length < balance.FAMILY.MAX_CHILDREN &&
    birthDraw < fateHazard(s, balance.FAMILY.BIRTH_P, 'birth')
  ) {
    p.children.push({ id: `c${s.tick}`, birthTick: s.tick, alive: true });
    enqueueLifeEvent(s, 'child_born', false);
  }

  // --- illness ---
  const illnessDraw = nextFloat(rng);
  let pIllness = balance.ILLNESS.BASE;
  if (age > balance.ILLNESS.AGE_FROM) {
    const d = age - balance.ILLNESS.AGE_FROM;
    pIllness += balance.ILLNESS.AGE_FACTOR * d * d;
  }
  if (illnessDraw < fateHazard(s, pIllness, 'illness')) {
    const severity = weightedIndex(rng, balance.ILLNESS.SEVERITY_WEIGHTS);
    enqueueLifeEvent(s, ['illness_mild', 'illness_moderate', 'illness_severe'][severity], true);
  }

  // --- death ---
  const deathDraw = nextFloat(rng);
  let pDeath = balance.DEATH.BASE;
  if (age > balance.DEATH.AGE_FROM) {
    const d = age - balance.DEATH.AGE_FROM;
    pDeath += balance.DEATH.AGE_FACTOR * d * d;
  }
  if (p.health < balance.DEATH.LOW_HEALTH_THRESHOLD) {
    pDeath += balance.DEATH.LOW_HEALTH_PENALTY;
  }
  if (deathDraw < fateHazard(s, pDeath, 'death')) {
    p.health = 0;
    p.alive = false;
    s.status = 'DECEASED';
    enqueueLifeEvent(s, 'death', false);
  }

  // --- spouse mortality (draw always; discarded when unmarried) ---
  const spouseDraw = nextFloat(rng);
  if (p.married && spouseDraw < fateHazard(s, balance.FAMILY.SPOUSE_DEATH_P, 'spouse')) {
    p.married = false;
    enqueueLifeEvent(s, 'spouse_death', false);
  }

  // --- child mortality: one draw per alive child, birth order ---
  for (const c of p.children) {
    if (!c.alive) continue;
    const draw = nextFloat(rng);
    if (draw < fateHazard(s, balance.FAMILY.CHILD_DEATH_P, 'child')) {
      c.alive = false;
      enqueueLifeEvent(s, 'child_death', false);
    }
  }
}

/**
 * Death transition, performed when the player ACKs the death event (the UI
 * shows an inheritance screen in between). Estate tax is paid from liquid
 * assets first, then by forced liquidation. The eldest alive child becomes
 * the new player; no heirs ends the dynasty.
 */
export function performInheritance(s: GameState): void {
  // The estate tax belongs to the founder's fate (e.g. varlıklı upbringing);
  // capture it before the handover resets the founder-scoped mods.
  const founderEstateTax = s.fate?.mods.estateTax ?? 1;
  // Heir health bias (design §3): a curse-heavy founder fate weighs on the
  // heir's constitution, a gentle one blesses it (reflected around neutral 1);
  // the varlıklı upbringing flag gives a small head start. Illness mod only —
  // captured pre-reset, applied post-reset, zero draws.
  const founderIllnessMod = s.fate?.mods.illness ?? 1;
  const upbringingBonus = s.fate?.flags.heir_upbringing === true ? 5 : 0;
  const heirHealth = clamp(
    balance.INHERIT.HEIR_HEALTH * (2 - founderIllnessMod) + upbringingBonus,
    50,
    95,
  );

  // Fate first: one fixed fate-stream draw; personal beats die with the
  // founder, dynastic beats roll to the heir, founder mods reset to neutral.
  if (s.fate) fateOnInherit(s.fate);

  const heirs = s.player.children.filter((c) => c.alive).sort((a, b) => a.birthTick - b.birthTick);
  const worth = netWorth(s);
  s.peakNetWorth = Math.max(s.peakNetWorth, worth);

  const tax = Math.max(0, worth) * balance.INHERIT.ESTATE_TAX * founderEstateTax;
  // liquidateToRaise only ADDS the raised cash — the deduction is the
  // caller's job (same pairing as resolveEvent in actions.ts)
  if (tax > s.cash) liquidateToRaise(s, tax - s.cash);
  s.cash = Math.round((s.cash - tax) * 100) / 100;

  if (heirs.length === 0) {
    s.status = 'GAME_OVER_EXTINCT';
    return;
  }

  const heir = heirs[0];
  s.player = {
    generation: s.player.generation + 1,
    name: s.player.name, // family name persists
    birthTick: heir.birthTick,
    health: heirHealth,
    alive: true,
    married: false,
    children: [],
  };
  // v7: the heir is a new person with a new job — employment resets even if
  // the founder died unemployed (the health gate re-evaluates from heirHealth).
  // The salary itself persists through the dynasty (the family's station).
  if (s.income) s.income = { ...s.income, employed: true };
  s.status = 'PLAYING';
}
