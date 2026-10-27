import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { COUNTRIES, countryDef } from '@/engine';
import type { CountryState, Holding } from '@/engine';
import { formatMoney, formatPct, useCurrencySync } from '@/lib/money';
import { Sparkline } from './Sparkline';
import { Colors, Radius, Spacing, Typography } from '@/theme';

interface Props {
  country: CountryState;
  holding?: Holding;
  onPress: (countryId: string) => void;
}

export function gradeColor(grade: string): string {
  return grade === 'A' ? Colors.positive : grade === 'B' ? Colors.gold : Colors.negative;
}

/** One row in the market/invest list. */
export function CountryRow({ country, holding, onPress }: Props) {
  const { t } = useTranslation();
  useCurrencySync();
  const def = countryDef(country.id);
  const history = country.indexHistory;
  const first = history[0] ?? country.index;
  const change = (country.index - first) / (first || 1);
  const up = change >= 0;

  const positionValue = holding ? holding.units * country.index : 0;
  const profit = holding ? positionValue - holding.units * holding.avgCost : 0;

  return (
    <Pressable
      onPress={() => onPress(country.id)}
      accessibilityRole="button"
      accessibilityLabel={t(`countries.${country.id}.name`)}
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
          <Text style={Typography.h2}>{t(`countries.${country.id}.name`)}</Text>
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
          {t(`countries.${country.id}.desc`)}
        </Text>
        {holding ? (
          <Text style={{ ...Typography.dim, color: profit >= 0 ? Colors.positive : Colors.negative }}>
            {t('ui.invest.value')}: {formatMoney(positionValue)} ({t('ui.invest.profit')}: {formatMoney(profit, { sign: true })})
          </Text>
        ) : null}
      </View>
      <Sparkline data={history} />
      <View style={{ alignItems: 'flex-end', gap: 2, minWidth: 76 }}>
        <Text style={{ ...Typography.mono, fontSize: 16 }}>{country.index.toFixed(1)}</Text>
        <Text style={{ color: up ? Colors.positive : Colors.negative, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
          {formatPct(change, { sign: true })}
        </Text>
      </View>
    </Pressable>
  );
}

export const MARKET_COUNTRIES = COUNTRIES;
