import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { eventDef } from '@/engine';
import { formatMoney, formatNumber, useCurrencySync } from '@/lib/money';
import { formatGameDateShort } from '@/lib/time';
import { marketName } from '@/lib/labels';
import { useActiveGame } from '@/store/gameStore';
import { Colors, Radius, ScreenContainer, Spacing, Typography } from '@/theme';

/** History annotations from the asset layer — NOT catalog events (eventDef throws on these). */
const ASSET_LOG_EVENTS = new Set([
  'assets_init',
  'asset_bought',
  'asset_sold',
  'asset_forced_sale',
  'asset_listed',
  'asset_listing_cancelled',
  'asset_escrow_collected',
  'asset_granted',
  'asset_taken',
  'asset_activated',
]);
/** World-layer annotations (v4) — regime flips, scenario headlines, activation. */
const WORLD_LOG_EVENTS = new Set(['regime_change', 'world_news', 'world_init']);
/** Expense-layer annotations (v5) — activation only; monthly flow is not logged. */
const EXPENSES_LOG_EVENTS = new Set(['expenses_init']);
/** Yuva-layer annotations (v6) — role switches. */
const HOME_LOG_EVENTS = new Set(['home_set']);
/** Income-layer annotations (v7) — activation + salary changes (job_loss/job_return are catalog events). */
const INCOME_LOG_EVENTS = new Set(['income_init', 'salary_set']);
/** Residency-layer annotations (v8) — the home-country pick (no catalog EventDef, like every INIT). */
const RESIDENCY_LOG_EVENTS = new Set(['residency_init']);

export default function History() {
  const { t } = useTranslation();
  useCurrencySync();
  const game = useActiveGame();
  const entries = useMemo(() => (game ? [...game.eventLog].reverse() : []), [game]);

  if (!game) return null;

  return (
    <ScreenContainer centered={false}>
      <ScrollView contentContainerStyle={{ gap: Spacing.sm, paddingBottom: Spacing.xl }} bounces={false}>
        <Text style={Typography.h2}>{t('ui.history.title')}</Text>
        {entries.length === 0 ? <Text style={Typography.dim}>— {t('ui.history.empty')}</Text> : null}

        {entries.slice(0, 100).map((e, i) => {
          const isAssetLog = ASSET_LOG_EVENTS.has(e.eventId);
          const isWorldLog = WORLD_LOG_EVENTS.has(e.eventId);
          const isExpenseLog = EXPENSES_LOG_EVENTS.has(e.eventId);
          const isHomeLog = HOME_LOG_EVENTS.has(e.eventId);
          const isIncomeLog = INCOME_LOG_EVENTS.has(e.eventId);
          const isResidencyLog = RESIDENCY_LOG_EVENTS.has(e.eventId);
          const isAnnotation = isAssetLog || isWorldLog || isExpenseLog || isHomeLog || isIncomeLog || isResidencyLog;
          const def = isAnnotation ? undefined : eventDef(e.eventId);
          const isFate = def?.trigger === 'FATE';
          const isLife = def?.trigger === 'LIFE';
          const isForced = e.eventId === 'asset_forced_sale';
          const market = marketName(t, e.countryId);
          const title = isAssetLog
            ? t(`assets.log.${e.eventId}.title`)
            : isWorldLog
              ? t(`ui.world.log.${e.eventId}.title`)
              : isExpenseLog
                ? t('expenses.log.init.title')
                : isHomeLog
                  ? t('home.log.home_set.title')
                  : isIncomeLog
                    ? t(`income.log.${e.eventId}.title`)
                    : isResidencyLog
                      ? t('ui.country.log.residency_init.title')
                      : t(`events.${e.eventId}.title`, { country: market ?? '—' });
          const body = isAssetLog
            ? t(`assets.log.${e.eventId}.text`, {
                asset: marketName(t, e.assetId) ?? '—',
                units: e.assetUnits !== undefined ? formatNumber(e.assetUnits, e.assetUnits % 1 === 0 ? 0 : 2) : '—',
                amount: e.assetAmount !== undefined ? formatMoney(e.assetAmount) : '—',
              })
            : isWorldLog
              ? e.eventId === 'regime_change'
                ? t('ui.world.log.regime_change.text', { regime: t(`ui.world.regimes.${e.regimeId ?? 'growth'}`) })
                : e.eventId === 'world_news'
                  ? t(`scenarios.${e.newsId?.split(':')[0] ?? ''}.news.${e.newsId?.split(':')[1] ?? 0}`, {
                      defaultValue: e.newsId ?? '—',
                    })
                  : t('ui.world.log.world_init.text')
              : isExpenseLog
                ? t('expenses.log.init.text')
                : isHomeLog
                  ? t('home.log.home_set.text')
                  : isIncomeLog
                    ? t(`income.log.${e.eventId}.text`, {
                        amount: e.assetAmount !== undefined ? formatMoney(e.assetAmount) : '—',
                      })
                    : isResidencyLog
                      ? t('ui.country.log.residency_init.text', { country: t(`countries.${e.countryId ?? 'us'}.name`) })
                      : t(`events.${e.eventId}.text`, { country: market ?? '—' });
          const accent =
            isFate || isLife || isForced || isWorldLog || isExpenseLog || isHomeLog || isIncomeLog || isResidencyLog
              ? Colors.gold
              : Colors.accent;
          return (
            <Animated.View
              key={`${e.uid}-${e.optionIndex ?? ''}`}
              entering={FadeInDown.duration(200).delay(Math.min(i * 15, 300))}
              style={{
                backgroundColor: Colors.surface,
                borderWidth: 1,
                borderColor: Colors.border,
                borderLeftColor: accent,
                borderLeftWidth: 3,
                borderRadius: Radius.md,
                padding: Spacing.md,
                gap: 2,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: accent, fontSize: 11, fontWeight: '700' }}>
                  {formatGameDateShort(game, e.tick, t)} · {isFate ? '☾ ' : ''}
                  {title}
                </Text>
              </View>
              <Text style={Typography.dim}>{body}</Text>
              <Text style={{ ...Typography.dim, fontSize: 11, fontVariant: ['tabular-nums' as const] }}>
                {t('ui.dashboard.netWorth')}: {formatMoney(e.netWorth)} · {t('ui.dashboard.generation')} {e.generation}
              </Text>
            </Animated.View>
          );
        })}
      </ScrollView>
    </ScreenContainer>
  );
}
