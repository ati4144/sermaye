import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FATE_QUESTIONS } from '@/engine';
import { ChoiceButton } from './ChoiceButton';
import { Colors, Spacing, Typography } from '@/theme';

interface Props {
  /** receives the answers (option index per question, -1 = left to fate) */
  onComplete: (answers: number[]) => void;
}

/**
 * The "Kaderini Kendin Yaz" stepper: five questions, gold progress dots,
 * back navigation, and a per-screen "Kadere Bırak" bail-out that leaves the
 * remaining questions to fate.
 */
export function FateQuestions({ onComplete }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<number[]>(() => FATE_QUESTIONS.map(() => -1));

  const total = FATE_QUESTIONS.length;
  const q = FATE_QUESTIONS[step];

  const pick = (choice: number) => {
    const next = [...answers];
    next[step] = choice;
    if (step === total - 1) {
      onComplete(next);
      return;
    }
    setAnswers(next);
    setStep(step + 1);
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: Spacing.xl }}>
      <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
        {FATE_QUESTIONS.map((qq, i) => (
          <View
            key={qq.id}
            testID={`fate-dot-${i}`}
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i < step || answers[i] >= 0 ? Colors.gold : Colors.border }}
          />
        ))}
        <Text style={{ ...Typography.dim, marginLeft: Spacing.sm }}>{t('fate.ui.step', { n: step + 1, total })}</Text>
      </View>

      <View testID={`fate-question-${step}`} style={{ gap: Spacing.sm }}>
        <Text style={{ ...Typography.h2, fontSize: 22 }}>{t(`fate.questions.${q.id}.text`)}</Text>
        {q.options.map((_, i) => (
          <ChoiceButton
            key={i}
            testID={`fate-option-${i}`}
            label={t(`fate.questions.${q.id}.options.${i}`)}
            onPress={() => pick(i)}
          />
        ))}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        {step > 0 ? (
          <Pressable testID="fate-back" onPress={() => setStep(step - 1)} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: Colors.accent, fontSize: 14, fontWeight: '600' }}>‹ {t('fate.ui.back')}</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable testID="fate-skip" onPress={() => onComplete(answers)} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: Colors.textDim, fontSize: 14 }}>☾ {t('fate.ui.skip')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
