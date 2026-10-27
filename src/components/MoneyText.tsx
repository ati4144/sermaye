import { Text, type TextProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { formatMoney, useCurrencySync } from '@/lib/money';
import { Colors } from '@/theme';

interface Props extends Omit<TextProps, 'children'> {
  value: number;
  decimals?: number;
  /** color by sign */
  signed?: boolean;
}

/** Money figure that counts up/down with an rAF tween and live locale. */
export function MoneyText({ value, decimals = 0, signed = false, style, ...rest }: Props) {
  // subscribing keeps the formatting in sync when the language or the
  // display currency switches
  useTranslation();
  useCurrencySync();
  const animated = useAnimatedNumber(value);
  const color = signed
    ? value > 0
      ? Colors.positive
      : value < 0
        ? Colors.negative
        : Colors.text
    : Colors.text;
  return (
    <Text style={[{ fontSize: 22, fontWeight: '700', color, fontVariant: ['tabular-nums'] }, style]} {...rest}>
      {formatMoney(animated, { decimals, sign: signed })}
    </Text>
  );
}
