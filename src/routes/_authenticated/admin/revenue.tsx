import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAdminTransactions, useAdminUsers, PLATFORM_COMMISSION_RATE } from "@/lib/admin-queries";
import { AdminSection, AdminCard, StatCard, inr } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/revenue")({
  head: () => ({
    meta: [
      { title: "Revenue & commission · Usop admin" },
      {
        name: "description",
        content: "Platform revenue and commission for Usop, broken down by period and by host.",
      },
    ],
  }),
  component: AdminRevenue,
});

const periods = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All time" },
] as const;

function AdminRevenue() {
  const [period, setPeriod] = useState<(typeof periods)[number]["key"]>("30");
  const { data: rows = [], isLoading } = useAdminTransactions();
  const { data: users = [] } = useAdminUsers();

  const hostNames = useMemo(
    () => new Map(users.map((u) => [u.user_id, u.name || "Unnamed host"])),
    [users],
  );

  const { gross, commission, byHost, count } = useMemo(() => {
    const since =
      period === "all" ? 0 : Date.now() - Number(period) * 86400_000;
    const inRange = rows.filter(
      (r) => r.status !== "cancelled" && new Date(r.start_time).getTime() >= since,
    );
    const totals = new Map<string, { gross: number; bookings: number }>();
    let g = 0;
    for (const r of inRange) {
      const amount = Number(r.grand_total ?? r.total_price ?? 0);
      g += amount;
      const owner = r.slot?.owner_id ?? "unknown";
      const prev = totals.get(owner) ?? { gross: 0, bookings: 0 };
      totals.set(owner, { gross: prev.gross + amount, bookings: prev.bookings + 1 });
    }
    return {
      gross: g,
      commission: g * PLATFORM_COMMISSION_RATE,
      count: inRange.length,
      byHost: [...totals.entries()].sort((a, b) => b[1].gross - a[1].gross),
    };
  }, [rows, period]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <>
      <AdminSection title="Period">
        <div className="flex gap-2">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                period === p.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Bookings" value={count} />
          <StatCard label="Gross" value={inr(gross)} />
          <StatCard
            label={`Commission ${Math.round(PLATFORM_COMMISSION_RATE * 100)}%`}
            value={inr(commission)}
          />
        </div>
      </AdminSection>

      <AdminSection title="By host">
        {byHost.map(([ownerId, v]) => (
          <AdminCard key={ownerId}>
            <div className="flex items-center justify-between">
              <span className="font-bold">{hostNames.get(ownerId) ?? "Unknown host"}</span>
              <span className="text-sm font-black">{inr(v.gross)}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {v.bookings} bookings · payout {inr(v.gross * (1 - PLATFORM_COMMISSION_RATE))} ·
              commission {inr(v.gross * PLATFORM_COMMISSION_RATE)}
            </div>
          </AdminCard>
        ))}
        {byHost.length === 0 && (
          <p className="text-sm text-muted-foreground">No revenue in this period.</p>
        )}
      </AdminSection>
    </>
  );
}
