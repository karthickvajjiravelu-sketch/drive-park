import { createFileRoute, Link } from "@tanstack/react-router";
import { ThemeQuickToggle } from "@/components/ThemeToggle";
import { useMySlots, useOwnerBookings } from "@/lib/queries";
import { FULL_FLAG_WINDOW_HOURS } from "@/lib/quote";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, DollarSign, Pencil, Trash2, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/my-slots")({
  component: MySlots,
});

function MySlots() {
  const { data: slots = [], isLoading, isError, error, refetch } = useMySlots();
  const qc = useQueryClient();
  const { data: bookings = [] } = useOwnerBookings();
  const openCount = (slotId: string) =>
    bookings.filter((b) => b.slot_id === slotId && (b.status === "upcoming" || b.status === "active"))
      .length;

  async function toggle(id: string, current: "open" | "full") {
    const next = current === "open" ? "full" : "open";
    const { error } = await supabase.from("slots").update({ status: next }).eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["my-slots"] });
  }

  async function remove(id: string, name: string) {
    const n = openCount(id);
    if (n > 0) {
      toast.error(
        `You have ${n} upcoming ${n === 1 ? "booking" : "bookings"}. Contact support to cancel them first.`,
      );
      return;
    }
    if (
      !confirm(
        `Delete "${name}"? Existing bookings are kept, but drivers won't see this slot anymore.`,
      )
    )
      return;
    // Safe archive first (won't fail even if reservations reference it).
    const { error } = await supabase
      .from("slots")
      .update({ archived: true, status: "full" })
      .eq("id", id);
    if (error) {
      toast.error(
        error.message.includes("upcoming or active bookings")
          ? "You have upcoming bookings. Contact support to cancel them first."
          : "Couldn't remove this slot. Please try again.",
      );
      return;
    }
    toast.success("Slot removed");
    qc.invalidateQueries({ queryKey: ["my-slots"] });
    qc.invalidateQueries({ queryKey: ["slots"] });
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (isError)
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-sm text-destructive">
          Couldn't load your slots. {error instanceof Error ? error.message : ""}
        </p>
        <button
          onClick={() => refetch()}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
        >
          Retry
        </button>
      </div>
    );

  const active = slots.filter((s) => !s.archived);
  const archived = slots.filter((s) => s.archived);

  return (
    <div className="pb-24">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-4 flex items-center justify-between">
        <h1 className="text-2xl font-black">My Slots</h1>
        <div className="flex gap-2 items-center">
          <ThemeQuickToggle className="bg-white/10 text-white" />

          <Link
            aria-label="Earnings"
            to="/earnings"
            className="rounded-full bg-white/10 text-white w-10 h-10 grid place-items-center"
          >
            <DollarSign className="w-5 h-5" />
          </Link>
          <Link
            aria-label="Add a slot"
            to="/add-slot"
            className="rounded-full bg-primary text-primary-foreground w-10 h-10 grid place-items-center"
          >
            <Plus className="w-5 h-5" />
          </Link>
        </div>
      </div>
      <div className="px-4 py-4 space-y-3">
        {active.map((s) => (
          <div key={s.id} className="rounded-2xl bg-card border border-border overflow-hidden">
            {s.photos[0] && <img src={s.photos[0]} className="w-full h-32 object-cover" alt="" />}
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{s.approx_area}</div>
                </div>
                <ApprovalBadge status={s.approval_status} />
              </div>
              {s.approval_status === "rejected" && s.approval_note && (
                <p className="mt-1 text-xs text-destructive">Reason: {s.approval_note}</p>
              )}
              {(s.approval_status !== "approved" || !s.is_available) && (
                <p className="mt-2 rounded-lg bg-muted px-2 py-1 text-xs font-semibold">
                  Not visible to drivers
                  {s.approval_status === "pending" && " until Usop approves it"}
                  {s.approval_status === "approved" && !s.is_available && " (unavailable)"}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  onClick={() => toggle(s.id, s.status)}
                  aria-pressed={s.status === "open"}
                  className={`shrink-0 text-xs font-bold px-3 py-2 rounded-full ${s.status === "open" ? "bg-primary text-primary-foreground" : "bg-foreground text-background"}`}
                >
                  {s.status === "open" ? "Accepting bookings" : "Marked full"}
                </button>
                {openCount(s.id) > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {openCount(s.id)} upcoming/active
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Marking full blocks bookings that start within the next {FULL_FLAG_WINDOW_HOURS}{" "}
                hours. Later times stay bookable.
              </p>
              <div className="mt-2 text-xs text-muted-foreground">
                ₹{s.hourly_rate}/hr · ₹{s.daily_rate}/day · ₹{s.monthly_rate}/mo
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Link
                  to="/edit-slot/$id"
                  params={{ id: s.id }}
                  className="rounded-xl border border-border py-2 text-xs font-semibold flex items-center justify-center gap-1"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </Link>
                <Link
                  to="/availability/$id"
                  params={{ id: s.id }}
                  className="rounded-xl border border-border py-2 text-xs font-semibold flex items-center justify-center gap-1"
                >
                  <Clock className="w-3.5 h-3.5" />
                  Hours
                </Link>
                <button
                  onClick={() => remove(s.id, s.name)}
                  className="rounded-xl border border-destructive text-destructive py-2 text-xs font-semibold flex items-center justify-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {active.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground mb-4">You haven't listed any slots yet.</p>
            <Link
              to="/add-slot"
              className="inline-block rounded-2xl bg-primary px-6 py-3 font-bold text-primary-foreground"
            >
              Add your first slot
            </Link>
          </div>
        )}
        {archived.length > 0 && (
          <div className="pt-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Archived
            </h2>
            <div className="space-y-2">
              {archived.map((s) => (
                <div key={s.id} className="rounded-xl bg-muted p-3 text-sm opacity-70">
                  <div className="font-semibold truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.approx_area}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, [string, string]> = {
    pending: ["Pending review", "bg-accent text-accent-foreground"],
    approved: ["Approved", "bg-success text-success-foreground"],
    rejected: ["Rejected", "bg-destructive text-destructive-foreground"],
  };
  const [text, cls] = map[status ?? "pending"] ?? map.pending;
  return <span className={`shrink-0 text-xs font-bold px-3 py-1 rounded-full ${cls}`}>{text}</span>;
}
