import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ClientOnly } from "@/components/ClientOnly";
import { loadGoogleMaps, USOP_MAP_STYLE, pinIcon } from "@/lib/google-maps";

export const Route = createFileRoute("/_authenticated/add-slot")({
  component: AddSlot,
});

const CHENNAI = { lat: 13.05, lng: 80.24 };

function AddSlot() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", approx_area: "", full_address: "",
    lat: CHENNAI.lat, lng: CHENNAI.lng,
    hourly_rate: "40", daily_rate: "300", monthly_rate: "6000",
    vehicle_type: "both" as "car" | "bike" | "both",
    vehicle_size_limit: "",
    access_instructions: "",
    photo_url: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<any>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("slots").insert({
        owner_id: user.id,
        name: form.name,
        approx_area: form.approx_area,
        full_address: form.full_address,
        lat: form.lat,
        lng: form.lng,
        hourly_rate: parseFloat(form.hourly_rate) || 0,
        daily_rate: parseFloat(form.daily_rate) || 0,
        monthly_rate: parseFloat(form.monthly_rate) || 0,
        vehicle_type: form.vehicle_type,
        vehicle_size_limit: form.vehicle_size_limit,
        access_instructions: form.access_instructions,
        photos: form.photo_url ? [form.photo_url] : [],
        status: "open",
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["my-slots"] });
      toast.success("Slot added");
      navigate({ to: "/my-slots" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-4">
        <Link to="/my-slots" className="text-white/60 text-sm flex items-center gap-1"><ArrowLeft className="w-4 h-4"/>Back</Link>
        <h1 className="text-2xl font-black mt-2">Add slot</h1>
      </div>
      <form onSubmit={save} className="px-5 py-4 space-y-3">
        <Field label="Name" value={form.name} onChange={set("name")} required/>

        <div>
          <span className="text-xs font-semibold text-muted-foreground uppercase">Location</span>
          <div className="mt-1 rounded-2xl overflow-hidden border border-border" style={{ height: 300 }}>
            <ClientOnly fallback={<div className="p-4 text-sm text-muted-foreground">Loading map…</div>}>
              <LocationPicker
                lat={form.lat}
                lng={form.lng}
                onChange={(loc) =>
                  setForm(f => ({
                    ...f,
                    lat: loc.lat,
                    lng: loc.lng,
                    full_address: loc.address ?? f.full_address,
                    approx_area: loc.area ?? f.approx_area,
                  }))
                }
              />
            </ClientOnly>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Search or drag the pin. Address & area auto-fill.</p>
        </div>

        <Field label="Approx area (public)" value={form.approx_area} onChange={set("approx_area")} required placeholder="e.g. Near T Nagar signal"/>
        <Field label="Full address (revealed after booking)" value={form.full_address} onChange={set("full_address")} required/>

        <div>
          <span className="text-xs font-semibold text-muted-foreground uppercase">Vehicle type</span>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {(["car","bike","both"] as const).map(v => (
              <button key={v} type="button" onClick={() => setForm(f => ({...f, vehicle_type: v}))}
                className={`rounded-xl border-2 py-2 text-xs capitalize font-semibold ${form.vehicle_type === v ? "border-primary bg-primary/10" : "border-border"}`}>{v}</button>
            ))}
          </div>
        </div>
        <Field label="Vehicle size limit" value={form.vehicle_size_limit} onChange={set("vehicle_size_limit")} placeholder="e.g. Sedan / SUV"/>
        <div className="grid grid-cols-3 gap-2">
          <Field label="₹/hour" value={form.hourly_rate} onChange={set("hourly_rate")} type="number"/>
          <Field label="₹/day" value={form.daily_rate} onChange={set("daily_rate")} type="number"/>
          <Field label="₹/month" value={form.monthly_rate} onChange={set("monthly_rate")} type="number"/>
        </div>
        <Field label="Access instructions" value={form.access_instructions} onChange={set("access_instructions")}/>
        <Field label="Photo URL" value={form.photo_url} onChange={set("photo_url")} placeholder="https://…"/>
        <button disabled={busy} className="w-full rounded-2xl bg-primary py-4 font-bold text-primary-foreground disabled:opacity-60">
          {busy ? "…" : "Save slot"}
        </button>
      </form>
    </div>
  );
}

function LocationPicker({
  lat, lng, onChange,
}: {
  lat: number; lng: number;
  onChange: (loc: { lat: number; lng: number; address?: string; area?: string }) => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const inputEl = useRef<HTMLInputElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then((g) => {
      if (cancelled || !mapEl.current) return;
      const center = { lat, lng };
      const map = new g.maps.Map(mapEl.current, {
        center, zoom: 15, styles: USOP_MAP_STYLE,
        disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy", clickableIcons: false,
      });
      mapRef.current = map;
      geocoderRef.current = new g.maps.Geocoder();

      const marker = new g.maps.Marker({
        position: center, map, draggable: true,
        icon: { url: pinIcon("#FFD400"), scaledSize: new g.maps.Size(36, 44), anchor: new g.maps.Point(18, 42) },
      });
      markerRef.current = marker;

      const commit = (pos: google.maps.LatLng) => {
        const p = { lat: pos.lat(), lng: pos.lng() };
        geocoderRef.current!.geocode({ location: p }, (results, status) => {
          if (status === "OK" && results?.[0]) {
            const r = results[0];
            const area =
              r.address_components?.find((c) => c.types.includes("sublocality") || c.types.includes("neighborhood"))?.long_name ||
              r.address_components?.find((c) => c.types.includes("locality"))?.long_name;
            onChange({ ...p, address: r.formatted_address, area });
          } else {
            onChange(p);
          }
        });
      };

      marker.addListener("dragend", () => {
        const pos = marker.getPosition();
        if (pos) { map.panTo(pos); commit(pos); }
      });
      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        marker.setPosition(e.latLng);
        commit(e.latLng);
      });

      if (inputEl.current && g.maps.places?.Autocomplete) {
        const ac = new g.maps.places.Autocomplete(inputEl.current, {
          fields: ["geometry", "formatted_address", "address_components", "name"],
        });
        ac.bindTo("bounds", map);
        ac.addListener("place_changed", () => {
          const p = ac.getPlace();
          const loc = p.geometry?.location;
          if (!loc) return;
          map.setCenter(loc); map.setZoom(16);
          marker.setPosition(loc);
          const area =
            p.address_components?.find((c) => c.types.includes("sublocality") || c.types.includes("neighborhood"))?.long_name ||
            p.address_components?.find((c) => c.types.includes("locality"))?.long_name ||
            p.name;
          onChange({ lat: loc.lat(), lng: loc.lng(), address: p.formatted_address, area });
        });
      }
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={mapEl} className="absolute inset-0" />
      <div className="absolute top-2 left-2 right-2 z-10">
        <div className="flex items-center gap-2 bg-white rounded-full shadow px-3 py-2 border border-black/5">
          <Search className="w-4 h-4 text-black/50" />
          <input
            ref={inputEl}
            placeholder="Search address"
            className="flex-1 outline-none text-sm bg-transparent"
          />
        </div>
      </div>
    </div>
  );
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground uppercase">{label}</span>
      <input {...props} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5"/>
    </label>
  );
}
