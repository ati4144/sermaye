import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOutUp, SlideInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { COUNTRY_IDS, HOME_INFLATION } from '@/engine';
import type { GameState } from '@/engine';
import { COUNTRY_CURRENCY, currencyDef } from '@/lib/currency';
import { useGameStore } from '@/store/gameStore';
import { useSettingsStore } from '@/store/settingsStore';
import { Colors, Radius, Spacing, Typography } from '@/theme';

interface Props {
  game: GameState;
  onClose: () => void;
}

/**
 * "Vatanını Seç" picker (v8): all ten home countries, each row showing the
 * display currency the pick would default and the catalog CPI chip. Picking
 * dispatches INIT_RESIDENCY (cpi re-bases at 100 THIS tick — the country's
 * past is not retro-charged) and sets the display currency as a convenience
 * default; the settings picker stays the override.
 */
export function CountrySheet({ game, onClose }: Props) {
  const { t } = useTranslation();
  const dispatch = useGameStore((s) => s.dispatch);
  const setCurrency = useSettingsStore((s) => s.setCurrency);

  const pick = (countryId: string) => {
    try {
      dispatch({ type: 'INIT_RESIDENCY', countryId });
      setCurrency(COUNTRY_CURRENCY[countryId]);
      onClose();
    } catch {
      // RESIDENCY_ACTIVE on a stale render — the banner disappears on the
      // next store push; leave the sheet open so the player sees it
    }
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable onPress={() => undefined}>
          <Animated.View entering={SlideInDown.springify().damping(18)} exiting={FadeOutUp.duration(200)} style={styles.sheet}>
            <Text style={Typography.h2}>{t('ui.country.sheet.title')}</Text>
            <Text style={Typography.dim}>{t('ui.country.sheet.subtitle')}</Text>
            <ScrollView bounces={false} style={{ maxHeight: 420 }}>
              <View style={{ gap: Spacing.sm, paddingBottom: Spacing.sm }}>
                {COUNTRY_IDS.map((id) => (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    testID={`country-row-${id}`}
                    onPress={() => pick(id)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: Spacing.md,
                      backgroundColor: pressed ? Colors.surfaceAlt : Colors.surface,
                      borderWidth: 1,
                      borderColor: game.residency?.countryId === id ? Colors.gold : Colors.border,
                      borderRadius: Radius.md,
                      padding: Spacing.md,
                    })}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ ...Typography.h2, fontSize: 16 }}>{t(`countries.${id}.name`)}</Text>
                      <Text style={{ ...Typography.dim, fontSize: 12 }}>{t(`countries.${id}.desc`)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text style={{ fontSize: 12, color: Colors.textDim }}>{currencyDef(COUNTRY_CURRENCY[id]).label}</Text>
                      <Text style={{ fontSize: 11, color: Colors.textDim, fontVariant: ['tabular-nums'] }}>
                        {t('ui.country.inflationChip', { pct: Math.round((HOME_INFLATION[id] ?? 0) * 100) })}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
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
});
