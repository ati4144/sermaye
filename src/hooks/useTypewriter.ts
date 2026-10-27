import { useEffect, useState } from 'react';

/**
 * Typewriter reveal driven by a plain interval — portable across native and
 * web, testable, no animation library quirks. cps = characters per second;
 * 0 or negative reveals instantly.
 *
 * The consumer is expected to remount (key={text}) when the text changes —
 * see TypewriterText — so state never needs resetting mid-life.
 */
export function useTypewriter(text: string, cps: number, enabled = true) {
  const [count, setCount] = useState(0);
  const instant = !enabled || cps <= 0;

  useEffect(() => {
    if (instant) return;
    let shown = 0;
    const step = Math.max(1, Math.round(cps / 20)); // update ~20×/s
    const interval = Math.max(16, 1000 / (cps / step));
    const id = setInterval(() => {
      shown = Math.min(text.length, shown + step);
      setCount(shown);
      if (shown >= text.length) clearInterval(id);
    }, interval);
    return () => clearInterval(id);
  }, [text, instant, cps]);

  const shown = Math.min(instant ? text.length : count, text.length);
  return {
    visible: text.slice(0, shown),
    done: shown >= text.length,
    skip: () => setCount(text.length),
  };
}
