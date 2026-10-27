import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOutUp, SlideInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { ASSETS_CATALOG, assetPrice, homeReliefFor, netWorth } from '@/engine';
import type { GameState } from '@/engine';
import { formatMoney, formatNumber, useCurrencySync } from '@/lib/money';
import { useGameStore } from '@/store/gameStore';
import { Colors, Radius, Spacing, Typography } from '@/theme';

interface Props {
  game: GameState;
  onClose: () => void;
}

/**
 * "Evine Taşın" picker (v6 Yuva): every owned REAL_ESTATE deed, each with the
 * relief the engine would grant (`homeReliefFor` on a hypothetical state —
 * the same formula phase 4b runs, so the promise on the row is the number
 * the ledger keeps). Picking a row dispatches SET_ROLE — zero draws.
 */
export function HomeRoleSheet({ game, onClose }: Props) {
  const { t } = useTranslation();
  const dispatch = useGameStore((s) => s.dispatch);
  useCurrencySync();
  const worth = netWorth(game);
  const candidates = ASSETS_CATALOG.filter(
    (d) => d.kind === 'DEED' && d.category === 'REAL_ESTATE' && (game.properties[d.id]?.units ?? 0) > 0,
  );

  const pick = (assetId: string) => {
    try {
      dispatch({ type: 'SET_ROLE', role: 'home', assetId });
      onClose();
    } catch {
      // INVALID_HOME_ASSET on a stale render — the list refreshes on the
      // next store push; leave the sheet open so the player sees it
    }
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable onPress={() => undefined}>
          <Animated.View entering={SlideInDown.springify().damping(18)} exiting={FadeOutUp.duration(200)} style={styles.sheet}>
            <Text style={Typography.h2}>{t('ui.home.sheetTitle')}</Text>
            {candidates.map((d) => {
              const pos = game.properties[d.id]!;
              // hypothetical state with THIS home designated — pure read
              const relief = homeReliefFor({ ...game, home: { role: 'home', assetId: d.id, sinceTick: game.tick } }, worth);
              return (
                <Pressable
                  key={d.id}
                  accessibilityRole="button"
                  onPress={() => pick(d.id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: Spacing.md,
                    backgroundColor: pressed ? Colors.surfaceAlt : Colors.surface,
                    borderWidth: 1,
                    borderColor: game.home?.assetId === d.id ? Colors.gold : Colors.border,
                    borderRadius: Radius.md,
                    padding: Spacing.md,
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={Typography.h2}>{t(`assets.${d.id}.name`)}</Text>
                    <Text style={Typography.dim}>
                      {formatNumber(pos.units, 0)} {t(`assets.${d.id}.unit`, { count: pos.units })} ·{' '}
                      {formatMoney(assetPrice(game, d.id), { decimals: 0 })}
                    </Text>
                  </View>
                  <Text style={{ color: Colors.positive, fontWeight: '600', fontSize: 13 }}>
                    {t('ui.home.sheetRelief', { amount: formatMoney(relief) })}
                  </Text>
                </Pressable>
              );
            })}
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
