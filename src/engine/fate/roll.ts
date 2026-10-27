import { balance } from '../balance';
import { netWorth, roundCash, clamp } from '../market';
import { createRng, nextFloat } from '../rng';
import type { FateBeatState, FateMods, FateState, GameState } from '../types';
import { ANSWER_BEATS, FATE_CATALOG, FATE_QUESTIONS, fateDefById } from './defs';

/**
 * Creation-time fate resolution. Draws ONLY from the private fate stream
 * (seeded by the single unconditional main-stream draw in create.ts), in a
 * fixed order:
 *
 *   1. destiny pick          — one draw (locked uniform, or clamped-weight walk)
 *   2. one jitter draw per saved beat  — destiny beats first, then armed
 *      answer beats (catalog order each)
 *   3. one variant draw per variant beat (saved-beat order)
 *   4. one reveal draw       — always consumed, even for destiny 'none'
 *
 * Mutates `s` with the answer-level starting deltas (cash/health) and resets
 * peakNetWorth to the post-delta net worth.
 */
export function rollFate(s: GameState, fateSeed: number, answers?: number[]): FateState {
  const normalized = normalizeAnswers(answers);

  // ---------- collect answer effects ----------
  const tokens = new Set<string>(); // answer keys + flags
  const flags: Record<string, true> = {};
  const armedKeys = new Set<string>();
  let cashTotal = 0;
  const mods: FateMods = {
    illness: 1, death: 1, marriage: 1, birth: 1, spouse: 1, child: 1,
    livingCost: 1, estateTax: 1, fee: 1,
  };
  const applyMods = (m: Partial<FateMods> | undefined): void => {
    if (!m) return;
    for (const k of Object.keys(m) as (keyof FateMods)[]) {
      mods[k] *= m[k] ?? 1;
    }
  };

  for (let i = 0; i < FATE_QUESTIONS.length; i++) {
    const a = normalized[i];
    if (a < 0) continue;
    const opt = FATE_QUESTIONS[i].options[a];
    tokens.add(opt.key);
    if (opt.flags) for (const f of opt.flags) { tokens.add(f); flags[f] = true; }
    if (opt.cashDelta !== undefined) cashTotal += opt.cashDelta;
    applyMods(opt.mods);
    if (opt.armBeats) for (const k of opt.armBeats) armedKeys.add(k);
  }

  const frng = createRng(fateSeed);

  // ---------- 1. destiny pick ----------
  const eligible = FATE_CATALOG.filter(
    (d) =>
      (d.requireAll ?? []).every((f) => tokens.has(f)) &&
      (d.requireNone ?? []).every((f) => !tokens.has(f)),
  );
  // hard-gated destinies whose requireAll is fully satisfied take priority —
  // the sır answer *guarantees* its thread (verifiable causality)
  const locked = eligible.filter((d) => (d.requireAll ?? []).length > 0);

  const pickDraw = nextFloat(frng);
  let destinyId = 'none';
  if (locked.length > 0) {
    destinyId = locked[Math.min(locked.length - 1, Math.floor(pickDraw * locked.length))].id;
  } else {
    const weights = eligible.map((d) => {
      let sway = 0;
      for (const t of tokens) sway += d.answerWeights?.[t] ?? 0;
      return clamp(d.weight + sway, balance.FATE.SWAY[0] * d.weight, balance.FATE.SWAY[1] * d.weight);
    });
    const totalW = weights.reduce((a, b) => a + b, 0);
    if (totalW > 0) {
      const x = pickDraw * totalW;
      let acc = 0;
      for (let i = 0; i < eligible.length; i++) {
        acc += weights[i];
        if (x < acc) { destinyId = eligible[i].id; break; }
      }
      if (destinyId === 'none') destinyId = eligible[eligible.length - 1].id; // x landed on the last sliver
    }
  }

  const dest = destinyId === 'none' ? undefined : fateDefById(destinyId);

  // ---------- 2. beat snapshots with jitter ----------
  const beatDefs = [...(dest?.beats ?? []), ...ANSWER_BEATS.filter((b) => armedKeys.has(b.key))];
  const beats: FateBeatState[] = beatDefs.map((bd) => {
    const draw = nextFloat(frng);
    const span = bd.window[1] - bd.window[0];
    // quadratic early-window bias via multiplication — no pow()
    const plannedTick = bd.window[0] + Math.floor(draw * draw * span);
    return {
      key: bd.key,
      eventId: bd.eventId,
      window: [bd.window[0], bd.window[1]] as [number, number],
      plannedTick,
      requires: bd.requires ? [...bd.requires] : [],
      personal: bd.personal === true, // default dynastic — the surname inherits the thread
      status: 'PENDING' as const,
    };
  });

  // ---------- 3. variant draws (in saved-beat order) ----------
  beatDefs.forEach((bd, i) => {
    if (!bd.variants || bd.variants.length === 0) return;
    const draw = nextFloat(frng);
    const vid = bd.variants[Math.min(bd.variants.length - 1, Math.floor(draw * bd.variants.length))];
    beats[i].eventId = vid;
  });

  // ---------- 4. reveal draw (always consumed) ----------
  const revealDraw = nextFloat(frng);
  const revealAtTick =
    dest !== undefined
      ? dest.revealWindow[0] + Math.floor(revealDraw * (dest.revealWindow[1] - dest.revealWindow[0] + 1))
      : -1;

  // ---------- start deltas & merged mods ----------
  cashTotal = clamp(cashTotal, -balance.FATE.START_CASH_CAP, balance.FATE.START_CASH_CAP);
  s.cash = roundCash(s.cash + cashTotal);
  if (dest?.start?.health !== undefined) {
    s.player.health = clamp(dest.start.health, 1, 100);
  }
  applyMods(dest?.mods);
  const [lo, hi] = balance.FATE.MOD_CLAMP;
  for (const k of Object.keys(mods) as (keyof FateMods)[]) {
    mods[k] = clamp(mods[k], lo, hi);
  }
  s.peakNetWorth = roundCash(netWorth(s));

  return {
    mode: normalized.some((a) => a >= 0) ? 'CHOSEN' : 'RANDOM',
    rng: frng,
    destinyId,
    answers: normalized,
    flags,
    mods,
    beats,
    revealAtTick,
    revealedTick: -1,
    counters: {},
    omenCount: 0,
  };
}

/** Validate against FATE_QUESTIONS and pad to the fixed length with -1. */
function normalizeAnswers(answers: number[] | undefined): number[] {
  if (!answers) return FATE_QUESTIONS.map(() => -1);
  if (answers.length > FATE_QUESTIONS.length) throw new Error('INVALID_ANSWERS');
  const out = FATE_QUESTIONS.map(() => -1);
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (!Number.isInteger(a) || a < -1 || a >= FATE_QUESTIONS[i].options.length) {
      throw new Error('INVALID_ANSWERS');
    }
    out[i] = a;
  }
  return out;
}
