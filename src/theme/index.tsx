import { StyleSheet, useWindowDimensions, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';

/**
 * Dark-first financial palette (GitHub-dark inspired — battle-tested contrast).
 */
export const Colors = {
  bg: '#0D1117',
  surface: '#161B22',
  surfaceAlt: '#1C2128',
  border: '#2D333B',
  text: '#E6EDF3',
  textDim: '#8B949E',
  accent: '#58A6FF',
  gold: '#D29922',
  positive: '#3FB950',
  negative: '#F85149',
  primary: '#238636',
  primaryPressed: '#2EA043',
  danger: '#DA3633',
  overlay: 'rgba(1, 4, 9, 0.75)',
} as const;

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const Radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const Typography = {
  title: { fontSize: 28, fontWeight: '700' as const, color: Colors.text },
  h2: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: Colors.text },
  dim: { fontSize: 13, fontWeight: '400' as const, color: Colors.textDim },
  stat: { fontSize: 22, fontWeight: '700' as const, color: Colors.text },
  mono: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, fontVariant: ['tabular-nums' as const] },
};

/** Responsive breakpoints: phone-first. */
export type Breakpoint = 'sm' | 'md' | 'lg';

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  if (width < 480) return 'sm';
  if (width < 1024) return 'md';
  return 'lg';
}

interface ScreenContainerProps extends ViewProps {
  children: ReactNode;
  /** center content column on tablets/desktop */
  centered?: boolean;
}

/** Safe-area padded page container; caps content width on large screens. */
export function ScreenContainer({ children, centered = true, style, ...rest }: ScreenContainerProps) {
  const bp = useBreakpoint();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View
        style={[
          styles.inner,
          centered && bp !== 'sm' && styles.centered,
          bp === 'lg' && styles.lg,
          style,
        ]}
        {...rest}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  inner: { flex: 1, padding: Spacing.lg },
  centered: { maxWidth: 720, width: '100%', alignSelf: 'center' },
  lg: { padding: Spacing.xl },
});
