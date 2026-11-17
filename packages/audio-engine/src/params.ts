export const SMOOTHING_TIME_CONSTANT = 0.015;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Perceptual slider (0..1) to linear gain. */
export const sliderToGain = (v: number) => clamp(v, 0, 1) ** 2;

export const dbToGain = (db: number) => 10 ** (db / 20);

/** Smoothly move a param to `target` (no zipper noise, safe while other automation is pending). */
export function rampTo(
  param: AudioParam,
  target: number,
  now: number,
  timeConstant = SMOOTHING_TIME_CONSTANT,
) {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(target, now, timeConstant);
}

/** Linear fade from the current value to `target` over `durationSec`. */
export function fadeTo(param: AudioParam, target: number, now: number, durationSec: number) {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  if (durationSec <= 0) {
    param.setValueAtTime(target, now);
    return;
  }
  param.linearRampToValueAtTime(target, now + durationSec);
}

const CURVE_STEPS = 64;

/**
 * Equal-power fade from the current value to `target` (sin in / cos out): no -3 dB dip mid-crossfade.
 * Uses setValueCurveAtTime, so all later automation on `param` is cancelled first.
 */
export function equalPowerFade(
  param: AudioParam,
  target: number,
  now: number,
  durationSec: number,
) {
  const from = param.value;
  param.cancelScheduledValues(now);
  if (durationSec <= 0) {
    param.setValueAtTime(target, now);
    return;
  }
  const curve = new Float32Array(CURVE_STEPS);
  for (let i = 0; i < CURVE_STEPS; i++) {
    const x = (i / (CURVE_STEPS - 1)) * (Math.PI / 2);
    curve[i] =
      target >= from
        ? from + (target - from) * Math.sin(x)
        : target + (from - target) * Math.cos(x);
  }
  param.setValueCurveAtTime(curve, now, durationSec);
}
