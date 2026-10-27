import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CashflowCard } from '@/components/CashflowCard';
import { ChoiceButton } from '@/components/ChoiceButton';
import { CountryRow } from '@/components/CountryRow';
import { LineChart } from '@/components/LineChart';
import { MoneyText } from '@/components/MoneyText';
import { PortfolioCard } from '@/components/PortfolioCard';
import { SalarySheet } from '@/components/SalarySheet';
import { ageYears, isVeiled, netWorth, regimeMonths } from '@/engine';
import type { GameState, RegimeId } from '@/engine';
import { formatMoney, formatNumber, useCurrencySync } from '@/lib/money';
import { formatGameDate } from '@/lib/time';
import { useActiveGame, useGameStore } from '@/store/gameStore';
import { Colors, Radius, ScreenContainer, Spacing, Typography } from '@/theme';

function regimeColor(regime: RegimeId): string {
  if (regime === 'growth') return Colors.positive;
  if (regime === 'boom') return Colors.gold;
  if (regime === 'crisis') return Colors.negative;
  return Colors.textDim;
}

/**
 * World card: current regime + how long it has run, the scenario/era name and
 * the hottest agenda topics (top 3 by weight). Hidden entirely on world-null
 * runs — the banner below covers those.
 */
function WorldCard({ game }: { game: GameState }) {
  const { t } = useTranslation();
  const w = game.world;
  if (!w) return null;
  const topics = Object.entries(w.agenda)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const era = w.scenarioId ? t('ui.world.scenario', { name: t(`scenarios.${w.scenarioId}.name`) }) : t('ui.world.era');
  return (
    <View style={{ backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={Typography.dim}>◈ {t('ui.world.title')}</Text>
        <Text style={{ fontSize: 12, color: Colors.textDim }}>{era}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
        <View
          style={{
            backgroundColor: `${regimeColor(w.regime)}22`,
            borderColor: regimeColor(w.regime),
            borderWidth: 1,
            borderRadius: Radius.sm,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text style={{ color: regimeColor(w.regime), fontSize: 12, fontWeight: '700' }}>
            {t(`ui.world.regimes.${w.regime}`)}
          </Text>
        </View>
        <Text style={{ ...Typography.dim, fontSize: 12 }}>
          {t('ui.world.regimeMonths', {
            regime: t(`ui.world.regimes.${w.regime}`),
            n: regimeMonths(game) + 1,
          })}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Text style={{ ...Typography.dim, fontSize: 11 }}>{t('ui.world.agenda')}:</Text>
        {topics.map(([topic, weight]) => (
          <View
            key={topic}
            style={{
              backgroundColor: weight >= 0.8 ? `${Colors.gold}22` : Colors.surfaceAlt,
              borderWidth: 1,
              borderColor: weight >= 0.8 ? Colors.gold : Colors.border,
              borderRadius: Radius.sm,
              paddingHorizontal: 6,
              paddingVertical: 1,
            }}
          >
            <Text style={{ color: weight >= 0.8 ? Colors.gold : Colors.textDim, fontSize: 11 }}>
              {t(`ui.world.agendaTopics.${topic}`, { defaultValue: topic })}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.md, gap: 2 }}>
      <Text style={Typography.dim}>{label}</Text>
      <Text style={{ ...Typography.mono, fontSize: 16, color: color ?? Colors.text }}>{value}</Text>
    </View>
  );
}

const worldBannerStyle = {
  backgroundColor: Colors.surface,
  borderWidth: 1,
  borderColor: Colors.gold,
  borderRadius: Radius.md,
  padding: Spacing.md,
  gap: Spacing.sm,
};

export default function Dashboard() {
  const { t } = useTranslation();
  useCurrencySync();
  const game = useActiveGame();
  const dispatch = useGameStore((s) => s.dispatch);
  const [raiseDismissedTick, setRaiseDismissedTick] = useState<number | null>(null);

  if (!game) return null;

  // v7: the yearly raise review, derived at render (no effect needed). The
  // engine stamps lastReviewTick on every SET_SALARY (visible as salary_set
  // in the history), so >= 12 means a year went by without a review — asked
  // only while employed and playing. "Keep as is" stamps the cursor through
  // the sheet; dismissing outright only hides it for the current tick, so an
  // unanswered review honestly re-asks at the next month boundary.
  const raiseDue = game.status === 'PLAYING' && !!game.income?.employed && game.tick - game.income.lastReviewTick >= 12;
  const raiseOpen = raiseDue && raiseDismissedTick !== game.tick;

  const worth = netWorth(game);
  const portfolioValue = worth - game.cash;
  const blocked = game.pendingEvents.length > 0;
  const heirs = game.player.children.filter((c) => c.alive).length;
  // a vague gold whisper when a pending fate beat's window is open — veiled
  // destinies stay silent until their reveal
  const f = game.fate;
  const omenNear =
    !!f &&
    (f.revealedTick >= 0 || !isVeiled(f.destinyId)) &&
    f.beats.some((b) => b.status === 'PENDING' && game.tick >= b.window[0] && game.tick <= b.window[1]);

  return (
    <ScreenContainer centered={false}>
      <ScrollView contentContainerStyle={{ gap: Spacing.lg, paddingBottom: Spacing.xl }} bounces={false}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1 }}>
            <Text style={Typography.dim}>{formatGameDate(game, t)}</Text>
            {game.residency ? (
              <View style={{ backgroundColor: `${Colors.gold}22`, borderColor: Colors.gold, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ color: Colors.gold, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {t('ui.country.chip', {
                    country: t(`countries.${game.residency.countryId}.name`),
                    cpi: formatNumber(game.residency.cpi, 0),
                  })}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={{ ...Typography.dim, color: Colors.gold }}>
            {game.player.name} · {t('ui.dashboard.generation')} {game.player.generation}
          </Text>
        </View>

        <Animated.View entering={FadeInDown.duration(300)} style={{ gap: 4 }}>
          <Text style={Typography.dim}>{t('ui.dashboard.netWorth')}</Text>
          <MoneyText value={worth} />
          <Text style={Typography.dim}>
            {t('ui.dashboard.cash')}: {formatMoney(game.cash)} · {t('ui.dashboard.portfolio')}: {formatMoney(portfolioValue)}
          </Text>
        </Animated.View>

        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <Stat label={t('ui.dashboard.age')} value={String(ageYears(game))} />
          <Stat
            label={t('ui.dashboard.health')}
            value={`${Math.round(game.player.health)}/100`}
            color={game.player.health < 30 ? Colors.negative : game.player.health < 60 ? Colors.gold : Colors.positive}
          />
          <Stat label={t('ui.family.children')} value={String(heirs)} color={heirs === 0 ? Colors.gold : undefined} />
        </View>

        {heirs === 0 && !game.player.married ? (
          <Text style={{ color: Colors.gold, fontSize: 13 }}>⚠ {t('ui.dashboard.heirWarning')}</Text>
        ) : null}

        {game.world === null ? (
          <Animated.View entering={FadeInDown.duration(300)} style={worldBannerStyle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <View style={{ backgroundColor: `${Colors.gold}22`, borderColor: Colors.gold, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: Colors.gold, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>{t('ui.world.banner.badge')}</Text>
              </View>
              <Text style={{ ...Typography.h2, fontSize: 16, flex: 1 }}>{t('ui.world.banner.title')}</Text>
            </View>
            <Text style={Typography.dim}>{t('ui.world.banner.text')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                try {
                  dispatch({ type: 'INIT_WORLD' });
                } catch {
                  // already active — the banner disappears on the next render
                }
              }}
              style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.sm, alignItems: 'center' }}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{t('ui.world.banner.cta')}</Text>
            </Pressable>
          </Animated.View>
        ) : (
          <WorldCard game={game} />
        )}

        <PortfolioCard game={game} />

        <CashflowCard game={game} />

        {game.assets ? null : (
          <Text style={{ color: Colors.gold, fontSize: 13 }}>◆ {t('ui.dashboard.assetsHint')}</Text>
        )}

        {omenNear ? <Text style={{ color: Colors.gold, fontSize: 13, fontStyle: 'italic' }}>{t('fate.ui.omen')}</Text> : null}

        <View style={{ backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm }}>
          <Text style={Typography.dim}>{t('ui.dashboard.netWorthChart')}</Text>
          <LineChart data={game.netWorthHistory.slice(-120)} />
        </View>

        <View style={{ gap: Spacing.sm }}>
          <Text style={Typography.dim}>{t('ui.dashboard.marketSummary')}</Text>
          {Object.values(game.countries)
            .sort((a, b) => b.index - a.index)
            .slice(0, 3)
            .map((cs) => (
              <CountryRow key={cs.id} country={cs} holding={game.holdings[cs.id]} onPress={() => undefined} />
            ))}
        </View>
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: Spacing.sm, paddingTop: Spacing.sm }}>
        <View style={{ flex: 3 }}>
          <ChoiceButton
            label={t('ui.dashboard.nextMonth')}
            variant="primary"
            disabled={blocked || game.status !== 'PLAYING'}
            onPress={() => dispatch({ type: 'NEXT_MONTH' })}
          />
        </View>
        <View style={{ flex: 2 }}>
          <ChoiceButton
            label={t('ui.dashboard.fastForward')}
            disabled={blocked || game.status !== 'PLAYING'}
            onPress={() => dispatch({ type: 'FAST_FORWARD' })}
          />
        </View>
      </View>

      {raiseOpen ? <SalarySheet game={game} mode="raise" onClose={() => setRaiseDismissedTick(game.tick)} /> : null}
    </ScreenContainer>
  );
}
