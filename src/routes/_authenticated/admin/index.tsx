import { createFileRoute, Link } from "@tanstack/react-router";
import { useAdminOverview, PLATFORM_COMMISSION_RATE } from "@/lib/admin-queries";
import { AdminSection, StatCard, inr } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Admin overview · Usop operations" },
      {
        name: "description",
        content:
          "Platform overview for Usop operators: users, listings awaiting approval, disputes and revenue.",
      },
    ],
  }),
  component: AdminOverview,
});

function AdminOverview() {
  const { data, isLoading } = useAdminOverview();

  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <>
      <AdminSection title="Needs attention">
        <div className="grid grid-cols-3 gap-3">
          <Link to="/admin/listings">
            <StatCard label="Pending listings" value={data.pendingSlots} />
          </Link>
          <Link to="/admin/disputes">
            <StatCard label="Open disputes" value={data.openDisputes} />
          </Link>
          <Link to="/admin/reviews">
            <StatCard label="Reported reviews" value={data.reportedReviews} />
          </Link>
        </div>
      </AdminSection>

      <AdminSection title="Marketplace">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Users" value={data.users} />
          <StatCard label="Hosts" value={data.hosts} />
          <StatCard label="Listings" value={data.slots} />
          <StatCard label="Bookings (30d)" value={data.bookings30d} />
        </div>
      </AdminSection>

      <AdminSection title="Revenue">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="GMV (30d)" value={inr(data.revenue30d)} />
          <StatCard
            label={`Commission (30d, ${Math.round(PLATFORM_COMMISSION_RATE * 100)}%)`}
            value={inr(data.revenue30d * PLATFORM_COMMISSION_RATE)}
          />
          <StatCard label="GMV lifetime" value={inr(data.revenueLifetime)} />
          <StatCard
            label="Commission lifetime"
            value={inr(data.revenueLifetime * PLATFORM_COMMISSION_RATE)}
          />
        </div>
      </AdminSection>
    </>
  );
}
