/// <reference types="google.maps" />
// Google Maps JS API loader (async, with libraries)
const KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string;
const CHANNEL = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string;

let loaderPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if ((window as any).google?.maps?.Map) return Promise.resolve((window as any).google);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    if (!KEY) return reject(new Error("Missing Google Maps browser key"));
    const cbName = "__usopInitMap";
    (window as any)[cbName] = () => resolve((window as any).google);
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
    s.onerror = () => reject(new Error("Google Maps failed to load"));
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

// SVG pin as data URL
export function pinIcon(color: string, stroke = "#000") {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='44' viewBox='0 0 36 44'>
    <path d='M18 2 C9 2 2 9 2 18 c0 12 16 24 16 24 s16-12 16-24 C34 9 27 2 18 2 z' fill='${color}' stroke='${stroke}' stroke-width='2'/>
    <circle cx='18' cy='17' r='6' fill='${stroke}'/>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
