import { useEffect, useState, lazy, Suspense, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSlots, type Slot } from "@/lib/queries";
import { ClientOnly } from "@/components/ClientOnly";
import { MapPin, List as ListIcon, Filter } from "lucide-react";

const SlotMap = lazy(() => import("@/components/SlotMap"));

export const Route = createFileRoute("/_authenticated/map")({
  component: MapPage,
});

const CHENNAI: [number, number] = [13.05, 80.24];

function haversine(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat/2)**2 + Math.cos(a[0]*Math.PI/180) * Math.cos(b[0]*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

function MapPage() {
  const { data: slots = [] } = useSlots();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [view, setView] = useState<"map" | "list">("map");
  const [center, setCenter] = useState<[number, number]>(CHENNAI);
  const [vehicle, setVehicle] = useState<"all" | "car" | "bike" | "both">("all");
  const [rate, setRate] = useState<"hourly" | "daily" | "monthly">("hourly");
  const [maxPrice, setMaxPrice] = useState(500);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setCenter([pos.coords.latitude, pos.coords.longitude]),
      () => {},
      { timeout: 5000 }
    );
  }, []);

  // Realtime slot updates
  useEffect(() => {
    const channel = supabase
      .channel("slots-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "slots" },
        () => qc.invalidateQueries({ queryKey: ["slots"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const filtered = useMemo(() => {
    const rateKey = `${rate}_rate` as const;
    return slots.filter(s => {
      if (vehicle !== "all" && s.vehicle_type !== vehicle && s.vehicle_type !== "both") return false;
      if ((s as any)[rateKey] > maxPrice) return false;
      return true;
    });
  }, [slots, vehicle, rate, maxPrice]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => haversine(center, [a.lat, a.lng]) - haversine(center, [b.lat, b.lng])),
  [filtered, center]);

  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100dvh - 5rem)" }}>
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-4">
        <h1 className="text-2xl font-black">Find parking</h1>
        <div className="flex items-center gap-2 mt-3">
          <button onClick={() => setView("map")}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold ${view === "map" ? "bg-primary text-primary-foreground" : "bg-white/10"}`}>
            <MapPin className="w-3.5 h-3.5"/>Map
          </button>
          <button onClick={() => setView("list")}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold ${view === "list" ? "bg-primary text-primary-foreground" : "bg-white/10"}`}>
            <ListIcon className="w-3.5 h-3.5"/>List
          </button>
          <button onClick={() => setShowFilters(!showFilters)}
            className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-white/10">
            <Filter className="w-3.5 h-3.5"/>Filter
          </button>
        </div>
        {showFilters && (
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex gap-1">
              {(["all","car","bike","both"] as const).map(v => (
                <button key={v} onClick={() => setVehicle(v)}
                  className={`px-3 py-1 rounded-full ${vehicle === v ? "bg-primary text-primary-foreground" : "bg-white/10"}`}>{v}</button>
              ))}
            </div>
            <div className="flex gap-1">
              {(["hourly","daily","monthly"] as const).map(r => (
                <button key={r} onClick={() => setRate(r)}
                  className={`px-3 py-1 rounded-full ${rate === r ? "bg-primary text-primary-foreground" : "bg-white/10"}`}>{r}</button>
              ))}
            </div>
            <label className="block">
              <span className="text-white/60">Max ₹{maxPrice}</span>
              <input type="range" min={50} max={10000} step={50} value={maxPrice}
                onChange={e => setMaxPrice(+e.target.value)} className="w-full accent-primary"/>
            </label>
          </div>
        )}
      </div>

      {view === "map" ? (
        <div className="flex-1 min-h-[60vh]">
          <ClientOnly fallback={<div className="p-6 text-sm text-muted-foreground">Loading map…</div>}>
            <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading map…</div>}>
              <SlotMap slots={sorted} center={center} onSelect={id => navigate({ to: "/slot/$id", params: { id } })}/>
            </Suspense>
          </ClientOnly>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-3">
          {sorted.map(s => <SlotCard key={s.id} slot={s} center={center}
            onClick={() => navigate({ to: "/slot/$id", params: { id: s.id } })}/>)}
          {sorted.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No slots match your filters.</p>}
        </div>
      )}
    </div>
  );
}

function SlotCard({ slot, center, onClick }: { slot: Slot; center: [number, number]; onClick: () => void }) {
  const dist = haversine(center, [slot.lat, slot.lng]).toFixed(1);
  const full = slot.status === "full";
  return (
    <button onClick={onClick}
      className={`w-full rounded-2xl bg-card border border-border overflow-hidden text-left ${full ? "opacity-50" : ""}`}>
      {slot.photos[0] && <img src={slot.photos[0]} alt="" className="w-full h-32 object-cover"/>}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold truncate">{slot.name}</div>
            <div className="text-xs text-muted-foreground truncate">{slot.approx_area} · {dist} km</div>
          </div>
          {full && <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-black text-white">FULL</span>}
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span className="font-semibold">₹{slot.hourly_rate}/hr</span>
          <span className="text-muted-foreground capitalize">{slot.vehicle_type}</span>
          {slot.rating > 0 && <span className="ml-auto">★ {slot.rating.toFixed(1)}</span>}
        </div>
      </div>
    </button>
  );
}
