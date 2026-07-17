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

export interface LightboxOrientation {
  readonly quarterTurns: 0 | 1 | 2 | 3;
  readonly flipped: boolean;
}

export const DEFAULT_ORIENTATION: LightboxOrientation = { quarterTurns: 0, flipped: false };

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;

export function rotateOrientation(orientation: LightboxOrientation, delta: -1 | 1): LightboxOrientation {
  const quarterTurns = (orientation.quarterTurns + delta + 4) % 4;
  return { ...orientation, quarterTurns: quarterTurns as LightboxOrientation['quarterTurns'] };
}

export function orientedSize(size: LightboxSize, orientation: LightboxOrientation): LightboxSize {
  return orientation.quarterTurns % 2 === 0 ? size : { width: size.height, height: size.width };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function fitSize(image: LightboxSize, viewport: LightboxSize): LightboxSize {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, viewport.width / image.width, viewport.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

export function fillZoom(image: LightboxSize, viewport: LightboxSize): number {
  const fitted = fitSize(image, viewport);
  const landscape = image.width >= image.height;
  const fittedAxis = landscape ? fitted.height : fitted.width;
  const viewportAxis = landscape ? viewport.height : viewport.width;
  if (fittedAxis <= 0) return 1;
  return clamp(viewportAxis / fittedAxis, ZOOM_MIN, ZOOM_MAX);
}

export function clampTransform(transform: LightboxTransform, fitted: LightboxSize, viewport: LightboxSize): LightboxTransform {
  const zoom = clamp(transform.zoom, ZOOM_MIN, ZOOM_MAX);
  const maximumX = Math.max(0, (fitted.width * zoom - viewport.width) / 2);
  const maximumY = Math.max(0, (fitted.height * zoom - viewport.height) / 2);
  return {
    zoom,
    x: clamp(transform.x, -maximumX, maximumX),
    y: clamp(transform.y, -maximumY, maximumY),
  };
}

export function panBy(transform: LightboxTransform, delta: LightboxPoint, fitted: LightboxSize, viewport: LightboxSize): LightboxTransform {
  return clampTransform({ zoom: transform.zoom, x: transform.x + delta.x, y: transform.y + delta.y }, fitted, viewport);
}

export function zoomAround(
  transform: LightboxTransform,
  requestedZoom: number,
  focal: LightboxPoint,
  fitted: LightboxSize,
  viewport: LightboxSize,
): LightboxTransform {
  const current = clampTransform(transform, fitted, viewport);
  const zoom = clamp(requestedZoom, ZOOM_MIN, ZOOM_MAX);
  const focalX = focal.x - viewport.width / 2;
  const focalY = focal.y - viewport.height / 2;
  const imageX = (focalX - current.x) / current.zoom;
  const imageY = (focalY - current.y) / current.zoom;
  return clampTransform(
    {
      zoom,
      x: focalX - imageX * zoom,
      y: focalY - imageY * zoom,
    },
    fitted,
    viewport,
  );
}
