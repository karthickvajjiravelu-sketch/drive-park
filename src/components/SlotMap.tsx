import { useEffect, useRef, useState } from "react";
import type { Slot } from "@/lib/queries";
import { loadGoogleMaps, USOP_MAP_STYLE, pinIcon } from "@/lib/google-maps";
import { Search } from "lucide-react";

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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((g) => {
      if (cancelled || !mapEl.current) return;
      mapRef.current = new g.maps.Map(mapEl.current, {
        center: { lat: center[0], lng: center[1] },
        zoom: 14,
        styles: USOP_MAP_STYLE,
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
          else { mapRef.current!.setCenter(loc); mapRef.current!.setZoom(15); }
          if (destMarkerRef.current) destMarkerRef.current.setMap(null);
          destMarkerRef.current = new g.maps.Marker({
            position: loc, map: mapRef.current!,
            icon: { url: pinIcon("#000", "#FFD400"), scaledSize: new g.maps.Size(40, 48), anchor: new g.maps.Point(20, 46) },
            title: p.name || "Destination",
            zIndex: 999,
          });
          onDestinationChange?.({ lat: loc.lat(), lng: loc.lng(), label: p.name || p.formatted_address || "Destination" });
        });
      }
      setReady(true);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const centeredOnce = useRef(false);
  useEffect(() => {
    if (!mapRef.current || centeredOnce.current) return;
    mapRef.current.setCenter({ lat: center[0], lng: center[1] });
    centeredOnce.current = true;
  }, [center]);

  useEffect(() => {
    if (!ready || !mapRef.current || !(window as any).google) return;
    const g = (window as any).google as typeof google;
    const existing = markersRef.current;
    const seen = new Set<string>();

    slots.forEach((s) => {
      seen.add(s.id);
      const isFull = s.status === "full";
      const icon = {
        url: pinIcon(isFull ? "#9ca3af" : "#FFD400"),
        scaledSize: new g.maps.Size(36, 44),
        anchor: new g.maps.Point(18, 42),
      };
      let m = existing.get(s.id);
      if (!m) {
        m = new g.maps.Marker({
          position: { lat: s.lat, lng: s.lng },
          map: mapRef.current!,
          icon,
          opacity: isFull ? 0.6 : 1,
          title: s.name,
        });
        m.addListener("click", () => {
          infoRef.current?.setContent(
            `<div style="font-family:Inter,sans-serif;min-width:180px">
               <div style="font-weight:800;color:#111">${escapeHtml(s.name)}</div>
               <div style="font-size:12px;color:#666;margin-top:2px">${escapeHtml(s.approx_area || "")}</div>
               <div style="margin-top:6px;font-weight:700">₹${s.hourly_rate}<span style="color:#666;font-weight:500">/hr</span> · ${isFull ? "Full" : "Open"}</div>
               <button id="usop-view-${s.id}" style="margin-top:8px;width:100%;background:#FFD400;color:#000;border:none;padding:8px 10px;border-radius:8px;font-weight:700;cursor:pointer">View details</button>
             </div>`
          );
          infoRef.current?.open({ map: mapRef.current!, anchor: m! });
          g.maps.event.addListenerOnce(infoRef.current!, "domready", () => {
            document.getElementById(`usop-view-${s.id}`)?.addEventListener("click", () => onSelect(s.id));
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
      if (!seen.has(id)) { m.setMap(null); existing.delete(id); }
    });
  }, [slots, ready, onSelect]);

  return (
    <div className="relative w-full h-full min-h-[60vh]">
      <div ref={mapEl} className="absolute inset-0" />
      <div className="absolute top-3 left-3 right-3 z-10">
        <div className="flex items-center gap-2 bg-white rounded-full shadow-lg px-3 py-2 border border-black/5">
          <Search className="w-4 h-4 text-black/50" />
          <input
            ref={searchEl}
            placeholder="Search a destination"
            className="flex-1 outline-none text-sm bg-transparent"
          />
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
