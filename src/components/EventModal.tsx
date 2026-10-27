import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOutUp, SlideInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { eventDef } from '@/engine';
import type { GameState, PendingEvent } from '@/engine';
import { marketName } from '@/lib/labels';
import { formatMoney, useCurrencySync } from '@/lib/money';
import { useGameStore } from '@/store/gameStore';
import { useSettingsStore } from '@/store/settingsStore';
import { ChoiceButton } from './ChoiceButton';
import { TypewriterText } from './TypewriterText';
import { Colors, Radius, Spacing, Typography } from '@/theme';

const LIFE_EVENTS = new Set([
  'illness_mild',
  'illness_moderate',
  'illness_severe',
  'marriage',
  'child_born',
  'spouse_death',
  'child_death',
  'death',
]);

function eventText(t: ReturnType<typeof useTranslation>['t'], pending: PendingEvent) {
  // ASSET-scope events reuse countryId for the asset id — resolve both kinds
  const market = marketName(t, pending.countryId);
  return {
    title: t(`events.${pending.eventId}.title`, { country: market ?? '—' }),
    body: t(`events.${pending.eventId}.text`, { country: market ?? '—' }),
  };
}

/** Option-label interpolation bag: market name + the option's cash magnitude
 *  (unsigned — the copy carries its own sign/context around {{amount}}). */
function optionVars(pending: PendingEvent, optionIndex: number, t: ReturnType<typeof useTranslation>['t']) {
  const market = marketName(t, pending.countryId);
  const cash = eventDef(pending.eventId).options?.[optionIndex];
  const amount = cash?.cashCost ?? cash?.cashDelta;
  return {
    country: market ?? '—',
    amount: amount !== undefined ? formatMoney(Math.abs(amount)) : '—',
  };
}

/**
 * Full-screen queue head presenter: news/life cards slide in from the bottom,
 * typewriter body, choices resolve or ack. Driven entirely by engine state —
 * when the queue empties, the modal disappears.
 */
export function EventModal({ game }: { game: GameState }) {
  const { t } = useTranslation();
  const dispatch = useGameStore((s) => s.dispatch);
  const haptics = useSettingsStore((s) => s.hapticsEnabled);
  useCurrencySync();

  const head = game.pendingEvents[0];
  if (!head) return null;

  const def = eventDef(head.eventId);
  const isFate = def.trigger === 'FATE';
  const isLife = !isFate && LIFE_EVENTS.has(head.eventId);
  const { title, body } = eventText(t, head);
  const options = def.options ?? [];
  const queueLeft = game.pendingEvents.length - 1;

  const act = (fn: () => void) => {
    if (haptics) {
      void import('expo-haptics').then((H) => H.impactAsync(H.ImpactFeedbackStyle.Light).catch(() => undefined));
    }
    fn();
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={() => undefined} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={() => undefined} disabled>
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          exiting={FadeOutUp.duration(200)}
          style={styles.card}
        >
          <View style={styles.tagRow}>
            <View
              style={{
                backgroundColor: isFate || isLife ? `${Colors.gold}22` : `${Colors.accent}22`,
                borderColor: isFate || isLife ? Colors.gold : Colors.accent,
                borderWidth: 1,
                borderRadius: Radius.sm,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text style={{ color: isFate || isLife ? Colors.gold : Colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>
                {isFate ? `☾ ${t('fate.ui.badge')}` : isLife ? t('ui.event.life') : t('ui.event.news')}
              </Text>
            </View>
            {queueLeft > 0 ? <Text style={Typography.dim}>+{queueLeft}</Text> : null}
          </View>

          <Text style={{ ...Typography.h2, fontSize: 22, marginBottom: Spacing.sm }}>{title}</Text>
          <TypewriterText style={{ ...Typography.body, fontSize: 16, lineHeight: 24, minHeight: 72 }}>{body}</TypewriterText>

          <View style={{ gap: Spacing.sm, marginTop: Spacing.lg }}>
            {options.length > 0 ? (
              options.map((_, i) => (
                <ChoiceButton
                  key={i}
                  label={t(`events.${head.eventId}.options.${i}`, optionVars(head, i, t))}
                  variant={i === 0 ? 'primary' : 'ghost'}
                  onPress={() => act(() => dispatch({ type: 'RESOLVE_EVENT', uid: head.uid, optionIndex: i }))}
                />
              ))
            ) : (
              <ChoiceButton
                label={t('ui.event.continue')}
                variant="primary"
                onPress={() => act(() => dispatch({ type: 'ACK_EVENT', uid: head.uid }))}
              />
            )}
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
