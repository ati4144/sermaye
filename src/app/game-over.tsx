import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { ChoiceButton } from '@/components/ChoiceButton';
import { MoneyText } from '@/components/MoneyText';
import { useActiveGame, useGameStore } from '@/store/gameStore';
import { Colors, Radius, ScreenContainer, Spacing, Typography } from '@/theme';

export default function GameOver() {
  const { t } = useTranslation();
  const game = useActiveGame();
  const closeGame = useGameStore((s) => s.closeGame);

  if (!game) return null;

  const extinct = game.status === 'GAME_OVER_EXTINCT';

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: Spacing.lg }}>
        <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: 'center', gap: Spacing.xs }}>
          <Text style={{ fontSize: 34, fontWeight: '800', color: Colors.negative, letterSpacing: 2 }}>
            {extinct ? t('ui.gameover.extinctTitle') : t('ui.gameover.bankruptTitle')}
          </Text>
          <Text style={{ ...Typography.dim, textAlign: 'center' }}>
            {extinct
              ? t('ui.event.extinctionText', { name: game.player.name })
              : t('ui.gameover.bankruptText')}
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(400).delay(150)}
          style={{ backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.lg, gap: Spacing.md }}
        >
          <Text style={Typography.dim}>{t('ui.gameover.stats')}</Text>
          <Stat label={t('ui.gameover.generations')} value={String(game.player.generation)} />
          <View style={{ gap: 2 }}>
            <Text style={Typography.dim}>{t('ui.gameover.peak')}</Text>
            <MoneyText value={game.peakNetWorth} />
          </View>
          <Stat label={t('ui.gameover.monthsPlayed')} value={String(game.tick)} />
        </Animated.View>

        <ChoiceButton
          label={t('ui.gameover.backToMenu')}
          variant="primary"
          onPress={() => {
            closeGame();
            // dismissAll on a bare stack dispatches POP_TO_TOP that no
            // navigator handles (game-over can be the only screen); guard it.
            if (router.canDismiss()) router.dismissAll();
            router.replace('/');
          }}
        />
      </ScrollView>
    </ScreenContainer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={Typography.dim}>{label}</Text>
      <Text style={{ ...Typography.mono, fontSize: 16 }}>{value}</Text>
    </View>
  );
}
