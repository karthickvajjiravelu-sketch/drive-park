import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAdminUsers, type AdminProfile } from "@/lib/admin-queries";
import { AdminSection, AdminCard, AdminButton, Pill } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "User management · Usop admin" },
      {
        name: "description",
        content: "Review Usop accounts, verify hosts and suspend or reinstate users.",
      },
    ],
  }),
  component: AdminUsers,
});

function AdminUsers() {
  const { data: users = [], isLoading } = useAdminUsers();
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  async function patch(userId: string, values: Partial<AdminProfile>, msg: string) {
    const { error } = await supabase.from("profiles").update(values).eq("user_id", userId);
    if (error) return toast.error(error.message);
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["admin-overview"] });
  }

  const filtered = users.filter((u) =>
    `${u.name} ${u.phone} ${u.role}`.toLowerCase().includes(q.toLowerCase()),
  );

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <AdminSection title={`Users (${users.length})`}>
      <input
        aria-label="Search users"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, phone or role"
        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
      />
      {filtered.map((u) => (
        <AdminCard key={u.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{u.name || "Unnamed"}</span>
                <Pill>{u.role}</Pill>
                {u.suspended && <Pill tone="danger">suspended</Pill>}
                {u.verified && <Pill tone="success">verified</Pill>}
                {u.verification_status === "pending" && <Pill tone="warn">verify pending</Pill>}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{u.phone || "no phone"}</div>
              {u.suspended_reason && (
                <div className="mt-1 text-xs text-destructive">{u.suspended_reason}</div>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {u.verification_status !== "approved" && (
              <AdminButton
                onClick={() =>
                  patch(
                    u.user_id,
                    { verified: true, verification_status: "approved" },
                    "Identity verified",
                  )
                }
              >
                Verify
              </AdminButton>
            )}
            {u.verification_status === "pending" && (
              <AdminButton
                variant="ghost"
                onClick={() => {
                  const note = prompt("Reason for rejection?") ?? "";
                  patch(
                    u.user_id,
                    { verified: false, verification_status: "rejected", verification_note: note },
                    "Verification rejected",
                  );
                }}
              >
                Reject
              </AdminButton>
            )}
            {u.suspended ? (
              <AdminButton
                variant="ghost"
                onClick={() =>
                  patch(
                    u.user_id,
                    { suspended: false, suspended_reason: null, suspended_at: null },
                    "Account reinstated",
                  )
                }
              >
                Reinstate
              </AdminButton>
            ) : (
              <AdminButton
                variant="danger"
                onClick={() => {
                  const reason = prompt("Reason for suspension?");
                  if (!reason) return;
                  patch(
                    u.user_id,
                    {
                      suspended: true,
                      suspended_reason: reason,
                      suspended_at: new Date().toISOString(),
                    },
                    "Account suspended",
                  );
                }}
              >
                Suspend
              </AdminButton>
            )}
          </div>
        </AdminCard>
      ))}
      {filtered.length === 0 && <p className="text-sm text-muted-foreground">No users found.</p>}
    </AdminSection>
  );
}
