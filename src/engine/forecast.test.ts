import { describe, expect, it } from 'vitest';
import { forecastCone, forecastMedianMove } from './forecast';
import { makeGame, runMonths } from './test-utils';
import type { GameState } from './types';

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

describe('forecast cones', () => {
  it('same state → identical cones (pure read, no rng side effects)', () => {
    const s = runMonths(makeGame(12345), 24).final;
    const before = JSON.stringify(s);
    const a = forecastCone(s, 'us', 12);
    const b = forecastCone(s, 'us', 12);
    expect(a).toEqual(b);
    expect(JSON.stringify(s)).toBe(before); // caller's state is untouched
    expect(s.rng).toEqual(runMonths(makeGame(12345), 24).final.rng);
  });

  it('percentiles are ordered: p10 ≤ p50 ≤ p90', () => {
    const s = runMonths(makeGame(555), 12).final;
    for (const id of ['us', 'tr', 'ng']) {
      const c = forecastCone(s, id, 6);
      expect(c.p10).toBeLessThanOrEqual(c.p50);
      expect(c.p50).toBeLessThanOrEqual(c.p90);
      expect(Number.isFinite(c.p10)).toBe(true);
    }
  });

  it('covers asset markets too (startPrice conversion stays at the UI)', () => {
    const s = runMonths(makeGame(555), 12).final;
    for (const id of ['gold', 'house', 'farm', 'car']) {
      const c = forecastCone(s, id, 12);
      expect(c.p10).toBeGreaterThan(0);
      expect(c.p50).toBeLessThanOrEqual(c.p90);
    }
  });

  it('throws ASSET_INACTIVE when the asset layer is off', () => {
    const s = makeGame(10);
    s.assets = null;
    expect(() => forecastCone(s, 'gold', 6)).toThrow('ASSET_INACTIVE');
  });

  it('different (seed, tick) states produce different cones', () => {
    const a = runMonths(makeGame(1), 6).final;
    const b = runMonths(makeGame(2), 6).final;
    expect(forecastCone(a, 'us', 12)).not.toEqual(forecastCone(b, 'us', 12));
  });

  it('crisis widens the cone vs boom for the same starting point', () => {
    const s = runMonths(makeGame(31337), 18).final;
    const calm = clone(s);
    calm.world = null;
    const s2 = runMonths(makeGame(31337), 18).final;
    const crisis = clone(s2);
    if (crisis.world) crisis.world.regime = 'crisis';
    const wCalm = forecastCone(calm, 'us', 12);
    const wCrisis = forecastCone(crisis, 'us', 12);
    const spread = (c: { p10: number; p90: number }) => c.p90 - c.p10;
    expect(spread(wCrisis)).toBeGreaterThan(spread(wCalm));
  });

  it('median move chip is finite and expressed in percent', () => {
    const s = runMonths(makeGame(777), 12).final;
    const mv = forecastMedianMove(s, 'gold', 12);
    expect(Number.isFinite(mv)).toBe(true);
    expect(Math.abs(mv)).toBeLessThan(100);
  });

  it('horizon is clamped: 24 months equals 12, and 0 floors to 1', () => {
    const s = runMonths(makeGame(41), 6).final;
    expect(forecastCone(s, 'us', 24)).toEqual(forecastCone(s, 'us', 12));
    expect(forecastCone(s, 'us', 0)).toEqual(forecastCone(s, 'us', 1));
    expect(forecastCone(s, 'gold', 1).p50).not.toBeNaN();
  });

  it('cones are identical over a JSON round-trip of the state (persisted-save parity)', () => {
    const s = runMonths(makeGame(42), 9).final;
    const rt = JSON.parse(JSON.stringify(s)) as GameState;
    expect(forecastCone(rt, 'us', 12)).toEqual(forecastCone(s, 'us', 12));
    expect(forecastCone(rt, 'gold', 12)).toEqual(forecastCone(s, 'gold', 12));
  });
});
