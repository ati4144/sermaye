import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ASSETS_CATALOG, ageYears, FATE_QUESTIONS, homeReliefFor, netWorth } from '@/engine';
import type { GameState } from '@/engine';
import { formatMoney, useCurrencySync } from '@/lib/money';
import { useActiveGame, useGameStore } from '@/store/gameStore';
import { HomeRoleSheet } from '@/components/HomeRoleSheet';
import { Colors, Radius, ScreenContainer, Spacing, Typography } from '@/theme';

export default function Family() {
  const { t } = useTranslation();
  const game = useActiveGame();
  if (!game) return null;

  const alive = game.player.children.filter((c) => c.alive);
  const eldest = [...alive].sort((a, b) => a.birthTick - b.birthTick)[0];
  const childAge = (birthTick: number) => {
    const months = game.tick - birthTick;
    const years = Math.floor(months / 12);
    return years >= 1 ? t('ui.family.ageYears', { n: years }) : t('ui.family.ageMonths', { n: months });
  };

  return (
    <ScreenContainer centered={false}>
      <ScrollView contentContainerStyle={{ gap: Spacing.md, paddingBottom: Spacing.xl }} bounces={false}>
        <Text style={Typography.h2}>{t('ui.family.title')}</Text>

        <Animated.View entering={FadeInDown.duration(300)} style={card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ ...Typography.h2, fontSize: 18 }}>{game.player.name}</Text>
            <Text style={{ ...Typography.dim, color: Colors.gold }}>
              {t('ui.family.you')} · {t('ui.menu.generation', { n: game.player.generation })}
            </Text>
          </View>
          <Text style={Typography.dim}>
            {t('ui.dashboard.age')}: {ageYears(game)} ·{' '}
            {t('ui.dashboard.health')}: {Math.round(game.player.health)}/100 ·{' '}
            {game.player.married ? t('ui.family.married') : t('ui.family.single')}
          </Text>
        </Animated.View>

        {game.fate ? <FateCard game={game} /> : null}

        <HomeCard game={game} />

        <Text style={{ ...Typography.dim, marginTop: Spacing.xs }}>{t('ui.family.children')}</Text>
        {game.player.children.length === 0 ? (
          <Text style={Typography.dim}>— {t('ui.family.noChildren')}</Text>
        ) : (
          game.player.children
            .sort((a, b) => a.birthTick - b.birthTick)
            .map((c, i) => (
              <Animated.View key={c.id} entering={FadeInDown.duration(250).delay(i * 40)} style={card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ ...Typography.mono, fontSize: 16 }}>{t('ui.family.child', { n: i + 1 })}</Text>
                  {c.alive ? (
                    eldest?.id === c.id ? (
                      <Text style={{ color: Colors.positive, fontWeight: '700', fontSize: 13 }}>★ {t('ui.family.heir')}</Text>
                    ) : null
                  ) : (
                    <Text style={{ color: Colors.negative, fontSize: 13 }}>✝</Text>
                  )}
                </View>
                <Text style={Typography.dim}>{c.alive ? childAge(c.birthTick) : '—'}</Text>
              </Animated.View>
            ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const card = {
  backgroundColor: Colors.surface,
  borderWidth: 1,
  borderColor: Colors.border,
  borderRadius: Radius.md,
  padding: Spacing.lg,
  gap: Spacing.xs,
} as const;

/**
 * The Yuva (v6 hearth) card: renter/homeowner role, the designated home with
 * its since-month and live relief estimate, and the role switches. home null
 * (pre-v6 save) degrades into the one-tap activation banner — SET_ROLE
 * 'rental' is zero-draw and costs nothing until a home is designated.
 */
function HomeCard({ game }: { game: GameState }) {
  const { t } = useTranslation();
  const dispatch = useGameStore((s) => s.dispatch);
  useCurrencySync();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (game.home === null) {
    return (
      <Animated.View entering={FadeInDown.duration(300)} style={{ ...card, borderColor: `${Colors.accent}66` }}>
        <Text style={{ ...Typography.dim, color: Colors.accent }}>⌂ {t('ui.home.title')}</Text>
        <Text style={{ ...Typography.dim, fontSize: 12 }}>{t('ui.home.legacyText')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            try {
              dispatch({ type: 'SET_ROLE', role: 'rental' });
            } catch {
              // already active — the banner disappears on the next render
            }
          }}
          style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.sm, alignItems: 'center' }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{t('ui.home.activate')}</Text>
        </Pressable>
      </Animated.View>
    );
  }

  const home = game.home;
  const pos = home.assetId !== null ? game.properties[home.assetId] : undefined;
  // designated home sold or fully escrowed → read-time ownership lapses
  const lapsed = home.role === 'home' && home.assetId !== null && (!pos || pos.units <= 0);
  const relief = homeReliefFor(game, netWorth(game));
  const ownable = ASSETS_CATALOG.filter(
    (d) => d.kind === 'DEED' && d.category === 'REAL_ESTATE' && (game.properties[d.id]?.units ?? 0) > 0,
  );

  return (
    <Animated.View entering={FadeInDown.duration(300)} style={card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ ...Typography.dim, color: Colors.gold }}>⌂ {t('ui.home.title')}</Text>
        <Text style={{ ...Typography.dim, fontWeight: '700' }}>
          {home.role === 'home' ? t('ui.home.owner') : t('ui.home.renter')}
        </Text>
      </View>

      {home.role === 'home' && home.assetId !== null ? (
        <>
          <Text style={Typography.h2}>{t(`assets.${home.assetId}.name`)}</Text>
          <Text style={Typography.dim}>{t('ui.home.since', { n: home.sinceTick })}</Text>
          {lapsed ? (
            <Text style={{ ...Typography.dim, fontStyle: 'italic' }}>{t('ui.home.lapsed')}</Text>
          ) : (
            <Text style={{ ...Typography.dim, color: Colors.positive }}>
              {t('ui.home.reliefEstimate', { amount: formatMoney(relief) })}
            </Text>
          )}
        </>
      ) : ownable.length === 0 ? (
        <Text style={{ ...Typography.dim, fontSize: 12 }}>{t('ui.home.noProperty')}</Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs }}>
        {home.role === 'home' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => dispatch({ type: 'SET_ROLE', role: 'rental' })}
            style={{ backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg }}
          >
            <Text style={{ color: Colors.text, fontWeight: '600' }}>{t('ui.home.backToRent')}</Text>
          </Pressable>
        ) : ownable.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setSheetOpen(true)}
            style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{t('ui.home.moveIn')}</Text>
          </Pressable>
        ) : null}
      </View>

      {sheetOpen ? <HomeRoleSheet game={game} onClose={() => setSheetOpen(false)} /> : null}
    </Animated.View>
  );
}

/** Trait keys shown as in-words lines (never raw multipliers). */
const TRAIT_KEYS = ['illness', 'fee', 'livingCost', 'estateTax', 'birth', 'marriage'] as const;

/**
 * The Kader card. Until the reveal: only "???" and the count of gathered
 * omens. After: name, description, stage dots (one per beat, filled as they
 * fire), trait tendencies in words, and — from generation 2 on — the
 * dynastic-legacy line.
 */
function FateCard({ game }: { game: GameState }) {
  const { t } = useTranslation();
  const f = game.fate!;
  const revealed = f.revealedTick >= 0;
  const fired = f.beats.filter((b) => b.status === 'FIRED').length;
  const traits = TRAIT_KEYS.filter((k) => Math.abs(f.mods[k] - 1) > 0.05);

  return (
    <Animated.View entering={FadeInDown.duration(300)} style={{ ...card, borderColor: revealed ? `${Colors.gold}66` : Colors.border }}>
      <Text style={{ ...Typography.dim, color: Colors.gold }}>{t('fate.ui.cardTitle')}</Text>

      {!revealed ? (
        <>
          <Text style={{ ...Typography.h2, fontSize: 18, color: Colors.textDim }}>{t('fate.ui.hidden')}</Text>
          {f.omenCount > 0 ? <Text style={Typography.dim}>{t('fate.ui.omens', { n: f.omenCount })}</Text> : null}
          <Text style={{ ...Typography.dim, fontStyle: 'italic' }}>{t('fate.ui.veiled')}</Text>
        </>
      ) : (
        <>
          <Text style={{ ...Typography.h2, fontSize: 18, color: Colors.gold }}>{t(`fate.destinies.${f.destinyId}.name`)}</Text>
          <Text style={Typography.dim}>{t(`fate.destinies.${f.destinyId}.desc`)}</Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs }}>
            <Text style={Typography.dim}>{t('fate.ui.stages')}</Text>
            {f.beats.map((b, i) => (
              <View
                key={b.key}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: b.status === 'FIRED' ? Colors.gold : Colors.border,
                  opacity: b.status === 'LOST' ? 0.4 : 1,
                }}
              />
            ))}
            {fired > 0 && fired === f.beats.length ? <Text style={{ color: Colors.gold, fontSize: 12 }}>✦</Text> : null}
          </View>

          {traits.length > 0 ? (
            <View style={{ marginTop: Spacing.xs, gap: 2 }}>
              {traits.map((k) => (
                <Text key={k} style={{ ...Typography.dim, fontSize: 12 }}>
                  ☾ {t(`fate.ui.traits.${k}`)}: {f.mods[k] > 1 ? t('fate.ui.high') : t('fate.ui.low')}
                </Text>
              ))}
            </View>
          ) : null}

          {f.mode === 'CHOSEN' && f.answers.some((a) => a >= 0) ? (
            <View style={{ marginTop: Spacing.xs, gap: 2 }}>
              <Text style={{ ...Typography.dim, fontSize: 12 }}>{t('fate.ui.answersTitle')}</Text>
              <Text style={{ ...Typography.dim, fontSize: 12 }}>
                {f.answers
                  .map((a, i) => (a >= 0 ? t(`fate.questions.${FATE_QUESTIONS[i].id}.options.${a}`) : null))
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ) : null}

          {game.player.generation > 1 ? (
            <Text style={{ ...Typography.dim, fontSize: 12, fontStyle: 'italic', marginTop: Spacing.xs }}>{t('fate.ui.legacy')}</Text>
          ) : null}
        </>
      )}
    </Animated.View>
  );
}
