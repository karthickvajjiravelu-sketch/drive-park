import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useMyReservations } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone, Navigation2, MapPin } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reservations")({
  component: MyReservations,
});

function useCountdown(end: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(end).getTime() - now);
  const h = Math.floor(ms / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  const s = Math.floor((ms % 60e3) / 1000);
  return `${h}h ${m}m ${s}s`;
}

function MyReservations() {
  const { data: reservations = [], isLoading } = useMyReservations();
  const qc = useQueryClient();
  const [reviewing, setReviewing] = useState<string | null>(null);

  const active = reservations.filter(r => r.status === "active");
  const upcoming = reservations.filter(r => r.status === "upcoming");
  const past = reservations.filter(r => r.status === "completed" || r.status === "cancelled");

  async function endSession(id: string) {
    const { error } = await supabase.from("reservations").update({ status: "completed" }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Session ended"); qc.invalidateQueries({ queryKey: ["my-reservations"] }); }
  }

  async function extend(id: string, currentEnd: string) {
    const newEnd = new Date(new Date(currentEnd).getTime() + 3600e3).toISOString();
    const { error } = await supabase.from("reservations").update({ end_time: newEnd }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Extended by 1 hour"); qc.invalidateQueries({ queryKey: ["my-reservations"] }); }
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div>
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-4">
        <h1 className="text-2xl font-black">My Bookings</h1>
      </div>
      <div className="px-4 py-4 space-y-6">
        {active.length > 0 && (
          <Section title="Active">
            {active.map(r => <ActiveCard key={r.id} r={r} onEnd={endSession} onExtend={extend}/>)}
          </Section>
        )}
        {upcoming.length > 0 && (
          <Section title="Upcoming">
            {upcoming.map(r => <UpcomingCard key={r.id} r={r}/>)}
          </Section>
        )}
        {past.length > 0 && (
          <Section title="Past">
            {past.map(r => (
              <div key={r.id} className="rounded-2xl bg-card border border-border p-4">
                <div className="font-semibold">{r.slot?.name ?? "Slot"}</div>
                <div className="text-xs text-muted-foreground">{new Date(r.start_time).toLocaleString()} · ₹{r.total_price}</div>
                {r.status === "completed" && (
                  <button onClick={() => setReviewing(r.slot_id)}
                    className="mt-2 text-xs font-semibold text-primary-foreground bg-primary px-3 py-1.5 rounded-lg">
                    Leave review
                  </button>
                )}
              </div>
            ))}
          </Section>
        )}
        {reservations.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No bookings yet.</p>}
      </div>
      {reviewing && <ReviewModal slotId={reviewing} onClose={() => setReviewing(null)}/>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ActiveCard({ r, onEnd, onExtend }: { r: any; onEnd: (id: string) => void; onExtend: (id: string, end: string) => void }) {
  const remaining = useCountdown(r.end_time);
  const slot = r.slot;
  if (!slot) return null;
  return (
    <div className="rounded-2xl bg-primary/10 border-2 border-primary p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="font-bold">{slot.name}</div>
          <div className="text-xs flex items-center gap-1 text-muted-foreground"><MapPin className="w-3 h-3"/>{slot.full_address}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase text-muted-foreground">Ends in</div>
          <div className="font-mono font-bold text-sm">{remaining}</div>
        </div>
      </div>
      {slot.access_instructions && <div className="mt-2 text-xs bg-white/50 rounded-lg p-2">{slot.access_instructions}</div>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={`tel:0000000000`} className="rounded-xl bg-black text-white py-2 text-xs font-semibold flex items-center justify-center gap-1"><Phone className="w-3.5 h-3.5"/>Call</a>
        <a href={`https://www.google.com/maps/dir/?api=1&destination=${slot.lat},${slot.lng}`} target="_blank" rel="noreferrer"
          className="rounded-xl bg-black text-white py-2 text-xs font-semibold flex items-center justify-center gap-1"><Navigation2 className="w-3.5 h-3.5"/>Directions</a>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={() => onExtend(r.id, r.end_time)} className="rounded-xl border border-black py-2 text-xs font-semibold">Extend +1h</button>
        <button onClick={() => onEnd(r.id)} className="rounded-xl bg-destructive text-destructive-foreground py-2 text-xs font-semibold">End session</button>
      </div>
    </div>
  );
}

function UpcomingCard({ r }: { r: any }) {
  const slot = r.slot;
  return (
    <div className="rounded-2xl bg-card border border-border p-4">
      <div className="font-bold">{slot?.name}</div>
      <div className="text-xs text-muted-foreground">{new Date(r.start_time).toLocaleString()}</div>
      <div className="mt-1 text-sm font-semibold">₹{r.total_price} · {r.rate_type}</div>
    </div>
  );
}

function ReviewModal({ slotId, onClose }: { slotId: string; onClose: () => void }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const qc = useQueryClient();

  async function submit() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("reviews").insert({ slot_id: slotId, driver_id: user.id, rating, comment });
    if (error) toast.error(error.message);
    else { toast.success("Review posted"); qc.invalidateQueries(); onClose(); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-lg">Rate this spot</h3>
        <div className="flex gap-1 my-3">
          {[1,2,3,4,5].map(n => (
            <button key={n} onClick={() => setRating(n)} className={`text-3xl ${n <= rating ? "text-primary" : "text-muted"}`}>★</button>
          ))}
        </div>
        <textarea value={comment} onChange={e => setComment(e.target.value)}
          placeholder="Optional comment" className="w-full border border-input rounded-xl p-3 text-sm"/>
        <div className="flex gap-2 mt-3">
          <button onClick={onClose} className="flex-1 rounded-xl border border-border py-2 text-sm font-semibold">Cancel</button>
          <button onClick={submit} className="flex-1 rounded-xl bg-primary py-2 text-sm font-bold text-primary-foreground">Post</button>
        </div>
      </div>
    </div>
  );
}
