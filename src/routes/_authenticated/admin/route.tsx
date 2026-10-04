import { RouteError, RouteNotFound } from "@/components/RouteError";
import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!data) throw redirect({ to: "/home" });
  },
  component: AdminLayout,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
});

const tabs = [
  { to: "/admin", label: "Overview" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/listings", label: "Listings" },
  { to: "/admin/transactions", label: "Transactions" },
  { to: "/admin/revenue", label: "Revenue" },
  { to: "/admin/disputes", label: "Disputes" },
  { to: "/admin/reviews", label: "Reviews" },
  { to: "/admin/promos", label: "Promos" },
  { to: "/admin/announcements", label: "Announce" },
] as const;

function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="pb-24">
      <div className="bg-[var(--surface-dark)] px-5 pt-8 pb-3 text-white">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-black">Admin</h1>
        </div>
        <p className="mt-1 text-xs text-white/60">Operations console</p>
      </div>
      <nav className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-border bg-background px-4 py-2">
        {tabs.map((t) => {
          const active = pathname === t.to;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${
                active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
