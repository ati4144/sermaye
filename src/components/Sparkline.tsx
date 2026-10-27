import { useMemo } from 'react';
import Svg, { Polyline } from 'react-native-svg';
import { Colors } from '@/theme';

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

/** Tiny per-country trend line. Empty/flat-safe. */
export function Sparkline({ data, width = 64, height = 24, color }: Props) {
  const { points, stroke } = useMemo(() => {
    const src = data.length >= 2 ? data : [0, 0];
    const min = Math.min(...src);
    const max = Math.max(...src);
    const span = max - min || 1;
    const step = width / (src.length - 1);
    const pts = src
      .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
      .join(' ');
    const up = src[src.length - 1] >= src[0];
    return { points: pts, stroke: color ?? (up ? Colors.positive : Colors.negative) };
  }, [data, width, height, color]);

  return (
    <Svg width={width} height={height}>
      <Polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}
