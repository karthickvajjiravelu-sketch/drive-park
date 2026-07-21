import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useProfile } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/home")({
  component: Home,
});

function Home() {
  const { data: profile, isLoading } = useProfile();
  const navigate = useNavigate();

  useEffect(() => {
    if (!profile) return;
    navigate({ to: profile.role === "driver" ? "/map" : "/my-slots", replace: true });
  }, [profile, navigate]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  return null;
}
