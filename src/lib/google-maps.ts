/// <reference types="google.maps" />
// Google Maps JS API loader (async, with libraries)
const KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string;
const CHANNEL = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string;

let loaderPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  const w = window as unknown as { google?: typeof google; [k: string]: unknown };
  if (w.google?.maps?.Map) return Promise.resolve(w.google);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    if (!KEY) return reject(new Error("Missing Google Maps browser key"));
    const cbName = "__usopInitMap";
    w[cbName] = () => resolve(w.google as typeof google);
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key: KEY,
      v: "weekly",
      libraries: "places,marker,geocoding",
      loading: "async",
      callback: cbName,
    });
    if (CHANNEL) params.set("channel", CHANNEL);
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.onerror = () => {
      loaderPromise = null;
      reject(new Error("Google Maps failed to load"));
    };
    document.head.appendChild(s);
  });
  return loaderPromise;
}

// Muted Usop map style (dark accents, subtle roads)
export const USOP_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f2" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5a5a5a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#e8ecd9" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#f2f2ee" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#ffe680" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#e5bd00" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#cfe3ec" }] },
];

// Dark-mode counterpart, tuned to the Usop indigo surfaces
export const USOP_MAP_STYLE_DARK: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#221E38" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9c95b4" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#191631" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#25302b" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#302a4d" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#372f58" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#4a3d6b" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#2a2444" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#161329" }] },
];

export const mapStyleFor = (dark: boolean) => (dark ? USOP_MAP_STYLE_DARK : USOP_MAP_STYLE);

// SVG pin as data URL
export function pinIcon(color: string, stroke = "#241F3D") {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='44' viewBox='0 0 36 44'>
    <path d='M18 2 C9 2 2 9 2 18 c0 12 16 24 16 24 s16-12 16-24 C34 9 27 2 18 2 z' fill='${color}' stroke='${stroke}' stroke-width='2'/>
    <circle cx='18' cy='17' r='6' fill='${stroke}'/>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/* -------------------------------------------------- pure helpers for the map screen */

export type RateKind = "hourly" | "daily" | "monthly";

/** Price slider for a rate type: max = highest listed rate (rounded up to the step), default = max. */
export function priceSliderRange(
  slots: readonly { hourly_rate: number; daily_rate: number; monthly_rate: number }[],
  rate: RateKind,
): { min: number; max: number; step: number } {
  const step = rate === "hourly" ? 10 : rate === "daily" ? 50 : 500;
  const highest = slots.reduce((m, s) => Math.max(m, Number(s[`${rate}_rate`]) || 0), 0);
  const max = Math.max(step, Math.ceil(highest / step) * step);
  return { min: step, max, step };
}

/**
 * Slot coordinates are approximate (150–300 m off) until paid, so distances are rounded:
 * under 5 km to the nearest 0.5 km ("about 0.5 km"), otherwise to the nearest 1 km.
 */
export function distanceLabel(km: number): string {
  if (!Number.isFinite(km)) return "";
  if (km < 5) {
    const r = Math.max(0.5, Math.round(km * 2) / 2);
    return `about ${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)} km`;
  }
  return `about ${Math.round(km)} km`;
}

/** Pin with a price label, as a data URL. */
export function pricePinIcon(color: string, label: string, ink = "#241F3D") {
  const w = Math.max(44, 14 + label.length * 8);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='38' viewBox='0 0 ${w} 38'>
    <rect x='1' y='1' width='${w - 2}' height='26' rx='13' fill='${color}' stroke='${ink}' stroke-width='2'/>
    <path d='M${w / 2 - 6} 26 L${w / 2} 36 L${w / 2 + 6} 26 z' fill='${color}' stroke='${ink}' stroke-width='2' stroke-linejoin='round'/>
    <rect x='${w / 2 - 5}' y='22' width='10' height='5' fill='${color}'/>
    <text x='${w / 2}' y='18.5' text-anchor='middle' font-family='Arial,sans-serif' font-size='13' font-weight='800' fill='#ffffff'>${label.replace(/[<&>]/g, "")}</text>
  </svg>`;
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, width: w };
}

/** Google calls window.gm_authFailure on key/billing/referrer problems. */
export function onGoogleMapsAuthFailure(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as unknown as { gm_authFailure?: () => void };
  const prev = w.gm_authFailure;
  w.gm_authFailure = () => {
    prev?.();
    cb();
  };
  return () => {
    w.gm_authFailure = prev;
  };
}

/** Allow a retry after a failed script load. */
export function resetGoogleMapsLoader() {
  loaderPromise = null;
  if (typeof document !== "undefined")
    document.querySelectorAll('script[src*="maps.googleapis.com/maps/api/js"]').forEach((s) => {
      if (!(window as unknown as { google?: typeof google }).google?.maps?.Map) s.remove();
    });
}
