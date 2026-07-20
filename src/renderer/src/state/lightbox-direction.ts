export function lightboxStepForKey(key: 'ArrowLeft' | 'ArrowRight', direction: 'ltr' | 'rtl'): -1 | 1 {
  const visualStep = key === 'ArrowRight' ? 1 : -1;
  return direction === 'rtl' ? (-visualStep as -1 | 1) : visualStep;
}
