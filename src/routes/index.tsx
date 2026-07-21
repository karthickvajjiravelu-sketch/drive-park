import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Car, DollarSign } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate({ to: "/home" });
      } else {
        setChecking(false);
      }
    });
  }, [navigate]);

  if (checking) {
    return <div className="mobile-shell flex items-center justify-center"><div className="text-sm text-muted-foreground">Loading…</div></div>;
  }

  return (
    <div className="mobile-shell">
      <div className="bg-[var(--surface-dark)] text-white px-6 pt-16 pb-12 rounded-b-3xl">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary grid place-items-center text-primary-foreground font-black">U</div>
          <span className="text-xl font-black tracking-tight">Usop</span>
        </div>
        <h1 className="text-4xl font-black leading-tight">Park anywhere.<br/>Earn from anywhere.</h1>
        <p className="mt-3 text-white/70 text-sm">Find nearby parking in seconds, or rent out your unused space.</p>
      </div>

      <div className="px-6 py-8 space-y-4">
        <Feature icon={<MapPin className="w-5 h-5"/>} title="Live nearby spots" desc="See what's open right now on the map."/>
        <Feature icon={<Car className="w-5 h-5"/>} title="Instant booking" desc="Reserve and get a QR pass to enter."/>
        <Feature icon={<DollarSign className="w-5 h-5"/>} title="Rent your space" desc="Turn your driveway into monthly income."/>
      </div>

      <div className="px-6 pt-4 pb-8 space-y-3">
        <Link to="/auth" search={{ mode: "signup" }} className="block w-full rounded-2xl bg-primary py-4 text-center font-bold text-primary-foreground">Create account</Link>
        <Link to="/auth" search={{ mode: "signin" }} className="block w-full rounded-2xl border border-border py-4 text-center font-semibold">Sign in</Link>
      </div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-muted p-4">
      <div className="shrink-0 w-10 h-10 rounded-xl bg-primary grid place-items-center text-primary-foreground">{icon}</div>
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}
