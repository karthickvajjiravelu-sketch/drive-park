import { Link } from "@tanstack/react-router";
import { Map, Calendar, User, LayoutGrid, ClipboardList } from "lucide-react";
import type { Profile } from "@/lib/queries";

export function BottomTabs({ role }: { role: Profile["role"] }) {
  const items =
    role === "driver"
      ? [
          { to: "/map", icon: Map, label: "Map" },
          { to: "/reservations", icon: Calendar, label: "Bookings" },
          { to: "/profile", icon: User, label: "Profile" },
        ]
      : [
          { to: "/my-slots", icon: LayoutGrid, label: "My Slots" },
          { to: "/bookings", icon: ClipboardList, label: "Bookings" },
          { to: "/profile", icon: User, label: "Profile" },
        ];

  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-[var(--surface-dark)] text-white z-50"
    >
      <div className="flex items-center justify-around py-2 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {items.map(({ to, icon: Icon, label }) => (
          <Link
            key={to}
            to={to}
            className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 flex-1 py-1 rounded-xl text-white/70 [&.active]:text-accent"
            activeProps={{ className: "active", "aria-current": "page" }}
          >
            <Icon className="w-6 h-6" aria-hidden />
            <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
