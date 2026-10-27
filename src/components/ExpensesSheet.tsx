import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeOutUp, SlideInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { cpiMult, LIFESTYLE_TIERS, livingClampFor, netWorth, roundCash } from '@/engine';
import type { GameState, LifestyleTier } from '@/engine';
import { formatMoney, inputToUsd, useCurrencySync, usdToSeed } from '@/lib/money';
import { useGameStore } from '@/store/gameStore';
import { ChoiceButton } from './ChoiceButton';
import { Colors, Radius, Spacing, Typography } from '@/theme';

interface Props {
  game: GameState;
  onClose: () => void;
}

/**
 * Expense CRUD sheet: lifestyle tier pills (SET_LIFESTYLE), the item list
 * with inline amount editing (UPDATE_EXPENSE) and removal (REMOVE_EXPENSE),
 * plus a custom-item form (ADD_EXPENSE). Everything dispatches engine
 * actions — validation and error codes live in the engine, mapped through
 * i18n here. All actions are zero-draw.
 */
export function ExpensesSheet({ game, onClose }: Props) {
  const { t } = useTranslation();
  const dispatch = useGameStore((s) => s.dispatch);
  useCurrencySync();
  const e = game.expenses;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!e) return null;

  const itemsTotal = e.items.reduce((a, it) => a + it.amount, 0);
  // The footer must agree with what the tick actually charges — the v8
  // livingClampFor seam (sim.ts phase 4b verbatim): the basket AND the
  // LIVING.MAX cap index by the cumulative home CPI (items beyond the cap
  // are simply not spent), the levy term does not, and the fate livingCost
  // multiplier scales the whole thing. Showing the raw item sum here would
  // contradict both the engine and the CashflowCard estimate.
  const fateMult = game.fate?.mods.livingCost ?? 1;
  const charge = livingClampFor(game, itemsTotal, netWorth(game));
  const itemsPart = Math.min(itemsTotal * cpiMult(game), charge);
  const levy = charge - itemsPart;

  const mapError = (err: unknown) => {
    const code = err instanceof Error ? err.message : 'UNKNOWN';
    setError(t(`ui.errors.${code}`, { defaultValue: t('ui.errors.UNKNOWN') }));
  };

  const chooseTier = (tier: LifestyleTier) => {
    setError(null);
    try {
      dispatch({ type: 'SET_LIFESTYLE', tier });
    } catch (err) {
      mapError(err);
    }
  };

  const commitEdit = () => {
    if (!editingId) return;
    const n = Number(editVal.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setError(t('ui.errors.INVALID_AMOUNT'));
      return;
    }
    try {
      // the sheet speaks the display currency; the engine stores USD
      dispatch({ type: 'UPDATE_EXPENSE', id: editingId, amount: inputToUsd(n) });
      setEditingId(null);
      setError(null);
    } catch (err) {
      mapError(err);
    }
  };

  const remove = (id: string) => {
    setError(null);
    try {
      dispatch({ type: 'REMOVE_EXPENSE', id });
    } catch (err) {
      mapError(err);
    }
  };

  const add = () => {
    const n = Number(newAmount.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setError(t('ui.errors.INVALID_AMOUNT'));
      return;
    }
    try {
      dispatch({ type: 'ADD_EXPENSE', label: newLabel, amount: inputToUsd(n) });
      setNewLabel('');
      setNewAmount('');
      setError(null);
    } catch (err) {
      mapError(err);
    }
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable onPress={() => undefined}>
          <Animated.View entering={SlideInDown.springify().damping(18)} exiting={FadeOutUp.duration(200)} style={styles.sheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={Typography.h2}>{t('expenses.sheet.title')}</Text>
              <Pressable hitSlop={8} onPress={onClose}>
                <Text style={{ color: Colors.accent, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>

            <View style={{ gap: Spacing.xs }}>
              <Text style={Typography.dim}>{t('expenses.sheet.lifestyle')}</Text>
              <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                {LIFESTYLE_TIERS.map((tier) => {
                  const active = e.lifestyle === tier;
                  return (
                    <Pressable
                      key={tier}
                      accessibilityRole="button"
                      onPress={() => chooseTier(tier)}
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
                      <Text style={{ color: active ? '#FFFFFF' : Colors.text, fontWeight: '700', fontSize: 13 }}>
                        {t(`expenses.tiers.${tier}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ ...Typography.dim, fontSize: 11 }}>{t('expenses.sheet.presetNote')}</Text>
            </View>

            <ScrollView bounces={false} style={{ maxHeight: 260 }} contentContainerStyle={{ gap: Spacing.xs }}>
              {e.items.map((it) => {
                const label = it.kind === 'PRESET' ? t(`expenses.items.${it.key}`) : it.label ?? '—';
                const editing = editingId === it.id;
                return (
                  <View
                    key={it.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Spacing.sm,
                      backgroundColor: Colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: editing ? Colors.accent : Colors.border,
                      borderRadius: Radius.sm,
                      paddingHorizontal: Spacing.md,
                      paddingVertical: Spacing.sm,
                    }}
                  >
                    <Text style={{ ...Typography.dim, flex: 1 }} numberOfLines={1}>
                      {label}
                    </Text>
                    {editing ? (
                      <TextInput
                        value={editVal}
                        onChangeText={(v) => {
                          setEditVal(v);
                          setError(null);
                        }}
                        onSubmitEditing={commitEdit}
                        onBlur={commitEdit}
                        keyboardType="decimal-pad"
                        autoFocus
                        testID={`expense-edit-${it.id}`}
                        style={{ color: Colors.text, fontSize: 14, fontVariant: ['tabular-nums'], minWidth: 72, textAlign: 'right' }}
                      />
                    ) : (
                      <Pressable
                        hitSlop={8}
                        accessibilityRole="button"
                        onPress={() => {
                          setEditingId(it.id);
                          // seed in the display currency — what the player sees
                          setEditVal(usdToSeed(it.amount));
                          setError(null);
                        }}
                      >
                        <Text style={{ ...Typography.mono, fontSize: 14, color: Colors.accent }}>{formatMoney(it.amount)}</Text>
                      </Pressable>
                    )}
                    <Pressable
                      hitSlop={8}
                      accessibilityRole="button"
                      onPress={() => remove(it.id)}
                      disabled={editing}
                      style={{ opacity: editing ? 0.3 : 1 }}
                    >
                      <Text style={{ color: Colors.negative, fontWeight: '700' }}>✕</Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TextInput
                value={newLabel}
                onChangeText={(v) => {
                  setNewLabel(v);
                  setError(null);
                }}
                placeholder={t('expenses.sheet.addLabel')}
                placeholderTextColor={Colors.textDim}
                style={[styles.input, { flex: 2, fontSize: 14 }]}
              />
              <TextInput
                value={newAmount}
                onChangeText={(v) => {
                  setNewAmount(v);
                  setError(null);
                }}
                placeholder={t('expenses.sheet.addAmount')}
                placeholderTextColor={Colors.textDim}
                keyboardType="decimal-pad"
                style={[styles.input, { flex: 1, fontSize: 14 }]}
              />
            </View>
            <ChoiceButton label={t('expenses.sheet.add')} variant="primary" onPress={add} />

            <View style={{ gap: 2, paddingTop: Spacing.xs, borderTopWidth: 1, borderTopColor: Colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={Typography.dim}>{t('expenses.sheet.total')}</Text>
                <Text style={Typography.mono}>−{formatMoney(roundCash(itemsPart * fateMult))}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={Typography.dim}>{t('expenses.sheet.levy')}</Text>
                <Text style={Typography.mono}>−{formatMoney(roundCash(levy * fateMult))}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ ...Typography.dim, fontWeight: '700' }}>{t('expenses.sheet.grandTotal')}</Text>
                <Text style={{ ...Typography.mono, color: Colors.negative }}>
                  −{formatMoney(roundCash(charge * fateMult))}
                </Text>
              </View>
            </View>

            {error ? <Text style={{ color: Colors.negative, fontSize: 13 }}>{error}</Text> : null}
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
    padding: Spacing.sm,
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
});
