// Bearer-token auth + JSON helpers for /api/public/* routes used by the mobile app.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
type UserCtx = { supabase: SupabaseClient<Database>; userId: string };

const ALLOWED_ORIGINS = ["https://www.usop.in", "https://usop.in"];

export function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export const json = (request: Request, body: unknown, status = 200) =>
  Response.json(body, { status, headers: cors(request) });

export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Validate `Authorization: Bearer <supabase access token>` and build a user-scoped client. */
export async function authenticate(request: Request): Promise<UserCtx> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError("Missing bearer token", 401);
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("Authorization", `Bearer ${token}`);
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const sub = data?.claims?.sub;
  if (error || !sub) throw new HttpError("Invalid or expired token", 401);
  return { supabase, userId: sub };
}

/** Wrap a handler: auth, JSON body, consistent error responses. */
export function handle(fn: (args: { request: Request; ctx: UserCtx; body: unknown; params: Record<string, string> }) => Promise<unknown>) {
  return async ({ request, params }: { request: Request; params: Record<string, string> }) => {
    try {
      const ctx = await authenticate(request);
      const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
      return json(request, await fn({ request, ctx, body, params }));
    } catch (e) {
      const { BookingError } = await import("@/lib/bookings.server");
      const { ZodError } = await import("zod");
      if (e instanceof HttpError || e instanceof BookingError) return json(request, { error: e.message }, e.status);
      if (e instanceof ZodError) return json(request, { error: "Invalid input", issues: e.issues }, 400);
      const msg = e instanceof Error ? e.message : "";
      if (/not found|unauthorized/i.test(msg)) return json(request, { error: "Not found" }, 404);
      if (/already paid|cancelled|expired|not set up|signature/i.test(msg)) return json(request, { error: msg }, 400);
      console.error(e);
      return json(request, { error: "Internal error" }, 500);
    }
  };
}

export const options = ({ request }: { request: Request }) => new Response(null, { status: 204, headers: cors(request) });
