import type { ReactNode } from "react";

export function AdminSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-4 py-4 space-y-3">
      <h2 className="text-sm font-black uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function AdminCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm">
      {children}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-black text-foreground">{value}</div>
    </div>
  );
}

export function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "success" | "warn" | "danger";
}) {
  const tones: Record<string, string> = {
    muted: "bg-muted text-muted-foreground",
    success: "bg-[var(--success)]/15 text-[var(--success)]",
    warn: "bg-accent/20 text-accent-foreground",
    danger: "bg-destructive/15 text-destructive",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function AdminButton({
  children,
  onClick,
  variant = "primary",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
}) {
  const styles: Record<string, string> = {
    primary: "bg-primary text-primary-foreground",
    ghost: "border border-border bg-background text-foreground",
    danger: "bg-destructive text-destructive-foreground",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-60 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export const inr = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
