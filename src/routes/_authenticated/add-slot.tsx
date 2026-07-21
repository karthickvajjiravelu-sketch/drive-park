import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/add-slot")({
  component: AddSlot,
});

function AddSlot() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", approx_area: "", full_address: "",
    lat: "13.05", lng: "80.24",
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
        lat: parseFloat(form.lat),
        lng: parseFloat(form.lng),
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
        <Field label="Approx area (public)" value={form.approx_area} onChange={set("approx_area")} required placeholder="e.g. Near T Nagar signal"/>
        <Field label="Full address (revealed after booking)" value={form.full_address} onChange={set("full_address")} required/>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude" value={form.lat} onChange={set("lat")} type="number" step="0.0001"/>
          <Field label="Longitude" value={form.lng} onChange={set("lng")} type="number" step="0.0001"/>
        </div>
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

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground uppercase">{label}</span>
      <input {...props} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5"/>
    </label>
  );
}
