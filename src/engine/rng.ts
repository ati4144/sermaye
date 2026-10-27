/**
 * Deterministic RNG — mulberry32.
 *
 * The RNG state lives inside GameState (never derived from the seed at tick
 * time), so replaying an action log on an initial state reproduces every
 * later state exactly. Uses only integer operations (imul, xor, shifts) that
 * are specified identically across JS engines (Hermes/JSC/V8).
 */

export interface RngState {
  /** uint32; mutated by every draw */
  s: number;
}

export function createRng(seed: number): RngState {
  // Spread the seed through one round so close seeds diverge immediately
  const r: RngState = { s: seed >>> 0 };
  nextU32(r);
  return r;
}

/** Raw uint32 draw in [0, 4294967295]. Advances the state. */
export function nextU32(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform float draw in [0, 1). */
export function nextFloat(r: RngState): number {
  return nextU32(r) / 4294967296;
}

/**
 * Approximately N(0,1) via the Irving–Hall method: sum of 12 uniforms minus 6.
 * Pure addition — no transcendental functions, which are implementation-
 * defined across JS engines. Bounded to ±6, mean 0, variance 1.
 */
export function normal12(r: RngState): number {
  return (
    nextFloat(r) +
    nextFloat(r) +
    nextFloat(r) +
    nextFloat(r) +
    nextFloat(r) +
    nextFloat(r) +
    nextFloat(r) +
    nextFloat(r) +
    nextFloat(r) +
    nextFloat(r) +
    nextFloat(r) +
    nextFloat(r) -
    6
  );
}

/** Pick an index from a weight table (weights sum to 1). One draw. */
export function weightedIndex(r: RngState, weights: readonly number[]): number {
  const x = nextFloat(r);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (x < acc) return i;
  }
  return weights.length - 1;
}
