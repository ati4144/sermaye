import { Pressable, Text } from 'react-native';
import { Colors, Radius, Spacing } from '@/theme';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  testID?: string;
}

/** Tactile button — press feedback via RN's pressed state (compiler-safe). */
export function ChoiceButton({ label, onPress, variant = 'ghost', disabled, testID }: Props) {
  const bg = variant === 'primary' ? Colors.primary : variant === 'danger' ? Colors.danger : Colors.surfaceAlt;
  const border = variant === 'ghost' ? Colors.border : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        backgroundColor: disabled ? Colors.surface : pressed ? (variant === 'primary' ? Colors.primaryPressed : Colors.surface) : bg,
        borderWidth: 1,
        borderColor: disabled ? Colors.border : border,
        borderRadius: Radius.md,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.lg,
        alignItems: 'center',
        opacity: disabled ? 0.5 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <Text style={{ color: Colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}
