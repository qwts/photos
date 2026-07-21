import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Live `prefers-reduced-motion` state (ADR-0026 §7): animated media must
 * not autoplay for reduced-motion users, and flipping the OS setting while
 * the viewer is open takes effect without a reload. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.(QUERY).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(QUERY);
    if (media === undefined) return;
    const onChange = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);
  return reduced;
}
