import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { ValidatedField } from "@/components/ValidatedField";
import {
  nameSchema,
  phoneSchema,
  emailSchema,
  otpSchema,
  formatName,
  formatDigits,
  validate,
  checkOtpThrottle,
  type OtpAttempt,
} from "@/lib/validation";

const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

const OTP_STORE_KEY = "usop.otp.attempts";

function readOtpAttempts(): OtpAttempt[] {
  try {
    const raw = localStorage.getItem(OTP_STORE_KEY);
    return raw ? (JSON.parse(raw) as OtpAttempt[]) : [];
  } catch {
    return [];
  }
}

function recordOtpAttempt(identifier: string) {
  try {
    const next = [...readOtpAttempts(), { phone: identifier, at: Date.now() }].slice(-20);
    localStorage.setItem(OTP_STORE_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage failures */
  }
}


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
  const [method, setMethod] = useState<"password" | "otp">("password");
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"driver" | "landowner">("driver");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");

  const nextPath = sanitizeNext(search.next);
  const otpMode = mode === "signin" && method === "otp";

  const formValid = otpMode
    ? validate(emailSchema, email) === null &&
      (!otpSent || validate(otpSchema, otp) === null)
    : validate(emailSchema, email) === null &&
      validate(passwordSchema, password) === null &&
      (mode === "signin" ||
        (validate(nameSchema, name) === null && validate(phoneSchema, phone) === null));

  function goNext() {
    if (nextPath) window.location.href = nextPath;
    else navigate({ to: "/home" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (otpMode) {
        if (!otpSent) {
          const throttle = checkOtpThrottle(readOtpAttempts(), email, Date.now());
          if (!throttle.allowed) {
            toast.error(
              throttle.reason === "cooldown"
                ? `Please wait ${Math.ceil(throttle.retryInMs / 1000)}s before requesting another code`
                : "Too many code requests. Try again later.",
            );
            return;
          }

          const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false },
          });
          if (error) throw error;
          recordOtpAttempt(email);
          setOtpSent(true);
          toast.success("We emailed you a 6-digit code");
        } else {
          const { error } = await supabase.auth.verifyOtp({
            email,
            token: otp,
            type: "email",
          });
          if (error) throw error;
          goNext();
        }
      } else if (mode === "signup") {
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
        goNext();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        goNext();
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
        {mode === "signin" && (
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
            {(["password", "otp"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMethod(m);
                  setOtpSent(false);
                  setOtp("");
                }}
                className={`rounded-xl py-2 text-sm font-semibold transition ${
                  method === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                {m === "password" ? "Email & password" : "Email code"}
              </button>
            ))}
          </div>
        )}

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
            <ValidatedField
              label="Name"
              value={name}
              onChange={setName}
              schema={nameSchema}
              format={formatName}
              required
            />
            <ValidatedField
              label="Phone"
              value={phone}
              onChange={(v) => setPhone(formatDigits(v, 10))}
              schema={phoneSchema}
              type="tel"
              inputMode="numeric"
              formatOnBlur={(v) => formatDigits(v, 10)}
              required
            />
          </>
        )}
        <ValidatedField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          schema={emailSchema}
          required
        />
        {!otpMode && (
          <ValidatedField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            schema={passwordSchema}
            required
          />
        )}
        {otpMode && otpSent && (
          <ValidatedField
            label="6-digit code"
            value={otp}
            onChange={(v) => setOtp(formatDigits(v, 6))}
            schema={otpSchema}
            inputMode="numeric"
            required
          />
        )}

        <button
          disabled={loading || !formValid}
          className="w-full rounded-2xl bg-primary py-4 font-bold text-primary-foreground disabled:opacity-60"
        >
          {loading
            ? "…"
            : mode === "signup"
              ? "Create account"
              : otpMode
                ? otpSent
                  ? "Verify code"
                  : "Send code"
                : "Sign in"}
        </button>

        {otpMode && otpSent && (
          <button
            type="button"
            onClick={() => {
              setOtpSent(false);
              setOtp("");
            }}
            className="w-full text-sm text-muted-foreground py-1"
          >
            Use a different email
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setOtpSent(false);
            setOtp("");
          }}
          className="w-full text-sm text-muted-foreground py-2"
        >
          {mode === "signup" ? "Have an account? Sign in" : "New here? Create account"}
        </button>

      </form>
    </div>
  );
}
