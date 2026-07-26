import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional(),
  next: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: searchSchema,
  component: AuthPage,
});

function sanitizeNext(next: string | undefined): string | null {
  if (!next) return null;
  // Only allow same-origin relative paths.
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signin");
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"driver" | "landowner">("driver");

  const nextPath = sanitizeNext(search.next);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const emailRedirectTo = nextPath
          ? `${window.location.origin}${nextPath}`
          : window.location.origin;
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo,
            data: { name, phone, role },
          },
        });
        if (error) throw error;
        toast.success("Account created");
        if (nextPath) window.location.href = nextPath;
        else navigate({ to: "/home" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (nextPath) window.location.href = nextPath;
        else navigate({ to: "/home" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mobile-shell">
      <div className="bg-[var(--surface-dark)] text-white px-6 pt-12 pb-8 rounded-b-3xl">
        <Link to="/" className="text-white/60 text-sm">
          ← Back
        </Link>
        <h1 className="mt-4 text-3xl font-black">
          {mode === "signup" ? "Create your Usop account" : "Welcome back"}
        </h1>
      </div>

      <form onSubmit={submit} className="px-6 py-6 space-y-4">
        {mode === "signup" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRole("driver")}
                className={`rounded-2xl border-2 p-4 text-left transition ${role === "driver" ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-bold">Driver</div>
                <div className="text-xs text-muted-foreground">Find parking</div>
              </button>
              <button
                type="button"
                onClick={() => setRole("landowner")}
                className={`rounded-2xl border-2 p-4 text-left transition ${role === "landowner" ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="font-bold">Landowner</div>
                <div className="text-xs text-muted-foreground">Rent your space</div>
              </button>
            </div>
            <Field label="Name" value={name} onChange={setName} required />
            <Field
              label="Phone"
              value={phone}
              onChange={setPhone}
              type="tel"
              required
              pattern="[0-9]{10}"
              title="Enter a 10-digit phone number"
            />
          </>
        )}
        <Field label="Email" type="email" value={email} onChange={setEmail} required />
        <Field label="Password" type="password" value={password} onChange={setPassword} required />

        <button
          disabled={loading}
          className="w-full rounded-2xl bg-primary py-4 font-bold text-primary-foreground disabled:opacity-60"
        >
          {loading ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          className="w-full text-sm text-muted-foreground py-2"
        >
          {mode === "signup" ? "Have an account? Sign in" : "New here? Create account"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  pattern,
  title,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  pattern?: string;
  title?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <input
        className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        pattern={pattern}
        title={title}
      />
    </label>
  );
}
