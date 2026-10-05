/**
 * Camera policy for the photorealistic 3D view.
 *
 * Privacy: a LOCKED policy is built only from the approximate point. Exact coordinates
 * are ignored even if passed in. UNLOCKED needs both `unlocked === true` and an exact point
 * (which the app only has after get_slots_private returned it for this user).
 */
export type LatLng = { lat: number; lng: number };
export type Bounds = { north: number; south: number; east: number; west: number };

export const LOCKED_LIMITS = {
  minRange: 600,
  maxRange: 5000,
  maxTilt: 45,
  minAltitude: 250,
  boundsKm: 0.8,
  circleRadiusM: 250,
} as const;
export const UNLOCKED_LIMITS = {
  minRange: 80,
  maxRange: 5000,
  maxTilt: 67.5,
  minAltitude: 0,
  boundsKm: 0.8,
} as const;

export type CameraPolicy = {
  locked: boolean;
  center: LatLng;
  range: number;
  minRange: number;
  maxRange: number;
  tilt: number;
  maxTilt: number;
  minAltitude: number;
  bounds: Bounds;
};

const KM_PER_DEG_LAT = 111.32;

export function boundsAround(p: LatLng, km: number): Bounds {
  const dLat = km / KM_PER_DEG_LAT;
  const dLng = km / (KM_PER_DEG_LAT * Math.max(0.01, Math.cos((p.lat * Math.PI) / 180)));
  return { north: p.lat + dLat, south: p.lat - dLat, east: p.lng + dLng, west: p.lng - dLng };
}

const valid = (p?: LatLng | null): p is LatLng =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

export function cameraPolicy(input: {
  approx: LatLng;
  exact?: LatLng | null;
  unlocked: boolean;
}): CameraPolicy {
  if (input.unlocked === true && valid(input.exact)) {
    const c = { lat: input.exact.lat, lng: input.exact.lng };
    return {
      locked: false,
      center: c,
      range: 250,
      minRange: UNLOCKED_LIMITS.minRange,
      maxRange: UNLOCKED_LIMITS.maxRange,
      tilt: 60,
      maxTilt: UNLOCKED_LIMITS.maxTilt,
      minAltitude: UNLOCKED_LIMITS.minAltitude,
      bounds: boundsAround(c, UNLOCKED_LIMITS.boundsKm),
    };
  }
  const c = { lat: input.approx.lat, lng: input.approx.lng };
  return {
    locked: true,
    center: c,
    range: 900,
    minRange: LOCKED_LIMITS.minRange,
    maxRange: LOCKED_LIMITS.maxRange,
    tilt: 40,
    maxTilt: LOCKED_LIMITS.maxTilt,
    minAltitude: LOCKED_LIMITS.minAltitude,
    bounds: boundsAround(c, LOCKED_LIMITS.boundsKm),
  };
}

export type Camera = { center: LatLng; range: number; tilt: number };

/** Snap a camera back inside the policy (range, tilt, centre inside bounds). */
export function clampCamera(policy: CameraPolicy, cam: Camera): Camera {
  const b = policy.bounds;
  const clamp = (v: number, lo: number, hi: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
  return {
    center: {
      lat: clamp(cam.center.lat, b.south, b.north),
      lng: clamp(cam.center.lng, b.west, b.east),
    },
    range: clamp(cam.range, policy.minRange, policy.maxRange),
    tilt: clamp(cam.tilt, 0, policy.maxTilt),
  };
}

export function sameCamera(a: Camera, b: Camera): boolean {
  return (
    Math.abs(a.range - b.range) < 0.5 &&
    Math.abs(a.tilt - b.tilt) < 0.05 &&
    Math.abs(a.center.lat - b.center.lat) < 1e-7 &&
    Math.abs(a.center.lng - b.center.lng) < 1e-7
  );
}

/** Closed ring of points approximating a circle (for the "approximate area" overlay). */
export function circlePath(c: LatLng, radiusM: number, n = 48): LatLng[] {
  const out: LatLng[] = [];
  const dLat = radiusM / 1000 / KM_PER_DEG_LAT;
  const dLng = radiusM / 1000 / (KM_PER_DEG_LAT * Math.cos((c.lat * Math.PI) / 180));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    out.push({ lat: c.lat + dLat * Math.sin(a), lng: c.lng + dLng * Math.cos(a) });
  }
  return out;
}

/** Slots whose exact data the map screen may request: only the caller's own. */
export function ownSlotIds(
  slots: readonly { id: string; owner_id: string }[],
  userId?: string | null,
) {
  if (!userId) return [];
  return slots.filter((s) => s.owner_id === userId).map((s) => s.id);
}
