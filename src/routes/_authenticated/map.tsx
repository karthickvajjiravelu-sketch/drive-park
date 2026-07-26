import { useEffect, useState, lazy, Suspense, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSlots, useMyFavorites, type Slot } from "@/lib/queries";
import { ClientOnly } from "@/components/ClientOnly";
import { MapPin, List as ListIcon, Filter, Heart, Navigation2 } from "lucide-react";
import { AMENITIES, slotAmenities, type AmenityKey } from "@/lib/amenities";
import { toast } from "sonner";

const SlotMap = lazy(() => import("@/components/SlotMap"));

export const Route = createFileRoute("/_authenticated/map")({
  component: MapPage,
});

const CHENNAI: [number, number] = [13.05, 80.24];

function haversine(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function MapPage() {
  const { data: slots = [] } = useSlots();
  const { data: favorites = [] } = useMyFavorites();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [view, setView] = useState<"map" | "list">("map");
  const [origin, setOrigin] = useState<[number, number]>(CHENNAI);
  const [destination, setDestination] = useState<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);
  const [vehicle, setVehicle] = useState<"all" | "car" | "bike" | "both">("all");
  const [rate, setRate] = useState<"hourly" | "daily" | "monthly">("hourly");
  const [maxPrice, setMaxPrice] = useState(500);
  const [amenities, setAmenities] = useState<Set<AmenityKey>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  const favSet = useMemo(() => new Set(favorites.map((f) => f.slot_id)), [favorites]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setOrigin([pos.coords.latitude, pos.coords.longitude]),
      () => {},
      { timeout: 5000 },
    );
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("slots-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "slots" }, () =>
        qc.invalidateQueries({ queryKey: ["slots"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const anchor = useMemo<[number, number]>(
    () => (destination ? [destination.lat, destination.lng] : origin),
    [destination, origin],
  );

  const filtered = useMemo(() => {
    const rateKey = `${rate}_rate` as const;
    return slots.filter((s) => {
      if (vehicle !== "all" && s.vehicle_type !== vehicle && s.vehicle_type !== "both")
        return false;
      if ((s as unknown as Record<string, number>)[rateKey] > maxPrice) return false;
      for (const a of amenities) if (!s[a]) return false;
      return true;
    });
  }, [slots, vehicle, rate, maxPrice, amenities]);

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) => haversine(anchor, [a.lat, a.lng]) - haversine(anchor, [b.lat, b.lng]),
      ),
    [filtered, anchor],
  );

  async function toggleFav(slotId: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const existing = favorites.find((f) => f.slot_id === slotId);
    if (existing) {
      const { error } = await supabase.from("favorites").delete().eq("id", existing.id);
      if (error) toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("favorites")
        .insert({ driver_id: user.id, slot_id: slotId });
      if (error) toast.error(error.message);
      else toast.success("Saved");
    }
    qc.invalidateQueries({ queryKey: ["my-favorites"] });
  }

  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100dvh - 5rem)" }}>
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-5 rounded-b-3xl">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-white/60 font-semibold uppercase tracking-wider">
              Chennai · Live
            </div>
            <h1 className="text-2xl font-black mt-0.5">Find parking</h1>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-primary">
              {sorted.filter((s) => s.status === "open").length}
            </div>
            <div className="text-[10px] text-white/60 font-semibold uppercase">spots open</div>
          </div>
        </div>

        {destination && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Navigation2 className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="truncate">
                Near <span className="font-bold">{destination.label}</span>
              </span>
            </div>
            <button onClick={() => setDestination(null)} className="text-white/60 font-semibold">
              Clear
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <div className="flex-1 flex bg-white/10 rounded-full p-1">
            <button
              onClick={() => setView("map")}
              className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition ${view === "map" ? "bg-primary text-primary-foreground" : "text-white/70"}`}
            >
              <MapPin className="w-3.5 h-3.5" />
              Map
            </button>
            <button
              onClick={() => setView("list")}
              className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition ${view === "list" ? "bg-primary text-primary-foreground" : "text-white/70"}`}
            >
              <ListIcon className="w-3.5 h-3.5" />
              List
            </button>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 px-3 py-2 rounded-full text-xs font-semibold ${showFilters ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
          </button>
        </div>

        {showFilters && (
          <div className="mt-4 space-y-3 text-xs animate-in fade-in slide-in-from-top-2 duration-200">
            <div>
              <div className="text-white/60 font-semibold uppercase text-[10px] mb-1.5">
                Vehicle
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(["all", "car", "bike", "both"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVehicle(v)}
                    className={`px-3 py-1.5 rounded-full capitalize font-semibold ${vehicle === v ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-white/60 font-semibold uppercase text-[10px] mb-1.5">Rate</div>
              <div className="flex gap-1.5">
                {(["hourly", "daily", "monthly"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRate(r)}
                    className={`px-3 py-1.5 rounded-full capitalize font-semibold ${rate === r ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-white/60 font-semibold uppercase text-[10px] mb-1.5">
                Amenities
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {AMENITIES.map((a) => {
                  const on = amenities.has(a.key);
                  return (
                    <button
                      key={a.key}
                      onClick={() =>
                        setAmenities((prev) => {
                          const next = new Set(prev);
                          if (next.has(a.key)) next.delete(a.key);
                          else next.add(a.key);
                          return next;
                        })
                      }
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full font-semibold ${on ? "bg-primary text-primary-foreground" : "bg-white/10"}`}
                    >
                      <a.icon className="w-3 h-3" />
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block">
              <div className="flex justify-between text-white/60 font-semibold uppercase text-[10px] mb-1">
                <span>Max price</span>
                <span className="text-primary">₹{maxPrice}</span>
              </div>
              <input
                type="range"
                min={50}
                max={10000}
                step={50}
                value={maxPrice}
                onChange={(e) => setMaxPrice(+e.target.value)}
                className="w-full accent-primary"
              />
            </label>
          </div>
        )}
      </div>

      {view === "map" ? (
        <div className="flex-1 min-h-[60vh] relative">
          <ClientOnly
            fallback={<div className="p-6 text-sm text-muted-foreground">Loading map…</div>}
          >
            <Suspense
              fallback={<div className="p-6 text-sm text-muted-foreground">Loading map…</div>}
            >
              <SlotMap
                slots={sorted}
                center={origin}
                onSelect={(id) => navigate({ to: "/slot/$id", params: { id } })}
                onDestinationChange={setDestination}
              />
            </Suspense>
          </ClientOnly>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-3">
          <div className="text-xs text-muted-foreground font-semibold px-1">
            {sorted.length} {sorted.length === 1 ? "spot" : "spots"}{" "}
            {destination ? `near ${destination.label}` : "near you"}
          </div>
          {sorted.map((s) => (
            <SlotCard
              key={s.id}
              slot={s}
              anchor={anchor}
              favorited={favSet.has(s.id)}
              onFav={() => toggleFav(s.id)}
              onClick={() => navigate({ to: "/slot/$id", params: { id: s.id } })}
            />
          ))}
          {sorted.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              No slots match your filters.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SlotCard({
  slot,
  anchor,
  favorited,
  onFav,
  onClick,
}: {
  slot: Slot;
  anchor: [number, number];
  favorited: boolean;
  onFav: () => void;
  onClick: () => void;
}) {
  const dist = haversine(anchor, [slot.lat, slot.lng]).toFixed(1);
  const full = slot.status === "full";
  return (
    <div
      className={`relative card-elevated overflow-hidden transition ${full ? "opacity-60" : ""}`}
    >
      <button onClick={onClick} className="w-full text-left active:scale-[0.98]">
        <div className="relative">
          {slot.photos[0] ? (
            <img src={slot.photos[0]} alt="" className="w-full h-40 object-cover" />
          ) : (
            <div className="w-full h-40 bg-muted grid place-items-center">
              <MapPin className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
          <div className="absolute top-2 right-2 price-pill">
            ₹{slot.hourly_rate}
            <span className="opacity-70 font-semibold">/hr</span>
          </div>
          {full && (
            <div className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-black text-white text-[10px] font-black tracking-wider">
              FULL
            </div>
          )}
          {!full && (
            <div className="absolute top-2 left-2 flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/95 text-[10px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              OPEN
            </div>
          )}
        </div>
        <div className="p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-black truncate text-[15px]">{slot.name}</div>
              <div className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3" />
                {slot.approx_area} · {dist} km away
              </div>
            </div>
            {slot.rating > 0 && (
              <div className="chip">
                <span className="text-primary">★</span>
                {slot.rating.toFixed(1)}
              </div>
            )}
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
            <span className="chip capitalize">{slot.vehicle_type}</span>
            {slotAmenities(slot).map((a) => (
              <span key={a.key} className="chip">
                <a.icon className="w-3 h-3" />
                {a.label}
              </span>
            ))}
            <span className="chip">Daily ₹{slot.daily_rate}</span>
          </div>
        </div>
      </button>
      <button
        onClick={onFav}
        aria-label={favorited ? "Remove from saved" : "Save spot"}
        className="absolute top-3 right-14 w-9 h-9 rounded-full bg-white/95 grid place-items-center shadow"
        style={{ position: "absolute" }}
      >
        <Heart className={`w-4 h-4 ${favorited ? "fill-primary text-primary" : "text-black"}`} />
      </button>
    </div>
  );
}
