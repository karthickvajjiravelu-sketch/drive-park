import { createFileRoute, Link } from "@tanstack/react-router";
import { useOwnerBookings } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/earnings")({
  component: Earnings,
});

function Earnings() {
  const { data: bookings = [] } = useOwnerBookings();
  const completed = bookings.filter(b => b.status === "completed");
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0,0,0,0);

  const thisMonth = completed.filter(b => new Date(b.start_time) >= monthStart);
  const monthTotal = thisMonth.reduce((a,b) => a + Number(b.total_price), 0);
  const lifetime = completed.reduce((a,b) => a + Number(b.total_price), 0);

  const bySlot = new Map<string, { name: string; total: number }>();
  thisMonth.forEach(b => {
    const key = b.slot_id;
    const prev = bySlot.get(key) ?? { name: b.slot?.name ?? "Slot", total: 0 };
    prev.total += Number(b.total_price);
    bySlot.set(key, prev);
  });

  return (
    <div>
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-6">
        <Link to="/my-slots" className="text-white/60 text-xs">← Back to slots</Link>
        <h1 className="text-2xl font-black mt-2">Earnings</h1>
        <div className="mt-4 rounded-2xl bg-primary p-5 text-primary-foreground">
          <div className="text-xs uppercase font-bold">This month</div>
          <div className="text-4xl font-black mt-1">₹{monthTotal.toLocaleString()}</div>
          <div className="text-xs mt-1 opacity-70">Lifetime: ₹{lifetime.toLocaleString()}</div>
        </div>
      </div>
      <div className="px-4 py-4 space-y-2">
        <h2 className="text-xs font-bold uppercase text-muted-foreground">By slot (this month)</h2>
        {[...bySlot.values()].map((s, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl bg-card border border-border p-3">
            <span className="font-semibold">{s.name}</span>
            <span className="font-bold">₹{s.total.toLocaleString()}</span>
          </div>
        ))}
        {bySlot.size === 0 && <p className="text-sm text-muted-foreground text-center py-6">No completed bookings this month.</p>}
      </div>
    </div>
  );
}
