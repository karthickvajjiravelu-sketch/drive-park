import { useEffect, useRef, useState } from "react";
import type { Slot } from "@/lib/queries";
import {
  loadGoogleMaps,
  mapStyleFor,
  onGoogleMapsAuthFailure,
  pinIcon,
  pricePinIcon,
  resetGoogleMapsLoader,
  type RateKind,
} from "@/lib/google-maps";
import { useTheme } from "next-themes";
import { Search, AlertTriangle } from "lucide-react";
import { locationSchema, validate } from "@/lib/validation";

export default function SlotMap({
  slots,
  center,
  onSelect,
  onDestinationChange,
  rate = "hourly",
  onShowList,
  windowPrices,
}: {
  slots: Slot[];
  center: [number, number];
  onSelect: (id: string) => void;
  onDestinationChange?: (loc: { lat: number; lng: number; label: string }) => void;
  /** Rate type whose listed price is shown on each pin. */
  rate?: RateKind;
  onShowList?: () => void;
  /** Active time window: total for the window per slot (replaces the listed rate on pins). */
  windowPrices?: Map<string, { total: number; available: boolean; reasonText: string | null }>;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const searchEl = useRef<HTMLInputElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const destMarkerRef = useRef<google.maps.Marker | null>(null);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<null | "load" | "auth">(null);
  const [attempt, setAttempt] = useState(0);
  // Latest requested center, applied whenever the map becomes ready.
  const centerRef = useRef(center);
  centerRef.current = center;
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => onGoogleMapsAuthFailure(() => setLoadError("auth")), []);

  useEffect(() => {
    let cancelled = false;
    setLoadError((e) => (e === "auth" ? e : null));
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        const c = centerRef.current;
        mapRef.current = new g.maps.Map(mapEl.current, {
          center: { lat: c[0], lng: c[1] },
          zoom: 14,
          styles: mapStyleFor(document.documentElement.classList.contains("dark")),
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        infoRef.current = new g.maps.InfoWindow();

        if (searchEl.current && g.maps.places?.Autocomplete) {
          const ac = new g.maps.places.Autocomplete(searchEl.current, {
            fields: ["geometry", "name", "formatted_address"],
            componentRestrictions: { country: "in" },
          });
          ac.bindTo("bounds", mapRef.current);
          ac.addListener("place_changed", () => {
            const p = ac.getPlace();
            const loc = p.geometry?.location;
            if (!loc) return;
            if (p.geometry?.viewport) mapRef.current!.fitBounds(p.geometry.viewport);
            else {
              mapRef.current!.setCenter(loc);
              mapRef.current!.setZoom(15);
            }
            if (destMarkerRef.current) destMarkerRef.current.setMap(null);
            destMarkerRef.current = new g.maps.Marker({
              position: loc,
              map: mapRef.current!,
              icon: {
                url: pinIcon("#443A78", "#F2A522"),
                scaledSize: new g.maps.Size(40, 48),
                anchor: new g.maps.Point(20, 46),
              },
              title: p.name || "Destination",
              zIndex: 999,
            });
            onDestinationChange?.({
              lat: loc.lat(),
              lng: loc.lng(),
              label: p.name || p.formatted_address || "Destination",
            });
          });
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError((e) => e ?? "load");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  function retry() {
    resetGoogleMapsLoader();
    setLoadError(null);
    setAttempt((n) => n + 1);
  }

  useEffect(() => {
    mapRef.current?.setOptions({ styles: mapStyleFor(isDark) });
  }, [isDark, ready]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    mapRef.current.setCenter({ lat: center[0], lng: center[1] });
  }, [center[0], center[1], ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !mapRef.current || !(window as unknown as { google?: typeof google }).google)
      return;
    const g = (window as unknown as { google: typeof google }).google;
    const existing = markersRef.current;
    const seen = new Set<string>();

    slots.forEach((s) => {
      seen.add(s.id);
      const isFull = s.status === "full";
      const listed = Number((s as unknown as Record<string, number>)[`${rate}_rate`]) || 0;
      const priceText = `₹${listed}`;
      const unit = rate === "hourly" ? "hour" : rate === "daily" ? "day" : "month";
      const pin = pricePinIcon(
        isFull ? "#E85D3D" : "#1FA35A",
        priceText,
        isDark ? "#F0ECF8" : "#241F3D",
      );
      const icon = {
        url: pin.url,
        scaledSize: new g.maps.Size(pin.width, 38),
        anchor: new g.maps.Point(pin.width / 2, 36),
      };
      const title = w
        ? `${s.name} · ${priceText} total for your time · ${w.available ? "Available" : (w.reasonText ?? "Not available")}`
        : `${s.name} · listed rate ${priceText} per ${unit} · ${isFull ? "Full" : "Open"}`;
      let m = existing.get(s.id);
      if (!m) {
        m = new g.maps.Marker({
          position: { lat: s.lat, lng: s.lng },
          map: mapRef.current!,
          icon,
          opacity: unavailable ? 0.55 : 1,
          title,
        });
        m.addListener("click", () => {
          const ink = isDark ? "#F0ECF8" : "#2A2438";
          const sub = isDark ? "#a9a1c0" : "#6b6478";
          infoRef.current?.setContent(
            `<div style="font-family:Inter,sans-serif;min-width:180px;color:${ink}">
               <div style="font-weight:800">${escapeHtml(s.name)}</div>
               <div style="font-size:12px;color:${sub};margin-top:2px">${escapeHtml(s.approx_area || "")}</div>
               <div style="margin-top:6px;font-weight:700">₹${s.hourly_rate}<span style="color:${sub};font-weight:500">/hr</span> · <span style="color:${isFull ? "#E85D3D" : "#1FA35A"}">${isFull ? "Full" : "Open"}</span></div>
               <button id="usop-view-${s.id}" style="margin-top:8px;width:100%;background:#F2A522;color:#241F3D;border:none;padding:8px 10px;border-radius:8px;font-weight:700;cursor:pointer">View details</button>
             </div>`,
          );
          infoRef.current?.open({ map: mapRef.current!, anchor: m! });
          g.maps.event.addListenerOnce(infoRef.current!, "domready", () => {
            document
              .getElementById(`usop-view-${s.id}`)
              ?.addEventListener("click", () => onSelect(s.id));
          });
        });
        existing.set(s.id, m);
      } else {
        m.setPosition({ lat: s.lat, lng: s.lng });
        m.setIcon(icon);
        m.setOpacity(unavailable ? 0.55 : 1);
        m.setTitle(title);
      }
    });

    existing.forEach((m, id) => {
      if (!seen.has(id)) {
        m.setMap(null);
        existing.delete(id);
      }
    });
  }, [slots, ready, onSelect, isDark, rate, windowPrices]);

  return (
    <div className="relative w-full h-full min-h-[60vh]">
      <div ref={mapEl} className="absolute inset-0" />
      {loadError && (
        <div
          role="alert"
          className="absolute inset-0 z-20 grid place-items-center bg-background/95 p-6"
        >
          <div className="max-w-sm text-center space-y-3">
            <AlertTriangle className="w-8 h-8 mx-auto text-destructive" aria-hidden />
            <p className="font-bold">
              {loadError === "auth"
                ? "The map is unavailable right now (map access was refused)."
                : "The map couldn't load."}
            </p>
            <p className="text-sm text-muted-foreground">
              {loadError === "auth"
                ? "This is a setup problem on our side, such as the map key or billing. You can still browse spaces as a list."
                : "Check your connection and try again, or browse spaces as a list."}
            </p>
            <div className="flex gap-2 justify-center">
              {loadError === "load" && (
                <button
                  onClick={retry}
                  className="min-h-11 px-4 rounded-full bg-primary text-primary-foreground font-semibold text-sm"
                >
                  Retry
                </button>
              )}
              {onShowList && (
                <button
                  onClick={onShowList}
                  className="min-h-11 px-4 rounded-full border border-border font-semibold text-sm"
                >
                  Show list instead
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="absolute top-3 left-3 right-3 z-10">
        <div className="flex items-center gap-2 bg-card text-card-foreground rounded-full shadow-lg px-3 py-2 border border-border">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            aria-label="Search a destination"
            ref={searchEl}
            placeholder="Search a destination"
            aria-invalid={!!searchError}
            onChange={(e) => {
              const v = e.target.value;
              setSearchError(v.length === 0 ? null : validate(locationSchema, v));
            }}
            className="flex-1 outline-none text-sm bg-transparent"
          />
        </div>
        {searchError && (
          <p className="mt-1 ml-3 text-xs font-semibold text-destructive drop-shadow">
            {searchError}
          </p>
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
