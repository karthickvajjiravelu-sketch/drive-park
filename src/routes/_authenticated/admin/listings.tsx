import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAdminSlots, type ApprovalStatus } from "@/lib/admin-queries";
import { AdminSection, AdminCard, AdminButton, Pill, inr } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/listings")({
  head: () => ({
    meta: [
      { title: "Listing approvals · Usop admin" },
      {
        name: "description",
        content: "Approve, reject or re-review parking space listings before they go live on Usop.",
      },
    ],
  }),
  component: AdminListings,
});

const filters: Array<{ key: ApprovalStatus | "all"; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

function AdminListings() {
  const [filter, setFilter] = useState<ApprovalStatus | "all">("pending");
  const { data: slots = [], isLoading } = useAdminSlots(filter === "all" ? undefined : filter);
  const qc = useQueryClient();

  async function decide(id: string, status: ApprovalStatus, note?: string | null) {
    const { error } = await supabase
      .from("slots")
      .update({
        approval_status: status,
        approval_note: note ?? null,
        approved_at: status === "approved" ? new Date().toISOString() : null,
      })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Listing ${status}`);
    qc.invalidateQueries({ queryKey: ["admin-slots"] });
    qc.invalidateQueries({ queryKey: ["admin-overview"] });
    qc.invalidateQueries({ queryKey: ["slots"] });
  }

  return (
    <AdminSection title="Listing approvals">
      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${
              filter === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {slots.map((s) => (
        <AdminCard key={s.id}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold">{s.name}</span>
            <Pill
              tone={
                s.approval_status === "approved"
                  ? "success"
                  : s.approval_status === "rejected"
                    ? "danger"
                    : "warn"
              }
            >
              {s.approval_status}
            </Pill>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{s.approx_area}</div>
          <div className="text-xs text-muted-foreground">{s.full_address}</div>
          <div className="mt-1 text-xs">
            {inr(s.hourly_rate)}/hr · {inr(s.daily_rate)}/day · {s.vehicle_type}
          </div>
          {s.approval_note && (
            <div className="mt-1 text-xs text-destructive">Note: {s.approval_note}</div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {s.approval_status !== "approved" && (
              <AdminButton onClick={() => decide(s.id, "approved")}>Approve</AdminButton>
            )}
            {s.approval_status !== "rejected" && (
              <AdminButton
                variant="danger"
                onClick={() => {
                  const note = prompt("Reason for rejection?");
                  if (!note) return;
                  decide(s.id, "rejected", note);
                }}
              >
                Reject
              </AdminButton>
            )}
            {s.approval_status !== "pending" && (
              <AdminButton variant="ghost" onClick={() => decide(s.id, "pending")}>
                Move to pending
              </AdminButton>
            )}
          </div>
        </AdminCard>
      ))}
      {!isLoading && slots.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing here.</p>
      )}
    </AdminSection>
  );
}
