import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp, SlideInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { accruedDepositInterest, ASSETS_CATALOG, feeRateFor } from '@/engine';
import { ChoiceButton } from '@/components/ChoiceButton';
import { CountryRow } from '@/components/CountryRow';
import { AssetRow } from '@/components/AssetRow';
import { AssetTradeSheet } from '@/components/AssetTradeSheet';
import { DepositSheet } from '@/components/DepositSheet';
import { AnalystLine } from '@/components/AnalystLine';
import type { CountryState, GameState } from '@/engine';
import { formatDisplayAmount, formatMoney, formatNumber, formatPct, inputToUsd, useCurrencySync, usdToSeed } from '@/lib/money';
import { useActiveGame, useGameStore } from '@/store/gameStore';
import { Colors, Radius, ScreenContainer, Spacing, Typography } from '@/theme';

type Mode = { kind: 'buy'; country: CountryState } | { kind: 'sell'; country: CountryState } | null;
type Segment = 'stocks' | 'metals' | 'property' | 'vehicles' | 'deposits';

const SEGMENTS: Segment[] = ['stocks', 'metals', 'property', 'vehicles', 'deposits'];
const SEGMENT_CATEGORIES: Record<Segment, string[]> = {
  stocks: [],
  metals: ['METAL'],
  property: ['REAL_ESTATE', 'LAND'],
  vehicles: ['VEHICLE'],
  deposits: [], // the fixed panel — no catalog entries behind it
};

export default function Invest() {
  const { t } = useTranslation();
  useCurrencySync();
  const game = useActiveGame();
  const dispatch = useGameStore((s) => s.dispatch);
  const [mode, setMode] = useState<Mode>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>('stocks');
  const [depositOpen, setDepositOpen] = useState(false);

  const sorted = useMemo(() => (game ? Object.values(game.countries).sort((a, b) => a.id.localeCompare(b.id)) : []), [game]);
  const segmentAssets = useMemo(
    () =>
      ASSETS_CATALOG.filter((d) => SEGMENT_CATEGORIES[segment].includes(d.category) && !!game?.assets?.markets[d.id]).map(
        (d) => d.id,
      ),
    [segment, game],
  );

  if (!game) return null;

  const openTrade = (id: string) => {
    setError(null);
    setAmount('');
    setMode({ kind: game.holdings[id] ? 'sell' : 'buy', country: game.countries[id] });
  };

  const openAsset = (id: string) => {
    setError(null);
    setAssetId(id);
  };

  const submit = () => {
    if (!mode) return;
    const n = Number(amount.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setError(t('ui.errors.INVALID_AMOUNT'));
      return;
    }
    try {
      if (mode.kind === 'buy') {
        // buy amounts are typed in the display currency; the engine takes USD
        // (sell mode's `amount` is units — untouched)
        dispatch({ type: 'BUY', countryId: mode.country.id, amount: inputToUsd(n) });
      } else {
        const max = game.holdings[mode.country.id]?.units ?? 0;
        dispatch({ type: 'SELL', countryId: mode.country.id, units: Math.min(n, max) });
      }
      setMode(null);
    } catch (e) {
      const code = e instanceof Error ? e.message : 'UNKNOWN';
      setError(t(`ui.errors.${code}`, { defaultValue: t('ui.errors.UNKNOWN') }));
    }
  };

  const activateAssets = () => {
    try {
      dispatch({ type: 'INIT_ASSETS' });
    } catch {
      // already active — the banner disappears on the next render anyway
    }
  };

  return (
    <ScreenContainer centered={false}>
      <ScrollView contentContainerStyle={{ gap: Spacing.sm, paddingBottom: Spacing.xl }} bounces={false}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={Typography.h2}>{t('ui.invest.title')}</Text>
          <Text style={Typography.dim}>
            {t('ui.dashboard.cash')}: <Text style={{ color: Colors.text }}>{formatMoney(game.cash)}</Text>
          </Text>
        </View>

        {game.assets === null ? (
          <Animated.View entering={FadeInDown.duration(300)} style={styles.banner}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <View style={styles.badge}>
                <Text style={{ color: Colors.gold, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>{t('ui.invest.assetsBanner.badge')}</Text>
              </View>
              <Text style={{ ...Typography.h2, fontSize: 16, flex: 1 }}>{t('ui.invest.assetsBanner.title')}</Text>
            </View>
            <Text style={Typography.dim}>{t('ui.invest.assetsBanner.text')}</Text>
            <ChoiceButton label={t('ui.invest.assetsBanner.cta')} variant="primary" onPress={activateAssets} />
          </Animated.View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
          {SEGMENTS.map((seg) => (
            <Pressable
              key={seg}
              onPress={() => setSegment(seg)}
              accessibilityRole="button"
              style={{
                flex: 1,
                alignItems: 'center',
                backgroundColor: segment === seg ? Colors.primary : Colors.surface,
                borderWidth: 1,
                borderColor: segment === seg ? 'transparent' : Colors.border,
                borderRadius: Radius.pill,
                paddingVertical: Spacing.sm,
              }}
            >
              <Text style={{ color: segment === seg ? '#FFFFFF' : Colors.textDim, fontWeight: '700', fontSize: 12 }}>
                {t(`ui.invest.segments.${seg}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        {segment === 'deposits' ? (
          <DepositPanel game={game} onOpen={() => setDepositOpen(true)} />
        ) : segment === 'stocks' ? (
          sorted.map((cs, i) => (
            <Animated.View key={cs.id} entering={FadeInDown.duration(250).delay(i * 30)}>
              <CountryRow country={cs} holding={game.holdings[cs.id]} onPress={() => openTrade(cs.id)} />
            </Animated.View>
          ))
        ) : game.assets === null
            ? // legacy save: the segment is inert until INIT_ASSETS runs — point
              // at the banner above instead of rendering a blank body
              <Text style={{ ...Typography.dim, fontSize: 13, textAlign: 'center', paddingVertical: Spacing.lg }}>
                ◆ {t('ui.invest.assetsLocked')}
              </Text>
            : segmentAssets.map((id, i) => (
                <Animated.View key={id} entering={FadeInDown.duration(250).delay(i * 30)}>
                  <AssetRow game={game} assetId={id} onPress={() => openAsset(id)} />
                </Animated.View>
              ))}
      </ScrollView>

      <Modal transparent visible={mode !== null} animationType="none" onRequestClose={() => setMode(null)}>
        {mode ? (
          <Pressable style={styles.overlay} onPress={() => setMode(null)}>
            <Pressable onPress={() => undefined}>
              <Animated.View entering={SlideInDown.springify().damping(18)} exiting={FadeOutUp.duration(200)} style={styles.sheet}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={Typography.h2}>{t(`countries.${mode.country.id}.name`)}</Text>
                  <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                    <ModeToggle label={t('ui.invest.buy')} active={mode.kind === 'buy'} onPress={() => setMode({ ...mode, kind: 'buy' })} />
                    <ModeToggle
                      label={t('ui.invest.sell')}
                      active={mode.kind === 'sell'}
                      disabled={!game.holdings[mode.country.id]}
                      onPress={() => setMode({ ...mode, kind: 'sell' })}
                    />
                  </View>
                </View>
                <Text style={Typography.dim}>
                  {t('ui.invest.fee')}: {(feeRateFor(game, mode.country.id) * 100).toFixed(2)}% · {t('ui.invest.avgCost')}:{' '}
                  {formatMoney(game.holdings[mode.country.id]?.avgCost ?? mode.country.index, { decimals: 2 })}
                </Text>
                <AnalystLine game={game} marketId={mode.country.id} />

                <TextInput
                  value={amount}
                  onChangeText={(v) => {
                    setAmount(v);
                    setError(null);
                  }}
                  keyboardType="decimal-pad"
                  autoFocus
                  testID="trade-amount"
                  placeholder={mode.kind === 'buy' ? t('ui.invest.amount') : t('ui.invest.units')}
                  placeholderTextColor={Colors.textDim}
                  style={styles.input}
                />

                {mode.kind === 'buy' ? (
                  <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                    <QuickAmount label={formatDisplayAmount(game.cash * 0.5)} onPress={() => setAmount(usdToSeed(game.cash * 0.5))} />
                    <QuickAmount label={formatDisplayAmount(game.cash)} onPress={() => setAmount(usdToSeed(game.cash))} />
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                    <QuickAmount
                      label={t('ui.invest.half')}
                      onPress={() => setAmount(String(game.holdings[mode.country.id].units / 2))}
                    />
                    <QuickAmount label={t('ui.invest.all')} onPress={() => setAmount(String(game.holdings[mode.country.id].units))} />
                  </View>
                )}

                {mode.kind === 'buy' && Number(amount) > 0 ? (
                  <Text style={Typography.dim}>
                    ≈ {formatNumber((inputToUsd(Number(amount.replace(',', '.'))) * (1 - feeRateFor(game, mode.country.id))) / mode.country.index, 2)}{' '}
                    {t('ui.invest.units')}
                  </Text>
                ) : null}
                {error ? <Text style={{ color: Colors.negative, fontSize: 13 }}>{error}</Text> : null}

                <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <ChoiceButton label={t('common.cancel')} onPress={() => setMode(null)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ChoiceButton
                      label={mode.kind === 'buy' ? t('ui.invest.buy') : t('ui.invest.sell')}
                      variant="primary"
                      onPress={submit}
                    />
                  </View>
                </View>
              </Animated.View>
            </Pressable>
          </Pressable>
        ) : null}
      </Modal>

      {assetId && game.assets ? <AssetTradeSheet game={game} assetId={assetId} onClose={() => setAssetId(null)} /> : null}
      {depositOpen ? <DepositSheet game={game} onClose={() => setDepositOpen(false)} /> : null}
    </ScreenContainer>
  );
}

function QuickAmount({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{ backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm }}
    >
      <Text style={{ color: Colors.accent, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function ModeToggle({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={{
        backgroundColor: active ? Colors.primary : Colors.surfaceAlt,
        borderWidth: 1,
        borderColor: active ? 'transparent' : Colors.border,
        borderRadius: Radius.sm,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ color: active ? '#FFFFFF' : Colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/**
 * The v9 Mevduat panel — the fixed body of the deposits segment. Open
 * positions: principal · locked rate · months left · accrued interest (the
 * same derived-from-state seam netWorth uses) with a two-tap Boz — the break
 * forfeits ALL accrued interest, so the first tap asks, the second acts.
 */
function DepositPanel({ game, onOpen }: { game: GameState; onOpen: () => void }) {
  const { t } = useTranslation();
  const dispatch = useGameStore((s) => s.dispatch);
  const [confirmUid, setConfirmUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const breakDeposit = (uid: string) => {
    try {
      dispatch({ type: 'BREAK_DEPOSIT', uid });
      setConfirmUid(null);
    } catch (e) {
      const code = e instanceof Error ? e.message : 'UNKNOWN';
      setError(t(`ui.errors.${code}`, { defaultValue: t('ui.errors.UNKNOWN') }));
    }
  };

  return (
    <Animated.View entering={FadeInDown.duration(250)} style={styles.depPanel}>
      {game.deposits.length === 0 ? (
        <Text style={{ ...Typography.dim, fontSize: 13, textAlign: 'center', paddingVertical: Spacing.sm }}>
          {t('ui.deposits.panel.empty')}
        </Text>
      ) : (
        game.deposits.map((d) => {
          const monthsLeft = Math.max(0, d.openedTick + d.termMonths - game.tick);
          const accrued = accruedDepositInterest(d, game.tick);
          const confirming = confirmUid === d.uid;
          return (
            <View key={d.uid} style={styles.depRow}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm }}>
                <Text style={{ ...Typography.h2, fontSize: 15, fontVariant: ['tabular-nums'] }}>{formatMoney(d.principal)}</Text>
                <Text style={{ color: Colors.accent, fontWeight: '700', fontSize: 13, fontVariant: ['tabular-nums'] }}>
                  {formatPct(d.annualRate)} · {t('ui.deposits.panel.monthsLeft', { n: monthsLeft })}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ ...Typography.dim, fontSize: 12 }}>
                  {t('ui.deposits.panel.accrued')}:{' '}
                  <Text style={{ color: Colors.positive, fontWeight: '600' }}>{formatMoney(accrued)}</Text>
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  testID={`deposit-break-${d.uid}`}
                  onPress={() => (confirming ? breakDeposit(d.uid) : setConfirmUid(d.uid))}
                  style={{
                    backgroundColor: confirming ? Colors.negative : Colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: confirming ? 'transparent' : Colors.border,
                    borderRadius: Radius.sm,
                    paddingHorizontal: Spacing.md,
                    paddingVertical: Spacing.xs,
                  }}
                >
                  <Text style={{ color: confirming ? '#FFFFFF' : Colors.negative, fontWeight: '600', fontSize: 12 }}>
                    {confirming ? t('ui.deposits.panel.breakWarning') : t('ui.deposits.panel.break')}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
      {error ? <Text style={{ color: Colors.negative, fontSize: 13 }}>{error}</Text> : null}
      <Text style={{ ...Typography.dim, fontSize: 11 }}>{t('ui.deposits.panel.locked')}</Text>
      <ChoiceButton label={t('ui.deposits.panel.open')} variant="primary" onPress={onOpen} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    color: Colors.text,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  banner: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  badge: {
    backgroundColor: `${Colors.gold}22`,
    borderColor: Colors.gold,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  depPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  depRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: 2,
  },
});
