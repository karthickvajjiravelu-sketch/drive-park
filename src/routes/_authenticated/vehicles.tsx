import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMyVehicles } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Star } from "lucide-react";
import { ValidatedField } from "@/components/ValidatedField";
import { vehicleNumberSchema, vehicleModelSchema, formatPlate, validate } from "@/lib/validation";

export const Route = createFileRoute("/_authenticated/vehicles")({
  component: VehiclesPage,
});

function VehiclesPage() {
  const { data: vehicles = [], isLoading } = useMyVehicles();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [colour, setColour] = useState("");
  const [busy, setBusy] = useState(false);

  const plateValid = validate(vehicleNumberSchema, plate) === null;
  const modelValid = !make || validate(vehicleModelSchema, make) === null;

  async function addVehicle() {
    if (!plateValid) {
      toast.error("Enter a valid vehicle number (e.g., TN01AB1234)");
      return;
    }

    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    const isFirst = vehicles.length === 0;
    const { error } = await supabase.from("vehicles").insert({
      user_id: user.id,
      plate: plate.trim().toUpperCase(),
      make: make.trim() || null,
      colour: colour.trim() || null,
      is_default: isFirst,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vehicle added");
    setPlate("");
    setMake("");
    setColour("");
    setAdding(false);
    qc.invalidateQueries({ queryKey: ["my-vehicles"] });
  }

  async function setDefault(id: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("vehicles").update({ is_default: false }).eq("user_id", user.id);
    await supabase.from("vehicles").update({ is_default: true }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["my-vehicles"] });
  }

  async function remove(id: string) {
    if (!confirm("Remove this vehicle?")) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["my-vehicles"] });
  }

  return (
    <div className="pb-20">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            aria-label="Back to profile"
            to="/profile"
            className="w-9 h-9 rounded-full bg-white/10 grid place-items-center"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-2xl font-black">My Garage</h1>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="rounded-full bg-primary text-primary-foreground w-10 h-10 grid place-items-center"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>
      <div className="px-4 py-4 space-y-3">
        {adding && (
          <div className="rounded-2xl bg-card border border-border p-4 space-y-2">
            <ValidatedField
              label="Vehicle number"
              value={plate}
              onChange={setPlate}
              schema={vehicleNumberSchema}
              format={formatPlate}
              placeholder="TN01AB1234"
              inputMode="text"
            />
            <div className="grid grid-cols-2 gap-2">
              <ValidatedField
                label="Make / model"
                value={make}
                onChange={setMake}
                schema={make ? vehicleModelSchema : undefined}
                placeholder="Swift VXI"
              />
              <ValidatedField label="Colour" value={colour} onChange={setColour} />
            </div>
            <button
              disabled={busy || !plateValid || !modelValid}
              onClick={addVehicle}
              className="w-full rounded-xl bg-primary py-2.5 font-bold text-primary-foreground disabled:opacity-60"
            >
              {busy ? "…" : "Save vehicle"}
            </button>
          </div>
        )}

        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {vehicles.map((v) => (
          <div
            key={v.id}
            className="rounded-2xl bg-card border border-border p-4 flex items-center gap-3"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/20 grid place-items-center font-black text-primary-foreground text-xs">
              {(v.colour ?? "•").slice(0, 3).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold tracking-wider">{v.plate}</div>
              <div className="text-xs text-muted-foreground truncate">
                {[v.make, v.colour].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <button
              onClick={() => setDefault(v.id)}
              title="Set default"
              className={`w-9 h-9 grid place-items-center rounded-full ${v.is_default ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              <Star className={`w-4 h-4 ${v.is_default ? "fill-current" : ""}`} />
            </button>
            <button
              onClick={() => remove(v.id)}
              className="w-9 h-9 grid place-items-center rounded-full bg-muted text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {!isLoading && vehicles.length === 0 && !adding && (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground mb-4">No vehicles saved yet.</p>
            <button
              onClick={() => setAdding(true)}
              className="inline-block rounded-2xl bg-primary px-6 py-3 font-bold text-primary-foreground"
            >
              Add a vehicle
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
