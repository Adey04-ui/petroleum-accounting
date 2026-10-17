// Motion helpers, straight from the Apple "Designing Fluid Interfaces" ideas:
// springs (not fixed-duration tweens), velocity hand-off, momentum projection, rubber-banding.

// Critically damped: graceful, no overshoot. This is the default for anything that did not carry momentum.
export const SPRING = { type: 'spring', bounce: 0, duration: 0.4 };
// A little bounce, ONLY for releases that carried momentum (a flick or a throw).
export const SPRING_MOMENTUM = { type: 'spring', bounce: 0.2, duration: 0.3 };
// Small things (a selected pill moving between segments).
export const SPRING_SNAP = { type: 'spring', bounce: 0, duration: 0.3 };

/** Where a flick will come to rest: exponential decay, as in Apple's sample code. v is px/s. */
export function project(v, decelerationRate = 0.998) {
  return ((v / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Soft boundary: the further past the edge, the less the element follows. */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Short, meaningful haptic only (success / commit). Silently ignored where unsupported. */
export function haptic(ms = 10) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
