import { Pressable, ScrollView, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ageYears, netWorth } from '@/engine';
import { formatMoney, useCurrencySync } from '@/lib/money';
import { SLOTS, useGameStore } from '@/store/gameStore';
import { ChoiceButton } from '@/components/ChoiceButton';
import { Colors, Radius, ScreenContainer, Spacing, Typography } from '@/theme';

export default function MainMenu() {
  const { t } = useTranslation();
  useCurrencySync();
  const slots = useGameStore((s) => s.slots);
  const loadSlot = useGameStore((s) => s.loadSlot);
  const deleteSlot = useGameStore((s) => s.deleteSlot);

  const hasAnySave = SLOTS.some((id) => slots[id]);

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: Spacing.lg }} bounces={false}>
        <View style={{ alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.xl }}>
          <Text style={{ ...Typography.title, fontSize: 44, color: Colors.gold }}>₺ Sermaye</Text>
          <Text style={Typography.dim}>{t('ui.tagline')}</Text>
        </View>

        {SLOTS.map((slot) => {
          const save = slots[slot];
          return save ? (
            // card + delete as SIBLINGS — nested buttons are invalid HTML and bad a11y
            <View
              key={slot}
              style={{
                backgroundColor: Colors.surface,
                borderWidth: 1,
                borderColor: Colors.border,
                borderRadius: Radius.md,
              }}
            >
              <Pressable
                onPress={() => {
                  loadSlot(slot);
                  // relative href — stable against typed-route generation quirks
                  // (the engine directory's index screen is '/game' at runtime)
                  router.push('./game');
                }}
                accessibilityRole="button"
                accessibilityLabel={`${t('ui.menu.slot', { n: slot })} — ${save.player.name}`}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? Colors.surfaceAlt : 'transparent',
                  borderRadius: Radius.md,
                  padding: Spacing.lg,
                  paddingRight: 64,
                  gap: Spacing.xs,
                })}
              >
                <Text style={Typography.dim}>
                  {t('ui.menu.slot', { n: slot })} · {t('ui.menu.playing')}
                </Text>
                <Text style={Typography.h2}>{save.player.name}</Text>
                <Text style={Typography.dim}>
                  {t('ui.menu.generation', { n: save.player.generation })} · {ageYears(save)} {'·'}{' '}
                  {formatMoney(netWorth(save))}
                </Text>
              </Pressable>
              <Pressable
                hitSlop={12}
                onPress={() => deleteSlot(slot)}
                accessibilityRole="button"
                accessibilityLabel={t('ui.menu.delete')}
                style={{ position: 'absolute', top: Spacing.md, right: Spacing.md, padding: Spacing.xs }}
              >
                <Text style={{ color: Colors.negative, fontSize: 13 }}>{t('ui.menu.delete')}</Text>
              </Pressable>
            </View>
          ) : (
            <ChoiceButton
              key={slot}
              label={`${t('ui.menu.newGame')} — ${t('ui.menu.slot', { n: slot })}`}
              variant={hasAnySave ? 'ghost' : 'primary'}
              onPress={() => router.push({ pathname: '/new-game', params: { slot: String(slot) } })}
            />
          );
        })}

        <Link href="/settings" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ui.menu.settings')}
            style={{ alignItems: 'center', padding: Spacing.md }}
          >
            <Text style={{ color: Colors.accent, fontSize: 15, fontWeight: '600' }}>⚙ {t('ui.menu.settings')}</Text>
          </Pressable>
        </Link>
      </ScrollView>
    </ScreenContainer>
  );
}
