# Kader — Unified Fate System Design (Sermaye)

> Produced by a 13-agent design panel (4 lenses × adversarial critique × synthesis), Oct 2026.
> Status: APPROVED — decisions locked with the user (see §10).

## 1. Concept

User-facing name: **Kader**. Engine term: `Fate`. Two entry modes, one runtime system:

- **(a) Kadere Bırak (RANDOM)** — skip the questionnaire; a hidden destiny thread is rolled uniformly from the pool and unfolds over the run.
- **(b) Kaderini Kendin Yaz (CHOSEN)** — a 5-question start questionnaire. The `sır` (secret) answer **hard-locks** a destiny via gates (your past *guarantees* its arc); other answers bias weights, set flags, apply small starting deltas, and arm answer-scheduled beats.

Every new game presents an explicit **mode-choice screen** ("Kaderini sen mi yazarsın, yazgı mı?") — the player picks random fate or the questionnaire each run; no first-run auto-skip heuristic.

A destiny = archetype + **beat timeline fully resolved at creation** (plannedTick, variants, revealAtTick) + founder-scoped life multipliers + passive trait modifiers (fees, living costs, estate tax). Beats fire through the existing PendingEvent ACK/RESOLVE pipeline as new `trigger: 'FATE'` EventDefs.

Iron rules (from critiques): fate never moves money without a player decision; every curse has a "kaderine meydan oku" fight path in MVP; fate never writes world/shared state (phases 1–2 stay pure for the shared-world server); mechanics numbers are never shown in UI.

## 2. Data model (src/engine/types.ts)

```ts
export type EventTrigger = 'MARKET' | 'LIFE' | 'FATE';

export interface FateBeatState {
  key: string; eventId: string;            // variant resolved at creation
  window: [number, number]; plannedTick: number;
  requires: string[]; reveal: boolean; personal: boolean;
  status: 'PENDING' | 'FIRED' | 'LOST';
}
export interface FateMods {                 // multipliers, all default 1
  illness: number; death: number; marriage: number; birth: number;
  spouse: number; child: number;            // founder-scoped hazards
  livingCost: number; estateTax: number; fee: number; // player-side economics
}
export interface FateState {
  mode: 'RANDOM' | 'CHOSEN';
  rng: RngState;                            // private fate stream (see §3)
  destinyId: string;                        // 'none' allowed
  answers: number[];                        // fixed FATE_QUESTIONS order, -1 = skipped
  flags: Record<string, true>;              // answer + branch flags
  mods: FateMods;                           // merged answer × destiny, clamped
  beats: FateBeatState[];                   // full resolved snapshot, indexed by key
  revealAtTick: number;                     // immutable creation schedule
  revealedTick: number;                     // -1 until flip (scheduled or via option)
  counters: Record<string, number>;
  omenCount: number;
}
// GameState += fate: FateState | null   (null = legacy v1 save, all reads guarded)
// EventOption += fate?: { setFlag?: string; cancelBeats?: string[];
//   counters?: Record<string, number>; reveal?: boolean;
//   modShift?: Partial<FateMods> }        // each shifted by ±0.1, clamped
// EventOption += cashDelta?: number       // signed, |v| <= 10k for fate defs (lint)
// NewGameOptions += answers?: number[]
```

Full bias surface (incl. `estateTax`, `livingCost`, `fee`) is enumerated **now** to avoid a second schema bump; `bankruptGrace` and per-country fees are deliberately deferred. Static catalogs (`FATE_QUESTIONS`, `FATE_CATALOG`) ship with the app and are never serialized; conditions stay code-side, so the honest contract is "fate catalog frozen per schemaVersion" (same as EVENT_CATALOG) and fate eventIds are append-only (lint-enforced).

**Migration (lossless, engine-side):** `SCHEMA_VERSION = 2`. New engine export `migrateState(state)`: if `schemaVersion < 2`, returns `{ ...st, schemaVersion: 2, fate: null }`. `replay()` invokes it on entry; `gameStore.migrate` becomes a thin wrapper (fixes the store-only-migration blocker). Because every fate read is guarded, v1 `(initial, actionLog)` pairs replay bit-for-bit — no save wipe. Test: v1 fixture replays identically pre/post migration.

## 3. Engine changes

New files: `src/engine/fate/{types,defs,roll,tick}.ts`. All obey the ESLint engine bans; predicates are pure and draw-free.

**Creation (`create.ts` + `fate/roll.ts`):** after base state, before the initial `netWorthHistory.push`: consume exactly **one unconditional `nextU32(s.rng)`** → fateSeed → `s.fate.rng = createRng(fateSeed)`. This one fixed slot is the only main-stream draw fate ever takes (per-player private in the future server; no `playerId` parameter needed). `rollFate` then draws **only from `s.fate.rng`**, in fixed order: (1) destiny pick — weight_i = clamp(base × sway, 0.5×base … 2×base) summed over sparse `answerWeights`; walk cumulative over `totalW` with `x = nextFloat × totalW` (never `weightedIndex` — zero-weight fallthrough); if `totalW === 0`, consume one discarded float and set `'none'`; (2) one jitter draw per beat in catalog order, `plannedTick = from + floor(draw × draw × span)` (early-window bias, quadratic via multiplication — no runtime draws needed); (3) one variant draw per variant beat; (4) one reveal draw inside `revealWindow` (veiled destinies use early windows, ~tick 12–30). Then apply start deltas (cash within ±15k total, shown on the sealed splash — answer-level only, destiny-level cash is forbidden to keep the hidden fate illegible at tick 0), merge+clamp mods (per-field [0.5, 1.5]), snapshot beats, and set `peakNetWorth = roundCash(netWorth(s))`. Answers are validated (`INVALID_ANSWERS` on unknown/out-of-range) and normalized to the fixed-length array — key-order-safe for golden hashes.

**Tick (`sim.ts`):** new **phase 2.5**, fixed position between market events and `liveLife`: `if (s.fate && s.player.alive && s.status === 'PLAYING') triggerFateBeats(s)`. `fate/tick.ts` consumes **zero draws**: (1) if `revealedTick < 0 && tick >= revealAtTick` → enqueue `destiny_reveal` (copy from `fate.destinies.<id>.reveal`), set `revealedTick`; (2) per beat in key order: `PENDING && tick >= plannedTick` — if any `requires` beat is LOST → this beat LOST; if requires unfired or `condition` false → defer (`plannedTick + 1`; past `window[1] + FATE.DEFER_GRACE` → LOST); else fire via `enqueueFateEvent`, status FIRED, apply beat counters, **max one beat fired per tick** (extras defer one month). Document in the sim.ts determinism block: fate draws occur only at creation (fate stream) plus one fixed slot in the inheritance path; phases 1–2 read only shared state.

**Life (`life.ts`):** hazards multiply by `s.fate?.mods.X ?? 1` on the **comparison side only** (marriage, birth, illness, death, spouse, child draws — slots untouched); every product clamped `min(0.95, p × mod)`. `performInheritance` gains, as its **first line** (before the heirs check, only when `s.fate` exists): one always-taken draw from `s.fate.rng` → `fateOnInherit`: personal beats → LOST (dynastic beats keep rolling — "kader binds the surname"), `mods` reset to neutral (founder-scoped — no generation-4 curse multipliers), `revealedTick` stays (the heir learns the family fate), heir health bias applied.

**Actions (`actions.ts`):** `resolveEvent` applies `option.fate` after existing effects: `setFlag`, `cancelBeats` (PENDING → LOST), `counters`, `reveal` (→ `revealedTick = s.tick`), `modShift` (each field ±0.1, clamped). Applies `cashDelta` next to `healthDelta`. No new EngineAction members.

**Events (`events/apply.ts`, `events/catalog.ts`):** `enqueueFateEvent(s, eventId, hasChoice)` mirrors `enqueueLifeEvent` with uid `${tick}:${eventId}:f${beatIndex}`; non-choice fate beats push a `LogEntry` (netWorth 0, backfilled by phase 5) so history works. Fate EventDefs: `scope: 'GLOBAL'`, `trigger: 'FATE'`, `p: 1`, `cooldown: 0`, `effects: []` — **player-scoped option fields only** (cashDelta, cashCost, costPctNetWorth, healthDelta, setMarried, fate). `marketEvents()` already excludes them; lint pins trigger and absence from the market loop.

**World purity (multiplayer):** dropped per-player MARKET-threshold multipliers, countryDrift pushes, and GLOBAL index shocks from fate options entirely (see §9). Market-flavored destinies read market state via `condition` predicates (pure) and act through player-scoped effects. `balance.ts` += `FATE { MOD_CLAMP, MOD_PRODUCT_MAX: 0.95, MAX_PER_TICK: 1, DEFER_GRACE: 36, SWAY: [0.5, 2], START_CASH_CAP: 15000, CASH_DELTA_CAP: 10000, MOD_SHIFT: 0.1 }`.

## 4. Questionnaire ("Kaderini Kendin Yaz")

5 questions, one per screen, 3–4 options, skippable via **"Kadere Bırak" on every screen** (remaining = -1; all -1 → RANDOM mode). Partial answers valid. Reached only through the mode-choice screen (CHOSEN); picking Kadere Bırak there goes straight to the sealed splash. Each answer = real trade-off (no dominant neutral), sparse weight deltas, and **at least one visible first-year beat or receipt line**. Native TR copy pass (nazar/borç/gurbet/kısmet register) is a gate before string freeze.

1. **q_koken "Ailen neydi?"** — yoksul (cash −10k, +`sifirdan_zirveye`), esnaf (fee 0.95), varlıklı (cash +10k, estateTax 1.25, flags `heir_upbringing`, +`nazarli_servet`). Cash shown on the sealed receipt ("Ailenden kalan 10 bin dolarla başladın").
2. **q_mizac "Seni ne tanımlar?"** — cesur (illness 1.1, marriage 1.15, +market-arc weights), temkinli (illness 0.9, marriage 0.85), kurnaz (fee 0.95, birth 0.9).
3. **q_sir "Geçmişinde bir sır var mı?"** — **the lock**: eski borç → flag `father_debt` (locks `aile_borcu` thread, letter beat fires month 3 exactly); göç hikâyesi → flag `gurbet` (locks `gurbet_kusu`); kayıp aşk → arms a late CHOICE beat (condition: unmarried — marry the lost love vs refuse, both with costs); temiz → nothing locked, boon weights up.
4. **q_para "Para senin için ne?"** — güvenlik (livingCost 0.95), güç (estateTax 1.15, +`nazarli`), özgürlük (marriage 0.9). Tilt-only.
5. **q_aile "Önceliğin ne?"** — büyük aile (birth 1.2, marriage 1.1), kariyer (birth 0.85, illness 1.1), huzur (all curse weights halved via sway cap, boons up).

Answers are raw material the fate twists: answer beats fire late (tick 60+), read current state, and destinies may cancel or rewrite them (an heir destiny cancels the debt arc) — never a tick-24 echo of your own input.

## 5. Content model

Static, typed, in `fate/defs.ts`; engine is a generic interpreter; content scales by rows + i18n keys only.

```ts
interface FateDef {
  id: string; weight: number;
  answerWeights?: Record<string /*answerFlagOrId*/, number>; // sparse, sway-capped
  requireAll?: string[]; requireNone?: string[];             // hard gates (q_sır lock)
  veiled?: boolean;                                          // no omens pre-reveal
  start?: { cashDelta?: number; health?: number };           // cash: answers only
  mods?: Partial<FateMods>;
  revealWindow: [number, number]; beats: FateBeatDef[];
}
interface FateBeatDef {
  key: string; eventId: string; variants?: string[];
  window: [number, number]; requires?: string[];
  condition?: (s: GameState) => boolean;                     // pure, draw-free
  reveal?: boolean; personal?: boolean;                      // personal = lost at inheritance
  counters?: Record<string, number>;
}
```

**Example 1 — `sifirdan_zirveye` "Sıfırdan Zirveye"** (foreshadowed, neutral-reachable; weight 10; answers: yoksul +6, cesur +2, varlıklı −6; start: health 95; mods: illness 0.85; reveal [18, 48]). Beats: `omen` win [6,18] foreshadow "Sırtındaki gölge büyük olacak"; `firsat` [24,60] CHOICE — partnership: pay 5% NW for a boon counter vs pass; `zirve` [96,144] condition `netWorth ≥ 400k`, CHOICE — vakıf kur (15% NW, flag `legacy`, counters) vs daha yüksek (modShift illness +0.1, later gain beat); alternate LOST path gives its own "harcanmamış kader" epilogue copy (Phase 2).

**Example 2 — `nazarli_servet` "Nazırlı Servet"** (veiled; weight 6; requireNone `huzur`; answers: varlıklı +5, cesur +2, temiz −4; mods: illness 1.4 founder-scoped; reveal [12, 30] — you learn your nature young). Beats: `nazar_omen` [6,18] "Üzerinde nazar var"; `parlak_firsat` [30,66] CHOICE — göze al (5% NW cost, flag `nazar_denendi`) vs dağıt (cashDelta +8k, counters); `agir_hastalik` [84,144] CHOICE — yurt dışı tedavi (8% NW, health +15, **flag `nazar_kirildi`**) vs katlan (health −20, modShift illness +0.1); `hesap_gunu` [150,210] condition `!nazar_kirildi`, CHOICE — bağış (15% NW, curse lifts) vs inat (25% NW). The fight path is real from day one.

**Example 3 — `gurbet_kusu` "Gurbet Kuşu"** (requireAll `gurbet` — hard-locked by q_sır=göç; weight 10; mods: fee 0.9 "diaspora ağı"; reveal [12, 36]). Beats: `yola_cikis` [3,3] fixed CHOICE — biriktir ve gönder (3% NW → counter `gonderi`) vs bekle; `dolar_hissi` [48,96] condition `anyIndexAbove(160)` CHOICE — tavsiyeye kulak ver (2% NW → arms `altin_gunu`) vs geç; `altin_gunu` [96,156] condition `gonderi ≥ 1 && altin_gunu armed` — cashDelta +10k "gurbetçinin helali"; `geri_donus` [180,240] dynastic (personal: false), CHOICE — dön vs kal (family copy, human-first: the loss, then the portfolio).

**i18n** (tr.ts first, en parity, key-parity test): `fate.questions.<qid>.{text,options.<n>}`; `fate.destinies.<id>.{name,desc,reveal,foreshadow}`; `fate.ui.{sealed,sealedVeiled,skip,hidden,badge,card.*}`; beats reuse the existing `events.<eventId>.{title,text,options.<n>}` tree — zero new event-copy machinery. Content lint (see §7) enforces append-only eventIds, DAG requires, windows valid, sway caps, player-scoped effects, variant ids exist.

## 6. UI changes

- **new-game.tsx**: 3-step flow — name, then the **mode-choice screen** ("Kaderini sen mi yazarsın, yazgı mı?" → Kadere Bırak | Kaderini Kendin Yaz), then (CHOSEN only) the `src/components/FateQuestions.tsx` stepper (progress dots; back allowed; "Kadere Bırak" on every screen → falls back to RANDOM). Splash "Kaderin mühürlendi" with a one-line **receipt** (cash delta + "bir sırla"), veiled line "Zamanı gelince öğreneceksin." Store: `newGame(slot, name, answers)`.
- **game/index.tsx**: gold omen line only while a beat window is open (foreshadowed/revealed only, veiled+unrevealed stays silent; respects settings). Vague copy ("yakında"), never dates.
- **game/family.tsx**: **Kader card** — pre-reveal: "???" + omen count; post-reveal: destiny name, one-line desc, stage dots (fill as beats fire), active trait lines in words ("Geçmiş hastalık: risk yüksek"), founder's questionnaire answers, dynastic-legacy line at handover ("Babanın kader borcu"). Never shows plannedTick or multipliers.
- **EventModal**: "KADER" badge derived from `eventDef(id).trigger === 'FATE'` (gold styling); `destiny_reveal` renders the destiny's reveal copy. FAST_FORWARD already halts on pendingEvents.
- **history.tsx**: ☾ sigil on fate entries (works because non-choice beats now log). Game-over epilogue line is Phase 2.

## 7. Deterministic test strategy

- **Creation isolation**: for fixed seed, `createNewGame(seed, anyAnswers).rng.s` identical across all answer sets (fate draws never touch the main stream beyond the single seed draw).
- **Phase-2.5 zero-draw**: snapshot `rng.s` immediately before/after `triggerFateBeats` each tick — identical; plus an ESLint/test boundary check that `fate/tick.ts` contains no rng calls.
- **Golden hashes**: (seed × answer set) fixtures incl. all-skip; scripted 600-tick runs mixing BUY/SELL/NEXT_MONTH/FAST_FORWARD/ACK/RESOLVE; hash `JSON.stringify(state)` incl. `fate.rng.s`; `replay(initial, log)` bit-for-bit parity; fuzz random logged action sequences.
- **Honest invariant docs**: lifeMods legitimately shift the main stream via pre-existing conditional draws (illness severity, per-child); tests assert per-run determinism, not cross-destiny stream equality.
- **Schedule unit tests**: fixed [3,3] fires at tick 3; condition-false defers +1/tick then LOST after grace; requires-lost propagates; MAX_PER_TICK defers; bounds guard at thread end.
- **Content lint**: all §5 rules + i18n key parity tr/en + choice fate defs have no def-level money + sway/weight sanity + every saved-beat eventId resolves.
- **Migration**: v1 fixture replays identically pre/post `migrateState`; migrated fate is inert.
- **Soak**: 10k seeds × 720 ticks × answer sets — destiny distribution within tolerance (RANDOM uniform; göç answer → `gurbet_kusu` 100%), no NaN, uid uniqueness, ≤1 fate pending/tick pacing, curse-breakable in >25% of `nazarli` runs, heir survival rates with reset mods.

## 8. Phased plan

**MVP (one release):** types + schema v2 lossless migration + rollFate + phase 2.5 + life mods + option.fate (setFlag/cancelBeats/reveal/modShift/cashDelta) + enqueueFateEvent with logging + **5 destinities** (the 3 above + `aile_borcu` borç-locked + one boon; ≥3 reachable from the neutral path) + 5 questions + Kader card + badge + omen line + questionnaire UI + tests. Choice-bearing beats and the fight path are IN — no ACK-popup railroad.
**Phase 2:** game-over epilogues + unspent-fate endings, rotating omen lines, 3–4 more destinies, counter-gated alternate endings, handover CHOICE event that re-tilts remaining stages (RESOLVE_EVENT seam — no new action type).
**Phase 3:** kinks (0–2 passive minor traits), dynasty-level destiny mods with legible UI, purchasable fate reroll as a logged action, telemetry-driven weight tuning.
**Phase 4:** shared-world extraction — fate state + fate rng + answers move to the per-player private block; zero shared-stream change.
**NOT yet:** world-index effects from fate (deferred to server-routed shared fate), oracle/prophecy index shocks, phoenix bankruptcy rescue (cut until fully specified: streak reset, floor, once-only, never for EXTINCT), per-country fee overrides, dense weight matrices, free-text answers, per-question "cards decide" option (global skip covers it).

## 9. Dropped from source designs (and why)

- Per-player MARKET-threshold multipliers, countryDrift/globalMods pushes, GLOBAL shocks in fate options — broke shared-world phase 1–2 purity; replaced by condition-gated beats + player-scoped effects.
- "Markets bit-identical regardless of destiny / draw-count == baseline" invariant — false (conditional severity/children draws); replaced by creation isolation + phase-2.5 zero-draw + replay goldens.
- `weightedIndex` for the destiny pick — zero-weight fallthrough; replaced by totalW walk with discarded-draw `none` path.
- `Record<string,number>` answers, `revealTick` dual-use, store-only migration, wholesale save drop, per-beat runtime fire draws (STAGE_P), Phase-2-deferred agency, ±$40–150k start cash, flat $-beat amounts, permanent cross-generation hazard muls, forced-marriage beat, next-beat dates on the Kader card, 'C'-grade marketMods targets, unused `FateStart.holdings`, "kartlar karar versin" per-question option, omen-hiding settings toggle, untranslated/translated-generic copy — all replaced per §2–§6 fixes.

## 10. Decisions (locked with the user, 2026-10-09)

1. **Lock strength of the sır question**: **HARD GATE** — the göç answer guarantees the gurbet destiny 100% (verifiable causality; within-arc RNG keeps surprise).
2. **Beat default at inheritance**: **DYNASTIC** — pending beats roll to the heir ("kader binds the surname"), with a per-beat `personal` flag for exceptions; mods reset to neutral at handover.
3. **Save migration**: lossless v1→v2 engine-side `migrateState` (fate: null; old runs replay intact).
4. **First-run experience**: **explicit mode-choice screen every run** ("Kadere Bırak" vs "Kaderini Kendin Yaz") — the user's own call; no first-run auto-skip, no settings toggle needed.
5. **MVP destiny count**: **5** (the 3 examples + `aile_borcu` + one boon; ≥3 reachable from the neutral path).
