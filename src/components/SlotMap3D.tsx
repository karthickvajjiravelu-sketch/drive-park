/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { loadMaps3d, onGoogleMapsAuthFailure, type Maps3D } from "@/lib/google-maps";
import {
  circlePath,
  clampCamera,
  sameCamera,
  LOCKED_LIMITS,
  type CameraPolicy,
} from "@/lib/map3d-camera";

export type OverlayKind = "circle" | "marker" | "none";

const LOAD_TIMEOUT_MS = 10_000;
// Overlay colours sit on photographic tiles, which don't follow the app theme.
const ACCENT = "#F2A522";
const ACCENT_FILL = "rgba(242,165,34,0.28)";

function addCircle(lib: Maps3D, map: HTMLElement, p: CameraPolicy, radiusM: number): boolean {
  if (!lib.Polygon3DElement) return false;
  try {
    const poly = new lib.Polygon3DElement({
      altitudeMode: "CLAMP_TO_GROUND" as google.maps.maps3d.AltitudeModeString,
      fillColor: ACCENT_FILL,
      strokeColor: ACCENT,
      strokeWidth: 3,
      drawsOccludedSegments: true,
    });
    const ring = circlePath(p.center, radiusM);
    const anyPoly = poly as unknown as { path?: unknown; outerCoordinates?: unknown };
    if ("path" in poly) anyPoly.path = ring;
    else anyPoly.outerCoordinates = ring;
    map.append(poly);
    return true;
  } catch {
    return false;
  }
}

function addMarker(lib: Maps3D, map: HTMLElement, p: CameraPolicy): boolean {
  if (!lib.Marker3DElement) return false;
  try {
    const m = new lib.Marker3DElement({
      position: { lat: p.center.lat, lng: p.center.lng },
      altitudeMode: "CLAMP_TO_GROUND" as google.maps.maps3d.AltitudeModeString,
    });
    map.append(m);
    return true;
  } catch {
    return false;
  }
}

/** Locked: translucent ~250 m circle (fallback marker). Unlocked: exact marker (fallback small circle). */
function addOverlay(lib: Maps3D, map: HTMLElement, p: CameraPolicy): OverlayKind {
  if (p.locked) {
    if (addCircle(lib, map, p, LOCKED_LIMITS.circleRadiusM)) return "circle";
    return addMarker(lib, map, p) ? "marker" : "none";
  }
  if (addMarker(lib, map, p)) return "marker";
  return addCircle(lib, map, p, 30) ? "circle" : "none";
}

export default function SlotMap3D({
  policy,
  label,
  onLoaded,
  onError,
  onOverlay,
}: {
  policy: CameraPolicy;
  label: string;
  onLoaded: () => void;
  onError: (message: string) => void;
  onOverlay?: (kind: OverlayKind) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const cb = useRef({ onLoaded, onError, onOverlay });
  cb.current = { onLoaded, onError, onOverlay };

  useEffect(() => {
    let done = false;
    let unmounted = false;
    let el: HTMLElement | null = null;
    setState("loading");
    const fail = (msg: string) => {
      if (done || unmounted) return;
      done = true;
      setState("error");
      cb.current.onError(msg);
    };
    const offAuth = onGoogleMapsAuthFailure(() =>
      fail("Google didn't allow the 3D map for this site."),
    );
    const timer = setTimeout(() => fail("The 3D view took too long to load."), LOAD_TIMEOUT_MS);

    loadMaps3d(LOAD_TIMEOUT_MS)
      .then((lib) => {
        if (done || unmounted || !host.current) return;
        const p = policy;
        const map = new lib.Map3DElement({
          center: { lat: p.center.lat, lng: p.center.lng, altitude: 0 },
          range: p.range,
          tilt: p.tilt,
          heading: 0,
          bounds: p.bounds,
          minAltitude: p.minAltitude,
          minTilt: 0,
          maxTilt: p.maxTilt,
          mode: "HYBRID" as google.maps.maps3d.MapModeString,
          description: label,
        });
        el = map as unknown as HTMLElement;
        el.style.width = "100%";
        el.style.height = "100%";
        el.style.display = "block";
        el.addEventListener("gmp-error", () => fail("The 3D map reported an error."));
        el.addEventListener("gmp-steadychange", (e) => {
          if ((e as Event & { isSteady?: boolean }).isSteady && !done && !unmounted) {
            done = true;
            clearTimeout(timer);
            setState("ready");
            cb.current.onLoaded();
          }
        });
        // Second layer on top of Google's bounds/minAltitude: snap the camera back.
        const snap = () => {
          const c = map.center;
          if (!c) return;
          const cam = {
            center: { lat: c.lat, lng: c.lng },
            range: map.range ?? p.range,
            tilt: map.tilt ?? p.tilt,
          };
          const next = clampCamera(p, cam);
          if (!sameCamera(next, cam)) {
            map.center = { ...next.center, altitude: 0 };
            map.range = next.range;
            map.tilt = next.tilt;
          }
        };
        for (const ev of ["gmp-rangechange", "gmp-centerchange", "gmp-tiltchange"])
          el.addEventListener(ev, snap);
        cb.current.onOverlay?.(addOverlay(lib, el, p));
        host.current.append(el);
      })
      .catch(() => fail("The 3D view isn't available right now."));

    return () => {
      unmounted = true;
      clearTimeout(timer);
      offAuth();
      el?.remove();
    };
    // policy identity is stable per slot (memoised by the caller)
  }, [policy, label]);

  return (
    <div className="absolute inset-0">
      <div ref={host} className="absolute inset-0" aria-hidden="true" />
      {state === "loading" && (
        <div className="absolute inset-0 bg-muted animate-pulse grid place-items-center">
          <span className="text-sm text-muted-foreground font-semibold">Loading 3D view…</span>
        </div>
      )}
    </div>
  );
}
