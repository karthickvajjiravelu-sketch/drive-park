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
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-5 rounded-b-3xl">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-white/60 font-semibold uppercase tracking-wider">Chennai · Live</div>
            <h1 className="text-2xl font-black mt-0.5">Find parking</h1>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-primary">{sorted.filter(s => s.status === "open").length}</div>
            <div className="text-[10px] text-white/60 font-semibold uppercase">spots open</div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <div className="flex-1 flex bg-white/10 rounded-full p-1">
            <button onClick={() => setView("map")}
              className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition ${view === "map" ? "bg-primary text-primary-foreground" : "text-white/70"}`}>
              <MapPin className="w-3.5 h-3.5"/>Map
            </button>
            <button onClick={() => setView("list")}
              className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition ${view === "list" ? "bg-primary text-primary-foreground" : "text-white/70"}`}>
              <ListIcon className="w-3.5 h-3.5"/>List
            </button>
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 px-3 py-2 rounded-full text-xs font-semibold ${showFilters ? "bg-primary text-primary-foreground" : "bg-white/10"}`}>
            <Filter className="w-3.5 h-3.5"/>Filter
          </button>
        </div>

        {showFilters && (
          <div className="mt-4 space-y-3 text-xs animate-in fade-in slide-in-from-top-2 duration-200">
            <div>
              <div className="text-white/60 font-semibold uppercase text-[10px] mb-1.5">Vehicle</div>
              <div className="flex gap-1.5 flex-wrap">
                {(["all","car","bike","both"] as const).map(v => (
                  <button key={v} onClick={() => setVehicle(v)}
                    className={`px-3 py-1.5 rounded-full capitalize font-semibold ${vehicle === v ? "bg-primary text-primary-foreground" : "bg-white/10"}`}>{v}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-white/60 font-semibold uppercase text-[10px] mb-1.5">Rate</div>
              <div className="flex gap-1.5">
                {(["hourly","daily","monthly"] as const).map(r => (
                  <button key={r} onClick={() => setRate(r)}
                    className={`px-3 py-1.5 rounded-full capitalize font-semibold ${rate === r ? "bg-primary text-primary-foreground" : "bg-white/10"}`}>{r}</button>
                ))}
              </div>
            </div>
            <label className="block">
              <div className="flex justify-between text-white/60 font-semibold uppercase text-[10px] mb-1">
                <span>Max price</span><span className="text-primary">₹{maxPrice}</span>
              </div>
              <input type="range" min={50} max={10000} step={50} value={maxPrice}
                onChange={e => setMaxPrice(+e.target.value)} className="w-full accent-primary"/>
            </label>
          </div>
        )}
      </div>

      {view === "map" ? (
        <div className="flex-1 min-h-[60vh] relative">
          <ClientOnly fallback={<div className="p-6 text-sm text-muted-foreground">Loading map…</div>}>
            <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading map…</div>}>
              <SlotMap slots={sorted} center={center} onSelect={id => navigate({ to: "/slot/$id", params: { id } })}/>
            </Suspense>
          </ClientOnly>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-3">
          <div className="text-xs text-muted-foreground font-semibold px-1">
            {sorted.length} {sorted.length === 1 ? "spot" : "spots"} near you
          </div>
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
      className={`w-full card-elevated overflow-hidden text-left transition active:scale-[0.98] ${full ? "opacity-60" : ""}`}>
      <div className="relative">
        {slot.photos[0]
          ? <img src={slot.photos[0]} alt="" className="w-full h-40 object-cover"/>
          : <div className="w-full h-40 bg-muted grid place-items-center"><MapPin className="w-8 h-8 text-muted-foreground"/></div>}
        <div className="absolute top-2 right-2 price-pill">₹{slot.hourly_rate}<span className="opacity-70 font-semibold">/hr</span></div>
        {full && <div className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-black text-white text-[10px] font-black tracking-wider">FULL</div>}
        {!full && <div className="absolute top-2 left-2 flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/95 text-[10px] font-bold"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"/>OPEN</div>}
      </div>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-black truncate text-[15px]">{slot.name}</div>
            <div className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3"/>{slot.approx_area} · {dist} km away
            </div>
          </div>
          {slot.rating > 0 && <div className="chip"><span className="text-primary">★</span>{slot.rating.toFixed(1)}</div>}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
          <span className="chip capitalize">{slot.vehicle_type}</span>
          {slot.vehicle_size_limit && <span className="chip">{slot.vehicle_size_limit}</span>}
          <span className="chip">Daily ₹{slot.daily_rate}</span>
        </div>
      </div>
    </button>
  );
}

