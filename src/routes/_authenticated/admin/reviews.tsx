import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAdminReviews } from "@/lib/admin-queries";
import { AdminSection, AdminCard, AdminButton, Pill } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/reviews")({
  head: () => ({
    meta: [
      { title: "Review moderation · Usop admin" },
      {
        name: "description",
        content: "Review reported feedback on Usop listings and hide or delete inappropriate content.",
      },
    ],
  }),
  component: AdminReviews,
});

function AdminReviews() {
  const { data: rows = [], isLoading } = useAdminReviews();
  const qc = useQueryClient();
  const [reportedOnly, setReportedOnly] = useState(true);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["admin-reviews"] });
    qc.invalidateQueries({ queryKey: ["admin-overview"] });
    qc.invalidateQueries({ queryKey: ["reviews"] });
  }

  async function setHidden(id: string, hidden: boolean) {
    const note = hidden ? (prompt("Moderation note (optional)") ?? null) : null;
    const { error } = await supabase
      .from("reviews")
      .update({ hidden, moderation_note: note, reported: hidden ? false : undefined })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(hidden ? "Review hidden" : "Review restored");
    refresh();
  }

  async function remove(id: string) {
    if (!confirm("Permanently delete this review?")) return;
    const { error } = await supabase.from("reviews").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Review deleted");
    refresh();
  }

  async function dismiss(id: string) {
    const { error } = await supabase.from("reviews").update({ reported: false }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Report dismissed");
    refresh();
  }

  const visible = reportedOnly ? rows.filter((r) => r.reported || r.hidden) : rows;

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <AdminSection title={`Reviews (${visible.length})`}>
      <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <input
          type="checkbox"
          checked={reportedOnly}
          onChange={(e) => setReportedOnly(e.target.checked)}
        />
        Show flagged / hidden only
      </label>
      {visible.map((r) => (
        <AdminCard key={r.id}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold">{"★".repeat(r.rating)}</span>
            <div className="flex gap-1">
              {r.reported && <Pill tone="danger">reported ×{r.report_count}</Pill>}
              {r.hidden && <Pill tone="warn">hidden</Pill>}
            </div>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{r.comment || "(no comment)"}</p>
          {r.moderation_note && (
            <p className="mt-1 text-xs text-muted-foreground">Note: {r.moderation_note}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {r.hidden ? (
              <AdminButton variant="ghost" onClick={() => setHidden(r.id, false)}>
                Unhide
              </AdminButton>
            ) : (
              <AdminButton onClick={() => setHidden(r.id, true)}>Hide</AdminButton>
            )}
            {r.reported && (
              <AdminButton variant="ghost" onClick={() => dismiss(r.id)}>
                Dismiss report
              </AdminButton>
            )}
            <AdminButton variant="danger" onClick={() => remove(r.id)}>
              Delete
            </AdminButton>
          </div>
        </AdminCard>
      ))}
      {visible.length === 0 && <p className="text-sm text-muted-foreground">Nothing flagged.</p>}
    </AdminSection>
  );
}
