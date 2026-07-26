import { createFileRoute, Link } from "@tanstack/react-router";
import { useMySlots } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, DollarSign } from "lucide-react";

export const Route = createFileRoute("/_authenticated/my-slots")({
  component: MySlots,
});

function MySlots() {
  const { data: slots = [], isLoading, isError, error, refetch } = useMySlots();
  const qc = useQueryClient();

  async function toggle(id: string, current: "open" | "full") {
    const next = current === "open" ? "full" : "open";
    const { error } = await supabase.from("slots").update({ status: next }).eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["my-slots"] });
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (isError) return (
    <div className="p-6 text-center space-y-3">
      <p className="text-sm text-destructive">Couldn't load your slots. {error instanceof Error ? error.message : ""}</p>
      <button onClick={() => refetch()} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">Retry</button>
    </div>
  );

  return (
    <div>
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-4 flex items-center justify-between">
        <h1 className="text-2xl font-black">My Slots</h1>
        <div className="flex gap-2">
          <Link to="/earnings" className="rounded-full bg-white/10 text-white w-10 h-10 grid place-items-center">
            <DollarSign className="w-5 h-5"/>
          </Link>
          <Link to="/add-slot" className="rounded-full bg-primary text-primary-foreground w-10 h-10 grid place-items-center">
            <Plus className="w-5 h-5"/>
          </Link>
        </div>
      </div>
      <div className="px-4 py-4 space-y-3">
        {slots.map(s => (
          <div key={s.id} className="rounded-2xl bg-card border border-border overflow-hidden">
            {s.photos[0] && <img src={s.photos[0]} className="w-full h-32 object-cover" alt=""/>}
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{s.approx_area}</div>
                </div>
                <button onClick={() => toggle(s.id, s.status)}
                  className={`shrink-0 text-xs font-bold px-3 py-1 rounded-full ${s.status === "open" ? "bg-primary text-primary-foreground" : "bg-black text-white"}`}>
                  {s.status.toUpperCase()}
                </button>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">₹{s.hourly_rate}/hr · ₹{s.daily_rate}/day · ₹{s.monthly_rate}/mo</div>
            </div>
          </div>
        ))}
        {slots.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground mb-4">You haven't listed any slots yet.</p>
            <Link to="/add-slot" className="inline-block rounded-2xl bg-primary px-6 py-3 font-bold text-primary-foreground">Add your first slot</Link>
          </div>
        )}
      </div>
    </div>
  );
}
