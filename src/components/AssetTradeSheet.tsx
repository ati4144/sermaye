import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeOutUp, SlideInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { assetDef, assetFeeFor, assetPrice, balance, effectiveQuickDiscount, escrowProceedsFor } from '@/engine';
import type { GameState } from '@/engine';
import { formatDisplayAmount, formatMoney, formatNumber, inputToUsd, useCurrencySync, usdToSeed } from '@/lib/money';
import { useGameStore } from '@/store/gameStore';
import { ChoiceButton } from './ChoiceButton';
import { AnalystLine } from './AnalystLine';
import { Colors, Radius, Spacing, Typography } from '@/theme';

interface Props {
  game: GameState;
  assetId: string;
  onClose: () => void;
}

/**
 * Buy/sell/list sheet for asset classes. FRACTIONAL (gold) trades by amount
 * like countries; DEED classes trade in whole units via a stepper, with the
 * real cost (floor + remainder stays in the wallet) and the quick-sale
 * discount previewed up front. The third mode — list — is the v6 escrow path
 * (DEED only): proceeds lock at price × (1−fee) today and pay out
 * ESCROW_MONTHS later, with no fire-sale discount. Prices come from state —
 * nothing here draws.
 */
export function AssetTradeSheet({ game, assetId, onClose }: Props) {
  const { t } = useTranslation();
  const dispatch = useGameStore((s) => s.dispatch);
  useCurrencySync();
  const def = assetDef(assetId);
  const price = assetPrice(game, assetId);
  const fee = assetFeeFor(game, assetId);
  const holding = def.kind === 'FRACTIONAL' ? game.holdings[assetId] : undefined;
  const position = def.kind === 'DEED' ? game.properties[assetId] : undefined;
  const listings = game.pendingSales.filter((ps) => ps.assetId === assetId);

  const [mode, setMode] = useState<'buy' | 'sell' | 'list'>(holding || position ? 'sell' : 'buy');
  const [amount, setAmount] = useState('');
  const [units, setUnits] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const maxAffordable = Math.floor((game.cash * (1 - fee)) / price);
  const ownedUnits = holding?.units ?? position?.units ?? 0;

  // Switching modes changes what the inputs mean — the DEED stepper's cap
  // flips between maxAffordable and ownedUnits, and a FRACTIONAL `amount`
  // flips dollars↔units outright. Re-clamp / clear instead of reinterpreting
  // a stale value.
  const switchMode = (next: 'buy' | 'sell' | 'list') => {
    setMode(next);
    setError(null);
    if (def.kind === 'DEED') {
      setUnits((u) => Math.min(u, Math.max(1, next === 'buy' ? maxAffordable : ownedUnits)));
    } else {
      setAmount('');
    }
  };

  const submit = () => {
    setError(null);
    try {
      if (def.kind === 'FRACTIONAL') {
        const n = Number(amount.replace(',', '.'));
        if (!Number.isFinite(n) || n <= 0) {
          setError(t('ui.errors.INVALID_AMOUNT'));
          return;
        }
        if (mode === 'buy') {
          // FRACTIONAL buy amounts are typed in the display currency; the
          // engine takes USD (sell mode's `amount` is units — untouched)
          dispatch({ type: 'BUY_ASSET', assetId, amount: inputToUsd(n) });
        } else {
          dispatch({ type: 'SELL_ASSET', assetId, units: Math.min(n, ownedUnits) });
        }
      } else if (mode === 'buy') {
        // the engine floors whole units and charges only the real cost; the
        // quarter-unit slack guarantees the floor lands on `units` exactly
        dispatch({ type: 'BUY_ASSET', assetId, amount: (units * price) / (1 - fee) + price * 0.25 });
      } else if (mode === 'list') {
        // escrow: proceeds lock at listing; the sheet preview and the engine
        // share escrowProceedsFor so the number can never drift
        dispatch({ type: 'LIST_ASSET', assetId, units });
      } else {
        dispatch({ type: 'SELL_ASSET', assetId, units });
      }
      onClose();
    } catch (e) {
      const code = e instanceof Error ? e.message : 'UNKNOWN';
      setError(t(`ui.errors.${code}`, { defaultValue: t('ui.errors.UNKNOWN') }));
    }
  };

  const sellProceeds =
    def.kind === 'DEED' && mode === 'sell'
      ? units * price * (1 - fee) * (1 - effectiveQuickDiscount(game, assetId))
      : 0;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable onPress={() => undefined}>
          <Animated.View entering={SlideInDown.springify().damping(18)} exiting={FadeOutUp.duration(200)} style={styles.sheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={Typography.h2}>{t(`assets.${assetId}.name`)}</Text>
              <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                <Pill label={t('ui.invest.buy')} active={mode === 'buy'} onPress={() => switchMode('buy')} />
                <Pill label={t('ui.invest.sell')} active={mode === 'sell'} disabled={ownedUnits <= 0} onPress={() => switchMode('sell')} />
                {def.kind === 'DEED' ? (
                  <Pill label={t('ui.invest.list')} active={mode === 'list'} disabled={ownedUnits <= 0} onPress={() => switchMode('list')} />
                ) : null}
              </View>
            </View>
            <Text style={Typography.dim}>
              {t('ui.invest.price')}: {formatMoney(price, { decimals: price < 1000 ? 2 : 0 })} · {t('ui.invest.fee')}:{' '}
              {(fee * 100).toFixed(2)}%
              {def.kind === 'DEED' ? ` · ${t('ui.invest.quickDiscount')}: ${(effectiveQuickDiscount(game, assetId) * 100).toFixed(0)}%` : ''}
            </Text>
            <AnalystLine game={game} marketId={assetId} />

            {def.kind === 'FRACTIONAL' ? (
              <>
                <TextInput
                  value={amount}
                  onChangeText={(v) => {
                    setAmount(v);
                    setError(null);
                  }}
                  keyboardType="decimal-pad"
                  autoFocus
                  testID="asset-amount"
                  placeholder={mode === 'buy' ? t('ui.invest.amount') : t('ui.invest.units')}
                  placeholderTextColor={Colors.textDim}
                  style={styles.input}
                />
                <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                  {mode === 'buy' ? (
                    <>
                      <Quick label={formatDisplayAmount(game.cash * 0.5)} onPress={() => setAmount(usdToSeed(game.cash * 0.5))} />
                      <Quick label={formatDisplayAmount(game.cash)} onPress={() => setAmount(usdToSeed(game.cash))} />
                    </>
                  ) : (
                    <>
                      <Quick label={t('ui.invest.half')} onPress={() => setAmount(String(ownedUnits / 2))} />
                      <Quick label={t('ui.invest.all')} onPress={() => setAmount(String(ownedUnits))} />
                    </>
                  )}
                </View>
                {mode === 'buy' && Number(amount) > 0 ? (
                  <Text style={Typography.dim}>
                    ≈ {formatNumber((inputToUsd(Number(amount.replace(',', '.'))) * (1 - fee)) / price, 2)} {t('ui.invest.units')}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, paddingVertical: Spacing.sm }}>
                  <StepperBtn
                    label="−"
                    disabled={units <= 1}
                    onPress={() => {
                      setUnits((u) => Math.max(1, u - 1));
                      setError(null);
                    }}
                  />
                  <Text style={{ ...Typography.stat, minWidth: 96, textAlign: 'center' }}>
                    {formatNumber(units, 0)}{' '}
                    <Text style={Typography.dim}>{t(`assets.${assetId}.unit`, { count: units })}</Text>
                  </Text>
                  <StepperBtn
                    label="+"
                    disabled={mode === 'buy' ? units >= maxAffordable : units >= ownedUnits}
                    onPress={() => {
                      setUnits((u) => u + 1);
                      setError(null);
                    }}
                  />
                </View>
                {mode === 'buy' ? (
                  <>
                    <Text style={Typography.dim}>
                      {t('ui.invest.cost')}: {formatMoney((units * price) / (1 - fee))} · {t('ui.invest.maxAffordable', { n: formatNumber(Math.max(0, maxAffordable)) })}
                    </Text>
                    {maxAffordable < 1 ? (
                      <Text style={{ color: Colors.negative, fontSize: 13 }}>{t('ui.errors.INSUFFICIENT_CASH')}</Text>
                    ) : null}
                  </>
                ) : mode === 'list' ? (
                  <Text style={{ ...Typography.dim, color: Colors.positive }}>
                    {t('ui.invest.escrowPreview', {
                      n: balance.ASSETS.ESCROW_MONTHS,
                      amount: formatMoney(escrowProceedsFor(game, assetId, units)),
                    })}
                  </Text>
                ) : (
                  <Text style={Typography.dim}>
                    {t('ui.invest.proceeds')}: {formatMoney(sellProceeds)}{' '}
                    {units > 0
                      ? `(${formatMoney(price * (1 - fee) * (1 - effectiveQuickDiscount(game, assetId)) - price, { sign: true })} ${t('ui.invest.perUnit', { unit: t(`assets.${assetId}.unit`) })})`
                      : ''}
                  </Text>
                )}
              </>
            )}

            {error ? <Text style={{ color: Colors.negative, fontSize: 13 }}>{error}</Text> : null}

            {def.kind === 'DEED' && listings.length > 0 ? (
              <View style={{ gap: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm }}>
                <Text style={{ ...Typography.dim, fontSize: 11, fontWeight: '700' }}>{t('ui.invest.pendingSales')}</Text>
                {listings.map((ps) => (
                  <View key={ps.uid} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm }}>
                    <Text style={{ ...Typography.dim, fontSize: 12, flex: 1 }}>
                      {formatNumber(ps.units, 0)} {t(`assets.${assetId}.unit`, { count: ps.units })} · {formatMoney(ps.proceeds)} ·{' '}
                      {t('ui.invest.monthsLeft', { n: Math.max(0, ps.dueTick - game.tick) })}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => {
                        try {
                          dispatch({ type: 'CANCEL_LISTING', uid: ps.uid });
                        } catch (e) {
                          const code = e instanceof Error ? e.message : 'UNKNOWN';
                          setError(t(`ui.errors.${code}`, { defaultValue: t('ui.errors.UNKNOWN') }));
                        }
                      }}
                      style={{ backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs }}
                    >
                      <Text style={{ color: Colors.negative, fontWeight: '600', fontSize: 12 }}>{t('ui.invest.cancelListing')}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm }}>
              <View style={{ flex: 1 }}>
                <ChoiceButton label={t('common.cancel')} onPress={onClose} />
              </View>
              <View style={{ flex: 1 }}>
                <ChoiceButton
                  label={mode === 'buy' ? t('ui.invest.buy') : mode === 'list' ? t('ui.invest.list') : t('ui.invest.sell')}
                  variant="primary"
                  disabled={
                    def.kind === 'DEED' &&
                    (mode === 'buy' ? maxAffordable < 1 : ownedUnits <= 0 || units > ownedUnits)
                  }
                  onPress={submit}
                />
              </View>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Pill({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
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

function Quick({ label, onPress }: { label: string; onPress: () => void }) {
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

function StepperBtn({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      style={{
        backgroundColor: disabled ? Colors.surfaceAlt : Colors.primary,
        borderWidth: 1,
        borderColor: disabled ? Colors.border : 'transparent',
        borderRadius: Radius.md,
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '700' }}>{label}</Text>
    </Pressable>
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
});
