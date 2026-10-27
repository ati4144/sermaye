import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { assetDef, assetPrice } from '@/engine';
import type { GameState } from '@/engine';
import { formatMoney, formatNumber, formatPct, useCurrencySync } from '@/lib/money';
import { gradeColor } from './CountryRow';
import { Sparkline } from './Sparkline';
import { Colors, Radius, Spacing, Typography } from '@/theme';

interface Props {
  game: GameState;
  assetId: string;
  onPress: (assetId: string) => void;
}

/** One row in the asset segments (gold / housing / farmland / classic cars). */
export function AssetRow({ game, assetId, onPress }: Props) {
  const { t } = useTranslation();
  useCurrencySync();
  const def = assetDef(assetId);
  const market = game.assets!.markets[assetId];
  // belt-and-suspenders: healAssets repairs stale saves at load, but a row
  // must never hard-crash the screen if one still slips through
  if (!market) return null;
  const history = market.indexHistory;
  const first = history[0] ?? market.index;
  const change = (market.index - first) / (first || 1);
  const up = change >= 0;
  const price = assetPrice(game, assetId);

  const holding = def.kind === 'FRACTIONAL' ? game.holdings[assetId] : undefined;
  const position = def.kind === 'DEED' ? game.properties[assetId] : undefined;
  const units = holding?.units ?? position?.units ?? 0;
  const value = units * price;
  const profit = units > 0 ? value - units * (holding?.avgCost ?? position?.avgCost ?? price) : 0;
  // v6 escrow: units parked in pendingSales are out of the position — surface
  // them so a fully-listed deed doesn't read as "owned nothing"
  const listedUnits = game.pendingSales.filter((ps) => ps.assetId === assetId).reduce((a, ps) => a + ps.units, 0);

  return (
    <Pressable
      onPress={() => onPress(assetId)}
      accessibilityRole="button"
      accessibilityLabel={t(`assets.${assetId}.name`)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        backgroundColor: pressed ? Colors.surfaceAlt : Colors.surface,
        borderWidth: 1,
        borderColor: Colors.border,
        borderRadius: Radius.md,
        padding: Spacing.md,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <Text style={Typography.h2}>{t(`assets.${assetId}.name`)}</Text>
          <View
            style={{
              backgroundColor: `${gradeColor(def.grade)}22`,
              borderColor: gradeColor(def.grade),
              borderWidth: 1,
              borderRadius: Radius.sm,
              paddingHorizontal: 6,
              paddingVertical: 1,
            }}
          >
            <Text style={{ color: gradeColor(def.grade), fontSize: 11, fontWeight: '700' }}>{def.grade}</Text>
          </View>
        </View>
        <Text style={Typography.dim} numberOfLines={1}>
          {t(`assets.${assetId}.desc`)}
        </Text>
        <Text style={{ ...Typography.dim, fontSize: 11 }}>
          {def.yieldNetM > 0
            ? `${t('ui.invest.yieldM')}: +${formatPct(def.yieldNetM)}`
            : def.yieldNetM < 0
              ? `${t('ui.invest.upkeepM')}: ${formatPct(def.yieldNetM, { sign: true })}`
              : `${t('ui.invest.fee')}: ${(def.fee * 100).toFixed(2)}%`}
        </Text>
        {units > 0 || listedUnits > 0 ? (
          <Text style={{ ...Typography.dim, color: profit >= 0 ? Colors.positive : Colors.negative }}>
            {units > 0
              ? `${t('ui.invest.unitsOwned')}: ${
                  def.kind === 'DEED' ? `${formatNumber(units, 0)} ${t(`assets.${assetId}.unit`, { count: units })}` : formatNumber(units, 2)
                } · ${formatMoney(value)} (${formatMoney(profit, { sign: true })})${
                  position && position.rentCollected > 0 ? ` · ${t('ui.invest.rentTotal')}: ${formatMoney(position.rentCollected)}` : ''
                }`
              : ''}
            {listedUnits > 0 ? `${units > 0 ? ' · ' : ''}${t('ui.invest.listed', { n: formatNumber(listedUnits, 0) })}` : ''}
          </Text>
        ) : null}
      </View>
      <Sparkline data={history} />
      <View style={{ alignItems: 'flex-end', gap: 2, minWidth: 76 }}>
        <Text style={{ ...Typography.mono, fontSize: 16 }}>{formatMoney(price, { decimals: 0 })}</Text>
        <Text style={{ color: up ? Colors.positive : Colors.negative, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
          {formatPct(change, { sign: true })}
        </Text>
      </View>
    </Pressable>
  );
}
