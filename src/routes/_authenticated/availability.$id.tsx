import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSlot, useSlotAvailability, type SlotAvailability } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { WEEKDAYS } from "@/lib/availability";

export const Route = createFileRoute("/_authenticated/availability/$id")({
  component: AvailabilityEditor,
  head: () => ({
    meta: [
      { title: "Opening hours · Usop host tools" },
      {
        name: "description",
        content: "Set the weekly opening hours drivers can book your parking space.",
      },
      { property: "og:title", content: "Opening hours · Usop host tools" },
      {
        property: "og:description",
        content: "Set the weekly opening hours drivers can book your parking space.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Row = { weekday: number; open_time: string; close_time: string; closed: boolean };

const DEFAULT_ROW = (weekday: number): Row => ({
  weekday,
  open_time: "00:00",
  close_time: "23:59",
  closed: false,
});

function toRows(saved: SlotAvailability[]): Row[] {
  return WEEKDAYS.map((_, i) => {
    const r = saved.find((s) => s.weekday === i);
    return r
      ? {
          weekday: i,
          open_time: r.open_time.slice(0, 5),
          close_time: r.close_time.slice(0, 5),
          closed: r.closed,
        }
      : DEFAULT_ROW(i);
  });
}

function AvailabilityEditor() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: slot } = useSlot(id);
  const { data: saved = [], isLoading } = useSlotAvailability(id);
  const [rows, setRows] = useState<Row[]>(() => toRows([]));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLoading) setRows(toRows(saved));
  }, [isLoading, saved]);

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function applyToAll() {
    const first = rows[0];
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        open_time: first.open_time,
        close_time: first.close_time,
        closed: first.closed,
      })),
    );
  }

  async function save() {
    const invalid = rows.find((r) => !r.closed && r.open_time >= r.close_time);
    if (invalid) {
      toast.error(`${WEEKDAYS[invalid.weekday]}: closing time must be after opening time.`);
      return;
    }
    setBusy(true);
    const { error: delError } = await supabase.from("slot_availability").delete().eq("slot_id", id);
    if (delError) {
      setBusy(false);
      toast.error(delError.message);
      return;
    }
    const { error } = await supabase
      .from("slot_availability")
      .insert(rows.map((r) => ({ ...r, slot_id: id })));
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Opening hours saved");
    qc.invalidateQueries({ queryKey: ["slot-availability", id] });
    navigate({ to: "/my-slots" });
  }

  async function clearAll() {
    setBusy(true);
    const { error } = await supabase.from("slot_availability").delete().eq("slot_id", id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows(toRows([]));
    qc.invalidateQueries({ queryKey: ["slot-availability", id] });
    toast.success("Set to always open (24/7)");
  }

  return (
    <div className="pb-28">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-5">
        <Link to="/my-slots" className="inline-flex items-center gap-1 text-sm opacity-80">
          <ArrowLeft className="w-4 h-4" /> My Slots
        </Link>
        <h1 className="mt-2 text-2xl font-black">Opening hours</h1>
        <p className="text-sm opacity-80">{slot?.name ?? "Your space"}</p>
      </div>

      <div className="px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Drivers can only book inside these hours. No schedule = open 24/7.
          </p>
          <button
            onClick={applyToAll}
            className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-semibold"
          >
            Copy Sunday to all
          </button>
        </div>

        {rows.map((r, i) => (
          <div key={r.weekday} className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{WEEKDAYS[r.weekday]}</span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={r.closed}
                  onChange={(e) => update(i, { closed: e.target.checked })}
                />
                Closed
              </label>
            </div>
            {!r.closed && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="time"
                  value={r.open_time}
                  onChange={(e) => update(i, { open_time: e.target.value })}
                  className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <input
                  type="time"
                  value={r.close_time}
                  onChange={(e) => update(i, { close_time: e.target.value })}
                  className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>
        ))}

        <button
          disabled={busy}
          onClick={save}
          className="w-full rounded-2xl bg-primary py-4 font-bold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save hours"}
        </button>
        <button
          disabled={busy}
          onClick={clearAll}
          className="w-full rounded-2xl border border-border py-3 text-sm font-semibold disabled:opacity-60"
        >
          Reset to always open (24/7)
        </button>
      </div>
    </div>
  );
}
