import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '@/i18n';
import { CURRENCIES, RATE_SNAPSHOT } from '@/lib/currency';
import { useSettingsStore, type Language } from '@/store/settingsStore';
import { Colors, Radius, ScreenContainer, Spacing, Typography } from '@/theme';

const TEXT_SPEEDS = [
  { cps: 0, key: 'instant' },
  { cps: 80, key: 'fast' },
  { cps: 40, key: 'normal' },
  { cps: 18, key: 'slow' },
] as const;

export default function Settings() {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const setLang = useSettingsStore((s) => s.setLanguage);
  const currency = useSettingsStore((s) => s.currency);
  const setCurrency = useSettingsStore((s) => s.setCurrency);
  const textSpeedCps = useSettingsStore((s) => s.textSpeedCps);
  const setTextSpeedCps = useSettingsStore((s) => s.setTextSpeedCps);
  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore((s) => s.setHapticsEnabled);

  return (
    <ScreenContainer>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={Typography.h2}>{t('ui.settings.title')}</Text>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.ok')}>
          <Text style={{ color: Colors.accent, fontSize: 16, fontWeight: '600' }}>{t('common.ok')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ gap: Spacing.lg, paddingTop: Spacing.xl }} bounces={false}>
        <Section title={t('ui.settings.language')}>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            {(['tr', 'en'] as Language[]).map((lang) => (
              <Chip
                key={lang}
                label={lang === 'tr' ? 'Türkçe' : 'English'}
                active={language === lang}
                onPress={() => {
                  setLang(lang);
                  setLanguage(lang); // apply immediately
                }}
              />
            ))}
          </View>
        </Section>

        <Section title={t('ui.settings.currency')}>
          <View style={{ flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' }}>
            {CURRENCIES.map((c) => (
              <Chip key={c.id} label={c.label} active={currency === c.id} onPress={() => setCurrency(c.id)} />
            ))}
          </View>
          <Text style={{ ...Typography.dim, fontSize: 11, fontStyle: 'italic' }}>
            {t('ui.settings.currencyNote', { date: RATE_SNAPSHOT })}
          </Text>
        </Section>

        <Section title={t('ui.settings.textSpeed')}>
          <View style={{ flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' }}>
            {TEXT_SPEEDS.map(({ cps, key }) => (
              <Chip key={key} label={t(`ui.settings.${key}`)} active={textSpeedCps === cps} onPress={() => setTextSpeedCps(cps)} />
            ))}
          </View>
        </Section>

        <Section title={t('ui.settings.haptics')}>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <Chip label={t('ui.settings.on')} active={hapticsEnabled} onPress={() => setHapticsEnabled(true)} />
            <Chip label={t('ui.settings.off')} active={!hapticsEnabled} onPress={() => setHapticsEnabled(false)} />
          </View>
        </Section>
      </ScrollView>
    </ScreenContainer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: Spacing.sm }}>
      <Text style={Typography.dim}>{title}</Text>
      {children}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        backgroundColor: active ? Colors.primary : Colors.surfaceAlt,
        borderWidth: 1,
        borderColor: active ? 'transparent' : Colors.border,
        borderRadius: Radius.pill,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
      }}
    >
      <Text style={{ color: active ? '#FFFFFF' : Colors.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
