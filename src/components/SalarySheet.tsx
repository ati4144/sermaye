import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeOutUp, SlideInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { HOME_INFLATION } from '@/engine';
import type { GameState } from '@/engine';
import { displayCurrencyCode, formatMoney, inputToUsd, usdToSeed, useCurrencySync } from '@/lib/money';
import { useGameStore } from '@/store/gameStore';
import { ChoiceButton } from './ChoiceButton';
import { Colors, Radius, Spacing, Typography } from '@/theme';

interface Props {
  game: GameState;
  /** 'raise' — the yearly review the dashboard opens; 'edit' — the salary row tap. */
  mode: 'raise' | 'edit';
  onClose: () => void;
}

/**
 * Salary editor sheet (v7 income layer). Two headline modes: 'raise' is the
 * yearly review the dashboard opens once 12 months pass since the last one;
 * 'edit' is the manual path from the CashflowCard salary row. Both buttons
 * save through SET_SALARY — including "keep as is", deliberately: the engine
 * stamps lastReviewTick on every save, which is the durable marker that this
 * year's review happened (otherwise the prompt would re-ask every month
 * until a change was made). Zero-draw: nothing here moves the rng.
 */
export function SalarySheet({ game, mode, onClose }: Props) {
  const { t } = useTranslation();
  const dispatch = useGameStore((s) => s.dispatch);
  useCurrencySync();
  const income = game.income;
  const [value, setValue] = useState(income ? usdToSeed(income.salaryM) : '');
  const [error, setError] = useState<string | null>(null);

  if (!income) return null;

  const save = () => {
    setError(null);
    const n = Number(value.trim().replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setError(t('ui.errors.INVALID_AMOUNT'));
      return;
    }
    try {
      // the sheet speaks the display currency; the engine stores USD
      dispatch({ type: 'SET_SALARY', salaryM: inputToUsd(n) });
      onClose();
    } catch (e) {
      const code = e instanceof Error ? e.message : 'UNKNOWN';
      setError(t(`ui.errors.${code}`, { defaultValue: t('ui.errors.UNKNOWN') }));
    }
  };

  const keep = () => {
    try {
      // stamp the review cursor so the yearly prompt waits another year
      dispatch({ type: 'SET_SALARY', salaryM: income.salaryM });
    } catch {
      // unreachable while income is non-null; if state changed underneath
      // us, the next render closes the sheet via the banner branch anyway
    }
    onClose();
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable onPress={() => undefined}>
          <Animated.View entering={SlideInDown.springify().damping(18)} exiting={FadeOutUp.duration(200)} style={styles.sheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={Typography.h2}>{mode === 'raise' ? t('ui.income.sheet.raiseTitle') : t('ui.income.sheet.title')}</Text>
              <Pressable hitSlop={8} onPress={onClose}>
                <Text style={{ color: Colors.accent, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>

            {mode === 'raise' ? <Text style={Typography.dim}>{t('ui.income.sheet.raiseText')}</Text> : null}
            {mode === 'raise' && game.residency ? (
              // v8: the raise review IS the inflation defense (salary stays
              // nominal by the locked scope decision) — show the yardstick
              <Text style={{ ...Typography.dim, fontSize: 11, fontStyle: 'italic' }}>
                {t('ui.country.raiseHint', { pct: Math.round((HOME_INFLATION[game.residency.countryId] ?? 0) * 100) })}
              </Text>
            ) : null}

            <View style={{ gap: 2 }}>
              <Text style={Typography.dim}>{t('ui.income.sheet.current')}</Text>
              <Text style={Typography.mono}>{formatMoney(income.salaryM)}</Text>
              {!income.employed ? <Text style={{ color: Colors.gold, fontSize: 12 }}>{t('ui.income.flow.unemployed')}</Text> : null}
            </View>

            <TextInput
              value={value}
              onChangeText={(v) => {
                setValue(v);
                setError(null);
              }}
              keyboardType="decimal-pad"
              testID="salary-input"
              placeholder={t('ui.income.sheet.inputLabel', { unit: displayCurrencyCode() })}
              placeholderTextColor={Colors.textDim}
              style={styles.input}
            />
            {error ? <Text style={{ color: Colors.negative, fontSize: 13 }}>{error}</Text> : null}

            <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm }}>
              <View style={{ flex: 1 }}>
                <ChoiceButton label={mode === 'raise' ? t('ui.income.sheet.keep') : t('common.cancel')} onPress={mode === 'raise' ? keep : onClose} />
              </View>
              <View style={{ flex: 1 }}>
                <ChoiceButton label={t('ui.income.sheet.save')} variant="primary" onPress={save} />
              </View>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
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
