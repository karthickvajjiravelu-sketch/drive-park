import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAdminDisputes, useAdminUsers } from "@/lib/admin-queries";
import { AdminSection, AdminCard, AdminButton, Pill } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/disputes")({
  head: () => ({
    meta: [
      { title: "Disputes & support · Usop admin" },
      {
        name: "description",
        content: "Work through Usop support requests and disputes between drivers and hosts.",
      },
    ],
  }),
  component: AdminDisputes,
});

function AdminDisputes() {
  const { data: rows = [], isLoading } = useAdminDisputes();
  const { data: users = [] } = useAdminUsers();
  const qc = useQueryClient();
  const [openOnly, setOpenOnly] = useState(true);

  const nameOf = (userId: string) =>
    users.find((u) => u.user_id === userId)?.name || "Unknown user";

  async function resolve(id: string, status: "open" | "resolved" | "rejected") {
    const note = status === "open" ? null : (prompt("Resolution note (optional)") ?? null);
    const { error } = await supabase
      .from("support_requests")
      .update({
        status,
        admin_note: note,
        resolved_at: status === "open" ? null : new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${status}`);
    qc.invalidateQueries({ queryKey: ["admin-disputes"] });
    qc.invalidateQueries({ queryKey: ["admin-overview"] });
  }

  const visible = openOnly ? rows.filter((r) => r.status === "open") : rows;

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <AdminSection title={`Disputes (${visible.length})`}>
      <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <input
          type="checkbox"
          checked={openOnly}
          onChange={(e) => setOpenOnly(e.target.checked)}
        />
        Show open only
      </label>
      {visible.map((r) => (
        <AdminCard key={r.id}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold">{r.subject}</span>
            <Pill tone={r.status === "open" ? "warn" : r.status === "resolved" ? "success" : "danger"}>
              {r.status}
            </Pill>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {nameOf(r.user_id)} · {r.category} · {new Date(r.created_at).toLocaleDateString()}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{r.message}</p>
          {r.admin_note && (
            <p className="mt-2 text-xs text-muted-foreground">Resolution: {r.admin_note}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {r.status !== "resolved" && (
              <AdminButton onClick={() => resolve(r.id, "resolved")}>Resolve</AdminButton>
            )}
            {r.status !== "rejected" && (
              <AdminButton variant="danger" onClick={() => resolve(r.id, "rejected")}>
                Reject
              </AdminButton>
            )}
            {r.status !== "open" && (
              <AdminButton variant="ghost" onClick={() => resolve(r.id, "open")}>
                Reopen
              </AdminButton>
            )}
          </div>
        </AdminCard>
      ))}
      {visible.length === 0 && <p className="text-sm text-muted-foreground">Nothing to resolve.</p>}
    </AdminSection>
  );
}
