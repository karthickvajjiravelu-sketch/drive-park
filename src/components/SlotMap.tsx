import { useEffect, useRef, useState } from "react";
import type { Slot } from "@/lib/queries";
import { loadGoogleMaps, mapStyleFor, pinIcon } from "@/lib/google-maps";
import { useTheme } from "next-themes";
import { Search } from "lucide-react";
import { locationSchema, validate } from "@/lib/validation";

export default function SlotMap({
  slots,
  center,
  onSelect,
  onDestinationChange,
}: {
  slots: Slot[];
  center: [number, number];
  onSelect: (id: string) => void;
  onDestinationChange?: (loc: { lat: number; lng: number; label: string }) => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const searchEl = useRef<HTMLInputElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const destMarkerRef = useRef<google.maps.Marker | null>(null);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        mapRef.current = new g.maps.Map(mapEl.current, {
          center: { lat: center[0], lng: center[1] },
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
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setOptions({ styles: mapStyleFor(isDark) });
  }, [isDark, ready]);

  const centeredOnce = useRef(false);
  useEffect(() => {
    if (!mapRef.current || centeredOnce.current) return;
    mapRef.current.setCenter({ lat: center[0], lng: center[1] });
    centeredOnce.current = true;
  }, [center]);

  useEffect(() => {
    if (!ready || !mapRef.current || !(window as unknown as { google?: typeof google }).google)
      return;
    const g = (window as unknown as { google: typeof google }).google;
    const existing = markersRef.current;
    const seen = new Set<string>();

    slots.forEach((s) => {
      seen.add(s.id);
      const isFull = s.status === "full";
      const icon = {
        url: pinIcon(isFull ? "#E85D3D" : "#1FA35A", "#241F3D"),
        scaledSize: new g.maps.Size(36, 44),
        anchor: new g.maps.Point(18, 42),
      };
      let m = existing.get(s.id);
      if (!m) {
        m = new g.maps.Marker({
          position: { lat: s.lat, lng: s.lng },
          map: mapRef.current!,
          icon,
          opacity: isFull ? 0.65 : 1,
          title: s.name,
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
        m.setOpacity(isFull ? 0.6 : 1);
      }
    });

    existing.forEach((m, id) => {
      if (!seen.has(id)) {
        m.setMap(null);
        existing.delete(id);
      }
    });
  }, [slots, ready, onSelect, isDark]);

  return (
    <div className="relative w-full h-full min-h-[60vh]">
      <div ref={mapEl} className="absolute inset-0" />
      <div className="absolute top-3 left-3 right-3 z-10">
        <div className="flex items-center gap-2 bg-card text-card-foreground rounded-full shadow-lg px-3 py-2 border border-border">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
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
