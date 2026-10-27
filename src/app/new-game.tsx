import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { balance, basketMultFor, COUNTRY_IDS, HOME_INFLATION, WORLD_PACK } from '@/engine';
import { ChoiceButton } from '@/components/ChoiceButton';
import { FateQuestions } from '@/components/FateQuestions';
import { COUNTRY_CURRENCY, currencyDef } from '@/lib/currency';
import { displayCurrencyCode, formatMoney, inputToUsd, useCurrencySync } from '@/lib/money';
import { useGameStore, type SlotId } from '@/store/gameStore';
import { useSettingsStore } from '@/store/settingsStore';
import { Colors, Radius, ScreenContainer, Spacing, Typography } from '@/theme';

/** name → era pick → country → salary → fate mode choice → questionnaire → sealed splash */
type Phase = 'name' | 'era' | 'country' | 'income' | 'mode' | 'questions' | 'sealed';

export default function NewGame() {
  const { t } = useTranslation();
  useCurrencySync();
  const params = useLocalSearchParams<{ slot: string }>();
  const slot = (Number(params.slot) || 1) as SlotId;
  const newGame = useGameStore((s) => s.newGame);
  const setCurrency = useSettingsStore((s) => s.setCurrency);
  const [name, setName] = useState('');
  const [error, setError] = useState(false);
  const [phase, setPhase] = useState<Phase>('name');
  const [cashDelta, setCashDelta] = useState(0);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [homeCountryId, setHomeCountryId] = useState('us');
  const [salary, setSalary] = useState('');

  const createWith = (answers?: number[]) => {
    // the input speaks the display currency; the engine takes USD. Empty or
    // unparseable → undefined → the engine default (SALARY_DEFAULT)
    const typed = Number(salary.trim().replace(',', '.'));
    const salaryUsd = salary.trim() && Number.isFinite(typed) && typed > 0 ? inputToUsd(typed) : undefined;
    const state = newGame(slot, name.trim(), answers, scenarioId, salaryUsd, homeCountryId);
    setCashDelta(state.cash - balance.START_CASH);
    setPhase('sealed');
  };

  const start = () => {
    if (!name.trim()) {
      setError(true);
      return;
    }
    setPhase('era');
  };

  return (
    <ScreenContainer>
      {phase === 'name' ? (
        <View style={{ flex: 1, justifyContent: 'center', gap: Spacing.lg }}>
          <View style={{ gap: Spacing.xs }}>
            <Text style={Typography.h2}>{t('ui.menu.newGame')}</Text>
            <Text style={Typography.dim}>{t('ui.tagline')}</Text>
          </View>

          <TextInput
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError(false);
            }}
            placeholder={t('ui.menu.namePlaceholder')}
            placeholderTextColor={Colors.textDim}
            autoFocus
            maxLength={24}
            testID="family-name-input"
            style={{
              backgroundColor: Colors.surface,
              borderWidth: 1,
              borderColor: error ? Colors.negative : Colors.border,
              borderRadius: Radius.md,
              padding: Spacing.lg,
              color: Colors.text,
              fontSize: 16,
            }}
          />
          {error ? <Text style={{ color: Colors.negative, fontSize: 13 }}>{t('ui.menu.nameRequired')}</Text> : null}

          <ChoiceButton label={t('ui.menu.start')} variant="primary" onPress={start} />
        </View>
      ) : null}

      {phase === 'era' ? (
        <View style={{ flex: 1, gap: Spacing.lg }}>
          <View style={{ gap: Spacing.xs }}>
            <Text style={Typography.h2}>{t('ui.era.title')}</Text>
            <Text style={Typography.dim}>{t('ui.era.subtitle')}</Text>
          </View>

          <ScrollView contentContainerStyle={{ gap: Spacing.md, paddingBottom: Spacing.xl }} bounces={false}>
            <EraCard
              label={t('ui.era.current')}
              desc={t('ui.era.currentDesc')}
              selected={scenarioId === null}
              onPress={() => setScenarioId(null)}
            />
            {WORLD_PACK.scenarios.map((sc) => (
              <EraCard
                key={sc.id}
                label={t(`scenarios.${sc.id}.name`)}
                desc={t(`scenarios.${sc.id}.desc`)}
                selected={scenarioId === sc.id}
                onPress={() => setScenarioId(sc.id)}
              />
            ))}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <View style={{ flex: 1 }}>
              <ChoiceButton label={t('common.cancel')} onPress={() => setPhase('name')} />
            </View>
            <View style={{ flex: 2 }}>
              <ChoiceButton label={t('ui.era.pick')} variant="primary" onPress={() => setPhase('country')} />
            </View>
          </View>
        </View>
      ) : null}

      {phase === 'country' ? (
        <View style={{ flex: 1, gap: Spacing.lg }}>
          <View style={{ gap: Spacing.xs }}>
            <Text style={Typography.h2}>{t('ui.country.title')}</Text>
            <Text style={Typography.dim}>{t('ui.country.subtitle')}</Text>
          </View>

          <ScrollView contentContainerStyle={{ gap: Spacing.md, paddingBottom: Spacing.xl }} bounces={false}>
            {COUNTRY_IDS.map((id) => (
              <CountryCard
                key={id}
                id={id}
                label={t(`countries.${id}.name`)}
                desc={t(`countries.${id}.desc`)}
                currency={currencyDef(COUNTRY_CURRENCY[id]).label}
                inflationPct={Math.round((HOME_INFLATION[id] ?? 0) * 100)}
                selected={homeCountryId === id}
                onPress={() => setHomeCountryId(id)}
              />
            ))}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <View style={{ flex: 1 }}>
              <ChoiceButton label={t('common.cancel')} onPress={() => setPhase('era')} />
            </View>
            <View style={{ flex: 2 }}>
              <ChoiceButton
                testID="country-continue"
                label={t('ui.country.pick')}
                variant="primary"
                onPress={() => {
                  // the country's currency becomes the DISPLAY default — the
                  // salary screen that follows speaks it; settings stay the
                  // override (engine money never leaves USD)
                  setCurrency(COUNTRY_CURRENCY[homeCountryId]);
                  setPhase('income');
                }}
              />
            </View>
          </View>
        </View>
      ) : null}

      {phase === 'income' ? (
        <View style={{ flex: 1, justifyContent: 'center', gap: Spacing.lg }}>
          <View style={{ gap: Spacing.xs }}>
            <Text style={Typography.h2}>{t('ui.income.newGame.title')}</Text>
            <Text style={Typography.dim}>
              {t('ui.income.newGame.subtitle', {
                def: formatMoney(balance.INCOME.SALARY_DEFAULT * basketMultFor(homeCountryId)),
              })}
            </Text>
          </View>

          <TextInput
            value={salary}
            onChangeText={setSalary}
            keyboardType="decimal-pad"
            maxLength={12}
            testID="income-input"
            placeholder={t('ui.income.newGame.inputLabel', { unit: displayCurrencyCode() })}
            placeholderTextColor={Colors.textDim}
            style={{
              backgroundColor: Colors.surface,
              borderWidth: 1,
              borderColor: Colors.border,
              borderRadius: Radius.md,
              padding: Spacing.lg,
              color: Colors.text,
              fontSize: 16,
              fontVariant: ['tabular-nums'],
            }}
          />
          <Text style={{ ...Typography.dim, fontSize: 12 }}>
            {t('ui.income.newGame.hint', {
              amount: formatMoney(balance.INCOME.SALARY_DEFAULT * basketMultFor(homeCountryId)),
            })}
          </Text>

          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <View style={{ flex: 1 }}>
              <ChoiceButton label={t('common.cancel')} onPress={() => setPhase('country')} />
            </View>
            <View style={{ flex: 2 }}>
              <ChoiceButton testID="income-continue" label={t('ui.income.newGame.continue')} variant="primary" onPress={() => setPhase('mode')} />
            </View>
          </View>
        </View>
      ) : null}

      {phase === 'mode' ? (
        <View style={{ flex: 1, justifyContent: 'center', gap: Spacing.xl }}>
          <View style={{ gap: Spacing.sm, alignItems: 'center' }}>
            <Text style={{ fontSize: 56, color: Colors.gold, textAlign: 'center' }}>☾</Text>
            <Text style={{ ...Typography.h2, fontSize: 22, textAlign: 'center' }}>{t('fate.ui.modeTitle')}</Text>
          </View>

          <View style={{ gap: Spacing.sm }}>
            <Text style={{ ...Typography.dim, textAlign: 'center' }}>{t('fate.ui.modeRandomDesc')}</Text>
            <ChoiceButton testID="fate-mode-random" label={`☾ ${t('fate.ui.random')}`} variant="primary" onPress={() => createWith(undefined)} />
          </View>

          <View style={{ gap: Spacing.sm }}>
            <Text style={{ ...Typography.dim, textAlign: 'center' }}>{t('fate.ui.modeChosenDesc')}</Text>
            <ChoiceButton testID="fate-mode-chosen" label={t('fate.ui.chosen')} onPress={() => setPhase('questions')} />
          </View>
        </View>
      ) : null}

      {phase === 'questions' ? <FateQuestions onComplete={(answers) => createWith(answers)} /> : null}

      {phase === 'sealed' ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.lg }}>
          <Text testID="fate-sealed" style={{ fontSize: 72, color: Colors.gold }}>
            ☾
          </Text>
          <Text style={{ ...Typography.h2, fontSize: 22, textAlign: 'center', color: Colors.gold }}>{t('fate.ui.sealedTitle')}</Text>
          <Text style={{ ...Typography.dim, textAlign: 'center' }}>{t('fate.ui.sealedText')}</Text>
          {cashDelta !== 0 ? (
            <Text style={{ ...Typography.mono, color: cashDelta > 0 ? Colors.positive : Colors.negative }}>
              {cashDelta > 0
                ? t('fate.ui.receiptCashPos', { amount: formatMoney(cashDelta) })
                : t('fate.ui.receiptCashNeg', { amount: formatMoney(-cashDelta) })}
            </Text>
          ) : null}
          <Text style={{ ...Typography.dim, fontStyle: 'italic', textAlign: 'center' }}>{t('fate.ui.veiled')}</Text>
          <ChoiceButton testID="fate-sealed-continue" label={t('ui.event.continue')} variant="primary" onPress={() => router.dismissTo('../game')} />
        </View>
      ) : null}
    </ScreenContainer>
  );
}

/** One era option — current era or a historical scenario. */
function EraCard({ label, desc, selected, onPress }: { label: string; desc: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        backgroundColor: selected ? Colors.surfaceAlt : Colors.surface,
        borderWidth: 1,
        borderColor: selected ? Colors.gold : Colors.border,
        borderRadius: Radius.md,
        padding: Spacing.md,
        gap: 4,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ ...Typography.h2, fontSize: 16 }}>{label}</Text>
        {selected ? <Text style={{ color: Colors.gold, fontWeight: '700' }}>◉</Text> : null}
      </View>
      <Text style={{ ...Typography.dim, fontSize: 12 }}>{desc}</Text>
    </Pressable>
  );
}

/** One home-country option — name, flavor text, currency + inflation chips. */
function CountryCard({
  id,
  label,
  desc,
  currency,
  inflationPct,
  selected,
  onPress,
}: {
  id: string;
  label: string;
  desc: string;
  currency: string;
  inflationPct: number;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`country-card-${id}`}
      style={{
        backgroundColor: selected ? Colors.surfaceAlt : Colors.surface,
        borderWidth: 1,
        borderColor: selected ? Colors.gold : Colors.border,
        borderRadius: Radius.md,
        padding: Spacing.md,
        gap: 4,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ ...Typography.h2, fontSize: 16 }}>{label}</Text>
        {selected ? <Text style={{ color: Colors.gold, fontWeight: '700' }}>◉</Text> : null}
      </View>
      <Text style={{ ...Typography.dim, fontSize: 12 }}>{desc}</Text>
      <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: 2 }}>
        <Text style={{ fontSize: 11, color: Colors.textDim, fontVariant: ['tabular-nums'] }}>{currency}</Text>
        <Text style={{ fontSize: 11, color: Colors.textDim, fontVariant: ['tabular-nums'] }}>
          {t('ui.country.inflationChip', { pct: inflationPct })}
        </Text>
      </View>
    </Pressable>
  );
}
