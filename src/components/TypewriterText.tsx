import { Pressable, Text, type TextProps } from 'react-native';
import { useTypewriter } from '@/hooks/useTypewriter';
import { useSettingsStore } from '@/store/settingsStore';
import { Colors, Typography } from '@/theme';

interface Props extends TextProps {
  children: string;
}

/** Text that types itself out; tapping reveals it instantly. */
export function TypewriterText({ children, style, ...rest }: Props) {
  const cps = useSettingsStore((s) => s.textSpeedCps);
  return (
    // key remount resets the typewriter whenever the text changes
    <Body key={children} text={children} cps={cps} style={style} {...rest} />
  );
}

function Body({ text, cps, style, ...rest }: TextProps & { text: string; cps: number }) {
  const { visible, done, skip } = useTypewriter(text, cps);
  return (
    <Pressable onPress={skip} disabled={done}>
      <Text style={[Typography.body, style]} {...rest}>
        {visible}
        {!done && <Text style={{ color: Colors.accent }}>▌</Text>}
      </Text>
    </Pressable>
  );
}
