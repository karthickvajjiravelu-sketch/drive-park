import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useProfile } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LogOut, Car, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) { setName(profile.name); setPhone(profile.phone); }
  }, [profile]);

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ name, phone }).eq("id", profile!.id);
    if (error) toast.error(error.message);
    else toast.success("Saved");
    setSaving(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (!profile) return null;

  return (
    <div>
      <div className="bg-[var(--surface-dark)] text-white px-5 pt-8 pb-6">
        <h1 className="text-2xl font-black">Profile</h1>
        <div className="mt-2 inline-block px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase">{profile.role}</div>
      </div>
      <div className="px-5 py-4 space-y-4">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Name</span>
          <input value={name} onChange={e => setName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-3"/>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Phone</span>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            pattern="[0-9]{10}" title="Enter a 10-digit phone number"
            className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-3"/>
        </label>
        <button disabled={saving} onClick={save}
          className="w-full rounded-2xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-60">Save</button>
        {profile.role === "driver" && (
          <Link to="/vehicles" className="w-full rounded-2xl bg-card border border-border py-3 px-4 flex items-center justify-between font-semibold">
            <span className="flex items-center gap-2"><Car className="w-4 h-4"/>My Garage</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground"/>
          </Link>
        )}
        <button onClick={signOut}
          className="w-full rounded-2xl bg-black text-white py-3 font-semibold flex items-center justify-center gap-2">
          <LogOut className="w-4 h-4"/>Sign out
        </button>
      </div>
    </div>
  );
}
