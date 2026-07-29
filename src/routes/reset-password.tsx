import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ValidatedField } from "@/components/ValidatedField";

const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  component: ResetPassword,
  head: () => ({
    meta: [
      { title: "Reset your password · Usop Parking" },
      {
        name: "description",
        content: "Choose a new password for your Usop parking account.",
      },
      { property: "og:title", content: "Reset your password · Usop Parking" },
      {
        property: "og:description",
        content: "Choose a new password for your Usop parking account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated");
      navigate({ to: "/home" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mobile-shell">
      <div className="bg-[var(--surface-dark)] text-white px-6 pt-12 pb-8 rounded-b-3xl">
        <h1 className="text-3xl font-black">Set a new password</h1>
      </div>
      <form onSubmit={submit} className="px-6 py-6 space-y-4">
        {!ready && (
          <p className="text-sm text-muted-foreground">
            Open this page from the reset link we emailed you.
          </p>
        )}
        <ValidatedField
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          schema={passwordSchema}
          required
        />
        <button
          disabled={loading || !ready || password.length < 6}
          className="w-full rounded-2xl bg-primary py-4 font-bold text-primary-foreground disabled:opacity-60"
        >
          {loading ? "…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
