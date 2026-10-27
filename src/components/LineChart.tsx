import { useMemo } from 'react';
import Svg, { Defs, LinearGradient, Line, Path, Stop, Text as SvgText } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { formatMoney, useCurrencySync } from '@/lib/money';
import { Colors } from '@/theme';

interface Props {
  data: number[];
  height?: number;
}

/** Net-worth over time. Responsive: measures itself with onLayout. */
export function LineChart({ data, height = 160 }: Props) {
  useTranslation();
  useCurrencySync();
  const width = 320; // svg scales via preserveAspectRatio + parent flex

  const geom = useMemo(() => {
    const src = data.length >= 2 ? data : [data[0] ?? 0, data[0] ?? 0];
    const padL = 56;
    const padR = 8;
    const padT = 8;
    const padB = 20;
    const w = width - padL - padR;
    const h = height - padT - padB;
    const min = Math.min(...src);
    const max = Math.max(...src);
    const span = max - min || Math.abs(max) || 1;
    const x = (i: number) => padL + (i / (src.length - 1)) * w;
    const y = (v: number) => padT + h - ((v - min) / span) * h;
    const line = src.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(src.length - 1).toFixed(1)},${(padT + h).toFixed(1)} L${padL},${(padT + h).toFixed(1)} Z`;
    return { line, area, min, max, padL, padT, h, y };
  }, [data, height]);

  const up = data.length >= 2 && data[data.length - 1] >= data[0];
  const stroke = up ? Colors.positive : Colors.negative;

  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity={0.25} />
          <Stop offset="1" stopColor={stroke} stopOpacity={0.02} />
        </LinearGradient>
      </Defs>
      <Path d={geom.area} fill="url(#chartFill)" />
      <Path d={geom.line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
      <Line x1={geom.padL} y1={geom.padT} x2={geom.padL} y2={geom.padT + geom.h} stroke={Colors.border} strokeWidth={1} />
      <SvgText x={4} y={geom.padT + 4} fill={Colors.textDim} fontSize={10}>
        {formatMoney(geom.max)}
      </SvgText>
      <SvgText x={4} y={geom.padT + geom.h} fill={Colors.textDim} fontSize={10}>
        {formatMoney(geom.min)}
      </SvgText>
    </Svg>
  );
}
