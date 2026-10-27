import { useEffect } from 'react';
import { Text, View, type ColorValue } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EventModal } from '@/components/EventModal';
import { useActiveGame } from '@/store/gameStore';
import { Colors, Spacing, Typography } from '@/theme';

/**
 * Game shell: bottom tabs + the global event queue overlay. Redirects to
 * /game-over when the run truly ends (bankruptcy or dynasty extinction).
 */
export default function GameLayout() {
  const { t } = useTranslation();
  const game = useActiveGame();
  const router = useRouter();

  useEffect(() => {
    if (game && (game.status === 'GAME_OVER_BANKRUPT' || game.status === 'GAME_OVER_EXTINCT')) {
      router.replace('/game-over');
    }
  }, [game?.status, router, game]);

  // stale deep link (no active run) → back to the menu
  useEffect(() => {
    if (!game) router.replace('/');
  }, [game, router]);

  if (!game) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={Typography.dim}>…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: Colors.surface,
            borderTopColor: Colors.border,
          },
          tabBarActiveTintColor: Colors.accent,
          tabBarInactiveTintColor: Colors.textDim,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
        backBehavior="none"
      >
        <Tabs.Screen
          name="index"
          options={{ title: t('ui.dashboard.title'), tabBarIcon: ({ color }) => <TabGlyph color={color} glyph="◈" /> }}
        />
        <Tabs.Screen
          name="invest"
          options={{ title: t('ui.invest.title'), tabBarIcon: ({ color }) => <TabGlyph color={color} glyph="↗" /> }}
        />
        <Tabs.Screen
          name="family"
          options={{ title: t('ui.family.title'), tabBarIcon: ({ color }) => <TabGlyph color={color} glyph="⌂" /> }}
        />
        <Tabs.Screen
          name="history"
          options={{ title: t('ui.history.title'), tabBarIcon: ({ color }) => <TabGlyph color={color} glyph="☰" /> }}
        />
      </Tabs>

      <EventModal game={game} />
    </View>
  );
}

function TabGlyph({ color, glyph }: { color: ColorValue; glyph: string }) {
  return (
    <Text style={{ color, fontSize: 18, fontWeight: '700', paddingTop: Spacing.xs }} accessible={false}>
      {glyph}
    </Text>
  );
}
