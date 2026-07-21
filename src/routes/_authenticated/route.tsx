import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/lib/queries";
import { BottomTabs } from "@/components/BottomTabs";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { userId: data.user.id };
  },
  component: Shell,
});

function Shell() {
  const { data: profile, isLoading } = useProfile();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        qc.clear();
        router.navigate({ to: "/auth", replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, qc]);

  if (isLoading || !profile) {
    return <div className="mobile-shell flex items-center justify-center"><div className="text-sm text-muted-foreground">Loading…</div></div>;
  }

  return (
    <div className="mobile-shell">
      <Outlet />
      <BottomTabs role={profile.role} />
    </div>
  );
}
