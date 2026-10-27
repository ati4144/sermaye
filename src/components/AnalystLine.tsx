import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { forecastCone } from '@/engine';
import type { GameState } from '@/engine';
import { Colors, Typography } from '@/theme';

/**
 * Analyst view for one market: the p10/p50/p90 forecast cone over `months`,
 * rendered as a single compact line for trade sheets. Deliberately fallible —
 * the cone holds the current regime and modifiers constant and misses every
 * event that actually fires (design §6, docs/dunya-design.md).
 */
export function AnalystLine({ game, marketId, months = 12 }: { game: GameState; marketId: string; months?: number }) {
  const { t } = useTranslation();
  // world-null runs still get a cone (identity multipliers); an inactive asset
  // layer legitimately throws — the sheet never opens without it
  const cone = forecastCone(game, marketId, months);
  const level =
    game.countries[marketId]?.index ?? game.assets?.markets[marketId]?.index ?? 1;
  const pct = (x: number) => {
    const v = (x / (level || 1) - 1) * 100;
    return `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
  };
  return (
    <Text style={{ ...Typography.dim, fontSize: 11 }}>
      ◈ {t('ui.analyst.label')} · {t('ui.analyst.months', { n: months })}:{' '}
      <Text style={{ color: Colors.negative }}>{pct(cone.p10)}</Text>
      {' / '}
      <Text style={{ color: Colors.text }}>{pct(cone.p50)}</Text>
      {' / '}
      <Text style={{ color: Colors.positive }}>{pct(cone.p90)}</Text>
    </Text>
  );
}
