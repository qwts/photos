export interface LightboxSize {
  readonly width: number;
  readonly height: number;
}

export interface LightboxPoint {
  readonly x: number;
  readonly y: number;
}

export interface LightboxTransform extends LightboxPoint {
  readonly zoom: number;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;

function pending(): never {
  throw new Error('lightbox geometry contract is not implemented');
}

export function fitSize(_image: LightboxSize, _viewport: LightboxSize): LightboxSize {
  return pending();
}

export function fillZoom(_image: LightboxSize, _viewport: LightboxSize): number {
  return pending();
}

export function clampTransform(_transform: LightboxTransform, _fitted: LightboxSize, _viewport: LightboxSize): LightboxTransform {
  return pending();
}

export function panBy(
  _transform: LightboxTransform,
  _delta: LightboxPoint,
  _fitted: LightboxSize,
  _viewport: LightboxSize,
): LightboxTransform {
  return pending();
}

export function zoomAround(
  _transform: LightboxTransform,
  _zoom: number,
  _focal: LightboxPoint,
  _fitted: LightboxSize,
  _viewport: LightboxSize,
): LightboxTransform {
  return pending();
}
