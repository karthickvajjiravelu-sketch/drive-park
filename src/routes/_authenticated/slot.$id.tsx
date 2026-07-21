import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useSlot } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Star, Car, Ruler, MapPin, Phone, Navigation2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/slot/$id")({
  component: SlotDetail,
});

function SlotDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: slot, isLoading } = useSlot(id);
  const [rateType, setRateType] = useState<"hourly" | "daily" | "monthly">("hourly");
  const [duration, setDuration] = useState(2);
  const [startTime, setStartTime] = useState(() => new Date(Date.now() + 15 * 60000).toISOString().slice(0, 16));
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const channel = supabase.channel(`slot-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "slots", filter: `id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["slot", id] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, qc]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!slot) return <div className="p-6">Slot not found</div>;

  const rate = slot[`${rateType}_rate` as const] as number;
  const total = rate * duration;
  const booked = !!reservationId;
  const isFull = slot.status === "full";

  async function reserve() {
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const start = new Date(startTime);
      const msPerUnit = rateType === "hourly" ? 3600e3 : rateType === "daily" ? 86400e3 : 30 * 86400e3;
      const end = new Date(start.getTime() + duration * msPerUnit);
      const { data, error } = await supabase.from("reservations").insert({
        driver_id: user.id,
        slot_id: slot!.id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status: "active",
        total_price: total,
        rate_type: rateType,
      }).select("id").single();
      if (error) throw error;
      setReservationId(data.id);
      qc.invalidateQueries({ queryKey: ["my-reservations"] });
      toast.success("Reserved!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  async function notifyMe() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("slot_notify").upsert({ driver_id: user.id, slot_id: slot!.id });
    if (error) toast.error(error.message);
    else toast.success("You'll be notified when it opens");
  }

  return (
    <div>
      <div className="relative">
        {slot.photos[0] ? (
          <img src={slot.photos[0]} alt="" className="w-full h-64 object-cover"/>
        ) : <div className="w-full h-64 bg-muted"/>}
        <button onClick={() => navigate({ to: "/map" })}
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/60 grid place-items-center text-white">
          <ArrowLeft className="w-5 h-5"/>
        </button>
        {isFull && !booked && (
          <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-black text-white text-xs font-bold">FULL</div>
        )}
      </div>

      <div className="px-5 py-4">
        <h1 className="text-2xl font-black">{slot.name}</h1>
        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5"/>{slot.approx_area}</span>
          {slot.rating > 0 && <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-primary text-primary"/>{slot.rating.toFixed(1)}</span>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Info icon={<Car className="w-4 h-4"/>} label="Vehicle" value={slot.vehicle_type}/>
          <Info icon={<Ruler className="w-4 h-4"/>} label="Size" value={slot.vehicle_size_limit || "Any"}/>
        </div>

        {booked ? (
          <div className="mt-6 rounded-2xl bg-primary/10 border-2 border-primary p-5 text-center">
            <div className="text-xs font-bold uppercase tracking-wider text-primary-foreground/70">Reservation confirmed</div>
            <div className="mt-3 inline-block bg-white p-3 rounded-xl">
              <QRCodeSVG value={reservationId!} size={160}/>
            </div>
            <div className="mt-4 text-left space-y-2">
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase">Full address</div>
                <div className="font-semibold">{slot.full_address}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase">Access</div>
                <div>{slot.access_instructions || "None"}</div>
              </div>
            </div>
            <Link to="/reservations" className="mt-4 inline-block w-full rounded-xl bg-black text-white py-3 font-semibold">View my bookings</Link>
          </div>
        ) : isFull ? (
          <button onClick={notifyMe}
            className="mt-6 w-full rounded-2xl bg-black text-white py-4 font-bold">
            Notify me when open
          </button>
        ) : (
          <div className="mt-6 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {(["hourly","daily","monthly"] as const).map(r => (
                <button key={r} onClick={() => setRateType(r)}
                  className={`rounded-xl border-2 p-3 text-center text-xs ${rateType === r ? "border-primary bg-primary/10" : "border-border"}`}>
                  <div className="font-bold capitalize">{r}</div>
                  <div className="text-muted-foreground">₹{(slot as any)[`${r}_rate`]}</div>
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Start</span>
              <input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2"/>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Duration ({rateType === "hourly" ? "hours" : rateType === "daily" ? "days" : "months"})</span>
              <input type="number" min={1} max={rateType === "monthly" ? 12 : rateType === "daily" ? 30 : 24}
                value={duration} onChange={e => setDuration(+e.target.value || 1)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2"/>
            </label>
            <div className="flex items-baseline justify-between rounded-xl bg-muted p-4">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-2xl font-black">₹{total}</span>
            </div>
            <button disabled={busy} onClick={reserve}
              className="w-full rounded-2xl bg-primary py-4 font-bold text-primary-foreground disabled:opacity-60">
              {busy ? "…" : "Reserve now"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground uppercase">{icon}{label}</div>
      <div className="mt-1 font-semibold capitalize">{value}</div>
    </div>
  );
}
