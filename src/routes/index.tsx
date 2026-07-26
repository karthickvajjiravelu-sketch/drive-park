import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Zap, IndianRupee, ShieldCheck } from "lucide-react";
import heroImg from "@/assets/parking-hero.jpg";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/home" });
      else setChecking(false);
    });
  }, [navigate]);

  if (checking) {
    return (
      <div className="mobile-shell flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="mobile-shell">
      <div className="relative h-[62vh] min-h-[480px] overflow-hidden">
        <img
          src={heroImg}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          width={1024}
          height={1536}
        />
        <div className="absolute inset-0 hero-scrim" />
        <div className="relative z-10 flex flex-col h-full px-6 pt-10 pb-8 text-white">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary grid place-items-center text-primary-foreground font-black">
              U
            </div>
            <span className="text-lg font-black tracking-tight">Usop</span>
          </div>
          <div className="mt-auto">
            <span className="chip chip-yellow mb-4">India&apos;s parking marketplace</span>
            <h1 className="text-[2.6rem] leading-[1.05] font-black">
              Your space.
              <br />
              <span className="text-primary">Your spot.</span>
            </h1>
            <p className="mt-3 text-white/80 text-[15px] max-w-xs">
              Book verified parking in seconds — or list your driveway and earn every month.
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 -mt-8 relative z-20">
        <div className="card-elevated grid grid-cols-3 divide-x divide-border p-1">
          <Stat icon={<Zap className="w-4 h-4" />} value="10 sec" label="Booking" />
          <Stat icon={<ShieldCheck className="w-4 h-4" />} value="Verified" label="Hosts" />
          <Stat icon={<IndianRupee className="w-4 h-4" />} value="₹0 fees" label="For drivers" />
        </div>
      </div>

      <div className="px-6 pt-8 space-y-3">
        <Feature
          icon={<MapPin className="w-5 h-5" />}
          title="Live nearby spots"
          desc="See what's open right now on the map."
        />
        <Feature
          icon={<Zap className="w-5 h-5" />}
          title="Instant QR entry"
          desc="Reserve and show the QR at the gate."
        />
        <Feature
          icon={<IndianRupee className="w-5 h-5" />}
          title="Rent your space"
          desc="Turn your driveway into monthly income."
        />
      </div>

      <div className="px-6 pt-6 pb-8 space-y-3">
        <Link
          to="/auth"
          search={{ mode: "signup" }}
          className="block w-full rounded-2xl bg-primary py-4 text-center font-bold text-primary-foreground shadow-lg shadow-primary/25"
        >
          Get started — it&apos;s free
        </Link>
        <Link
          to="/auth"
          search={{ mode: "signin" }}
          className="block w-full rounded-2xl border-2 border-foreground/10 py-4 text-center font-semibold"
        >
          I already have an account
        </Link>
      </div>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="px-3 py-3 text-center">
      <div className="flex items-center justify-center gap-1 text-foreground">
        {icon}
        <span className="font-black text-sm">{value}</span>
      </div>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
        {label}
      </div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted p-4">
      <div className="shrink-0 w-10 h-10 rounded-xl bg-primary grid place-items-center text-primary-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}
