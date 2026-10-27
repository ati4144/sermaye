import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { activeAssetIds, assetDef, assetPrice, cpiMult, homeReliefFor, livingClampFor, netWorth, salaryFor } from '@/engine';
import type { GameState } from '@/engine';
import { formatMoney, formatNumber, useCurrencySync } from '@/lib/money';
import { marketName } from '@/lib/labels';
import { useGameStore } from '@/store/gameStore';
import { CountrySheet } from './CountrySheet';
import { ExpensesSheet } from './ExpensesSheet';
import { SalarySheet } from './SalarySheet';
import { Colors, Radius, Spacing, Typography } from '@/theme';

/**
 * Cash-flow card: last month's ACTUAL breakdown (from the engine's flow
 * record) plus this month's estimate (same formulas, current state), with
 * the lifestyle badge and a shortcut into the expense sheet. On legacy
 * saves (expenses null) it degrades into the one-tap INIT_EXPENSES banner —
 * the standard preset sums to LIVING.BASE, so activation is balance-neutral.
 * The v7 income layer follows the same pattern: income null → INIT_INCOME
 * banner; active → a salary row on both sections (tap to edit), a dim
 * "unemployed" row while the health gate holds the job away. The v8
 * residency layer completes the cascade: residency null → INIT_RESIDENCY
 * banner (CountrySheet); active → a dim cumulative-inflation line under the
 * estimate header (the basket and the cap above it are already indexed).
 */
export function CashflowCard({ game }: { game: GameState }) {
  const { t } = useTranslation();
  const dispatch = useGameStore((s) => s.dispatch);
  useCurrencySync();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  // aggregate rows expand in place — one toggle per section group so tapping
  // opens exactly where the player tapped
  const [lastItemsOpen, setLastItemsOpen] = useState(false);
  const [estItemsOpen, setEstItemsOpen] = useState(false);
  const [estRentOpen, setEstRentOpen] = useState(false);
  const [estUpkeepOpen, setEstUpkeepOpen] = useState(false);
  const e = game.expenses;

  if (!e) {
    return (
      <Animated.View
        entering={FadeInDown.duration(300)}
        style={{ backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.gold, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <View style={{ backgroundColor: `${Colors.gold}22`, borderColor: Colors.gold, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: Colors.gold, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>{t('expenses.banner.badge')}</Text>
          </View>
          <Text style={{ ...Typography.h2, fontSize: 16, flex: 1 }}>{t('expenses.banner.title')}</Text>
        </View>
        <Text style={Typography.dim}>{t('expenses.banner.text')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            try {
              dispatch({ type: 'INIT_EXPENSES' });
            } catch {
              // already active — the banner disappears on the next render
            }
          }}
          style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.sm, alignItems: 'center' }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{t('expenses.banner.cta')}</Text>
        </Pressable>
      </Animated.View>
    );
  }

  if (!game.income) {
    // v7 legacy save: the income layer never existed here. Same one-tap
    // activation pattern as the expenses banner above — INIT_INCOME starts
    // the default salary flowing; the salary itself can be edited right
    // after from the salary row it creates.
    return (
      <Animated.View
        entering={FadeInDown.duration(300)}
        style={{ backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.gold, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <View style={{ backgroundColor: `${Colors.gold}22`, borderColor: Colors.gold, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: Colors.gold, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>{t('ui.income.banner.badge')}</Text>
          </View>
          <Text style={{ ...Typography.h2, fontSize: 16, flex: 1 }}>{t('ui.income.banner.title')}</Text>
        </View>
        <Text style={Typography.dim}>{t('ui.income.banner.text')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            try {
              dispatch({ type: 'INIT_INCOME' });
            } catch {
              // already active — the banner disappears on the next render
            }
          }}
          style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.sm, alignItems: 'center' }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{t('ui.income.banner.cta')}</Text>
        </Pressable>
      </Animated.View>
    );
  }

  if (!game.residency) {
    // v8 legacy save: the residency layer never existed here — the same
    // one-tap activation cascade as the banners above. INIT_RESIDENCY
    // re-bases the CPI at 100 this tick, so the pick charges no retroactive
    // inflation; the sheet also defaults the display currency.
    return (
      <Animated.View
        entering={FadeInDown.duration(300)}
        style={{ backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.gold, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <View style={{ backgroundColor: `${Colors.gold}22`, borderColor: Colors.gold, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ color: Colors.gold, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>{t('ui.country.banner.badge')}</Text>
          </View>
          <Text style={{ ...Typography.h2, fontSize: 16, flex: 1 }}>{t('ui.country.banner.title')}</Text>
        </View>
        <Text style={Typography.dim}>{t('ui.country.banner.text')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setCountryOpen(true)}
          style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.sm, alignItems: 'center' }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{t('ui.country.banner.cta')}</Text>
        </Pressable>
        {countryOpen ? <CountrySheet game={game} onClose={() => setCountryOpen(false)} /> : null}
      </Animated.View>
    );
  }

  // ---- this month's estimate: the engine's phase-4b formulas on live state
  const fateMult = game.fate?.mods.livingCost ?? 1;
  const salary = salaryFor(game);
  const itemsSum = e.items.reduce((a, it) => a + it.amount, 0);
  const worth = netWorth(game);
  // v8: the shared engine seam — the basket AND the bounds index by the
  // cumulative CPI; the levy term inside the raw value does not
  const clamped = livingClampFor(game, itemsSum, worth);
  const cpi = cpiMult(game);
  const estItems = Math.min(itemsSum * cpi, clamped) * fateMult;
  const estLevy = (clamped - Math.min(itemsSum * cpi, clamped)) * fateMult;
  let rent = 0;
  let upkeep = 0;
  const rentParts: { id: string; amount: number }[] = [];
  const upkeepParts: { id: string; amount: number }[] = [];
  if (game.assets) {
    for (const id of activeAssetIds(game)) {
      const def = assetDef(id);
      const market = game.assets.markets[id];
      if (!market) continue;
      let y = def.yieldNetM;
      for (const m of market.mods) y += m.yieldDelta ?? 0;
      const units = def.kind === 'FRACTIONAL' ? game.holdings[id]?.units ?? 0 : game.properties[id]?.units ?? 0;
      if (units <= 0) continue;
      const v = units * assetPrice(game, id) * y;
      if (v > 0) {
        rent += v;
        rentParts.push({ id, amount: v });
      } else {
        upkeep += -v;
        upkeepParts.push({ id, amount: -v });
      }
    }
  }
  rentParts.sort((a, b) => b.amount - a.amount);
  upkeepParts.sort((a, b) => b.amount - a.amount);
  // v6 Yuva: the same expression phase 4b runs — relief carves the clamped
  // base AFTER the clamp and BEFORE the fate multiplier, and estNet must
  // match the engine's `living` to the cent (homeReliefFor is shared)
  const relief = homeReliefFor(game, worth);
  const estLiving = relief > 0 ? Math.max(0, clamped - relief) * fateMult : clamped * fateMult;
  const estNet = salary + rent - upkeep - estLiving;

  const last = e.flow[e.flow.length - 1];

  return (
    <View style={{ backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <Text style={Typography.dim}>◇ {t('expenses.flow.title')}</Text>
          <View style={{ backgroundColor: `${Colors.gold}22`, borderColor: Colors.gold, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ color: Colors.gold, fontSize: 11, fontWeight: '700' }}>{t(`expenses.tiers.${e.lifestyle}`)}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setSheetOpen(true)}>
          <Text style={{ color: Colors.accent, fontSize: 13, fontWeight: '600' }}>{t('expenses.sheet.edit')} →</Text>
        </Pressable>
      </View>

      {last ? (
        <View style={{ gap: 2 }}>
          <Text style={{ ...Typography.dim, fontSize: 11, fontWeight: '700' }}>{t('expenses.flow.lastMonth')}</Text>
          {last.salary ? (
            <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setSalaryOpen(true)}>
              <FlowRow label={t('ui.income.flow.salary')} value={`+${formatMoney(last.salary)}`} color={Colors.positive} />
            </Pressable>
          ) : null}
          {last.rent > 0 ? <FlowRow label={t('expenses.flow.rent')} value={`+${formatMoney(last.rent)}`} color={Colors.positive} /> : null}
          {last.upkeep > 0 ? <FlowRow label={t('expenses.flow.upkeep')} value={`−${formatMoney(last.upkeep)}`} color={Colors.negative} /> : null}
          <FlowRow
            label={t('expenses.flow.itemsCount', { n: e.items.length })}
            value={`−${formatMoney(last.items)}`}
            color={Colors.negative}
            expandable={e.items.length > 0}
            expanded={lastItemsOpen}
            onToggle={() => setLastItemsOpen((v) => !v)}
          />
          {lastItemsOpen ? <ItemsExpansion game={game} /> : null}
          <FlowRow label={t('expenses.flow.wealthLevy')} value={`−${formatMoney(last.wealthLevy)}`} color={Colors.negative} />
          {last.relief ? (
            <FlowRow label={t('expenses.flow.relief')} value={`+${formatMoney(last.relief)}`} color={Colors.positive} />
          ) : null}
          <FlowRow label={t('expenses.flow.net')} value={formatMoney(last.net, { sign: true })} color={last.net >= 0 ? Colors.positive : Colors.negative} bold />
        </View>
      ) : (
        <Text style={{ ...Typography.dim, fontSize: 12, fontStyle: 'italic' }}>{t('expenses.flow.empty')}</Text>
      )}

      <View style={{ gap: 2, paddingTop: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.border }}>
        <Text style={{ ...Typography.dim, fontSize: 11, fontWeight: '700' }}>{t('expenses.flow.estimate')}</Text>
        {cpi !== 1 ? (
          <Text style={{ ...Typography.dim, fontSize: 10, fontStyle: 'italic' }}>
            {t('expenses.flow.inflationLine', { mult: formatNumber(cpi, 2) })}
          </Text>
        ) : null}
        {salary > 0 ? (
          <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setSalaryOpen(true)}>
            <FlowRow label={t('ui.income.flow.salary')} value={`+${formatMoney(salary)}`} color={Colors.positive} />
          </Pressable>
        ) : (
          // income is active (the banner returned early) with salary 0 → the
          // health gate holds the job: show why the salary is missing
          <FlowRow label={t('ui.income.flow.unemployed')} value="—" color={Colors.textDim} />
        )}
        {rent > 0 ? (
          <>
            <FlowRow
              label={t('expenses.flow.rent')}
              value={`+${formatMoney(rent)}`}
              color={Colors.positive}
              expandable={rentParts.length > 1}
              expanded={estRentOpen}
              onToggle={() => setEstRentOpen((v) => !v)}
            />
            {estRentOpen ? (
              <Animated.View entering={FadeInDown.duration(150)} style={{ gap: 1 }}>
                {rentParts.map((p) => (
                  <SubRow key={p.id} label={marketName(t, p.id) ?? p.id} value={`+${formatMoney(p.amount)}`} color={Colors.positive} />
                ))}
              </Animated.View>
            ) : null}
          </>
        ) : null}
        {upkeep > 0 ? (
          <>
            <FlowRow
              label={t('expenses.flow.upkeep')}
              value={`−${formatMoney(upkeep)}`}
              color={Colors.negative}
              expandable={upkeepParts.length > 1}
              expanded={estUpkeepOpen}
              onToggle={() => setEstUpkeepOpen((v) => !v)}
            />
            {estUpkeepOpen ? (
              <Animated.View entering={FadeInDown.duration(150)} style={{ gap: 1 }}>
                {upkeepParts.map((p) => (
                  <SubRow key={p.id} label={marketName(t, p.id) ?? p.id} value={`−${formatMoney(p.amount)}`} color={Colors.negative} />
                ))}
              </Animated.View>
            ) : null}
          </>
        ) : null}
        <FlowRow
          label={t('expenses.flow.itemsCount', { n: e.items.length })}
          value={`−${formatMoney(estItems)}`}
          color={Colors.negative}
          expandable={e.items.length > 0}
          expanded={estItemsOpen}
          onToggle={() => setEstItemsOpen((v) => !v)}
        />
        {estItemsOpen ? <ItemsExpansion game={game} /> : null}
        <FlowRow label={t('expenses.flow.wealthLevy')} value={`−${formatMoney(estLevy)}`} color={Colors.negative} />
        {relief > 0 ? (
          <FlowRow label={t('expenses.flow.relief')} value={`+${formatMoney(relief)}`} color={Colors.positive} />
        ) : null}
        <FlowRow label={t('expenses.flow.net')} value={formatMoney(estNet, { sign: true })} color={estNet >= 0 ? Colors.positive : Colors.negative} bold />
      </View>

      {sheetOpen ? <ExpensesSheet game={game} onClose={() => setSheetOpen(false)} /> : null}
      {salaryOpen ? <SalarySheet game={game} mode="edit" onClose={() => setSalaryOpen(false)} /> : null}
    </View>
  );
}

function FlowRow({
  label,
  value,
  color,
  bold,
  expandable,
  expanded,
  onToggle,
}: {
  label: string;
  value: string;
  color: string;
  bold?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const row = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ ...Typography.dim, fontSize: 12, fontWeight: bold ? '700' : '400' }} numberOfLines={1}>
        {expandable ? (
          <Text style={{ color: Colors.accent, fontWeight: '700' }}>{expanded ? '▾ ' : '▸ '}</Text>
        ) : null}
        {label}
      </Text>
      <Text style={{ ...Typography.mono, fontSize: 12, color, fontWeight: bold ? '700' : '400' }}>{value}</Text>
    </View>
  );
  if (!expandable) return row;
  return (
    <Pressable accessibilityRole="button" hitSlop={6} onPress={onToggle}>
      {row}
    </Pressable>
  );
}

/** One indented contributor under an expanded aggregate row. */
function SubRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: Spacing.md }}>
      <Text style={{ ...Typography.dim, fontSize: 11 }} numberOfLines={1}>
        {label}
      </Text>
      <Text style={{ ...Typography.mono, fontSize: 11, color }}>{value}</Text>
    </View>
  );
}

/** The expansion body for the lifestyle-items aggregate: the configured list. */
function ItemsExpansion({ game: g }: { game: GameState }) {
  const { t } = useTranslation();
  const items = g.expenses!.items;
  return (
    <Animated.View entering={FadeInDown.duration(150)} style={{ gap: 1 }}>
      {items.map((it) => (
        <SubRow
          key={it.id}
          label={it.kind === 'PRESET' ? t(`expenses.items.${it.key}`) : it.label ?? '—'}
          value={`−${formatMoney(it.amount)}`}
          color={Colors.negative}
        />
      ))}
      <Text style={{ ...Typography.dim, fontSize: 10, fontStyle: 'italic', paddingLeft: Spacing.md }}>
        {t('expenses.flow.itemsNote')}
      </Text>
    </Animated.View>
  );
}
