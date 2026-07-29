import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AdminSection, AdminCard, AdminButton } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/announcements")({
  head: () => ({
    meta: [
      { title: "Announcements · Usop admin" },
      {
        name: "description",
        content: "Send an in-app announcement to every Usop user or to drivers or hosts only.",
      },
    ],
  }),
  component: AdminAnnouncements,
});

function AdminAnnouncements() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [target, setTarget] = useState<"all" | "driver" | "landowner">("all");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!title.trim()) return toast.error("Title is required");
    if (!confirm(`Send this announcement to ${target === "all" ? "all users" : `${target}s`}?`))
      return;
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_broadcast_notification", {
      _title: title.trim(),
      _body: body.trim() || null,
      _link: link.trim() || null,
      _target: target,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Sent to ${data ?? 0} user(s)`);
    setTitle("");
    setBody("");
    setLink("");
  }

  const field = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm";

  return (
    <AdminSection title="System announcement">
      <AdminCard>
        <div className="grid gap-2">
          <select
            className={field}
            value={target}
            onChange={(e) => setTarget(e.target.value as typeof target)}
          >
            <option value="all">Everyone</option>
            <option value="driver">Drivers only</option>
            <option value="landowner">Hosts only</option>
          </select>
          <input
            className={field}
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className={`${field} min-h-24`}
            placeholder="Message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <input
            className={field}
            placeholder="Link (optional, e.g. /map)"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <AdminButton onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send announcement"}
          </AdminButton>
          <p className="text-xs text-muted-foreground">
            Delivered to the in-app notifications feed. Email and push delivery are not wired up
            yet.
          </p>
        </div>
      </AdminCard>
    </AdminSection>
  );
}
