import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeOutUp, SlideInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { balance, depositPayoutFor, depositRateFor } from '@/engine';
import type { GameState } from '@/engine';
import { formatDisplayAmount, formatMoney, formatPct, inputToUsd, useCurrencySync, usdToSeed } from '@/lib/money';
import { useGameStore } from '@/store/gameStore';
import { ChoiceButton } from './ChoiceButton';
import { Colors, Radius, Spacing, Typography } from '@/theme';

interface Props {
  game: GameState;
  onClose: () => void;
}

/**
 * Open-a-deposit sheet (v9). The rate comes from the ENGINE seam
 * (depositRateFor) — the term chip, the payout preview and the locked
 * annualRate can never drift. Interest is derived, never stored: the preview
 * builds a hypothetical deposit at today's tick and prices it with the same
 * formula the maturity path uses (HomeRoleSheet's hypothetical-state pattern).
 */
export function DepositSheet({ game, onClose }: Props) {
  const { t } = useTranslation();
  const dispatch = useGameStore((s) => s.dispatch);
  useCurrencySync();
  const [term, setTerm] = useState<number>(balance.DEPOSITS.TERMS[balance.DEPOSITS.TERMS.length - 1]);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rate = depositRateFor(game, term);
  const usd = inputToUsd(Number(amount.replace(',', '.')) || 0);
  const payout =
    usd > 0
      ? depositPayoutFor({ uid: 'hypothetical', principal: usd, annualRate: rate, openedTick: game.tick, termMonths: term })
      : 0;

  const submit = () => {
    setError(null);
    try {
      dispatch({ type: 'OPEN_DEPOSIT', amount: usd, termMonths: term });
      onClose();
    } catch (e) {
      const code = e instanceof Error ? e.message : 'UNKNOWN';
      setError(
        // TOO_SMALL's shared text speaks of buying one unit — deposits have
        // their own floor, so intercept the code and name the minimum
        code === 'TOO_SMALL'
          ? t('ui.deposits.sheet.tooSmall', { min: formatMoney(balance.DEPOSITS.MIN_AMOUNT) })
          : t(`ui.errors.${code}`, { defaultValue: t('ui.errors.UNKNOWN') }),
      );
    }
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable onPress={() => undefined}>
          <Animated.View entering={SlideInDown.springify().damping(18)} exiting={FadeOutUp.duration(200)} style={styles.sheet}>
            <Text style={Typography.h2}>{t('ui.deposits.sheet.title')}</Text>
            <Text style={Typography.dim}>{t('ui.deposits.sheet.rateLine')}</Text>

            <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
              {balance.DEPOSITS.TERMS.map((m) => (
                <TermPill
                  key={m}
                  testID={`deposit-term-${m}`}
                  label={t('ui.deposits.sheet.termChip', { n: m, rate: formatPct(depositRateFor(game, m)) })}
                  active={term === m}
                  onPress={() => {
                    setTerm(m);
                    setError(null);
                  }}
                />
              ))}
            </View>

            <TextInput
              value={amount}
              onChangeText={(v) => {
                setAmount(v);
                setError(null);
              }}
              keyboardType="decimal-pad"
              autoFocus
              testID="deposit-amount"
              placeholder={t('ui.invest.amount')}
              placeholderTextColor={Colors.textDim}
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <Quick label={formatDisplayAmount(game.cash * 0.5)} onPress={() => setAmount(usdToSeed(game.cash * 0.5))} />
              <Quick label={formatDisplayAmount(game.cash)} onPress={() => setAmount(usdToSeed(game.cash))} />
            </View>

            {usd > 0 ? (
              <Text style={{ ...Typography.dim, color: Colors.positive }}>
                {t('ui.deposits.sheet.payoutPreview', { amount: formatMoney(payout), interest: formatMoney(payout - usd) })}
              </Text>
            ) : null}
            {game.deposits.length >= balance.DEPOSITS.MAX_OPEN ? (
              <Text style={{ ...Typography.dim, fontSize: 13 }}>
                {t('ui.deposits.sheet.max', { n: balance.DEPOSITS.MAX_OPEN })}
              </Text>
            ) : null}
            {error ? <Text style={{ color: Colors.negative, fontSize: 13 }}>{error}</Text> : null}

            <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm }}>
              <View style={{ flex: 1 }}>
                <ChoiceButton label={t('common.cancel')} onPress={onClose} />
              </View>
              <View style={{ flex: 1 }}>
                <ChoiceButton label={t('ui.deposits.sheet.open')} variant="primary" onPress={submit} />
              </View>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TermPill({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      testID={testID}
      style={{
        flex: 1,
        alignItems: 'center',
        backgroundColor: active ? Colors.primary : Colors.surfaceAlt,
        borderWidth: 1,
        borderColor: active ? 'transparent' : Colors.border,
        borderRadius: Radius.sm,
        paddingVertical: Spacing.sm,
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
