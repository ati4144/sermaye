import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { activeAssetIds, assetDef, assetPrice, countryDef } from '@/engine';
import type { GameState } from '@/engine';
import { marketName } from '@/lib/labels';
import { formatMoney, formatNumber, formatPct, useCurrencySync } from '@/lib/money';
import { gradeColor } from './CountryRow';
import { Sparkline } from './Sparkline';
import { Colors, Radius, Spacing, Typography } from '@/theme';

/** One open position in the portfolio card (formula-only derivation). */
interface RowPos {
  id: string;
  grade: string;
  units: number;
  /** fractional (countries, gold) or whole (deeds) — affects the label only */
  deed: boolean;
  value: number;
  cost: number;
  pnl: number;
  history: number[];
  /** monthly net yield at current prices (deeds only; negative = upkeep) */
  incomeM: number;
  rentCollected: number;
}

/**
 * Dashboard investment tracker: every open position (countries, gold, deeds)
 * as a widget row — value vs avg-cost P&L, sparkline, and deed income. Pure
 * derivation from engine state (avgCost basis excludes fees, matching the
 * invest screen); hidden entirely while the player holds nothing.
 */
export function PortfolioCard({ game }: { game: GameState }) {
  const { t } = useTranslation();
  useCurrencySync();

  const rows = useMemo<RowPos[]>(() => {
    const out: RowPos[] = [];
    for (const cs of Object.values(game.countries)) {
      const h = game.holdings[cs.id];
      if (!h || h.units <= 0) continue;
      out.push({
        id: cs.id,
        grade: countryDef(cs.id).grade,
        units: h.units,
        deed: false,
        value: h.units * cs.index,
        cost: h.units * h.avgCost,
        pnl: h.units * (cs.index - h.avgCost),
        history: cs.indexHistory,
        incomeM: 0,
        rentCollected: 0,
      });
    }
    if (game.assets) {
      for (const id of activeAssetIds(game)) {
        const def = assetDef(id);
        const market = game.assets.markets[id];
        if (!market) continue; // healAssets repairs saves, rows never crash
        if (def.kind === 'FRACTIONAL') {
          const h = game.holdings[id];
          if (!h || h.units <= 0) continue;
          const price = assetPrice(game, id);
          out.push({
            id,
            grade: def.grade,
            units: h.units,
            deed: false,
            value: h.units * price,
            cost: h.units * h.avgCost,
            pnl: h.units * (price - h.avgCost),
            history: market.indexHistory,
            incomeM: 0,
            rentCollected: 0,
          });
        } else {
          const pos = game.properties[id];
          if (!pos || pos.units <= 0) continue;
          const price = assetPrice(game, id);
          let y = def.yieldNetM;
          for (const m of market.mods) y += m.yieldDelta ?? 0;
          const value = pos.units * price;
          out.push({
            id,
            grade: def.grade,
            units: pos.units,
            deed: true,
            value,
            cost: pos.units * pos.avgCost,
            pnl: pos.units * (price - pos.avgCost),
            history: market.indexHistory,
            incomeM: value * y,
            rentCollected: pos.rentCollected,
          });
        }
      }
    }
    // tracking priority: biggest position first; id breaks ties so the render
    // stays deterministic across dispatches
    out.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    return out;
  }, [game]);

  // v6 escrow: locked proceeds total (principal, not P&L). Even a fully
  // listed portfolio keeps the card alive so the player sees the escrow.
  const pendingTotal = game.pendingSales.reduce((a, ps) => a + ps.proceeds, 0);
  if (rows.length === 0 && pendingTotal === 0) return null;

  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalPnl = totalValue - totalCost;
  const rentSum = rows.reduce((s, r) => s + r.rentCollected, 0);
  const pnlColor = totalPnl >= 0 ? Colors.positive : Colors.negative;
  const withIncome = totalPnl + rentSum;

  return (
    <Animated.View
      entering={FadeInDown.duration(300)}
      style={{ backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.md, gap: 2 }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={Typography.dim}>◆ {t('ui.dashboard.tracker.title')}</Text>
        <Text style={Typography.mono}>{formatMoney(totalValue)}</Text>
      </View>
      {rows.length > 0 ? (
        <>
          <Text style={Typography.dim}>
            {t('ui.dashboard.tracker.invested')}: {formatMoney(totalCost)}
          </Text>
          <Text style={{ color: pnlColor, fontWeight: '600', fontSize: 13, fontVariant: ['tabular-nums'] }}>
            {t('ui.invest.profit')}: {formatMoney(totalPnl, { sign: true })}
            {totalCost > 0 ? ` (${formatPct(totalPnl / totalCost, { sign: true })})` : ''}
          </Text>
          {rentSum !== 0 ? (
            <Text style={{ color: withIncome >= 0 ? Colors.positive : Colors.negative, fontSize: 13 }}>
              {t('ui.dashboard.tracker.withIncome')}: {formatMoney(withIncome, { sign: true })}
            </Text>
          ) : null}
        </>
      ) : null}
      {pendingTotal > 0 ? (
        <Text style={{ ...Typography.dim, fontSize: 13, fontVariant: ['tabular-nums'] }}>
          {t('ui.dashboard.tracker.pending')}: {formatMoney(pendingTotal)}
        </Text>
      ) : null}

      {rows.map((r, i) => {
        const color = r.pnl >= 0 ? Colors.positive : Colors.negative;
        const unitsLabel = r.deed
          ? `${formatNumber(r.units, 0)} ${t(`assets.${r.id}.unit`, { count: r.units })}`
          : `${formatNumber(r.units, 2)} ${t('ui.invest.units')}`;
        // one income string per deed row: monthly flow + cumulative total
        const flow =
          r.incomeM > 0
            ? `${t('ui.dashboard.rentPerMonth')}: +${formatMoney(r.incomeM)}`
            : r.incomeM < 0
              ? `${t('ui.dashboard.upkeepPerMonth')}: −${formatMoney(-r.incomeM)}`
              : '';
        const total =
          r.rentCollected > 0
            ? `${t('ui.invest.rentTotal')}: ${formatMoney(r.rentCollected)}`
            : r.rentCollected < 0
              ? `${t('ui.dashboard.tracker.upkeepTotal')}: ${formatMoney(-r.rentCollected)}`
              : '';
        const income = [flow, total].filter(Boolean).join(' · ');
        return (
          <Animated.View
            key={r.id}
            entering={FadeInDown.duration(250).delay(i * 30)}
            style={{ borderTopWidth: i > 0 ? 1 : 0, borderColor: Colors.border, paddingVertical: Spacing.sm, gap: 2 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: gradeColor(r.grade) }} />
              <Text style={{ ...Typography.h2, flex: 1 }} numberOfLines={1}>
                {marketName(t, r.id)}
              </Text>
              <Text style={{ color, fontWeight: '600', fontSize: 13, fontVariant: ['tabular-nums'] }}>
                {formatMoney(r.pnl, { sign: true })}
                {r.cost > 0 ? ` (${formatPct(r.pnl / r.cost, { sign: true })})` : ''}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <Text style={{ ...Typography.dim, fontSize: 12, flex: 1 }} numberOfLines={1}>
                {unitsLabel} · {formatMoney(r.value)}
              </Text>
              <Sparkline data={r.history} />
            </View>
            {income ? (
              <Text style={{ ...Typography.dim, fontSize: 11 }} numberOfLines={1}>
                {income}
              </Text>
            ) : null}
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}
