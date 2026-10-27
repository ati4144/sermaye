import { useEffect, useRef, useState } from 'react';

/**
 * Tween a number with requestAnimationFrame and an easeOutCubic curve
 * (t*(2-t) form — no Math.pow). Works identically on native and web.
 */
export function useAnimatedNumber(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === value) return;

    fromRef.current = value;
    startRef.current = 0;

    const step = (ts: number) => {
      if (startRef.current === 0) startRef.current = ts;
      const t = Math.min(1, (ts - startRef.current) / durationMs);
      const eased = t * (2 - t); // easeOutCubic approximation
      const next = fromRef.current + (target - fromRef.current) * eased;
      setValue(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}
