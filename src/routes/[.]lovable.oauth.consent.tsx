import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type AuthorizationDetails = {
  client?: { name?: string; redirect_uri?: string } | null;
  scope?: string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
};

function oauth(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } as never });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mobile-shell p-6">
      <h1 className="text-xl font-bold">Authorization error</h1>
      <p className="mt-2 text-sm text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) { setBusy(false); setError(error.message); return; }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); setError("No redirect returned by the authorization server."); return; }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an app";

  return (
    <main className="mobile-shell">
      <div className="bg-[var(--surface-dark)] text-white px-6 pt-12 pb-8 rounded-b-3xl">
        <h1 className="text-2xl font-black">Connect {clientName} to Usop</h1>
        <p className="mt-2 text-sm text-white/70">
          This lets {clientName} use Usop as you — browse slots, view your reservations, and manage your own listings.
        </p>
      </div>

      <div className="px-6 py-6 space-y-4">
        <div className="rounded-2xl border border-border p-4 text-sm">
          <div className="font-semibold">You are signing in as yourself.</div>
          <div className="text-muted-foreground mt-1">
            {clientName} will only be able to do what your Usop account allows. Your data stays scoped to you.
          </div>
        </div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <button
          disabled={busy}
          onClick={() => decide(true)}
          className="w-full rounded-2xl bg-primary py-4 font-bold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "…" : `Approve`}
        </button>
        <button
          disabled={busy}
          onClick={() => decide(false)}
          className="w-full rounded-2xl bg-black text-white py-3 font-semibold disabled:opacity-60"
        >
          Cancel connection
        </button>
      </div>
    </main>
  );
}
