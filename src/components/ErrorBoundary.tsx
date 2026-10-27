import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Radius, Spacing, Typography } from '@/theme';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort render guard: without it a single crashing component takes the
 * whole app down with an unrecoverable red screen. Shows the error plus an
 * escape hatch — wiping the persisted saves (dev-stage saves can carry stale
 * engine shapes; clearing them always boots).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  private wipeAndReload = (): void => {
    void AsyncStorage.removeItem('sermaye-saves')
      .catch(() => undefined)
      .finally(() => {
        if (typeof location !== 'undefined' && typeof location.reload === 'function') {
          location.reload(); // web
        } else {
          this.setState({ error: null }); // native: retry with a clean-ish tree
        }
      });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md }}>
        <Text style={{ ...Typography.h2, textAlign: 'center' }}>⚠ Sermaye</Text>
        <Text style={{ ...Typography.dim, textAlign: 'center' }}>{String(error.message ?? error)}</Text>
        <Pressable
          onPress={() => this.setState({ error: null })}
          accessibilityRole="button"
          style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, marginTop: Spacing.md }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Yeniden dene</Text>
        </Pressable>
        <Pressable
          onPress={this.wipeAndReload}
          accessibilityRole="button"
          style={{ backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.negative, borderRadius: Radius.md, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm }}
        >
          <Text style={{ color: Colors.negative, fontWeight: '700' }}>Kayıtları sıfırla</Text>
        </Pressable>
      </View>
    );
  }
}
