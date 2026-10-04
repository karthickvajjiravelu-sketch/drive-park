import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNotifications } from "@/lib/queries";
import { ArrowLeft, Bell, Check, CheckCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
});

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function NotificationsPage() {
  const { data: items = [] } = useNotifications();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const channel = supabase
        .channel("notifications-feed")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
          () => qc.invalidateQueries({ queryKey: ["notifications"] }),
        )
        .subscribe();
      if (cancelled) supabase.removeChannel(channel);
      return () => supabase.removeChannel(channel);
    })();
    return () => {
      cancelled = true;
    };
  }, [qc]);

  async function markAllRead() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function open(n: { id: string; link: string | null }) {
    await supabase.from("notifications").update({ read: true }).eq("id", n.id);
    qc.invalidateQueries({ queryKey: ["notifications"] });
    if (n.link) navigate({ to: n.link });
  }

  const unread = items.filter((i) => !i.read).length;

  return (
    <div className="pb-24">
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            aria-label="Back"
            onClick={() => history.back()}
            className="w-9 h-9 rounded-full bg-white/10 grid place-items-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-black">Notifications</h1>
            <div className="text-xs text-white/60">{unread} unread</div>
          </div>
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1 text-xs font-bold bg-primary text-primary-foreground px-3 py-2 rounded-full"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all
          </button>
        )}
      </div>

      <div className="px-4 py-4 space-y-2">
        {items.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            <Bell className="w-8 h-8 mx-auto mb-2 opacity-40" />
            No notifications yet
          </div>
        )}
        {items.map((n) => (
          <button
            key={n.id}
            onClick={() => open(n)}
            className={`w-full text-left rounded-2xl border p-4 flex gap-3 transition ${n.read ? "bg-card border-border" : "bg-primary/5 border-primary/30"}`}
          >
            <div
              className={`w-9 h-9 rounded-full grid place-items-center shrink-0 ${n.read ? "bg-muted" : "bg-primary text-primary-foreground"}`}
            >
              {n.read ? <Check className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-sm truncate">{n.title}</div>
                <div className="text-[10px] text-muted-foreground shrink-0">
                  {timeAgo(n.created_at)}
                </div>
              </div>
              {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
