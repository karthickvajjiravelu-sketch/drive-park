import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMyFavorites } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Heart, MapPin, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/saved")({
  component: SavedPage,
});

function SavedPage() {
  const { data = [], isLoading } = useMyFavorites();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function unfav(id: string) {
    const { error } = await supabase.from("favorites").delete().eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["my-favorites"] });
  }

  return (
    <div className="pb-24">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-5 flex items-center gap-3">
        <button
          onClick={() => navigate({ to: "/profile" })}
          className="w-10 h-10 rounded-full bg-white/10 grid place-items-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-black">Saved spots</h1>
      </div>
      <div className="px-4 py-4 space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && data.length === 0 && (
          <div className="text-center py-12">
            <Heart className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Tap the heart on any spot to save it here.
            </p>
            <Link
              to="/map"
              className="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
            >
              Browse spots
            </Link>
          </div>
        )}
        {data.map(
          (f) =>
            f.slot && (
              <div key={f.id} className="rounded-2xl bg-card border border-border overflow-hidden">
                <Link to="/slot/$id" params={{ id: f.slot.id }} className="block">
                  {f.slot.photos[0] ? (
                    <img src={f.slot.photos[0]} className="w-full h-36 object-cover" alt="" />
                  ) : (
                    <div className="w-full h-36 bg-muted" />
                  )}
                  <div className="p-3">
                    <div className="font-bold truncate">{f.slot.name}</div>
                    <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {f.slot.approx_area}
                    </div>
                    <div className="mt-1 text-sm font-semibold">₹{f.slot.hourly_rate}/hr</div>
                  </div>
                </Link>
                <button
                  onClick={() => unfav(f.id)}
                  className="w-full border-t border-border py-2 text-xs font-semibold text-destructive flex items-center justify-center gap-1"
                >
                  <Heart className="w-3.5 h-3.5 fill-current" />
                  Remove from saved
                </button>
              </div>
            ),
        )}
      </div>
    </div>
  );
}
